/**
 * Orchestrates a full barcode lookup:
 *   validate -> query every enabled provider in parallel -> normalize ->
 *   aggregate identity + conflicts -> run the safety engine -> return one result.
 *
 * It deliberately does NOT return the first successful provider response:
 * every source must be heard, because a single source reporting peanuts must
 * never be cancelled by a silent one.
 */

import { assessAllergenRisk } from '../../domain/allergy/assessAllergenRisk.ts';
import type { UnavailableSource } from '../../domain/allergy/assessAllergenRisk.ts';
import type { AllergenCode } from '../../domain/allergy/allergenTypes.ts';
import type { AllergyAssessment } from '../../domain/allergy/assessment.ts';
import type { AppError } from '../../domain/errors/appError.ts';
import { createAppError, toAppError } from '../../domain/errors/appError.ts';
import type { PackageEvidence } from '../../domain/package/packageEvidence.ts';
import { toProductEvidence } from '../../domain/package/packageEvidence.ts';
import type { ProductEvidence } from '../../domain/product/productEvidence.ts';
import type { ProductIdentity, SourceConflict } from '../../domain/product/productIdentity.ts';
import type { LookupCache } from '../../infrastructure/cache/lookupCache.ts';
import { createRequestId, type Logger } from '../../infrastructure/logging/logger.ts';
import { normalizeBarcode, validateBarcode } from '../../utils/barcode.ts';
import { aggregateEvidence } from './evidenceAggregator.ts';
import type { ProviderRegistry } from './providerRegistry.ts';
import type { ProductSourceResult, ProviderDiagnostics } from './providerTypes.ts';

export interface ProviderResultRecord {
  readonly providerId: string;
  readonly providerName: string;
  readonly status: ProductSourceResult['status'];
  readonly fromCache: boolean;
  readonly error?: AppError;
  readonly diagnostics: ProviderDiagnostics;
}

/**
 * A package photo that was folded into this result.
 *
 * Both the barcode-derived and the photo-derived evidence stay in `evidence`;
 * this record only says what the photo changed, so a developer (and the UI) can
 * answer "which source caused the RED?" without re-deriving anything.
 */
export interface PackageScanRecord {
  readonly scanId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly analysisMethod: string;
  readonly packageEvidence: PackageEvidence;
  readonly previousStatus: AllergyAssessment['status'];
  readonly previousReasonCode: AllergyAssessment['reasonCode'];
  readonly newStatus: AllergyAssessment['status'];
  readonly newReasonCode: AllergyAssessment['reasonCode'];
  /** True when the photo made the result stricter than the barcode result. */
  readonly escalated: boolean;
  readonly performedAt: string;
}

export interface ProductLookupResult {
  readonly requestId: string;
  readonly barcode: string;
  readonly allergen: AllergenCode;
  readonly product: ProductIdentity | null;
  readonly assessment: AllergyAssessment;
  readonly evidence: readonly ProductEvidence[];
  readonly providerResults: readonly ProviderResultRecord[];
  readonly conflicts: readonly SourceConflict[];
  readonly generatedAt: string;
  /** Set only when the barcode itself was rejected before any lookup. */
  readonly inputError?: AppError;
  /** Package photos folded into this result, oldest first. */
  readonly packageScans?: readonly PackageScanRecord[];
}

export interface ProductLookupServiceOptions {
  readonly registry: ProviderRegistry;
  readonly logger: Logger;
  readonly cache?: LookupCache;
  readonly allergen?: AllergenCode;
}

/** Strictness order — used to decide whether a package photo escalated a result. */
const STATUS_RANK: Record<AllergyAssessment['status'], number> = {
  no_known_risk: 1,
  insufficient_data: 2,
  danger: 3,
};

function toUnavailableSources(
  providerResults: readonly ProviderResultRecord[],
): UnavailableSource[] {
  return providerResults
    .filter((result) => result.status !== 'success')
    .map((result) => ({
      providerId: result.providerId,
      providerName: result.providerName,
      reason: result.status === 'not_found' ? ('not_found' as const) : ('error' as const),
      detail: result.error?.technicalMessage ?? result.status,
    }));
}

export class ProductLookupService {
  private readonly registry: ProviderRegistry;
  private readonly logger: Logger;
  private readonly cache?: LookupCache;
  private readonly allergen: AllergenCode;

