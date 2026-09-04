/**
 * The contract every product data source implements.
 *
 * Adding a provider means implementing this interface, normalizing into
 * ProductEvidence, and registering it. No React component and no service is
 * modified. See README → "Adding a New Product Data Provider".
 */

import type { AppError } from '../../domain/errors/appError.ts';
import type { ProductEvidence, SourceReliability, SourceType } from '../../domain/product/productEvidence.ts';
import type { Logger } from '../../infrastructure/logging/logger.ts';

export interface LookupContext {
  readonly requestId: string;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
}

export interface ProviderDiagnostics {
  readonly providerId: string;
  readonly providerName: string;
  readonly requestId: string;
  readonly barcode: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly httpStatus?: number;
  readonly url?: string;
  /** Response fields that arrived with usable content. */
  readonly fieldsPresent: readonly string[];
  /** Response fields we asked for but did not get. */
  readonly fieldsMissing: readonly string[];
  readonly warnings: readonly string[];
}

export type ProductSourceResult =
  | { readonly status: 'success'; readonly evidence: ProductEvidence; readonly diagnostics: ProviderDiagnostics }
  | { readonly status: 'not_found'; readonly diagnostics: ProviderDiagnostics }
  | { readonly status: 'error'; readonly error: AppError; readonly diagnostics: ProviderDiagnostics };

export interface ProductDataProvider {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly sourceType: SourceType;
  readonly reliability: SourceReliability;
  /**
   * Identity-only sources (false) can improve the displayed product name but
   * can never contribute to clearing an allergen.
   */
  readonly providesAllergenEvidence: boolean;
  /** Lower number = queried/preferred first for product identity fields. */
  readonly identityPriority: number;
  /** Lower number = preferred when reconciling allergen evidence. */
  readonly allergenEvidencePriority: number;

  lookupByBarcode(barcode: string, context: LookupContext): Promise<ProductSourceResult>;
}

/** Small helper so providers report diagnostics consistently. */
export function buildDiagnostics(params: {
  provider: Pick<ProductDataProvider, 'id' | 'name'>;
  requestId: string;
  barcode: string;
  startedAtMs: number;
  httpStatus?: number;
  url?: string;
  fieldsPresent?: readonly string[];
  fieldsMissing?: readonly string[];
  warnings?: readonly string[];
}): ProviderDiagnostics {
  const completedAtMs = Date.now();
  return {
    providerId: params.provider.id,
    providerName: params.provider.name,
    requestId: params.requestId,
    barcode: params.barcode,
    startedAt: new Date(params.startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - params.startedAtMs,
    httpStatus: params.httpStatus,
    url: params.url,
    fieldsPresent: params.fieldsPresent ?? [],
    fieldsMissing: params.fieldsMissing ?? [],
    warnings: params.warnings ?? [],
  };
}
