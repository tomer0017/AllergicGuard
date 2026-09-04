/**
 * GS1 Israel provider — PREPARED, DISABLED, NOT IMPLEMENTED.
 *
 * Why it is not implemented
 * ------------------------
 * GS1 Israel does not publish a free, publicly documented barcode/allergen API.
 * Access to GS1-sourced product data ("GS1 Israel / SmartTrade"-style feeds) is
 * commercial and credential-gated. Inventing an endpoint here would be worse
 * than having no provider at all, so this file deliberately contains no URL.
 *
 * What is still required before enabling
 * --------------------------------------
 *  1. Official API/feed documentation from GS1 Israel (endpoint, auth scheme,
 *     response schema, rate limits, licensing terms).
 *  2. Credentials — which must NOT live in the browser bundle. A GS1-backed
 *     provider requires a thin backend proxy that holds the secret and exposes
 *     an unauthenticated read endpoint to this app.
 *  3. Confirmation of which allergen fields the feed actually carries
 *     (structured "contains" vs "may contain" vs free-text ingredients), since
 *     the safety engine will only clear a product when BOTH are present.
 *
 * When implemented, expected mapping into ProductEvidence:
 *   GTIN            -> barcode
 *   product name    -> productName / productNameHebrew
 *   brand owner     -> manufacturer
 *   ingredients     -> ingredientsText
 *   allergen list   -> containsAllergens  (allergenDataStatus: 'reported')
 *   may-contain     -> mayContainAllergens (mayContainDataStatus: 'reported')
 *   lastModified    -> lastUpdated
 * with sourceType 'gs1' and reliability 'high'.
 */

import { createAppError } from '../../../../domain/errors/appError.ts';
import type { SourceReliability, SourceType } from '../../../../domain/product/productEvidence.ts';
import {
  buildDiagnostics,
  type LookupContext,
  type ProductDataProvider,
  type ProductSourceResult,
} from '../../providerTypes.ts';

export const GS1_ISRAEL_PROVIDER_ID = 'gs1-israel';

export interface Gs1IsraelProviderOptions {
  readonly enabled: boolean;
  readonly baseUrl: string;
}

export class Gs1IsraelProvider implements ProductDataProvider {
  readonly id = GS1_ISRAEL_PROVIDER_ID;
  readonly name = 'GS1 Israel';
  readonly sourceType: SourceType = 'gs1';
  readonly reliability: SourceReliability = 'high';
  readonly providesAllergenEvidence = true;
  readonly identityPriority = 10;
  readonly allergenEvidencePriority = 10;
  readonly enabled: boolean;

  constructor(options: Gs1IsraelProviderOptions) {
    // Enabling without a configured base URL is treated as "still disabled":
    // a half-configured safety-critical source must never look operational.
    this.enabled = options.enabled && options.baseUrl.trim().length > 0;
  }

  async lookupByBarcode(barcode: string, context: LookupContext): Promise<ProductSourceResult> {
    const startedAtMs = Date.now();
    const error = createAppError(
      'PROVIDER_NOT_IMPLEMENTED',
      'GS1 Israel provider is a prepared skeleton: no official API documentation or credentials are available yet.',
      { providerId: this.id },
    );
    context.logger.warn('PROVIDER', 'provider not implemented', {
      requestId: context.requestId,
      providerId: this.id,
      barcode,
    });
    return {
      status: 'error',
      error,
      diagnostics: buildDiagnostics({
        provider: this,
        requestId: context.requestId,
        barcode,
        startedAtMs,
        warnings: [error.technicalMessage],
      }),
    };
  }
}
