/**
 * THE SAFETY ENGINE.
 *
 * Pure function. No network, no React, no camera, no I/O, no logging.
 * Same input -> same output, always.
 *
 * INVARIANT (enforced by tests in assessAllergenRisk.test.ts):
 *   `no_known_risk` is reachable ONLY when at least one sufficiently reliable
 *   allergen-capable source actively reported BOTH a "contains" list and a
 *   "may contain" list, and neither mentioned the allergen, and no source
 *   contradicted it.
 *
 *   Everything else — missing fields, empty fields, errors, timeouts, not
 *   found, identity-only sources, conflicts — yields `insufficient_data`.
 *   Any positive indication anywhere yields `danger` and can never be
 *   cancelled by a silent source.
 */

import type { AllergenCode } from './allergenTypes.ts';
import type { AllergyAssessment, AllergyEvidence } from './assessment.ts';
import { getMatcher, matchAllergenInList, matchAllergenInText } from './allergenMatchers.ts';
import type { SourceConflict } from '../product/productIdentity.ts';
import {
  RELIABILITY_RANK,
  isAllergenDataUsable,
  type ProductEvidence,
  type SourceReliability,
} from '../product/productEvidence.ts';

export interface AssessmentInput {
  readonly allergen: AllergenCode;
  readonly evidence: readonly ProductEvidence[];
  /** Conflicts detected during aggregation (identity mismatches, …). */
  readonly conflicts?: readonly SourceConflict[];
  /**
   * Provider lookups that produced no evidence (error / not found / disabled).
   * They can never clear a product, but they are recorded for transparency.
   */
  readonly unavailableSources?: readonly UnavailableSource[];
  readonly options?: AssessmentOptions;
}

export interface UnavailableSource {
  readonly providerId: string;
  readonly providerName: string;
  readonly reason: 'not_found' | 'error';
  readonly detail: string;
}

export interface AssessmentOptions {
  /** A source below this reliability may raise an alarm but may never clear. */
  readonly minimumReliabilityToClear?: SourceReliability;
}

const DEFAULT_OPTIONS: Required<AssessmentOptions> = {
  minimumReliabilityToClear: 'medium',
};

function canClear(reliability: SourceReliability, minimum: SourceReliability): boolean {
  return RELIABILITY_RANK[reliability] >= RELIABILITY_RANK[minimum];
}

function sourceMeta(evidence: ProductEvidence) {
  return {
    providerId: evidence.providerId,
    providerName: evidence.providerName,
    sourceType: evidence.sourceType,
    reliability: evidence.reliability,
  } as const;
}

/**
 * Does this source actually carry allergen-relevant content? An entirely empty
 * record is treated as "unknown", never as "contains nothing".
 */
function hasSubstantiveContent(evidence: ProductEvidence): boolean {
  return (
    evidence.containsAllergens.length > 0 ||
    evidence.mayContainAllergens.length > 0 ||
    Boolean(evidence.ingredientsText?.trim()) ||
    Boolean(evidence.ingredientsTextHebrew?.trim())
  );
}

/** Free text we are willing to scan for allergen mentions. */
function collectScannableText(evidence: ProductEvidence): string {
  return [
    evidence.ingredientsText,
    evidence.ingredientsTextHebrew,
    ...evidence.containsAllergens,
    ...evidence.mayContainAllergens,
    ...evidence.warnings,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' \n ');
}

