/**
 * @vitest-environment jsdom
 *
 * The scan session state machine: scan → confirm → result, and the automatic
 * photo analysis that follows an ORANGE.
 *
 * appServices is mocked so these tests exercise sequencing and safety
 * behaviour only — the lookup and the safety engine have their own tests.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assessPeanutRisk } from '../../domain/allergy/assessAllergenRisk.ts';
import type { PackageEvidence } from '../../domain/package/packageEvidence.ts';
import { analyzePackageText } from '../../services/package-analysis/packageTextAnalysis.ts';
import { createAppError } from '../../domain/errors/appError.ts';
import { makeEvidence } from '../../testing/evidenceFixtures.ts';
import type { ProductLookupResult } from '../../services/product-data/productLookupService.ts';

const lookup = vi.fn();
const applyPackageEvidence = vi.fn();
const analyze = vi.fn();

vi.mock('../appServices.ts', () => ({
  appServices: {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    lookupService: {
      lookup: (...args: unknown[]) => lookup(...args),
      applyPackageEvidence: (...args: unknown[]) => applyPackageEvidence(...args),
    },
    packageScanService: {
      available: true,
      analyze: (...args: unknown[]) => analyze(...args),
    },
  },
}));

const { useProductScan } = await import('../useProductScan.ts');

const BARCODE = '7290000074184';

/** Open Food Facts answered with an identity but no allergen fields. */
const INCOMPLETE = makeEvidence({
  providerId: 'off',
  productName: 'Petit Beurre',
  allergenDataStatus: 'missing',
  mayContainDataStatus: 'missing',
});

function orangeResult(): ProductLookupResult {
  return {
    requestId: 'req001',
    barcode: BARCODE,
    allergen: 'peanut',
    product: { barcode: BARCODE, displayName: 'פתי בר', contributingProviderIds: ['off'] },
    assessment: assessPeanutRisk({ evidence: [INCOMPLETE] }),
    evidence: [INCOMPLETE],
    providerResults: [],
    conflicts: [],
    generatedAt: new Date().toISOString(),
  };
}

function photo(text: string, confidence = 90): PackageEvidence {
  return analyzePackageText({
    providerId: 'tesseract-ocr',
    providerName: 'OCR',
    analysisMethod: 'test',
    reliability: 'medium',
    text,
    confidence,
    durationMs: 1,
  });
}

const GOOD_LABEL = [
  'רכיבים: קמח חיטה, סוכר, שמן דקלים, מלח.',
  'מייצב, חומר תפיחה, ארומה, ויטמינים.',
  'לשמור במקום קריר ויבש הרחק מלחות.',
  'תוצרת ישראל. יצרן: דוגמה בעמ, תל אביב.',
].join('\n');

beforeEach(() => {
  lookup.mockReset();
  applyPackageEvidence.mockReset();
  analyze.mockReset();
  lookup.mockResolvedValue(orangeResult());
  applyPackageEvidence.mockImplementation((result: ProductLookupResult) => result);
});

afterEach(() => vi.clearAllMocks());

async function scanTo(screen: 'confirming' | 'result') {
  const hook = renderHook(() => useProductScan());
  await act(async () => {
    await hook.result.current.check(BARCODE);
  });
  if (screen === 'result') act(() => hook.result.current.confirmProduct());
  return hook;
}

describe('scan → confirm → result', () => {
  it('stops at the confirmation step instead of showing the verdict', async () => {
    const { result } = await scanTo('confirming');

    expect(result.current.screen).toBe('confirming');
    expect(result.current.pendingConfirmation?.barcode).toBe(BARCODE);
    // The verdict exists but is deliberately not exposed yet.
    expect(result.current.result).toBeNull();
  });

  it('shows the verdict only after the user confirms the product', async () => {
    const { result } = await scanTo('confirming');
    act(() => result.current.confirmProduct());

    expect(result.current.screen).toBe('result');
    expect(result.current.result?.assessment.status).toBe('insufficient_data');
    expect(result.current.pendingConfirmation).toBeNull();
  });

  it('discards the lookup entirely when the user says it is the wrong product', async () => {
    const { result } = await scanTo('confirming');
    act(() => result.current.rejectProduct());

    // Allergen data for the wrong product is worse than no data at all.
    expect(result.current.screen).toBe('home');
    expect(result.current.result).toBeNull();
    expect(result.current.pendingConfirmation).toBeNull();
  });

  it('re-confirms on every new scan rather than reusing the last answer', async () => {
    const { result } = await scanTo('result');
    await act(async () => {
      await result.current.check('7290000446547');
    });
    expect(result.current.screen).toBe('confirming');
  });
});

