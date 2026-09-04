/**
 * Open Food Facts provider — the first fully working data source.
 *
 * Uses the documented public v2 read API:
 *   GET {baseUrl}/api/v2/product/{barcode}.json?fields=...
 * No scraping, no undocumented endpoints, no credentials.
 *
 * OFF is crowdsourced: reliability is 'medium' and it is presented to the user
 * as "מאגר קהילתי", never as manufacturer-authoritative data.
 */

import { fetchJson } from '../../../../infrastructure/http/httpClient.ts';
import { isSameBarcode } from '../../../../utils/barcode.ts';
import { createAppError } from '../../../../domain/errors/appError.ts';
import type { SourceReliability, SourceType } from '../../../../domain/product/productEvidence.ts';
import {
  buildDiagnostics,
  type LookupContext,
  type ProductDataProvider,
  type ProductSourceResult,
} from '../../providerTypes.ts';
import {
  OPEN_FOOD_FACTS_REQUESTED_FIELDS,
  openFoodFactsResponseSchema,
} from './openFoodFactsSchema.ts';
import {
  OPEN_FOOD_FACTS_PROVIDER_ID,
  OPEN_FOOD_FACTS_PROVIDER_NAME,
  normalizeOpenFoodFactsProduct,
} from './normalizeOpenFoodFacts.ts';

export interface OpenFoodFactsProviderOptions {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly userAgent: string;
  readonly fetchImpl?: typeof fetch;
}

export class OpenFoodFactsProvider implements ProductDataProvider {
  readonly id = OPEN_FOOD_FACTS_PROVIDER_ID;
  readonly name = OPEN_FOOD_FACTS_PROVIDER_NAME;
  readonly sourceType: SourceType = 'crowdsourced';
  readonly reliability: SourceReliability = 'medium';
  readonly providesAllergenEvidence = true;
  readonly identityPriority = 20;
  readonly allergenEvidencePriority = 20;

  readonly enabled: boolean;
  private readonly options: OpenFoodFactsProviderOptions;

  constructor(options: OpenFoodFactsProviderOptions) {
    this.options = options;
    this.enabled = options.enabled;
  }

  async lookupByBarcode(barcode: string, context: LookupContext): Promise<ProductSourceResult> {
    const startedAtMs = Date.now();
    const url = this.buildUrl(barcode);
    const logContext = { requestId: context.requestId, providerId: this.id };

    context.logger.info('PROVIDER', 'lookup started', { ...logContext, barcode, url });

    const response = await fetchJson({
      url,
      schema: openFoodFactsResponseSchema,
      timeoutMs: this.options.timeoutMs,
      retryAttempts: this.options.retryAttempts,
      providerId: this.id,
      signal: context.signal,
      fetchImpl: this.options.fetchImpl,
      // Open Food Facts asks API consumers to identify themselves.
      headers: { 'User-Agent': this.options.userAgent },
    });

    if (!response.ok) {
      // A 404 from the CDN is semantically "product not found", not an outage.
      if (response.error.code === 'PRODUCT_NOT_FOUND') {
        context.logger.warn('PROVIDER', 'product not found', { ...logContext, barcode });
        return {
          status: 'not_found',
          diagnostics: buildDiagnostics({
            provider: this,
            requestId: context.requestId,
            barcode,
            startedAtMs,
            httpStatus: response.httpStatus,
            url,
            fieldsMissing: [...OPEN_FOOD_FACTS_REQUESTED_FIELDS],
          }),
        };
      }

      context.logger.error('PROVIDER', `lookup failed: ${response.error.code}`, {
        ...logContext,
        barcode,
        technicalMessage: response.error.technicalMessage,
        httpStatus: response.httpStatus,
        durationMs: response.durationMs,
      });
      return {
        status: 'error',
        error: response.error,
        diagnostics: buildDiagnostics({
          provider: this,
          requestId: context.requestId,
          barcode,
          startedAtMs,
          httpStatus: response.httpStatus,
          url,
          warnings: [response.error.technicalMessage],
          fieldsMissing: [...OPEN_FOOD_FACTS_REQUESTED_FIELDS],
        }),
      };
    }

    const body = response.data;

    if (body.status !== 1 || !body.product) {
      context.logger.warn('PROVIDER', 'product not found', {
        ...logContext,
        barcode,
        statusVerbose: body.status_verbose,
      });
      return {
        status: 'not_found',
        diagnostics: buildDiagnostics({
          provider: this,
          requestId: context.requestId,
          barcode,
          startedAtMs,
          httpStatus: response.httpStatus,
          url,
          warnings: body.status_verbose ? [body.status_verbose] : [],
          fieldsMissing: [...OPEN_FOOD_FACTS_REQUESTED_FIELDS],
        }),
      };
    }

    // The API echoes the requested code; a mismatch means we would be showing
    // allergen data for a different product, which is never acceptable.
    // The comparison is GTIN-aware: Open Food Facts stores UPC-A codes
    // zero-padded to 13 digits, so `037600309417` legitimately comes back as
    // `0037600309417` — the same article number, not a different product.
    const returnedCode = body.product.code ?? body.code;
    if (returnedCode && !isSameBarcode(returnedCode, barcode)) {
      const error = createAppError(
        'PROVIDER_INVALID_RESPONSE',
        `Barcode mismatch: requested ${barcode}, received ${returnedCode}`,
        { providerId: this.id },
      );
      context.logger.error('PROVIDER', 'barcode mismatch', {
        ...logContext,
        requested: barcode,
        received: returnedCode,
      });
      return {
        status: 'error',
        error,
        diagnostics: buildDiagnostics({
          provider: this,
          requestId: context.requestId,
          barcode,
          startedAtMs,
          httpStatus: response.httpStatus,
          url,
          warnings: [error.technicalMessage],
        }),
      };
    }

    const { evidence, fieldsPresent, fieldsMissing } = normalizeOpenFoodFactsProduct(
      barcode,
      body.product,
      OPEN_FOOD_FACTS_REQUESTED_FIELDS,
    );

    context.logger.info('PROVIDER', 'product found', {
      ...logContext,
      barcode,
      productName: evidence.productName ?? evidence.productNameHebrew,
      durationMs: response.durationMs,
    });
    context.logger.debug('PROVIDER', 'allergen fields', {
      ...logContext,
      allergensStatus: evidence.allergenDataStatus,
      tracesStatus: evidence.mayContainDataStatus,
      contains: evidence.containsAllergens,
      mayContain: evidence.mayContainAllergens,
    });

    return {
      status: 'success',
      evidence,
      diagnostics: buildDiagnostics({
        provider: this,
        requestId: context.requestId,
        barcode,
        startedAtMs,
        httpStatus: response.httpStatus,
        url,
        fieldsPresent,
        fieldsMissing,
        warnings: evidence.warnings,
      }),
    };
  }

  private buildUrl(barcode: string): string {
    const fields = OPEN_FOOD_FACTS_REQUESTED_FIELDS.join(',');
    const base = this.options.baseUrl.replace(/\/+$/, '');
    return `${base}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`;
  }
}
