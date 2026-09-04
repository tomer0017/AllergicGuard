/**
 * End-to-end merge behaviour: a barcode result plus a package photo.
 *
 * These are the cases that matter to a parent standing in a supermarket, so
 * every combination of barcode verdict and photo finding is pinned here.
 */

import { describe, expect, it } from 'vitest';

import { Logger } from '../../../infrastructure/logging/logger.ts';
import { ProductLookupService } from '../../product-data/productLookupService.ts';
import { ProviderRegistry } from '../../product-data/providerRegistry.ts';
import { makeClearingEvidence, makeEvidence } from '../../../testing/evidenceFixtures.ts';
import { assessPeanutRisk } from '../../../domain/allergy/assessAllergenRisk.ts';
import type { ProductEvidence } from '../../../domain/product/productEvidence.ts';
import type { ProductLookupResult } from '../../product-data/productLookupService.ts';
import { analyzePackageText } from '../packageTextAnalysis.ts';

const BARCODE = '7290000074184';

function makeService(): ProductLookupService {
  return new ProductLookupService({
    registry: new ProviderRegistry([]),
    logger: new Logger({ minLevel: 'error', enabled: false }),
    allergen: 'peanut',
  });
}

/** Builds the shape ProductLookupService.lookup would have returned. */
function barcodeResult(evidence: readonly ProductEvidence[]): ProductLookupResult {
  return {
    requestId: 'test01',
    barcode: BARCODE,
    allergen: 'peanut',
    product: { barcode: BARCODE, displayName: 'פתי בר', contributingProviderIds: ['off'] },
    assessment: assessPeanutRisk({ evidence }),
    evidence,
    providerResults: [],
    conflicts: [],
    generatedAt: new Date().toISOString(),
  };
}

function photo(text: string, confidence = 85) {
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

/** Open Food Facts answered with an identity but no allergen fields — the real Osem case. */
const INCOMPLETE = makeEvidence({
  providerId: 'off',
  productName: 'Petit Beurre',
  containsAllergens: [],
  mayContainAllergens: [],
  allergenDataStatus: 'missing',
  mayContainDataStatus: 'missing',
});

const CLEARING = makeClearingEvidence({ providerId: 'off', reliability: 'high' });

const PEANUT_DECLARED = makeEvidence({
  providerId: 'off',
  containsAllergens: ['en:peanuts'],
  ingredientsText: 'peanuts, salt',
});

describe('barcode ORANGE + package photo', () => {
  it('becomes RED when the photo shows explicit peanut evidence', () => {
    const before = barcodeResult([INCOMPLETE]);
    expect(before.assessment.status).toBe('insufficient_data');

    const after = makeService().applyPackageEvidence(before, photo('מכיל: בוטנים, סויה.'));

    expect(after.assessment.status).toBe('danger');
    expect(after.packageScans?.[0]?.escalated).toBe(true);
    expect(after.packageScans?.[0]?.previousStatus).toBe('insufficient_data');
  });

  it('becomes RED from a front-of-pack product name alone', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([INCOMPLETE]),
      photo('SKIPPY Peanut Butter Creamy'),
    );
    expect(after.assessment.status).toBe('danger');
  });

  it('stays ORANGE when the photo shows nothing', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([INCOMPLETE]),
      photo('רכיבים: קמח חיטה, סוכר, חמאה, ביצים, מלח.'),
    );
    expect(after.assessment.status).toBe('insufficient_data');
    expect(after.packageScans?.[0]?.escalated).toBe(false);
  });

  it('stays ORANGE when the photo was unreadable', () => {
    const after = makeService().applyPackageEvidence(barcodeResult([INCOMPLETE]), photo('', 0));
    expect(after.assessment.status).toBe('insufficient_data');
  });

  it('stays ORANGE when the photo shows a "free from peanuts" claim', () => {
    // A package saying "ללא בוטנים" is a manufacturer claim read by OCR from a
    // photo. It is not a verified allergen record, so it may not clear.
    const after = makeService().applyPackageEvidence(
      barcodeResult([INCOMPLETE]),
      photo('ללא בוטנים. ללא אגוזים. מיוצר במפעל נטול בוטנים לחלוטין.'),
    );
    expect(after.assessment.status).toBe('insufficient_data');
  });
});