describe('automatic photo analysis', () => {
  it('starts analysis on its own — there is no separate confirm step', async () => {
    analyze.mockResolvedValue({ status: 'success', evidence: photo(GOOD_LABEL) });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(applyPackageEvidence).toHaveBeenCalledTimes(1);
    expect(result.current.packageScan.attempts).toBe(1);
  });

  it('asks for a retake when the photo could not be read', async () => {
    analyze.mockResolvedValue({ status: 'success', evidence: photo('xy', 10) });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(result.current.packageScan.retake?.reason).toBe('poor_quality');
    expect(result.current.packageScan.retake?.quality).toBe('poor');
  });

  it('asks for a retake when only part of the label was read', async () => {
    analyze.mockResolvedValue({ status: 'success', evidence: photo('מכיל חלב וסוכר', 90) });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(result.current.packageScan.retake?.reason).toBe('partial_read');
  });

  it('does NOT ask for a retake when a poor photo still found peanuts', async () => {
    // There is nothing left to find: the label already answered the question.
    analyze.mockResolvedValue({ status: 'success', evidence: photo('PEANUT', 15) });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(result.current.packageScan.retake).toBeNull();
  });

  it('does not ask for a retake after a clean, complete read', async () => {
    analyze.mockResolvedValue({ status: 'success', evidence: photo(GOOD_LABEL) });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(result.current.packageScan.retake).toBeNull();
  });

  it('leaves the verdict untouched when analysis fails, and asks for a retake', async () => {
    analyze.mockResolvedValue({
      status: 'error',
      error: createAppError('OCR_FAILED', 'engine died'),
    });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(applyPackageEvidence).not.toHaveBeenCalled();
    expect(result.current.result?.assessment.status).toBe('insufficient_data');
    expect(result.current.packageScan.retake?.reason).toBe('analysis_failed');
  });

  it('survives a provider that throws, without clearing the product', async () => {
    analyze.mockRejectedValue(new Error('boom'));
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(result.current.result?.assessment.status).toBe('insufficient_data');
    expect(result.current.packageScan.retake?.reason).toBe('analysis_failed');
  });

  it('counts repeated attempts within one product session', async () => {
    analyze.mockResolvedValue({ status: 'success', evidence: photo('xy', 10) });
    const { result } = await scanTo('result');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['a']));
    });
    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['b']));
    });

    expect(result.current.packageScan.attempts).toBe(2);
  });

  it('ignores a photo taken before any product was confirmed', async () => {
    const { result } = await scanTo('confirming');

    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });

    expect(analyze).not.toHaveBeenCalled();
  });

  it('clears photo state when a new product is scanned', async () => {
    analyze.mockResolvedValue({ status: 'success', evidence: photo('xy', 10) });
    const { result } = await scanTo('result');
    await act(async () => {
      await result.current.packageScan.analyze(new Blob(['x']));
    });
    expect(result.current.packageScan.attempts).toBe(1);

    await act(async () => {
      await result.current.check('7290000446547');
    });

    await waitFor(() => expect(result.current.packageScan.attempts).toBe(0));
    expect(result.current.packageScan.retake).toBeNull();
  });
});

describe('failsafe', () => {
  it('shows ORANGE, never a crash, when the whole lookup pipeline throws', async () => {
    lookup.mockRejectedValue(new Error('network exploded'));
    const { result } = await scanTo('confirming');

    expect(result.current.screen).toBe('confirming');
    expect(result.current.pendingConfirmation?.assessment.status).toBe('insufficient_data');
  });
});
