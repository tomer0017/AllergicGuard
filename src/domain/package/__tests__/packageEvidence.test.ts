/**
 * Guards the single most important property of the package-photo feature:
 *
 *   A PHOTO CAN ESCALATE TO RED. A PHOTO CAN NEVER CREATE GREEN.
 *
 * The tests here work on the bridge (`toProductEvidence`) and on the real
 * safety engine, so they fail if either the bridge or the engine is changed in
 * a way that lets image analysis clear a product.
 */

import { describe, expect, it } from 'vitest';

// Loaded as text so the assertion below can check the literals in the source
// itself, not just the behaviour they happen to produce today.
import packageEvidenceSource from '../packageEvidence.ts?raw';

import { assessPeanutRisk } from '../../allergy/assessAllergenRisk.ts';
import { analyzePackageText } from '../../../services/package-analysis/packageTextAnalysis.ts';
import { toProductEvidence, type PackageEvidence } from '../packageEvidence.ts';

function packageEvidence(text: string, confidence = 85): PackageEvidence {
  return analyzePackageText({
    providerId: 'test-ocr',
    providerName: 'Test OCR',
    analysisMethod: 'test',
    reliability: 'medium',
    text,
    confidence,
    durationMs: 5,
  });
}

function assessFromPhotoOnly(text: string, confidence?: number) {
  return assessPeanutRisk({
    evidence: [toProductEvidence(packageEvidence(text, confidence), '7290000000000')],
  });
}

describe('the bridge into the safety engine', () => {
  it('always marks allergen data as unusable, whatever the photo said', () => {
    for (const text of [
      'מכיל בוטנים',
      'ללא בוטנים כלל, מוצר נקי לחלוטין ובטוח לשימוש',
      'רכיבים: קמח, סוכר, חמאה, ביצים, מלח, שמרים, מים',
      '',
    ]) {
      const evidence = toProductEvidence(packageEvidence(text), '7290000000000');
      expect(evidence.allergenDataStatus).toBe('empty');
      expect(evidence.mayContainDataStatus).toBe('empty');
      expect(evidence.sourceType).toBe('package_scan');
    }
  });

  it('does not let OCR overwrite the product identity resolved from the barcode', () => {
    const evidence = toProductEvidence(packageEvidence('SKIPPY Peanut Butter'), '037600309417');
    expect(evidence.productName).toBeUndefined();
    expect(evidence.brand).toBeUndefined();
  });

  it('hard-codes the unusable statuses in source, with no way to pass them in', () => {
    // A regression here would be invisible to the runtime tests above if some
    // future overload started accepting a status, so the literal is asserted.
    const source = packageEvidenceSource;
    const assignments = [...source.matchAll(/(?:mayContain)?[aA]llergenDataStatus:\s*([^,\n]+)/g)].map(
      (match) => match[1]!.trim().replace(/,$/, ''),
    );
    expect(assignments.length).toBeGreaterThan(0);
    expect(new Set(assignments)).toEqual(new Set(["'empty'"]));
  });
});

describe('a photo can never produce GREEN', () => {
  const nonEvidenceTexts = [
    'רכיבים: קמח חיטה, סוכר, חמאה, ביצים, מלח. מיוצר בישראל בפיקוח.',
    'ללא בוטנים. ללא אגוזים. ללא גלוטן. מוצר טבעוני.',
    'Ingredients: wheat flour, sugar, butter, eggs, salt. Made in Israel.',
    'PEANUT FREE FACILITY',
    '',
    '   ',
    'blurry-nonsense qqq wwww',
  ];

  for (const text of nonEvidenceTexts) {
    it(`stays insufficient_data for: ${JSON.stringify(text.slice(0, 40))}`, () => {
      expect(assessFromPhotoOnly(text).status).toBe('insufficient_data');
    });
  }

  it('stays insufficient_data even for a long, perfectly confident read', () => {
    const text = 'רכיבים: קמח חיטה, סוכר, שמן דקלים, מלח.\nמכיל: גלוטן, חלב.\nעלול להכיל: שומשום.';
    expect(assessFromPhotoOnly(text, 99).status).toBe('insufficient_data');
  });

  it('stays insufficient_data when the photo was unreadable', () => {
    expect(assessFromPhotoOnly('', 0).status).toBe('insufficient_data');
  });
});

describe('a photo can produce RED', () => {
  const dangerTexts: readonly (readonly [string, string])[] = [
    ['Peanut Butter', 'Skippy Peanut Butter Creamy 462g'],
    ['חמאת בוטנים', 'חמאת בוטנים טבעית 100%'],
    ['מכיל בוטנים', 'רכיבים: סוכר, שמן.\nמכיל: בוטנים.'],
    ['עלול להכיל בוטנים', 'רכיבים: קמח, סוכר.\nעלול להכיל בוטנים.'],
    ['may contain peanuts', 'Ingredients: flour, sugar.\nMay contain peanuts.'],
    ['arachis hypogaea', 'Ingredients: arachis hypogaea oil, salt, sugar.'],
  ];

  for (const [label, text] of dangerTexts) {
    it(`escalates on "${label}"`, () => {
      const assessment = assessFromPhotoOnly(text);
      expect(assessment.status).toBe('danger');
      expect(assessment.evidence.some((item) => item.sourceType === 'package_scan')).toBe(true);
    });
  }

  it('escalates even when the image quality is poor', () => {
    const assessment = assessFromPhotoOnly('PEANUT', 20);
    expect(assessment.status).toBe('danger');
  });

  it('names the package scan as the source of the RED', () => {
    const assessment = assessFromPhotoOnly('מכיל: בוטנים.');
    const cause = assessment.evidence.find((item) => item.kind !== 'no_indication');
    expect(cause?.sourceType).toBe('package_scan');
    expect(cause?.providerId).toBe('test-ocr');
  });
});
