/** Aggregated product identity, merged from every source that answered. */

export interface ProductIdentity {
  readonly barcode: string;
  readonly displayName?: string;
  readonly brand?: string;
  readonly manufacturer?: string;
  readonly quantity?: string;
  readonly imageUrl?: string;
  /** Provider ids that contributed to the chosen identity fields. */
  readonly contributingProviderIds: readonly string[];
}

export type ConflictKind = 'PRODUCT_IDENTITY_CONFLICT' | 'ALLERGEN_EVIDENCE_CONFLICT';

export interface SourceConflict {
  readonly kind: ConflictKind;
  /** English, developer-facing description. */
  readonly description: string;
  readonly providerIds: readonly string[];
  readonly values: readonly string[];
}
