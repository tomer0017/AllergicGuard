/**
 * Remote Vision fallback — PREPARED, DISABLED.
 *
 * WHEN IT WOULD RUN
 * -----------------
 * Only as a second opinion, and only when the browser OCR pass was inconclusive:
 *
 *   photo → Tesseract → explicit peanut wording?  → RED, stop (no remote call)
 *                     → good-quality read, nothing found? → ORANGE, stop
 *                     → poor/partial read?              → remote Vision
 *
 * That ordering matters for cost, latency and privacy: the overwhelming
 * majority of photos never leave the device, and the ones that would are
 * exactly the ones where local OCR admits it failed.
 *
 * WHY IT IS DISABLED
 * ------------------
 * Every credible multimodal provider (Gemini, OpenAI, Google Cloud Vision)
 * requires an API key. GitHub Pages ships every byte to the browser, so a key
 * in the bundle is a published key. This provider therefore talks to a PROXY
 * URL and never to a model vendor, and it stays disabled until such a proxy is
 * deployed. There are no credentials in this repository and none are invented.
 *
 * PROXY CONTRACT (see README → "Optional remote Vision fallback")
 * --------------------------------------------------------------
 *   POST <proxyUrl>
 *   Content-Type: application/json
 *   { "image": "<base64 JPEG/PNG, no data: prefix>", "mimeType": "image/png" }
 *
 *   200 { "text": "<verbatim text read from the label>" }
 *   4xx/5xx → treated as a failure, which leaves the verdict untouched
 *
 * The proxy must return TEXT ONLY. It must not return a verdict, a safety
 * judgement, or a boolean. The recognized text is fed through the same
 * `analyzePackageText` rules as local OCR, so a remote model cannot invent a
 * decision path of its own — and, like every package source, it cannot clear a
 * product no matter what it says.
 */

import { createAppError, toAppError } from '../../domain/errors/appError.ts';
import { analyzePackageText } from './packageTextAnalysis.ts';
import type {
  PackageAnalysisContext,
  PackageAnalysisDiagnostics,
  PackageAnalysisProvider,
  PackageAnalysisResult,
} from './packageAnalysisProvider.ts';

export const REMOTE_VISION_PROVIDER_ID = 'remote-vision';

export interface RemoteVisionProviderOptions {
  readonly enabled: boolean;
  /** Credential-holding proxy endpoint. Never a model vendor URL, never a key. */
  readonly proxyUrl: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

interface ProxyResponse {
  readonly text?: unknown;
}

export class RemoteVisionProvider implements PackageAnalysisProvider {
  readonly id = REMOTE_VISION_PROVIDER_ID;
  readonly name = 'ניתוח תמונה מרחוק';
  readonly analysisMethod = 'Vision מרוחק דרך שרת מתווך';
  readonly enabled: boolean;

  private readonly options: RemoteVisionProviderOptions;

  constructor(options: RemoteVisionProviderOptions) {
    this.options = options;
    // A configured-but-URL-less provider stays disabled rather than looking
    // operational and failing every scan.
    this.enabled = options.enabled && options.proxyUrl.trim().length > 0;
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
        error: createAppError(
          'PACKAGE_ANALYSIS_UNAVAILABLE',
          'Remote Vision provider is disabled: no proxy URL is configured.',
          { providerId: this.id },
        ),
        diagnostics: diagnostics(0),
      };
    }

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    context.signal?.addEventListener('abort', () => controller.abort());

    try {
      context.onProgress?.(0.2, 'uploading');
      const response = await fetchImpl(this.options.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: await toBase64(image), mimeType: image.type || 'image/png' }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw createAppError(
          'VISION_PROVIDER_FAILED',
          `Vision proxy returned HTTP ${response.status}`,
          { providerId: this.id },
        );
      }

      const body = (await response.json()) as ProxyResponse;
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text) warnings.push('Vision proxy returned no text.');

      context.onProgress?.(1, 'done');
      return {
        status: 'success',
        // Same interpretation rules as local OCR: the remote model supplies
        // text, never a decision.
        evidence: analyzePackageText({
          providerId: this.id,
          providerName: this.name,
          analysisMethod: this.analysisMethod,
          reliability: 'medium',
          text,
          durationMs: Date.now() - startedAtMs,
          warnings,
          rawAnalysisAvailable: true,
        }),
        diagnostics: diagnostics(text.length),
      };
    } catch (thrown) {
      const error = toAppError(thrown, this.id);
      context.logger.error('PACKAGE_SCAN', 'remote vision analysis failed', {
        requestId: context.requestId,
        providerId: this.id,
        technicalMessage: error.technicalMessage,
      });
      return {
        status: 'error',
        error:
          error.code === 'UNKNOWN_ERROR'
            ? createAppError('VISION_PROVIDER_FAILED', error.technicalMessage, {
                providerId: this.id,
                cause: error.cause,
              })
            : error,
        diagnostics: diagnostics(0),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function toBase64(image: Blob): Promise<string> {
  const buffer = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]!);
  return btoa(binary);
}
