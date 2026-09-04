/**
 * Turns recognized package text into structured PackageEvidence.
 *
 * Pure function: no network, no React, no OCR engine. Every OCR/Vision provider
 * funnels its output through here, so the interpretation rules — and therefore
 * the safety behaviour — are identical whatever produced the text.
 *
 * DESIGN NOTES
 * ------------
 * 1. The text is analyzed SEGMENT BY SEGMENT (one label line at a time) rather
 *    than as one blob. A label commonly reads "ללא גלוטן. מכיל בוטנים." and a
 *    whole-blob negation window would be free to attach the "ללא" to the wrong
 *    allergen. Per-segment matching keeps each declaration in its own scope.
 *
 * 2. Findings are written into `containsAllergens` / `mayContainAllergens`,
 *    which the safety engine reads with `matchAllergenInList` — a declaration
 *    list, deliberately not negation-sensitive. So a finding that survived the
 *    per-segment negation check here cannot be silently lost later.
 *
 * 3. OCR misreads letters. Beyond exact matching we run two tolerant passes:
 *    Latin look-alike correction (0/O, 1/l, 5/S, rn/m …) and a distance-1
 *    fuzzy check for the peanut word itself. Tolerant matches are ONLY made in
 *    segments with no "free from" wording, and are always flagged
 *    `viaOcrCorrection` so a developer can see why the app escalated.
 *
 * 4. Image quality NEVER suppresses a finding. A blurry photo that still says
 *    "PEANUT" is RED. Quality only decides how loudly we tell the user that a
 *    *lack* of findings proves nothing.
 */

import { PEANUT_MATCHER, matchAllergenInText, normalizeForMatching } from '../../domain/allergy/allergenMatchers.ts';
import type {
  ImageQuality,
  PackageEvidence,
  PackageStatement,
  PackageStatementKind,
} from '../../domain/package/packageEvidence.ts';
import type { SourceReliability } from '../../domain/product/productEvidence.ts';

/** Precautionary ("may contain") wording. Checked before the contains wording. */
const MAY_CONTAIN_MARKERS = [
  'עלול להכיל',
  'עלולים להכיל',
  'עשוי להכיל',
  'עשויים להכיל',
  'עלול לכלול',
  'עקבות',
  'שאריות',
  'מיוצר במפעל',
  'מיוצר בפס ייצור',
  'באותו פס ייצור',
  'may contain',
  'may also contain',
  'traces',
  'trace of',
  'produced in a facility',
  'manufactured in a facility',
  'made on equipment',
  'same production line',
] as const;

/** Positive declaration / ingredient-panel wording. */
const CONTAINS_MARKERS = [
  'מכיל',
  'מכילים',
  'רכיבים',
  'מרכיבים',
  'אלרגנים',
  'contains',
  'ingredients',
  'allergen',
  'allergens',
] as const;

/**
 * Front-of-pack product identities. A pack whose face says "Peanut Butter" is
 * dangerous even when the allergen panel was never photographed.
 */
const PRODUCT_NAME_MARKERS = [
  'חמאת בוטנים',
  'ממרח בוטנים',
  'חטיף בוטנים',
  'peanut butter',
  'peanutbutter',
  'peanut spread',
  'peanut paste',
  'peanut cream',
] as const;

/** Wording that declares the ABSENCE of the allergen; disables tolerant matching. */
const NEGATION_MARKERS = [
  'ללא',
  'לא מכיל',
  'אינו מכיל',
  'נטול',
  'free from',
  'free of',
  'peanut free',
  'nut free',
  'does not contain',
] as const;

/** Latin characters OCR routinely swaps on printed labels. */
const LATIN_CONFUSIONS: readonly (readonly [RegExp, string])[] = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/[0]/g, 'o'],
  [/[1|!]/g, 'l'],
  [/5/g, 's'],
  [/8/g, 'b'],
  [/6/g, 'g'],
  [/\$/g, 's'],
  [/@/g, 'a'],
];

/** Words checked with edit distance 1, alongside the minimum token length. */
const FUZZY_TARGETS: readonly { readonly word: string; readonly minLength: number }[] = [
  { word: 'בוטנים', minLength: 5 },
  { word: 'peanut', minLength: 5 },
  { word: 'peanuts', minLength: 6 },
];

/** Below this many recognized characters the photo is unusable as a negative. */
const MIN_USABLE_TEXT_LENGTH = 12;
/** Below this the photo is only a partial read. */
const PARTIAL_TEXT_LENGTH = 40;
const POOR_CONFIDENCE = 40;
const PARTIAL_CONFIDENCE = 65;

export interface PackageTextAnalysisInput {
  readonly providerId: string;
  readonly providerName: string;
  readonly analysisMethod: string;
  readonly reliability: SourceReliability;
  readonly text: string;
  readonly confidence?: number;
  readonly durationMs: number;
  /** Provider-level notes (small image, engine warnings, …). */
  readonly warnings?: readonly string[];
  readonly rawAnalysisAvailable?: boolean;
  readonly analyzedAt?: string;
}

