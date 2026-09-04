/**
 * Provider + service behaviour, using the TesseractOcrProvider's `createWorker`
 * test seam. No WASM, no network, no canvas: the real engine is exercised by
 * hand on a phone, the contract around it is exercised here.
 */

import { describe, expect, it, vi } from 'vitest';

import { Logger } from '../../../infrastructure/logging/logger.ts';
import { PackageScanService } from '../packageScanService.ts';
import { TesseractOcrProvider } from '../tesseractOcrProvider.ts';
import type { PackageAnalysisProvider } from '../packageAnalysisProvider.ts';
import { analyzePackageText } from '../packageTextAnalysis.ts';
import { createAppError } from '../../../domain/errors/appError.ts';

function silentLogger() {
  return new Logger({ minLevel: 'error', enabled: false });
}

function imageBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

/** A provider that skips image preparation entirely and returns fixed text. */
function textProvider(text: string, confidence = 90): PackageAnalysisProvider {
  return {
    id: 'stub-ocr',
    name: 'Stub OCR',
    enabled: true,
    analysisMethod: 'stub',
    analyze: async () => ({
      status: 'success' as const,
      evidence: analyzePackageText({
        providerId: 'stub-ocr',
        providerName: 'Stub OCR',
        analysisMethod: 'stub',
        reliability: 'medium',
        text,
        confidence,
        durationMs: 1,
      }),
      diagnostics: {
        providerId: 'stub-ocr',
        providerName: 'Stub OCR',
        requestId: 'req',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        imageBytes: 1024,
        imageType: 'image/jpeg',
        extractedTextLength: text.length,
        warnings: [],
      },
    }),
  };
}

describe('PackageScanService', () => {
  it('reports unavailable when no provider is enabled', async () => {
    const service = new PackageScanService({ providers: [], logger: silentLogger() });
    expect(service.available).toBe(false);

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });
    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' && outcome.error.code).toBe('PACKAGE_ANALYSIS_UNAVAILABLE');
  });

  it('rejects an empty file before touching the engine', async () => {
    const provider = textProvider('מכיל בוטנים');
    const analyze = vi.spyOn(provider, 'analyze');
    const service = new PackageScanService({ providers: [provider], logger: silentLogger() });

    const outcome = await service.analyze(new Blob([]), { requestId: 'req' });

    expect(outcome.status === 'error' && outcome.error.code).toBe('PACKAGE_IMAGE_UNREADABLE');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('returns normalized evidence on success', async () => {
    const service = new PackageScanService({
      providers: [textProvider('מכיל: בוטנים.')],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });

    expect(outcome.status).toBe('success');
    expect(outcome.status === 'success' && outcome.evidence.explicitPeanutEvidence).toBe(true);
  });

  it('converts a provider that throws into an error, never into evidence', async () => {
    const provider: PackageAnalysisProvider = {
      ...textProvider(''),
      analyze: async () => {
        throw new Error('worker exploded');
      },
    };
    const service = new PackageScanService({ providers: [provider], logger: silentLogger() });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });

    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' && outcome.error.code).toBe('PACKAGE_ANALYSIS_FAILED');
  });

  it('passes a provider-reported error through unchanged', async () => {
    const provider: PackageAnalysisProvider = {
      ...textProvider(''),
      analyze: async () => ({
        status: 'error' as const,
        error: createAppError('PACKAGE_IMAGE_UNREADABLE', 'too blurry'),
        diagnostics: {
          providerId: 'stub-ocr',
          providerName: 'Stub OCR',
          requestId: 'req',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 1,
          imageBytes: 1,
          imageType: 'image/jpeg',
          extractedTextLength: 0,
          warnings: [],
        },
      }),
    };
    const service = new PackageScanService({ providers: [provider], logger: silentLogger() });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });
    expect(outcome.status === 'error' && outcome.error.code).toBe('PACKAGE_IMAGE_UNREADABLE');
  });

  it('logs the scan without ever logging the image itself', async () => {
    const logger = silentLogger();
    const service = new PackageScanService({
      providers: [textProvider('מכיל: בוטנים.')],
      logger,
    });

    await service.analyze(imageBlob(), { requestId: 'req42', barcode: '7290000074184' });

    const serialized = JSON.stringify(logger.getEntries('req42'));
    expect(serialized).toContain('peanut evidence detected: true');
    expect(serialized).toContain('imageBytes');
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('blob:');
  });
});

