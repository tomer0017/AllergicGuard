/**
 * @vitest-environment jsdom
 *
 * Presentation behaviour that the redesign is responsible for. These assert
 * what the user can SEE and DO — not CSS values, which would break on every
 * visual tweak without protecting anything.
 *
 * The domain result is always constructed by the real safety engine, so a test
 * here can never accidentally assert a verdict the engine would not produce.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `globals: false` in the vitest config means Testing Library's automatic
// cleanup is not registered, so renders would otherwise stack up in the DOM.
afterEach(cleanup);

import { assessPeanutRisk } from '../../domain/allergy/assessAllergenRisk.ts';
import { makeClearingEvidence, makeEvidence } from '../../testing/evidenceFixtures.ts';
import { analyzePackageText } from '../../services/package-analysis/packageTextAnalysis.ts';
import { toProductEvidence } from '../../domain/package/packageEvidence.ts';
import type { ProductEvidence } from '../../domain/product/productEvidence.ts';
import type {
  PackageScanRecord,
  ProductLookupResult,
} from '../../services/product-data/productLookupService.ts';
import type { PackageScanApi } from '../../app/useProductScan.ts';
import { ResultScreen } from '../product-result/ResultScreen.tsx';
import { ProductConfirmation } from '../product-confirm/ProductConfirmation.tsx';
import { HomeScreen } from '../home/HomeScreen.tsx';

const BARCODE = '7290000074184';

const packageScan: PackageScanApi = {
  available: true,
  state: 'idle',
  progress: 0,
  retake: null,
  attempts: 0,
  analyze: async () => {},
  dismissRetake: () => {},
};

function buildResult(
  evidence: readonly ProductEvidence[],
  overrides: Partial<ProductLookupResult> = {},
): ProductLookupResult {
  return {
    requestId: 'req001',
    barcode: BARCODE,
    allergen: 'peanut',
    product: {
      barcode: BARCODE,
      displayName: 'ביסקוויט פתי בר',
      brand: 'אסם',
      contributingProviderIds: ['off'],
    },
    assessment: assessPeanutRisk({ evidence }),
    evidence,
    providerResults: [],
    conflicts: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const INCOMPLETE = makeEvidence({
  providerId: 'off',
  providerName: 'Open Food Facts',
  productName: 'Petit Beurre',
  allergenDataStatus: 'missing',
  mayContainDataStatus: 'missing',
});

const PEANUT = makeEvidence({
  providerId: 'off',
  providerName: 'Open Food Facts',
  containsAllergens: ['en:peanuts'],
});

function packageRecord(text: string): PackageScanRecord {
  const evidence = analyzePackageText({
    providerId: 'tesseract-ocr',
    providerName: 'OCR',
    analysisMethod: 'OCR בדפדפן',
    reliability: 'medium',
    text,
    confidence: 90,
    durationMs: 1,
  });
  return {
    scanId: 'req001-1',
    providerId: evidence.providerId,
    providerName: evidence.providerName,
    analysisMethod: evidence.analysisMethod,
    packageEvidence: evidence,
    previousStatus: 'insufficient_data',
    previousReasonCode: 'ALLERGEN_DATA_MISSING',
    newStatus: 'danger',
    newReasonCode: 'MAY_CONTAIN_DECLARED',
    escalated: true,
    performedAt: new Date().toISOString(),
  };
}

describe('home screen', () => {
  it('offers all three ways to check a product', () => {
    render(
      <HomeScreen onScan={() => {}} onManual={() => {}} onPackagePhoto={() => {}} packagePhotoAvailable />,
    );

    expect(screen.getByRole('button', { name: /סריקת ברקוד/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /הזנת ברקוד ידנית/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /צילום גב האריזה/ })).toBeTruthy();
  });

  it('presents the package photo as its own entry point, not a fallback', () => {
    const onPackagePhoto = vi.fn();
    render(
      <HomeScreen
        onScan={() => {}}
        onManual={() => {}}
        onPackagePhoto={onPackagePhoto}
        packagePhotoAvailable
      />,
    );

    screen.getByRole('button', { name: /צילום גב האריזה/ }).click();
    expect(onPackagePhoto).toHaveBeenCalledTimes(1);
  });

  it('hides the photo option when no analysis provider is enabled', () => {
    render(
      <HomeScreen
        onScan={() => {}}
        onManual={() => {}}
        onPackagePhoto={() => {}}
        packagePhotoAvailable={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /צילום גב האריזה/ })).toBeNull();
  });

  it('has no history destination', () => {
    const { container } = render(
      <HomeScreen onScan={() => {}} onManual={() => {}} onPackagePhoto={() => {}} packagePhotoAvailable />,
    );
    expect(container.textContent).not.toMatch(/היסטוריה|מוצרים אחרונים/);
    // Three ways to check a product, and nothing else competing with them.
    expect(container.querySelectorAll('button')).toHaveLength(3);
  });
});

describe('ORANGE is an action state', () => {
  const result = buildResult([INCOMPLETE]);

  it('is the insufficient_data verdict from the real engine', () => {
    expect(result.assessment.status).toBe('insufficient_data');
  });

  it('shows the photo action immediately, not behind a disclosure', () => {
    render(<ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />);

    const cta = screen.getByRole('button', { name: /צלם את גב האריזה/ });
    expect(cta).toBeTruthy();
    expect(cta.closest('details')).toBeNull();
  });

  it('keeps the gallery available as a quieter option', () => {
    render(<ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />);
    expect(screen.getByRole('button', { name: /בחירה מהגלריה/ })).toBeTruthy();
  });

  it('states the missing-data fact once rather than in several places', () => {
    const { container } = render(
      <ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />,
    );
    const occurrences = (container.textContent ?? '').match(/אין מספיק מידע/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('never uses the word "safe"', () => {
    const { container } = render(
      <ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/בטוח/);
  });
});

describe('RED is prominent and final', () => {
  const result = buildResult([PEANUT]);

  it('is the danger verdict from the real engine', () => {
    expect(result.assessment.status).toBe('danger');
  });

  it('leads with the danger, the reason and the instruction', () => {
    render(<ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />);

    const verdict = screen.getByText('נמצא סיכון לבוטנים').closest('.status--danger') as HTMLElement;
    expect(verdict.getAttribute('role')).toBe('alert');
    expect(within(verdict).getByText('מכיל בוטנים')).toBeTruthy();
    expect(within(verdict).getByText('אין לתת את המוצר לילד.')).toBeTruthy();
  });

  it('does not offer another photo — there is nothing left to find', () => {
    render(<ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />);
    expect(screen.queryByRole('button', { name: /צלם את גב האריזה/ })).toBeNull();
  });

  it('quotes the package wording verbatim when the photo caused the escalation', () => {
    const scan = packageRecord('רכיבים: סוכר.\nעלול להכיל בוטנים.');
    const withPhoto = buildResult([INCOMPLETE, toProductEvidence(scan.packageEvidence, BARCODE)], {
      packageScans: [scan],
    });
    expect(withPhoto.assessment.status).toBe('danger');

    const { container } = render(
      <ResultScreen result={withPhoto} packageScan={packageScan} onScanAgain={() => {}} />,
    );

    // Scoped to the verdict block: the same wording is also quoted inside the
    // collapsed details, and this test is about what leads the screen.
    const verdict = container.querySelector('.status--danger') as HTMLElement;
    expect(within(verdict).getByText('על האריזה מופיע:')).toBeTruthy();
    // The quote carries the reason, so the generic label is not repeated above it.
    expect(verdict.querySelector('q')?.textContent).toContain('עלול להכיל בוטנים');
    expect(verdict.querySelector('.status__reason')).toBeNull();
  });
});

describe('GREEN is reassuring without claiming safety', () => {
  const result = buildResult([makeClearingEvidence({ providerId: 'off', reliability: 'high' })]);

  it('is the no_known_risk verdict from the real engine', () => {
    expect(result.assessment.status).toBe('no_known_risk');
  });

  it('never says the product is safe, and keeps the caveat visible', () => {
    const { container } = render(
      <ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />,
    );
    const verdict = container.querySelector('.status--ok') as HTMLElement;
    expect(within(verdict).getByText('לא נמצא סימון לבוטנים')).toBeTruthy();
    expect(container.textContent).toMatch(/זו אינה הצהרה שהמוצר בטוח/);
    expect(container.textContent).not.toMatch(/בטוח לאכילה|100%/);
  });

  it('still allows a package photo as a double-check', () => {
    render(<ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />);
    expect(screen.getByRole('button', { name: /צלם את גב האריזה/ })).toBeTruthy();
  });
});

describe('technical detail is secondary', () => {
  it('keeps sources and evidence collapsed by default, but present', () => {
    const result = buildResult([INCOMPLETE]);
    const { container } = render(
      <ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />,
    );

    const disclosure = container.querySelector('details.disclosure') as HTMLDetailsElement;
    expect(disclosure).toBeTruthy();
    expect(disclosure.open).toBe(false);
    expect(within(disclosure).getByText('פרטי הבדיקה והמקורות')).toBeTruthy();
    // Collapsed, not deleted: the transparency data is still rendered inside.
    expect(within(disclosure).getByText('מאיפה הגיע המידע?')).toBeTruthy();
  });

  it('puts nothing technical above the verdict', () => {
    const result = buildResult([INCOMPLETE]);
    const { container } = render(
      <ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />,
    );

    const beforeVerdict = container.textContent?.split('אין מספיק מידע')[0] ?? '';
    expect(beforeVerdict).not.toMatch(/Open Food Facts|אמינות|HTTP/);
  });
});

describe('retake', () => {
  it('asks for another photo instead of reporting an error', () => {
    const result = buildResult([INCOMPLETE]);
    render(
      <ResultScreen
        result={result}
        packageScan={{ ...packageScan, attempts: 1, retake: { reason: 'poor_quality', quality: 'poor' } }}
        onScanAgain={() => {}}
      />,
    );

    expect(screen.getByText('לא הצלחנו לקרוא את הסימון בצורה ברורה.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /צלם שוב/ })).toBeTruthy();
  });

  it('shows a processing state while analysing, with no diagnostics', () => {
    const result = buildResult([INCOMPLETE]);
    const { container } = render(
      <ResultScreen
        result={result}
        packageScan={{ ...packageScan, state: 'analyzing', progress: 0.4 }}
        onScanAgain={() => {}}
      />,
    );

    expect(screen.getByText(/קורא את הרכיבים וסימון האלרגנים/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/confidence|OCR confidence|tesseract/i);
  });
});

describe('product confirmation', () => {
  it('asks about identity only, and never implies safety', () => {
    const { container } = render(
      <ProductConfirmation result={buildResult([PEANUT])} onConfirm={() => {}} onReject={() => {}} />,
    );

    expect(screen.getByText('האם זה המוצר שסרקת?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /כן, זה המוצר/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /לא — סרוק שוב/ })).toBeTruthy();
    // The verdict must not leak into the identity step.
    expect(container.textContent).not.toMatch(/סיכון|בטוח|אין מספיק מידע/);
  });

  it('asks about the barcode when the product could not be identified', () => {
    const result = buildResult([], { product: null });
    render(<ProductConfirmation result={result} onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText('האם זה הברקוד שעל המוצר?')).toBeTruthy();
  });
});

describe('photo-only check', () => {
  it('starts from a neutral prompt rather than a data-failure warning', () => {
    const result = buildResult([], { barcode: '', product: null });
    const { container } = render(
      <ResultScreen result={result} packageScan={packageScan} onScanAgain={() => {}} />,
    );

    // Nothing has been checked yet, so claiming a lookup failed would be false.
    expect(screen.getByText('בדיקה לפי צילום האריזה')).toBeTruthy();
    expect(container.textContent).not.toMatch(/אין מספיק מידע/);
    // But it is still not GREEN: the engine's verdict is unchanged underneath.
    expect(result.assessment.status).toBe('insufficient_data');
    expect(container.textContent).not.toMatch(/לא נמצא סימון לבוטנים/);
  });
});