/** Splits recognized text into individually-scoped label segments. */
export function segmentPackageText(text: string): string[] {
  return text
    .split(/[\n\r•·|;]+|(?<=[.!?])\s+/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function applyLatinConfusions(value: string): string {
  let corrected = value.toLowerCase();
  for (const [pattern, replacement] of LATIN_CONFUSIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  return corrected;
}

function hasMarker(normalized: string, markers: readonly string[]): boolean {
  return markers.some((marker) => normalized.includes(normalizeForMatching(marker)));
}

/** Bounded Levenshtein: returns true when the distance is at most `max`. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > max) return false;
    previous = current;
  }
  return previous[b.length]! <= max;
}

/** Distance-1 hits for the peanut word, to survive a single OCR character error. */
function fuzzyPeanutTerms(normalizedSegment: string): string[] {
  const found: string[] = [];
  for (const token of normalizedSegment.split(/\s+/u)) {
    if (token.length < 4) continue;
    for (const target of FUZZY_TARGETS) {
      if (token.length < target.minLength) continue;
      if (token === target.word) continue; // exact hits are handled by the strict pass
      if (withinEditDistance(token, target.word, 1)) found.push(token);
    }
  }
  return [...new Set(found)];
}

/**
 * Precautionary wording is checked first: "עלול להכיל" and "may contain" must
 * never be filed as a plain "contains" declaration.
 */
function classifySegment(normalized: string): PackageStatementKind {
  if (hasMarker(normalized, PRODUCT_NAME_MARKERS)) return 'product_name';
  if (hasMarker(normalized, MAY_CONTAIN_MARKERS)) return 'may_contain';
  if (hasMarker(normalized, CONTAINS_MARKERS)) return 'contains';
  return 'mention';
}

/** Keeps quoted segments short enough to display without swamping the screen. */
function trimForDisplay(segment: string): string {
  const collapsed = segment.replace(/\s+/gu, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}…` : collapsed;
}

function assessImageQuality(text: string, confidence: number | undefined): ImageQuality {
  const length = text.replace(/\s+/gu, '').length;
  if (length < MIN_USABLE_TEXT_LENGTH) return 'poor';
  if (confidence !== undefined && confidence < POOR_CONFIDENCE) return 'poor';
  if (length < PARTIAL_TEXT_LENGTH) return 'partial';
  if (confidence !== undefined && confidence < PARTIAL_CONFIDENCE) return 'partial';
  return 'good';
}

export function analyzePackageText(input: PackageTextAnalysisInput): PackageEvidence {
  const text = input.text ?? '';
  const statements: PackageStatement[] = [];
  const detectedTerms = new Set<string>();

  for (const segment of segmentPackageText(text)) {
    const normalized = normalizeForMatching(segment);
    if (!normalized) continue;

    // Pass 1 — strict, using the shared allergen matcher with its own
    // negation handling ("ללא בוטנים" / "peanut free" do not match).
    const strict = matchAllergenInText(segment, PEANUT_MATCHER);
    let matchedTerms = strict.matchedTerms;
    let viaOcrCorrection = false;

    // Pass 2 — Latin look-alike correction, only where nothing was negated.
    if (matchedTerms.length === 0 && !strict.onlyNegatedMatches) {
      const corrected = matchAllergenInText(applyLatinConfusions(segment), PEANUT_MATCHER);
      if (corrected.matched) {
        matchedTerms = corrected.matchedTerms;
        viaOcrCorrection = true;
      }
    }

    // Pass 3 — distance-1 fuzzy. Never applied to a segment that declares the
    // absence of the allergen: a misread "ללא בוטנים" must not become RED.
    if (matchedTerms.length === 0 && !hasMarker(normalized, NEGATION_MARKERS)) {
      const fuzzy = fuzzyPeanutTerms(normalized);
      if (fuzzy.length > 0) {
        matchedTerms = fuzzy;
        viaOcrCorrection = true;
      }
    }

    if (matchedTerms.length === 0) continue;

    for (const term of matchedTerms) detectedTerms.add(term);
    statements.push({
      kind: classifySegment(normalized),
      text: trimForDisplay(segment),
      matchedTerms,
      viaOcrCorrection,
    });
  }

  const mayContainAllergens = statements
    .filter((statement) => statement.kind === 'may_contain')
    .map((statement) => statement.text);
  const containsAllergens = statements
    .filter((statement) => statement.kind !== 'may_contain')
    .map((statement) => statement.text);

  const imageQuality = assessImageQuality(text, input.confidence);
  const warnings = [...(input.warnings ?? [])];

  if (imageQuality === 'poor') {
    warnings.push('Image produced little or low-confidence text; a negative result proves nothing.');
  } else if (imageQuality === 'partial') {
    warnings.push('Only part of the label was read confidently.');
  }
  if (statements.some((statement) => statement.viaOcrCorrection)) {
    warnings.push('At least one finding required OCR error correction; wording may be approximate.');
  }

  return {
    providerId: input.providerId,
    providerName: input.providerName,
    analysisMethod: input.analysisMethod,
    sourceType: 'package_scan',
    reliability: input.reliability,
    extractedText: text,
    textConfidence: input.confidence,
    containsAllergens,
    mayContainAllergens,
    statements,
    detectedProductTerms: [...detectedTerms],
    explicitPeanutEvidence: statements.length > 0,
    imageQuality,
    warnings,
    rawAnalysisAvailable: input.rawAnalysisAvailable ?? false,
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    durationMs: input.durationMs,
  };
}