describe('TesseractOcrProvider', () => {
  const context = { requestId: 'req', logger: silentLogger() };

  it('refuses to run when disabled', async () => {
    const provider = new TesseractOcrProvider({ enabled: false, languages: 'heb+eng' });
    const result = await provider.analyze(imageBlob(), context);

    expect(result.status).toBe('error');
    expect(result.status === 'error' && result.error.code).toBe('PACKAGE_ANALYSIS_UNAVAILABLE');
  });

  it('reports a failure rather than empty evidence when the pipeline fails', async () => {
    // Runs under the node test environment, which has no canvas — so this
    // exercises the "image could not even be prepared" path as well.
    const provider = new TesseractOcrProvider({
      enabled: true,
      languages: 'heb+eng',
      createWorker: async () => {
        throw new Error('engine assets unavailable');
      },
    });

    const result = await provider.analyze(imageBlob(), context);

    expect(result.status).toBe('error');
    // Distinguishable from "we read the label and saw nothing" — which is the
    // whole point: a failed read must never look like a completed one.
    expect(result.status === 'error' && result.error.code).toBe('PACKAGE_ANALYSIS_FAILED');
  });
});

describe('provider escalation', () => {
  /** A provider that always returns the given text, recording that it ran. */
  function recording(id: string, text: string, confidence = 90) {
    const calls = { count: 0 };
    const provider: PackageAnalysisProvider = {
      id,
      name: id,
      enabled: true,
      analysisMethod: id,
      analyze: async () => {
        calls.count += 1;
        return {
          status: 'success' as const,
          evidence: analyzePackageText({
            providerId: id,
            providerName: id,
            analysisMethod: id,
            reliability: 'medium',
            text,
            confidence,
            durationMs: 1,
          }),
          diagnostics: {
            providerId: id,
            providerName: id,
            requestId: 'req',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 1,
            imageBytes: 1,
            imageType: 'image/jpeg',
            extractedTextLength: text.length,
            warnings: [],
          },
        };
      },
    };
    return { provider, calls };
  }

  const GOOD_LABEL = [
    'רכיבים: קמח חיטה, סוכר, שמן דקלים, מלח.',
    'מייצב, חומר תפיחה, ארומה, ויטמינים.',
    'לשמור במקום קריר ויבש הרחק מלחות.',
    'תוצרת ישראל. יצרן: דוגמה בעמ, תל אביב.',
  ].join('\n');

  it('stops at the first provider when it finds explicit peanut evidence', async () => {
    // No reason to pay a remote model to confirm what the label already says.
    const first = recording('local', 'מכיל: בוטנים.');
    const second = recording('remote', GOOD_LABEL);
    const service = new PackageScanService({
      providers: [first.provider, second.provider],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });

    expect(outcome.status === 'success' && outcome.evidence.explicitPeanutEvidence).toBe(true);
    expect(second.calls.count).toBe(0);
  });

  it('stops at the first provider when it produced a good read that found nothing', async () => {
    const first = recording('local', GOOD_LABEL);
    const second = recording('remote', 'מכיל: בוטנים.');
    const service = new PackageScanService({
      providers: [first.provider, second.provider],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });

    expect(outcome.status === 'success' && outcome.evidence.imageQuality).toBe('good');
    expect(second.calls.count).toBe(0);
  });

  it('escalates to the next provider when the local read was poor', async () => {
    const first = recording('local', 'xy', 10);
    const second = recording('remote', 'עלול להכיל בוטנים.');
    const service = new PackageScanService({
      providers: [first.provider, second.provider],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });

    expect(second.calls.count).toBe(1);
    expect(outcome.status === 'success' && outcome.evidence.explicitPeanutEvidence).toBe(true);
  });

  it('falls back to the first provider when escalation also found nothing', async () => {
    const first = recording('local', 'xy', 10);
    const second = recording('remote', 'ab', 10);
    const service = new PackageScanService({
      providers: [first.provider, second.provider],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });

    expect(outcome.status).toBe('success');
    expect(outcome.status === 'success' && outcome.evidence.providerId).toBe('local');
  });

  it('skips a broken provider and uses the working one', async () => {
    const broken: PackageAnalysisProvider = {
      ...textProvider(''),
      id: 'broken',
      analyze: async () => {
        throw new Error('down');
      },
    };
    const working = recording('remote', 'מכיל: בוטנים.');
    const service = new PackageScanService({
      providers: [broken, working.provider],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });
    expect(outcome.status === 'success' && outcome.evidence.explicitPeanutEvidence).toBe(true);
  });

  it('reports an error when every provider failed — never empty evidence', async () => {
    const broken = (id: string): PackageAnalysisProvider => ({
      ...textProvider(''),
      id,
      analyze: async () => {
        throw new Error('down');
      },
    });
    const service = new PackageScanService({
      providers: [broken('a'), broken('b')],
      logger: silentLogger(),
    });

    const outcome = await service.analyze(imageBlob(), { requestId: 'req' });
    expect(outcome.status).toBe('error');
  });
});
