/**
 * Normalized, provider-independent evidence about a product.
 *
 * SAFETY-CRITICAL MODELLING RULE
 * ------------------------------
 * Missing data must stay explicit. An empty `containsAllergens` array means
 * "the source listed no allergens" — it does NOT mean "this product contains no
 * allergens". The `allergenDataStatus` / `mayContainDataStatus` fields carry
 * that distinction, and the safety engine refuses to clear a product unless
 * both are `reported`.
 */

export type SourceType =
  | 'manufacturer'
  | 'gs1'
  | 'retailer'
  | 'crowdsourced'
  | 'package_scan'
  | 'manual';

export type SourceReliability = 'very_high' | 'high' | 'medium' | 'low';

/** Ranking used for "is this source trustworthy enough to clear a product?". */
export const RELIABILITY_RANK: Record<SourceReliability, number> = {
  very_high: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Why a piece of allergen information is or is not usable.
 *
 * - `reported`      : the source actively recorded this information.
 * - `empty`         : the field exists but is blank — in crowdsourced data this
 *                     usually means "nobody filled it in", NOT "none".
 * - `missing`       : the field was absent from the response entirely.
 * - `not_supported` : this source never carries this kind of information
 *                     (e.g. a price-transparency identity dataset).
 */
export type AllergenDataStatus = 'reported' | 'empty' | 'missing' | 'not_supported';

export interface ProductEvidence {
  readonly providerId: string;
  readonly providerName: string;
  readonly sourceType: SourceType;
  readonly reliability: SourceReliability;

  readonly barcode: string;

  readonly productName?: string;
  readonly productNameHebrew?: string;
  readonly brand?: string;
  readonly manufacturer?: string;
  readonly quantity?: string;
  readonly imageUrl?: string;

  readonly ingredientsText?: string;
  readonly ingredientsTextHebrew?: string;

  /** Raw declared "contains" entries, exactly as the source reported them. */
  readonly containsAllergens: readonly string[];
  /** Raw declared "may contain"/traces entries, exactly as reported. */
  readonly mayContainAllergens: readonly string[];

  readonly allergenDataStatus: AllergenDataStatus;
  readonly mayContainDataStatus: AllergenDataStatus;

  /**
   * False for identity-only sources (e.g. retail price datasets). Such evidence
   * can improve product identity but can never clear a product.
   */
  readonly providesAllergenEvidence: boolean;

  readonly lastUpdated?: string;
  readonly sourceUrl?: string;
  readonly warnings: readonly string[];
}

export function isAllergenDataUsable(status: AllergenDataStatus): boolean {
  return status === 'reported';
}

export const SOURCE_TYPE_HEBREW: Record<SourceType, string> = {
  manufacturer: 'יצרן',
  gs1: 'מאגר ברקודים רשמי (GS1)',
  retailer: 'מאגר קמעונאי',
  crowdsourced: 'מאגר קהילתי',
  package_scan: 'סריקת אריזה',
  manual: 'הזנה ידנית',
};

export const RELIABILITY_HEBREW: Record<SourceReliability, string> = {
  very_high: 'גבוהה מאוד',
  high: 'גבוהה',
  medium: 'בינונית',
  low: 'נמוכה',
};

export const ALLERGEN_DATA_STATUS_HEBREW: Record<AllergenDataStatus, string> = {
  reported: 'קיים',
  empty: 'קיים אך ריק',
  missing: 'חסר',
  not_supported: 'לא נתמך במקור זה',
};