export function assessAllergenRisk(input: AssessmentInput): AllergyAssessment {
  const { allergen } = input;
  const matcher = getMatcher(allergen);
  const options = { ...DEFAULT_OPTIONS, ...input.options };
  const evidenceList = input.evidence ?? [];
  const conflicts = input.conflicts ?? [];
  const unavailable = input.unavailableSources ?? [];

  const findings: AllergyEvidence[] = [];
  const containsHits: AllergyEvidence[] = [];
  const mayContainHits: AllergyEvidence[] = [];
  const textHits: AllergyEvidence[] = [];
  const clearingSources: AllergyEvidence[] = [];

  let sawAllergenCapableSource = false;
  let sawMissingAllergenData = false;
  let sawMissingMayContainData = false;
  let sawReliabilityTooLow = false;
  let sawInsubstantialData = false;

  for (const evidence of evidenceList) {
    if (!evidence.providesAllergenEvidence) {
      findings.push({
        ...sourceMeta(evidence),
        kind: 'identity_only_source',
        detail: 'Source provides product identity only and cannot clear allergens.',
      });
      continue;
    }
    sawAllergenCapableSource = true;

    // 1. Structured "contains" declaration — strongest signal.
    const containsMatch = matchAllergenInList(evidence.containsAllergens, matcher);
    if (containsMatch.matched) {
      containsHits.push({
        ...sourceMeta(evidence),
        kind: 'contains_declared',
        detail: `Declared in the "contains" list: ${containsMatch.matchedTerms.join(', ')}`,
        matchedTerms: containsMatch.matchedTerms,
      });
    }

    // 2. Structured "may contain" / traces declaration — treated as danger.
    const mayContainMatch = matchAllergenInList(evidence.mayContainAllergens, matcher);
    if (mayContainMatch.matched) {
      mayContainHits.push({
        ...sourceMeta(evidence),
        kind: 'may_contain_declared',
        detail: `Declared in the "may contain"/traces list: ${mayContainMatch.matchedTerms.join(', ')}`,
        matchedTerms: mayContainMatch.matchedTerms,
      });
    }

    // 3. Free-text mention (ingredients, warnings) that is not a "free from" claim.
    const textMatch = matchAllergenInText(collectScannableText(evidence), matcher);
    if (textMatch.matched) {
      textHits.push({
        ...sourceMeta(evidence),
        kind: 'text_match',
        detail: `Mentioned in source text: ${textMatch.matchedTerms.join(', ')}`,
        matchedTerms: textMatch.matchedTerms,
      });
    }

    if (containsMatch.matched || mayContainMatch.matched || textMatch.matched) {
      continue;
    }

    // No indication from this source. Can it actually clear the product?
    const allergenUsable = isAllergenDataUsable(evidence.allergenDataStatus);
    const mayContainUsable = isAllergenDataUsable(evidence.mayContainDataStatus);

    if (!allergenUsable) {
      sawMissingAllergenData = true;
      findings.push({
        ...sourceMeta(evidence),
        kind: 'allergen_data_missing',
        detail: `Allergen information unusable (status: ${evidence.allergenDataStatus}).`,
      });
    }
    if (!mayContainUsable) {
      sawMissingMayContainData = true;
      findings.push({
        ...sourceMeta(evidence),
        kind: 'may_contain_data_missing',
        detail: `"May contain" information unusable (status: ${evidence.mayContainDataStatus}).`,
      });
    }
    if (!allergenUsable || !mayContainUsable) continue;

    // Defense in depth: a source may claim both fields are "reported" while
    // carrying nothing at all. An empty declaration with no ingredients text is
    // indistinguishable from an unfilled record, so it may not clear a product.
    if (!hasSubstantiveContent(evidence)) {
      sawInsubstantialData = true;
      findings.push({
        ...sourceMeta(evidence),
        kind: 'allergen_data_insubstantial',
        detail: 'Source claims complete allergen data but reported no allergens, no traces and no ingredients.',
      });
      continue;
    }

    if (!canClear(evidence.reliability, options.minimumReliabilityToClear)) {
      sawReliabilityTooLow = true;
      findings.push({
        ...sourceMeta(evidence),
        kind: 'no_indication',
        detail: `No indication found, but reliability "${evidence.reliability}" is below the clearing threshold.`,
      });
      continue;
    }

    clearingSources.push({
      ...sourceMeta(evidence),
      kind: 'no_indication',
      detail: 'Complete "contains" and "may contain" data reported, with no indication of the allergen.',
    });
  }

  for (const source of unavailable) {
    findings.push({
      providerId: source.providerId,
      providerName: source.providerName,
      sourceType: 'crowdsourced',
      reliability: 'low',
      kind: 'source_unavailable',
      detail: `${source.reason}: ${source.detail}`,
    });
  }

  const positiveHits = [...containsHits, ...mayContainHits, ...textHits];
  const hasConflict =
    conflicts.length > 0 || (positiveHits.length > 0 && clearingSources.length > 0);

  // ---- DANGER: any positive indication wins, unconditionally. ----
  if (containsHits.length > 0) {
    return {
      status: 'danger',
      allergen,
      reasonCode: 'CONTAINS_DECLARED',
      reason: `The allergen is declared in the "contains" list by: ${containsHits.map((hit) => hit.providerId).join(', ')}.`,
      evidence: [...positiveHits, ...clearingSources, ...findings],
      hasConflict,
    };
  }
  if (mayContainHits.length > 0) {
    return {
      status: 'danger',
      allergen,
      reasonCode: 'MAY_CONTAIN_DECLARED',
      reason: `The allergen is declared as "may contain"/traces by: ${mayContainHits.map((hit) => hit.providerId).join(', ')}.`,
      evidence: [...positiveHits, ...clearingSources, ...findings],
      hasConflict,
    };
  }
  if (textHits.length > 0) {
    return {
      status: 'danger',
      allergen,
      reasonCode: 'ALLERGEN_FOUND_IN_TEXT',
      reason: `The allergen is mentioned in source text by: ${textHits.map((hit) => hit.providerId).join(', ')}.`,
      evidence: [...positiveHits, ...clearingSources, ...findings],
      hasConflict,
    };
  }

  // ---- No positive indication. Decide between insufficient_data and clearance. ----
  const insufficient = (
    reasonCode: AllergyAssessment['reasonCode'],
    reason: string,
  ): AllergyAssessment => ({
    status: 'insufficient_data',
    allergen,
    reasonCode,
    reason,
    evidence: [...clearingSources, ...findings],
    hasConflict,
  });

  if (evidenceList.length === 0) {
    return insufficient(
      unavailable.length > 0 && unavailable.every((source) => source.reason === 'not_found')
        ? 'PRODUCT_NOT_FOUND'
        : 'NO_SOURCES_RESPONDED',
      unavailable.length === 0
        ? 'No source returned any evidence for this barcode.'
        : `No usable evidence. Sources: ${unavailable.map((source) => `${source.providerId}=${source.reason}`).join(', ')}.`,
    );
  }

  if (!sawAllergenCapableSource) {
    return insufficient(
      'NO_ALLERGEN_CAPABLE_SOURCE',
      'Only identity-only sources answered. Product identity alone can never clear an allergen.',
    );
  }

  if (clearingSources.length === 0) {
    if (sawMissingAllergenData) {
      return insufficient(
        'ALLERGEN_DATA_MISSING',
        'No source reported usable allergen information for this product.',
      );
    }
    if (sawMissingMayContainData) {
      return insufficient(
        'MAY_CONTAIN_DATA_MISSING',
        'Allergen information exists, but no source reported usable "may contain"/traces information.',
      );
    }
    if (sawInsubstantialData) {
      return insufficient(
        'ALLERGEN_DATA_INSUBSTANTIAL',
        'A source reported allergen fields with no actual content, which cannot be distinguished from an unfilled record.',
      );
    }
    if (sawReliabilityTooLow) {
      return insufficient(
        'SOURCE_RELIABILITY_TOO_LOW',
        'The only sources without an indication are below the reliability threshold required to clear a product.',
      );
    }
    return insufficient('ALLERGEN_DATA_MISSING', 'No source could clear this product.');
  }

  // A clearing source exists — but conflicting identity means we may be looking
  // at allergen data for a different product. Stay conservative.
  if (conflicts.length > 0) {
    return insufficient(
      'PRODUCT_IDENTITY_CONFLICT',
      `Sources disagree, so their allergen data cannot be trusted for this product: ${conflicts
        .map((conflict) => conflict.description)
        .join(' | ')}`,
    );
  }

  return {
    status: 'no_known_risk',
    allergen,
    reasonCode: 'NO_INDICATION_IN_COMPLETE_DATA',
    reason: `Complete allergen and "may contain" data from ${clearingSources
      .map((source) => source.providerId)
      .join(', ')} shows no indication of the allergen.`,
    evidence: [...clearingSources, ...findings],
    hasConflict,
  };
}

/** Peanut-specific entry point used by the MVP. */
export function assessPeanutRisk(input: Omit<AssessmentInput, 'allergen'>): AllergyAssessment {
  return assessAllergenRisk({ ...input, allergen: 'peanut' });
}
