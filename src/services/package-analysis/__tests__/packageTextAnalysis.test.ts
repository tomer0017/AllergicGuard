import { describe, expect, it } from 'vitest';

import {
  analyzePackageText,
  assessImageQuality,
  segmentPackageText,
  type PackageTextAnalysisInput,
} from '../packageTextAnalysis.ts';
import type { ImageQualityMetrics } from '../imagePreparation.ts';

function analyze(text: string, confidence = 88, extra: Partial<PackageTextAnalysisInput> = {}) {
  return analyzePackageText({
    providerId: 'test-ocr',
    providerName: 'Test OCR',
    analysisMethod: 'test',
    reliability: 'medium',
    text,
    confidence,
    durationMs: 10,
    ...extra,
  });
}

function metrics(overrides: Partial<ImageQualityMetrics> = {}): ImageQualityMetrics {
  return {
    width: 1600,
    height: 1200,
    originalWidth: 3200,
    originalHeight: 2400,
    focusScore: 400,
    focus: 'sharp',
    contrastRange: 200,
    tooSmall: false,
    ...overrides,
  };
}

/** Padding so short danger phrases are not also flagged as a poor-quality read. */
const FILLER = [
  '',
  'רכיבים: קמח חיטה, סוכר, שמן דקלים, מלח.',
  'מייצב, חומר תפיחה, ארומה, ויטמינים.',
  'לשמור במקום קריר ויבש הרחק מלחות.',
  'תוצרת ישראל. יצרן: דוגמה בעמ, תל אביב.',
  '',
].join('\n');

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
      expect(evidence.detectedPeanutTerms.length).toBeGreaterThan(0);
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

  it('does not resurrect a hit the strict pass rejected as negated', () => {
    // Regression: "peanuts" is one edit from the "peanut" target, so the fuzzy
    // pass used to re-match a phrase the negation logic had already dismissed.
    expect(analyze(`This product contains no peanuts at all.${FILLER}`).explicitPeanutEvidence).toBe(false);
    expect(analyze(`המוצר אינו מכיל בוטנים כלל.${FILLER}`).explicitPeanutEvidence).toBe(false);
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

describe('the quality gate', () => {
  const readable = { readableCharacterCount: 200, meaningfulLineCount: 6, ocrConfidence: 90 };

  it('is POOR when almost no characters were recognized', () => {
    expect(assessImageQuality({ ...readable, readableCharacterCount: 5 })).toBe('poor');
  });

  it('is POOR when OCR confidence collapsed', () => {
    expect(assessImageQuality({ ...readable, ocrConfidence: 20 })).toBe('poor');
  });

  it('is POOR when the photo is out of focus, however much text OCR guessed', () => {
    expect(assessImageQuality({ ...readable, imageMetrics: metrics({ focus: 'blurred' }) })).toBe('poor');
  });

  it('is POOR when text covers almost none of the frame', () => {
    // A photo of a shelf, or of the box from a metre away.
    expect(assessImageQuality({ ...readable, textCoverageRatio: 0.002 })).toBe('poor');
  });

  it('is PARTIAL for a single stray line rather than a panel', () => {
    expect(assessImageQuality({ ...readable, meaningfulLineCount: 1 })).toBe('partial');
  });

  it('is PARTIAL for a soft-focus photo', () => {
    expect(assessImageQuality({ ...readable, imageMetrics: metrics({ focus: 'soft' }) })).toBe('partial');
  });

  it('is PARTIAL for a low-resolution photo', () => {
    expect(assessImageQuality({ ...readable, imageMetrics: metrics({ tooSmall: true }) })).toBe('partial');
  });

  it('is PARTIAL when text covers only a sliver of the frame', () => {
    // The classic "photographed the front of the box" case.
    expect(assessImageQuality({ ...readable, textCoverageRatio: 0.02 })).toBe('partial');
  });

  it('is GOOD for a dense, sharp, confident read', () => {
    expect(
      assessImageQuality({ ...readable, imageMetrics: metrics(), textCoverageRatio: 0.25 }),
    ).toBe('good');
  });

  it('NEVER suppresses a peanut finding, whatever the verdict', () => {
    // The gate governs how we describe a photo, never whether danger counts.
    const evidence = analyze('PEANUT BUTTER', 15, {
      imageMetrics: metrics({ focus: 'blurred', tooSmall: true }),
      textCoverageRatio: 0.001,
    });
    expect(evidence.imageQuality).toBe('poor');
    expect(evidence.explicitPeanutEvidence).toBe(true);
    expect(evidence.containsAllergens.length).toBeGreaterThan(0);
  });

  it('reports the metrics behind the verdict without calling them a safety score', () => {
    const evidence = analyze(FILLER, 88, { imageMetrics: metrics(), textCoverageRatio: 0.2 });
    expect(evidence.confidenceMetadata?.ocrConfidence).toBe(88);
    expect(evidence.confidenceMetadata?.meaningfulLineCount).toBeGreaterThanOrEqual(4);
    expect(evidence.confidenceMetadata?.focus).toBe('sharp');
  });
});