  constructor(options: ProductLookupServiceOptions) {
    this.registry = options.registry;
    this.logger = options.logger;
    this.cache = options.cache;
    this.allergen = options.allergen ?? 'peanut';
  }

  async lookup(
    rawBarcode: string,
    options: { requestId?: string; signal?: AbortSignal } = {},
  ): Promise<ProductLookupResult> {
    const requestId = options.requestId ?? createRequestId();
    const barcode = normalizeBarcode(rawBarcode);
    const generatedAt = () => new Date().toISOString();

    const validation = validateBarcode(barcode);
    if (!validation.valid) {
      const inputError = createAppError('INVALID_BARCODE', validation.reason);
      this.logger.warn('LOOKUP', 'invalid barcode rejected', { requestId, barcode, reason: validation.reason });
      return {
        requestId,
        barcode,
        allergen: this.allergen,
        product: null,
        // An unusable barcode is missing information, never clearance.
        assessment: assessAllergenRisk({ allergen: this.allergen, evidence: [] }),
        evidence: [],
        providerResults: [],
        conflicts: [],
        generatedAt: generatedAt(),
        inputError,
      };
    }

    const providers = this.registry.enabled();
    this.logger.info('LOOKUP', 'lookup started', {
      requestId,
      barcode,
      enabledProviders: providers.map((provider) => provider.id),
      disabledProviders: this.registry.disabled().map((provider) => provider.id),
    });

    if (providers.length === 0) {
      this.logger.error('LOOKUP', 'no providers enabled', { requestId, barcode });
    }

    const context = { requestId, logger: this.logger, signal: options.signal };

    // Providers run in parallel; one slow or broken source must not block others.
    const settled = await Promise.all(
      providers.map(async (provider) => {
        const cached = this.cache?.get(provider.id, barcode);
        if (cached) {
          this.logger.debug('CACHE', 'evidence cache hit', {
            requestId,
            providerId: provider.id,
            ageMs: cached.ageMs,
          });
          const now = Date.now();
          const record: ProviderResultRecord = {
            providerId: provider.id,
            providerName: provider.name,
            status: 'success',
            fromCache: true,
            diagnostics: {
              providerId: provider.id,
              providerName: provider.name,
              requestId,
              barcode,
              startedAt: new Date(now).toISOString(),
              completedAt: new Date(now).toISOString(),
              durationMs: 0,
              fieldsPresent: [],
              fieldsMissing: [],
              warnings: [`served from cache, age ${Math.round(cached.ageMs / 1000)}s`],
            },
          };
          return { record, evidence: cached.evidence };
        }

        try {
          const result = await provider.lookupByBarcode(barcode, context);
          if (result.status === 'success') {
            this.cache?.set(provider.id, barcode, result.evidence);
            return {
              record: {
                providerId: provider.id,
                providerName: provider.name,
                status: result.status,
                fromCache: false,
                diagnostics: result.diagnostics,
              } satisfies ProviderResultRecord,
              evidence: result.evidence,
            };
          }
          return {
            record: {
              providerId: provider.id,
              providerName: provider.name,
              status: result.status,
              fromCache: false,
              error: result.status === 'error' ? result.error : undefined,
              diagnostics: result.diagnostics,
            } satisfies ProviderResultRecord,
            evidence: undefined,
          };
        } catch (thrown) {
          // A provider that throws is a provider bug — it degrades to ORANGE,
          // it never removes information from the decision.
          const error = toAppError(thrown, provider.id);
          this.logger.error('PROVIDER', 'provider threw unexpectedly', {
            requestId,
            providerId: provider.id,
            technicalMessage: error.technicalMessage,
          });
          const now = Date.now();
          return {
            record: {
              providerId: provider.id,
              providerName: provider.name,
              status: 'error',
              fromCache: false,
              error,
              diagnostics: {
                providerId: provider.id,
                providerName: provider.name,
                requestId,
                barcode,
                startedAt: new Date(now).toISOString(),
                completedAt: new Date(now).toISOString(),
                durationMs: 0,
                fieldsPresent: [],
                fieldsMissing: [],
                warnings: [error.technicalMessage],
              },
            } satisfies ProviderResultRecord,
            evidence: undefined,
          };
        }
      }),
    );

    const providerResults = settled.map((entry) => entry.record);
    const evidence = settled
      .map((entry) => entry.evidence)
      .filter((item): item is ProductEvidence => item !== undefined);

    const identityPriority = (providerId: string) =>
      this.registry.get(providerId)?.identityPriority ?? Number.MAX_SAFE_INTEGER;

    const { identity, conflicts } = aggregateEvidence(barcode, evidence, identityPriority, this.allergen);

    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        this.logger.warn('AGGREGATE', `conflict detected: ${conflict.kind}`, {
          requestId,
          description: conflict.description,
          providerIds: conflict.providerIds,
        });
      }
    }

    const assessment = assessAllergenRisk({
      allergen: this.allergen,
      evidence,
      conflicts,
      unavailableSources: toUnavailableSources(providerResults),
    });

    this.logger.info('ASSESSMENT', `status: ${assessment.status}`, {
      requestId,
      barcode,
      reasonCode: assessment.reasonCode,
      reason: assessment.reason,
      hasConflict: assessment.hasConflict,
      evidenceSources: evidence.map((item) => item.providerId),
    });

    return {
      requestId,
      barcode,
      allergen: this.allergen,
      product: identity,
      assessment,
      evidence,
      providerResults,
      conflicts,
      generatedAt: generatedAt(),
    };
  }

  /**
   * Folds a package photo's evidence into an existing barcode result.
   *
   * NOTHING IS REPLACED. The photo's evidence is APPENDED to the barcode
   * evidence and the whole set is re-assessed by the same pure safety engine,
   * so:
   *  - a photo that reads "מכיל בוטנים" turns ORANGE (or even GREEN) into RED,
   *  - a photo that reads nothing cannot undo an existing RED, and cannot
   *    create GREEN — see domain/package/packageEvidence.ts for why that is a
   *    structural property rather than a rule this method has to remember,
   *  - earlier photos are kept, so a second, worse photo can never cancel a
   *    peanut finding made by the first one.
   */
  applyPackageEvidence(
    result: ProductLookupResult,
    packageEvidence: PackageEvidence,
    options: { requestId?: string } = {},
  ): ProductLookupResult {
    const requestId = options.requestId ?? result.requestId;
    const scanEvidence = toProductEvidence(packageEvidence, result.barcode);
    const evidence = [...result.evidence, scanEvidence];

    const identityPriority = (providerId: string) =>
      this.registry.get(providerId)?.identityPriority ?? Number.MAX_SAFE_INTEGER;

    const { identity, conflicts } = aggregateEvidence(
      result.barcode,
      evidence,
      identityPriority,
      this.allergen,
    );

    const assessment = assessAllergenRisk({
      allergen: this.allergen,
      evidence,
      conflicts,
      unavailableSources: toUnavailableSources(result.providerResults),
    });

    const previous = result.assessment;
    const record: PackageScanRecord = {
      scanId: `${requestId}-${(result.packageScans?.length ?? 0) + 1}`,
      providerId: packageEvidence.providerId,
      providerName: packageEvidence.providerName,
      analysisMethod: packageEvidence.analysisMethod,
      packageEvidence,
      previousStatus: previous.status,
      previousReasonCode: previous.reasonCode,
      newStatus: assessment.status,
      newReasonCode: assessment.reasonCode,
      escalated: STATUS_RANK[assessment.status] > STATUS_RANK[previous.status],
      performedAt: new Date().toISOString(),
    };

    this.logger.info('ASSESSMENT', `package scan merged: ${previous.status} -> ${assessment.status}`, {
      requestId,
      barcode: result.barcode,
      providerId: packageEvidence.providerId,
      previousStatus: previous.status,
      previousReasonCode: previous.reasonCode,
      newStatus: assessment.status,
      newReasonCode: assessment.reasonCode,
      escalated: record.escalated,
      explicitPeanutEvidence: packageEvidence.explicitPeanutEvidence,
      imageQuality: packageEvidence.imageQuality,
    });

    return {
      ...result,
      product: identity ?? result.product,
      evidence,
      assessment,
      conflicts,
      packageScans: [...(result.packageScans ?? []), record],
      generatedAt: new Date().toISOString(),
    };
  }
}
