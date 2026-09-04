/**
 * Browser-side OCR provider built on Tesseract.js (WASM).
 *
 * WHY THIS AND NOT A CLOUD VISION API — see README → "Package photo analysis".
 * Short version: it needs no API key, so it fits a static GitHub Pages deploy
 * with no backend and no secret to leak; the photo never leaves the phone; and
 * the job here is keyword detection on a label, not document understanding —
 * a task where Tesseract's ~92-96% accuracy on clean Hebrew/Latin print is
 * enough, especially since every OCR failure degrades to ORANGE, never to GREEN.
 *
 * Engine assets (WASM core ~4MB, heb ~0.6MB, eng ~3MB) are fetched from the
 * jsDelivr CDN on FIRST USE ONLY and cached by Tesseract.js in IndexedDB. The
 * library itself is dynamically imported, so a user who never photographs a
 * package never downloads any of it.
 */

import { createAppError, toAppError } from '../../domain/errors/appError.ts';
import { prepareImageForOcr } from './imagePreparation.ts';
import { analyzePackageText } from './packageTextAnalysis.ts';
import type {
  PackageAnalysisContext,
  PackageAnalysisDiagnostics,
  PackageAnalysisProvider,
  PackageAnalysisResult,
} from './packageAnalysisProvider.ts';

/** Minimal shape we use from Tesseract.js, so the app is not coupled to it. */
interface OcrWorker {
  setParameters(params: Record<string, unknown>): Promise<unknown>;
  recognize(image: Blob | string): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}

export interface TesseractOcrProviderOptions {
  readonly enabled: boolean;
  /** Tesseract language codes, e.g. "heb+eng". */
  readonly languages: string;
  /** Override the CDN the engine core is fetched from. */
  readonly corePath?: string;
  /** Override the CDN the language data is fetched from. */
  readonly langPath?: string;
  /** Test seam: supply a worker instead of loading the real engine. */
  readonly createWorker?: (context: PackageAnalysisContext) => Promise<OcrWorker>;
}

export class TesseractOcrProvider implements PackageAnalysisProvider {
  readonly id = 'tesseract-ocr';
  readonly name = 'זיהוי טקסט במכשיר (OCR)';
  readonly analysisMethod = 'OCR בדפדפן (Tesseract.js)';
  readonly enabled: boolean;

  private readonly options: TesseractOcrProviderOptions;

  constructor(options: TesseractOcrProviderOptions) {
    this.options = options;
    this.enabled = options.enabled;
  }

  async analyze(image: Blob, context: PackageAnalysisContext): Promise<PackageAnalysisResult> {
    const startedAtMs = Date.now();
    const warnings: string[] = [];

    const diagnostics = (extractedTextLength: number): PackageAnalysisDiagnostics => {
      const completedAtMs = Date.now();
      return {
        providerId: this.id,
        providerName: this.name,
        requestId: context.requestId,
        startedAt: new Date(startedAtMs).toISOString(),
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - startedAtMs,
        imageBytes: image.size,
        imageType: image.type || 'unknown',
        extractedTextLength,
        warnings,
      };
    };

    if (!this.enabled) {
      return {
        status: 'error',
        error: createAppError('PACKAGE_ANALYSIS_UNAVAILABLE', 'OCR provider is disabled', {
          providerId: this.id,
        }),
        diagnostics: diagnostics(0),
      };
    }

    let worker: OcrWorker | undefined;
    try {
      context.onProgress?.(0.05, 'preparing');
      const prepared = await prepareImageForOcr(image);
      warnings.push(...prepared.warnings);
      context.logger.debug('PACKAGE_SCAN', 'image prepared', {
        requestId: context.requestId,
        providerId: this.id,
        original: `${prepared.originalWidth}x${prepared.originalHeight}`,
        prepared: `${prepared.width}x${prepared.height}`,
      });

      if (context.signal?.aborted) throw new Error('Analysis aborted');

      context.onProgress?.(0.15, 'loading_engine');
      worker = await this.loadWorker(context);

      if (context.signal?.aborted) throw new Error('Analysis aborted');

      context.onProgress?.(0.55, 'recognizing');
      const { data } = await worker.recognize(prepared.source);

      const evidence = analyzePackageText({
        providerId: this.id,
        providerName: this.name,
        analysisMethod: this.analysisMethod,
        // Never higher: OCR is a reading of a photo, not a manufacturer record.
        // Reliability is irrelevant to clearing (see packageEvidence.ts) and
        // only affects how the source is described to the user.
        reliability: 'medium',
        text: data.text ?? '',
        confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
        durationMs: Date.now() - startedAtMs,
        warnings,
        rawAnalysisAvailable: true,
      });

      context.onProgress?.(1, 'done');
      return { status: 'success', evidence, diagnostics: diagnostics(evidence.extractedText.length) };
    } catch (thrown) {
      const error = toAppError(thrown, this.id);
      context.logger.error('PACKAGE_SCAN', 'analysis failed', {
        requestId: context.requestId,
        providerId: this.id,
        technicalMessage: error.technicalMessage,
      });
      warnings.push(error.technicalMessage);
      return {
        status: 'error',
        error:
          error.code === 'UNKNOWN_ERROR'
            ? createAppError('PACKAGE_ANALYSIS_FAILED', error.technicalMessage, {
                providerId: this.id,
                cause: error.cause,
              })
            : error,
        diagnostics: diagnostics(0),
      };
    } finally {
      await worker?.terminate().catch(() => undefined);
    }
  }

  private async loadWorker(context: PackageAnalysisContext): Promise<OcrWorker> {
    if (this.options.createWorker) return this.options.createWorker(context);

    // Dynamic import: the ~60KB library and its multi-megabyte engine assets
    // are only ever fetched by a user who actually photographs a package.
    const tesseract = await import('tesseract.js');
    const worker = (await tesseract.createWorker(this.options.languages, undefined, {
      corePath: this.options.corePath,
      langPath: this.options.langPath,
      logger: (message: { status: string; progress: number }) => {
        // Map engine progress into the 0.15-0.95 slice the UI reserves for it.
        context.onProgress?.(0.15 + message.progress * 0.8, message.status);
      },
    })) as unknown as OcrWorker;

    await worker.setParameters({
      // Allergen panels are dense multi-line blocks, not single lines.
      tessedit_pageseg_mode: '3',
      preserve_interword_spaces: '1',
    });
    return worker;
  }
}
