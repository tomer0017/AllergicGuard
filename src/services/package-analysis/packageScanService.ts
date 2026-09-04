/**
 * Orchestrates one package-photo analysis: pick the provider, run it, log every
 * stage under the scan's correlation id, and hand back normalized evidence.
 *
 * It makes no safety decision. Merging the evidence into a result is
 * ProductLookupService.applyPackageEvidence's job, and the verdict is always
 * the pure safety engine's.
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
      this.logger.info('PACKAGE_SCAN', 'text extracted', {
        requestId,
        providerId: provider.id,
        durationMs: result.diagnostics.durationMs,
        // Length and terms only. The recognized text can contain anything the
        // camera saw, so it is kept in the debug panel, not in the log stream.
        extractedTextLength: evidence.extractedText.length,
        textConfidence: evidence.textConfidence,
        imageQuality: evidence.imageQuality,
      });
      this.logger.info('PACKAGE_SCAN', `peanut evidence detected: ${evidence.explicitPeanutEvidence}`, {
        requestId,
        providerId: provider.id,
        detectedTerms: evidence.detectedProductTerms,
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
