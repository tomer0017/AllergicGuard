/**
 * The assessment domain model.
 *
 * There is deliberately NO `isSafe` field anywhere in this codebase.
 * The application never declares food safe; it reports what the available
 * evidence does or does not show.
 */

import type { AllergenCode } from './allergenTypes.ts';
import type { SourceReliability, SourceType } from '../product/productEvidence.ts';

export type AssessmentReasonCode =
  // danger
  | 'CONTAINS_DECLARED'
  | 'MAY_CONTAIN_DECLARED'
  | 'ALLERGEN_FOUND_IN_TEXT'
  // insufficient data
  | 'NO_SOURCES_RESPONDED'
  | 'PRODUCT_NOT_FOUND'
  | 'NO_ALLERGEN_CAPABLE_SOURCE'
  | 'ALLERGEN_DATA_MISSING'
  | 'MAY_CONTAIN_DATA_MISSING'
  | 'ALLERGEN_DATA_INSUBSTANTIAL'
  | 'SOURCE_RELIABILITY_TOO_LOW'
  | 'PRODUCT_IDENTITY_CONFLICT'
  // cleared
  | 'NO_INDICATION_IN_COMPLETE_DATA';

export type EvidenceKind =
  | 'contains_declared'
  | 'may_contain_declared'
  | 'text_match'
  | 'no_indication'
  | 'allergen_data_missing'
  | 'allergen_data_insubstantial'
  | 'may_contain_data_missing'
  | 'identity_only_source'
  | 'source_unavailable';

/** One provider-attributed fact that fed the decision. */
export interface AllergyEvidence {
  readonly providerId: string;
  readonly providerName: string;
  readonly sourceType: SourceType;
  readonly reliability: SourceReliability;
  readonly kind: EvidenceKind;
  /** English, developer-facing. The UI renders Hebrew from `kind`. */
  readonly detail: string;
  readonly matchedTerms?: readonly string[];
}

interface AssessmentBase {
  readonly allergen: AllergenCode;
  readonly reasonCode: AssessmentReasonCode;
  /** English, developer-facing explanation. Logged, shown in the debug panel. */
  readonly reason: string;
  readonly evidence: readonly AllergyEvidence[];
  /** True when sources disagreed; always surfaced, never hidden. */
  readonly hasConflict: boolean;
}

export type AllergyAssessment =
  | (AssessmentBase & { readonly status: 'danger' })
  | (AssessmentBase & { readonly status: 'insufficient_data' })
  | (AssessmentBase & { readonly status: 'no_known_risk' });

export type AssessmentStatus = AllergyAssessment['status'];

/** Exhaustiveness helper — makes a missing switch branch a compile error. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