describe('barcode GREEN + package photo', () => {
  it('becomes RED when the photo shows explicit peanut evidence', () => {
    const before = barcodeResult([CLEARING]);
    expect(before.assessment.status).toBe('no_known_risk');

    const after = makeService().applyPackageEvidence(before, photo('עלול להכיל בוטנים.'));

    expect(after.assessment.status).toBe('danger');
    expect(after.packageScans?.[0]?.escalated).toBe(true);
    expect(after.assessment.hasConflict).toBe(true);
  });

  it('stays GREEN — never upgraded, never downgraded — when the photo shows nothing', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([CLEARING]),
      photo('רכיבים: חלב, סוכר, לציטין מסויה.'),
    );
    expect(after.assessment.status).toBe('no_known_risk');
    // The clearance still comes from the database source, not from the photo.
    const clearing = after.assessment.evidence.filter((item) => item.kind === 'no_indication');
    expect(clearing.every((item) => item.sourceType !== 'package_scan')).toBe(true);
  });
});

describe('barcode RED + package photo', () => {
  it('stays RED when the photo shows no peanut', () => {
    const before = barcodeResult([PEANUT_DECLARED]);
    expect(before.assessment.status).toBe('danger');

    const after = makeService().applyPackageEvidence(
      before,
      photo('רכיבים: קמח חיטה, סוכר, חמאה, ביצים, מלח.'),
    );
    expect(after.assessment.status).toBe('danger');
    expect(after.packageScans?.[0]?.escalated).toBe(false);
  });

  it('stays RED when the photo claims the product is peanut free', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([PEANUT_DECLARED]),
      photo('ללא בוטנים. Peanut free.'),
    );
    expect(after.assessment.status).toBe('danger');
  });
});

describe('evidence bookkeeping', () => {
  it('keeps the barcode evidence alongside the photo evidence', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([INCOMPLETE]),
      photo('מכיל: בוטנים.'),
    );
    expect(after.evidence).toHaveLength(2);
    expect(after.evidence.map((item) => item.sourceType)).toEqual(['crowdsourced', 'package_scan']);
    expect(after.evidence[0]).toBe(INCOMPLETE);
  });

  it('never lets a later, emptier photo cancel an earlier peanut finding', () => {
    const service = makeService();
    const first = service.applyPackageEvidence(barcodeResult([INCOMPLETE]), photo('מכיל: בוטנים.'));
    expect(first.assessment.status).toBe('danger');

    const second = service.applyPackageEvidence(first, photo('רכיבים: קמח, סוכר, מלח.'));

    expect(second.assessment.status).toBe('danger');
    expect(second.packageScans).toHaveLength(2);
    expect(second.evidence).toHaveLength(3);
  });

  it('records which source caused the escalation', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([INCOMPLETE]),
      photo('מכיל: בוטנים.'),
    );
    const scan = after.packageScans?.[0];
    expect(scan?.providerId).toBe('tesseract-ocr');
    expect(scan?.newReasonCode).toBe('CONTAINS_DECLARED');
    expect(scan?.packageEvidence.statements[0]?.text).toContain('בוטנים');
  });

  it('does not let the photo change the product identity', () => {
    const after = makeService().applyPackageEvidence(
      barcodeResult([INCOMPLETE]),
      photo('SKIPPY Peanut Butter'),
    );
    expect(after.product?.displayName).toBe('Petit Beurre');
    expect(after.conflicts.filter((item) => item.kind === 'PRODUCT_IDENTITY_CONFLICT')).toHaveLength(0);
  });
});
