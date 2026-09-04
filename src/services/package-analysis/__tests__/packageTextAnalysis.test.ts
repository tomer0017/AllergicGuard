import { describe, expect, it } from 'vitest';

import { analyzePackageText, segmentPackageText } from '../packageTextAnalysis.ts';

function analyze(text: string, confidence = 88) {
  return analyzePackageText({
    providerId: 'test-ocr',
    providerName: 'Test OCR',
    analysisMethod: 'test',
    reliability: 'medium',
    text,
    confidence,
    durationMs: 10,
  });
}

/** Padding so short danger phrases are not also flagged as a poor-quality read. */
const FILLER = '\nרכיבים: קמח חיטה, סוכר, שמן דקלים, מלח, מייצב, חומר תפיחה.\n';

describe('segmentPackageText', () => {
  it('splits label text on line breaks, bullets and sentence ends', () => {
    expect(segmentPackageText('מכיל בוטנים.\nללא גלוטן • ייצור ישראלי')).toEqual([
      'מכיל בוטנים.',
      'ללא גלוטן',
      'ייצור ישראלי',
    ]);
  });
});

describe('explicit peanut evidence', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['English front label', 'SKIPPY Peanut Butter Creamy'],
    ['Hebrew front label', 'חמאת בוטנים טבעית'],
    ['Hebrew contains', `מכיל: בוטנים, סויה.${FILLER}`],
    ['Hebrew may contain', `עלול להכיל בוטנים ואגוזים.${FILLER}`],
    ['English may contain', `May contain peanuts and tree nuts.${FILLER}`],
    ['Scientific name', `Ingredients: arachis hypogaea oil, salt.${FILLER}`],
    ['English contains', `Contains peanuts and milk.${FILLER}`],
    ['Traces wording', `עשוי להכיל עקבות של בוטנים.${FILLER}`],
  ];

  for (const [label, text] of cases) {
    it(`detects peanuts — ${label}`, () => {
      const evidence = analyze(text);
      expect(evidence.explicitPeanutEvidence).toBe(true);
      expect(evidence.detectedProductTerms.length).toBeGreaterThan(0);
      expect(evidence.containsAllergens.length + evidence.mayContainAllergens.length).toBeGreaterThan(0);
    });
  }

  it('files precautionary wording as may-contain, not as a contains declaration', () => {
    const evidence = analyze(`עלול להכיל בוטנים.${FILLER}`);
    expect(evidence.mayContainAllergens).toHaveLength(1);
    expect(evidence.containsAllergens).toHaveLength(0);
    expect(evidence.statements[0]?.kind).toBe('may_contain');
  });

  it('files a front-of-pack product name as its own statement kind', () => {
    expect(analyze('Skippy Peanut Butter').statements[0]?.kind).toBe('product_name');
  });

  it('reports an unexplained mention honestly, and still as evidence', () => {
    const evidence = analyze(`בוטנים${FILLER}`);
    expect(evidence.statements[0]?.kind).toBe('mention');
    expect(evidence.explicitPeanutEvidence).toBe(true);
  });
});

describe('non-evidence', () => {
  it('finds nothing in readable, unrelated text', () => {
    const evidence = analyze('רכיבים: קמח חיטה, סוכר, חמאה, ביצים, מלח. מיוצר בישראל.');
    expect(evidence.explicitPeanutEvidence).toBe(false);
    expect(evidence.containsAllergens).toHaveLength(0);
    expect(evidence.mayContainAllergens).toHaveLength(0);
  });

  it('finds nothing when no text was recognized', () => {
    const evidence = analyze('', 0);
    expect(evidence.explicitPeanutEvidence).toBe(false);
    expect(evidence.imageQuality).toBe('poor');
  });

  it('does not treat a "free from" declaration as evidence', () => {
    expect(analyze(`ללא בוטנים וללא אגוזים.${FILLER}`).explicitPeanutEvidence).toBe(false);
    expect(analyze(`This product is peanut free.${FILLER}`).explicitPeanutEvidence).toBe(false);
  });

  it('keeps a positive declaration that follows an unrelated "free from" claim', () => {
    const evidence = analyze(`ללא גלוטן.\nמכיל בוטנים.${FILLER}`);
    expect(evidence.explicitPeanutEvidence).toBe(true);
  });
});

describe('OCR error tolerance', () => {
  it('recovers a Latin look-alike misread', () => {
    const evidence = analyze(`Contains PEANU7 8UTTER${FILLER}`);
    expect(evidence.explicitPeanutEvidence).toBe(true);
    expect(evidence.statements[0]?.viaOcrCorrection).toBe(true);
  });

  it('recovers a single-character Hebrew misread', () => {
    const evidence = analyze(`מכיל: בוטנימ, סוכר.${FILLER}`);
    expect(evidence.explicitPeanutEvidence).toBe(true);
    expect(evidence.statements[0]?.viaOcrCorrection).toBe(true);
  });

  it('does NOT fuzzy-match inside a "free from" declaration', () => {
    // A misread "ללא בוטנים" must not be turned into a peanut warning.
    expect(analyze(`ללא בוטנימ.${FILLER}`).explicitPeanutEvidence).toBe(false);
  });

  it('flags a finding that needed correction so the user can verify it', () => {
    const evidence = analyze(`מכיל: בוטנימ.${FILLER}`);
    expect(evidence.warnings.some((warning) => warning.includes('OCR error correction'))).toBe(true);
  });
});

describe('image quality', () => {
  it('marks a near-empty read as poor', () => {
    expect(analyze('abc', 90).imageQuality).toBe('poor');
  });

  it('marks a low-confidence read as poor', () => {
    expect(analyze(`${FILLER}${FILLER}`, 20).imageQuality).toBe('poor');
  });

  it('marks a short or middling-confidence read as partial', () => {
    expect(analyze('מכיל חלב וסוכר בלבד', 90).imageQuality).toBe('partial');
    expect(analyze(`${FILLER}${FILLER}`, 55).imageQuality).toBe('partial');
  });

  it('marks a long, confident read as good', () => {
    expect(analyze(`${FILLER}${FILLER}`, 90).imageQuality).toBe('good');
  });

  it('NEVER lets poor quality suppress a peanut finding', () => {
    // A blurry photo that still reads "PEANUT" is danger, not "try again".
    const evidence = analyze('PEANUT', 25);
    expect(evidence.imageQuality).toBe('poor');
    expect(evidence.explicitPeanutEvidence).toBe(true);
    expect(evidence.containsAllergens.length).toBeGreaterThan(0);
  });
});
