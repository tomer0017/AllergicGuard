/**
 * Orchestrates one package-photo analysis: pick the provider, run it, log every
 * stage under the scan's correlation id, and hand back normalized evidence.
 *
 * It makes no safety decision. Merging the evidence into a result is
 * ProductLookupService.applyPackageEvidence's job, and the verdict is always
 * the pure safety engine's.
 *
 * PROVIDER ESCALATION
 * -------------------
 * Providers are tried in order, and the chain STOPS as soon as one produces a
 * usable answer:
 *
 *   1. explicit peanut wording found → stop. Nothing a second provider says
 *      could make the result safer, so there is no reason to pay for it.
 *   2. a good-quality read that found nothing → stop. We read the label; the
 *      result stays ORANGE because a photo can never clear a product.
 *   3. a poor or partial read → try the next provider, which is the only case
 *      where a remote model earns its cost, its latency and its privacy price.
 *
 * The BEST attempt is returned (an escalating provider beats a better-quality
 * empty read), and every attempt is kept for the debug panel.
 */

import { createAppError, toAppError, type AppError } from '../../domain/errors/appError.ts';
import type { PackageEvidence } from '../../domain/package/packageEvidence.ts';
import type { Logger } from '../../infrastructure/logging/logger.ts';
import type {
  PackageAnalysisDiagnostics,
  PackageAnalysisProvider,
} from './packageAnalysisProvider.ts';

export type PackageScanOutcome =
  | {
      readonly status: 'success';
      readonly evidence: PackageEvidence;
      readonly diagnostics: PackageAnalysisDiagnostics;
    }
  | {
      readonly status: 'error';
      readonly error: AppError;
      readonly diagnostics?: PackageAnalysisDiagnostics;
    };

export interface PackageScanRequest {
  readonly requestId: string;
  readonly barcode?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, stage: string) => void;
}

/** Largest photo we accept before analysis, to protect low-end phones. */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

export class PackageScanService {
  private readonly providers: readonly PackageAnalysisProvider[];
  private readonly logger: Logger;

  constructor(options: { providers: readonly PackageAnalysisProvider[]; logger: Logger }) {
    this.providers = options.providers;
    this.logger = options.logger;
  }

  get available(): boolean {
    return this.providers.some((provider) => provider.enabled);
  }

  activeProvider(): PackageAnalysisProvider | undefined {
    return this.providers.find((provider) => provider.enabled);
  }

  enabledProviders(): readonly PackageAnalysisProvider[] {
    return this.providers.filter((provider) => provider.enabled);
  }

  async analyze(image: Blob, request: PackageScanRequest): Promise<PackageScanOutcome> {
    const { requestId } = request;
    const provider = this.activeProvider();

    // Never log the image itself — only its shape.
    this.logger.info('PACKAGE_SCAN', 'image selected', {
      requestId,
      barcode: request.barcode,
      imageBytes: image.size,
      imageType: image.type || 'unknown',
      providerId: provider?.id,
    });

    if (!provider) {
      const error = createAppError(
        'PACKAGE_ANALYSIS_UNAVAILABLE',
        'No package analysis provider is enabled',
      );
      this.logger.warn('PACKAGE_SCAN', 'no provider enabled', { requestId });
      return { status: 'error', error };
    }

    if (image.size === 0) {
      return {
        status: 'error',
        error: createAppError('PACKAGE_IMAGE_UNREADABLE', 'Selected image is empty', {
          providerId: provider.id,
        }),
      };
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return {
        status: 'error',
        error: createAppError(
          'PACKAGE_IMAGE_UNREADABLE',
          `Image is ${image.size} bytes, above the ${MAX_IMAGE_BYTES} byte limit`,
          { providerId: provider.id },
        ),
      };
    }

    const providers = this.enabledProviders();
    let lastError: PackageScanOutcome | undefined;
    let bestEmptyRead: PackageScanOutcome | undefined;

    for (const candidate of providers) {
      const outcome = await this.runProvider(candidate, image, request);

      if (outcome.status === 'error') {
        lastError = outcome;
        continue;
      }
      // Explicit danger: stop immediately, nothing later can improve on it.
      if (outcome.evidence.explicitPeanutEvidence) return outcome;
      // A good read that found nothing is a complete answer too.
      if (outcome.evidence.imageQuality === 'good') return outcome;
      // Poor/partial: remember it, but let the next provider try.
      bestEmptyRead ??= outcome;
    }

    return bestEmptyRead ?? lastError ?? {
      status: 'error',
      error: createAppError('PACKAGE_ANALYSIS_FAILED', 'No package analysis provider produced a result'),
    };
  }

  private async runProvider(
    provider: PackageAnalysisProvider,
    image: Blob,
    request: PackageScanRequest,
  ): Promise<PackageScanOutcome> {
    const { requestId } = request;
    this.logger.info('PACKAGE_SCAN', 'analysis started', {
      requestId,
      providerId: provider.id,
      analysisMethod: provider.analysisMethod,
    });

    const startedAtMs = Date.now();
    try {
      const result = await provider.analyze(image, {
        requestId,
        logger: this.logger,
        signal: request.signal,
        barcode: request.barcode,
        onProgress: request.onProgress,
      });

      if (result.status === 'error') {
        this.logger.warn('PACKAGE_SCAN', 'provider returned an error', {
          requestId,
          providerId: provider.id,
          code: result.error.code,
          technicalMessage: result.error.technicalMessage,
          durationMs: Date.now() - startedAtMs,
        });
        return { status: 'error', error: result.error, diagnostics: result.diagnostics };
      }

      const evidence = result.evidence;
      this.logger.info('OCR', 'text extracted', {
        requestId,
        providerId: provider.id,
        durationMs: result.diagnostics.durationMs,
        // Length and terms only. The recognized text can contain anything the
        // camera saw, so it is kept in the debug panel, not in the log stream.
        extractedTextLength: evidence.extractedText.length,
        textConfidence: evidence.textConfidence,
        imageQuality: evidence.imageQuality,
      });
      this.logger.info('QUALITY', `image quality: ${evidence.imageQuality}`, {
        requestId,
        providerId: provider.id,
        ...evidence.confidenceMetadata,
      });
      this.logger.info('ALLERGEN', `peanut evidence detected: ${evidence.explicitPeanutEvidence}`, {
        requestId,
        providerId: provider.id,
        detectedTerms: evidence.detectedPeanutTerms,
        containsStatements: evidence.containsAllergens.length,
        mayContainStatements: evidence.mayContainAllergens.length,
        warnings: evidence.warnings,
      });

      return { status: 'success', evidence, diagnostics: result.diagnostics };
    } catch (thrown) {
      // A provider that throws degrades to "we learned nothing", never to GREEN.
      const error = toAppError(thrown, provider.id);
      this.logger.error('PACKAGE_SCAN', 'provider threw unexpectedly', {
        requestId,
        providerId: provider.id,
        technicalMessage: error.technicalMessage,
        durationMs: Date.now() - startedAtMs,
      });
      return {
        status: 'error',
        error:
          error.code === 'UNKNOWN_ERROR'
            ? createAppError('PACKAGE_ANALYSIS_FAILED', error.technicalMessage, {
                providerId: provider.id,
                cause: error.cause,
              })
            : error,
      };
    }
  }
}
