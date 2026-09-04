/**
 * FatSecret Platform API provider — PREPARED, DISABLED.
 *
 * Researched September 2026 against the official documentation
 * (platform.fatsecret.com/docs/v2/food.find_id_for_barcode).
 *
 * WHY IT IS DISABLED — three independent blockers, all verified, none of which
 * this repository can resolve on its own:
 *
 *  1. BARCODE LOOKUP IS PREMIER-ONLY. `GET /rest/food/barcode/find-by-id/v2`
 *     is marked "Premier Exclusive". A free developer account cannot call it,
 *     so there is nothing to test against and nothing to ship.
 *
 *  2. ALLERGENS ARE GATED SEPARATELY. FatSecret carries 10 allergens (peanuts
 *     among them), but the documentation states allergens, dietary preferences
 *     and images sit behind access granted separately from Premier, and that
 *     allergen coverage is complete for GENERIC foods with branded foods being
 *     added "over time". Israeli branded products are exactly the case we need,
 *     and we have no evidence they are covered.
 *
 *  3. OAUTH SECRETS CANNOT LIVE IN A STATIC BUILD. Both OAuth 1.0 and OAuth 2.0
 *     require a client secret. GitHub Pages ships every byte to the browser, so
 *     enabling this provider REQUIRES the proxy described in the README — the
 *     browser may only ever see an unauthenticated proxy URL.
 *
 * WHAT IS REQUIRED TO ENABLE
 * --------------------------
 *  - A FatSecret Premier subscription with barcode scope.
 *  - Written confirmation of allergen-attribute access for branded foods.
 *  - A deployed proxy holding FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET as
 *    environment secrets, exposing GET /fatsecret/barcode/:gtin13.
 *  - `VITE_ENABLE_FATSECRET=true` and `VITE_FATSECRET_PROXY_URL=<proxy>`.
 *
 * BARCODE FORMAT (from the docs, and the reason `toGtin13` exists):
 *   "Barcodes must be specified as GTIN-13 numbers - a 13-digit number filled
 *    in with zeros for the spaces to the left."
 *
 * ALLERGEN SEMANTICS — the part that matters for safety. FatSecret models an
 * allergen as one of three values, and the mapping below must be preserved by
 * whoever implements this:
 *   value  1  -> contains          -> containsAllergens,  status 'reported'
 *   value  0  -> does not contain  -> absent from lists,  status 'reported'
 *   value -1  -> UNKNOWN           -> status 'empty'  (NOT "does not contain")
 * Treating -1 as absence is the single mistake that could turn this provider
 * into a source of false GREEN.
 */

import { createAppError } from '../../../../domain/errors/appError.ts';
import type { SourceReliability, SourceType } from '../../../../domain/product/productEvidence.ts';
import { toGtin13 } from '../../../../utils/barcode.ts';
import {
  buildDiagnostics,
  type LookupContext,
  type ProductDataProvider,
  type ProductSourceResult,
} from '../../providerTypes.ts';

export const FAT_SECRET_PROVIDER_ID = 'fatsecret';

export interface FatSecretProviderOptions {
  readonly enabled: boolean;
  /**
   * URL of the credential-holding proxy. NEVER a FatSecret URL directly, and
   * never a place to put a key: the browser must only ever see this origin.
   */
  readonly proxyUrl: string;
}

export class FatSecretProvider implements ProductDataProvider {
  readonly id = FAT_SECRET_PROVIDER_ID;
  readonly name = 'FatSecret Platform';
  readonly sourceType: SourceType = 'crowdsourced';
  readonly reliability: SourceReliability = 'medium';
  readonly providesAllergenEvidence = true;
  /** Below Open Food Facts for identity until its Israeli coverage is measured. */
  readonly identityPriority = 30;
  readonly allergenEvidencePriority = 30;
  readonly enabled: boolean;

  constructor(options: FatSecretProviderOptions) {
    // Enabling without a proxy is treated as "still disabled": a half-configured
    // safety-critical source must never look operational.
    this.enabled = options.enabled && options.proxyUrl.trim().length > 0;
  }

  async lookupByBarcode(barcode: string, context: LookupContext): Promise<ProductSourceResult> {
    const startedAtMs = Date.now();
    const error = createAppError(
      'PROVIDER_NOT_IMPLEMENTED',
      `FatSecret provider is a prepared skeleton: barcode lookup is Premier-only and allergen access is granted separately, so no working credentials exist. GTIN-13 form of the request would be ${toGtin13(barcode)}.`,
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
