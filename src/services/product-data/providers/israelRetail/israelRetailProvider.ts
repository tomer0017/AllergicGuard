/**
 * Israeli retail (price transparency) provider — PREPARED, DISABLED.
 *
 * Purpose (identity only)
 * -----------------------
 * Israel's price-transparency regulation ("חוק המזון"/שקיפות מחירים) requires
 * retail chains to publish product files. Those files are excellent for PRODUCT
 * IDENTITY in Hebrew (barcode, item name, manufacturer, quantity), which helps
 * confirm *what* was scanned.
 *
 * They do NOT contain ingredient or allergen information. Therefore this
 * provider declares `providesAllergenEvidence = false`, and the safety engine
 * structurally cannot use it to clear a product — identity-only evidence can
 * never produce GREEN.
 *
 * Why it is not implemented
 * -------------------------
 * Each chain publishes to its own portal, several require per-chain login, the
 * files are gzipped XML dumps rather than a barcode lookup API, and there is no
 * single stable documented endpoint. Implementing this properly means a backend
 * ingestion job, not a browser fetch. No endpoint is invented here.
 *
 * What is still required before enabling
 * --------------------------------------
 *  1. A chosen, stable data access path (an official portal with documented
 *     credentials, or a self-hosted ingestion service exposing /product/{gtin}).
 *  2. A defined response schema to validate with Zod.
 *  3. Confirmation that the chosen source is refreshed regularly enough that
 *     `lastUpdated` is meaningful.
 */

import { createAppError } from '../../../../domain/errors/appError.ts';
import type { SourceReliability, SourceType } from '../../../../domain/product/productEvidence.ts';
import {
  buildDiagnostics,
  type LookupContext,
  type ProductDataProvider,
  type ProductSourceResult,
} from '../../providerTypes.ts';

export const ISRAEL_RETAIL_PROVIDER_ID = 'israel-retail';

export interface IsraelRetailProviderOptions {
  readonly enabled: boolean;
  readonly baseUrl: string;
}

export class IsraelRetailProvider implements ProductDataProvider {
  readonly id = ISRAEL_RETAIL_PROVIDER_ID;
  readonly name = 'מאגר קמעונאי (שקיפות מחירים)';
  readonly sourceType: SourceType = 'retailer';
  readonly reliability: SourceReliability = 'high';
  /** Identity only — structurally incapable of clearing an allergen. */
  readonly providesAllergenEvidence = false;
  readonly identityPriority = 5;
  readonly allergenEvidencePriority = 90;
  readonly enabled: boolean;

  constructor(options: IsraelRetailProviderOptions) {
    this.enabled = options.enabled && options.baseUrl.trim().length > 0;
  }

  async lookupByBarcode(barcode: string, context: LookupContext): Promise<ProductSourceResult> {
    const startedAtMs = Date.now();
    const error = createAppError(
      'PROVIDER_NOT_IMPLEMENTED',
      'Israel retail provider is a prepared skeleton: no stable documented barcode lookup endpoint is configured.',
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
