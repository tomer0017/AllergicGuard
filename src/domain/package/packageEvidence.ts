/**
 * Evidence produced by analyzing a PHOTO of the package (OCR / Vision).
 *
 * THE VISION SAFETY RULE
 * ----------------------
 * A photo analysis may escalate a product to RED. It may NEVER, on its own,
 * produce GREEN. "The model did not read the word peanut" is not evidence of
 * absence: the photo may be blurry, cropped, badly lit, or of the wrong panel.
 *
 * This is enforced STRUCTURALLY, not by convention. `toProductEvidence()` is
 * the only bridge from this model into the safety engine, and it hard-codes
 *
 *     allergenDataStatus:   'empty'
 *     mayContainDataStatus: 'empty'
 *
 * which the engine treats as "unknown". A source with those statuses can never
 * reach the `clearingSources` branch of assessAllergenRisk, so no package photo
 * can ever contribute to `no_known_risk`. Positive findings, in contrast, land
 * in `containsAllergens` / `mayContainAllergens` / `ingredientsText`, all of
 * which the engine reads as danger.
 *
 * Do not add a code path that sets these statuses to 'reported'.
 * `packageEvidence.test.ts` fails the build if one appears.
 */

import type { ProductEvidence, SourceReliability } from '../product/productEvidence.ts';

export type ImageQuality = 'good' | 'partial' | 'poor';

/** How an explicit finding was worded on the package. */
export type PackageStatementKind =
  /** "מכיל בוטנים" / "contains peanuts" / an ingredient line. */
  | 'contains'
  /** "עלול להכיל" / "may contain" / "traces of". */
  | 'may_contain'
  /** Front-of-pack product identity: "Peanut Butter" / "חמאת בוטנים". */
  | 'product_name'
  /**
   * The allergen appears on the package but not inside a recognizable
   * declaration. Still treated as danger — an unexplained "בוטנים" on a wrapper
   * is not something to reason away — but reported honestly as a mention.
   */
  | 'mention';

export interface PackageStatement {
  readonly kind: PackageStatementKind;
  /** The text segment the finding was read from, trimmed for display. */
  readonly text: string;
  /** Normalized allergen terms that matched inside the segment. */
  readonly matchedTerms: readonly string[];
  /** True when the term was only found after OCR confusion correction. */
  readonly viaOcrCorrection: boolean;
}

export interface PackageEvidence {
  readonly providerId: string;
  readonly providerName: string;
  /** How the text was obtained, shown to the user verbatim. */
  readonly analysisMethod: string;

  readonly sourceType: 'package_scan';
  readonly reliability: SourceReliability;

  /** Full recognized text. Kept for transparency and the debug panel. */
  readonly extractedText: string;
  /** Mean OCR confidence 0-100, when the provider reports one. */
  readonly textConfidence?: number;

  /** Segments read as a "contains" declaration or a peanut product name. */
  readonly containsAllergens: readonly string[];
  /** Segments read as a "may contain"/traces declaration. */
  readonly mayContainAllergens: readonly string[];

  /** Every structured finding, with its wording and how it was matched. */
  readonly statements: readonly PackageStatement[];
  /** Distinct allergen terms detected anywhere in the image. */
  readonly detectedProductTerms: readonly string[];

  /**
   * True when the package itself states the allergen. This — not the absence
   * of a finding — is the only thing a photo is allowed to decide.
   */
  readonly explicitPeanutEvidence: boolean;

  readonly imageQuality: ImageQuality;
  readonly warnings: readonly string[];
  /** True when raw provider output was retained for the debug panel. */
  readonly rawAnalysisAvailable: boolean;
  readonly analyzedAt: string;
  readonly durationMs: number;
}

/**
 * The ONLY bridge from a package photo into the safety engine.
 *
 * See the file header: the two `'empty'` statuses below are the structural
 * guarantee that Vision can never create GREEN. They are literals on purpose —
 * there is no parameter, and no caller, that can change them.
 */
export function toProductEvidence(
  evidence: PackageEvidence,
  barcode: string,
): ProductEvidence {
  return {
    providerId: evidence.providerId,
    providerName: evidence.providerName,
    sourceType: 'package_scan',
    reliability: evidence.reliability,
    barcode,

    // Deliberately no productName/brand: OCR must not overwrite the identity
    // resolved from the barcode databases, and must not trigger a spurious
    // PRODUCT_IDENTITY_CONFLICT against them.

    // Free text feeds the engine's negation-aware text matcher, so a package
    // reading "ללא בוטנים" does NOT become a hit — while it also does not clear.
    ingredientsText: evidence.extractedText || undefined,

    containsAllergens: evidence.containsAllergens,
    mayContainAllergens: evidence.mayContainAllergens,

    // SAFETY INVARIANT — never make these dynamic. See the file header.
    allergenDataStatus: 'empty',
    mayContainDataStatus: 'empty',

    providesAllergenEvidence: true,
    lastUpdated: evidence.analyzedAt,
    warnings: evidence.warnings,
  };
}
