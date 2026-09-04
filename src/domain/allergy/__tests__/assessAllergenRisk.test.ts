import { describe, expect, it } from 'vitest';

import { assessPeanutRisk } from '../assessAllergenRisk.ts';
import { makeClearingEvidence, makeEvidence } from '../../../testing/evidenceFixtures.ts';
import type { ProductEvidence } from '../../product/productEvidence.ts';

describe('peanut safety engine — RED (danger)', () => {
  it('flags a structured "contains peanuts" declaration', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ containsAllergens: ['en:peanuts'] })],
    });
    expect(result.status).toBe('danger');
    expect(result.reasonCode).toBe('CONTAINS_DECLARED');
  });

  it('flags a structured "may contain peanuts" declaration', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ mayContainAllergens: ['en:peanuts'] })],
    });
    expect(result.status).toBe('danger');
    expect(result.reasonCode).toBe('MAY_CONTAIN_DECLARED');
  });

  it.each([
    ['מכיל בוטנים'],
    ['עלול להכיל בוטנים'],
    ['עקבות בוטנים'],
    ['בוטן'],
    ['אגוזי אדמה'],
    ['peanut'],
    ['contains peanuts'],
    ['may contain peanuts'],
    ['traces of peanuts'],
    ['arachis hypogaea'],
    ['Arachide'],
  ])('flags free text: %s', (text) => {
    const result = assessPeanutRisk({
      evidence: [makeClearingEvidence({ ingredientsText: `sugar, ${text}, salt` })],
    });
    expect(result.status).toBe('danger');
  });

  it('flags Hebrew allergen tags returned by Open Food Facts (en:בוטנים)', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ containsAllergens: ['en:בוטנים'] })],
    });
    expect(result.status).toBe('danger');
  });

  it('keeps RED when one provider reports peanuts and another is silent', () => {
    const result = assessPeanutRisk({
      evidence: [
        makeEvidence({ providerId: 'a', containsAllergens: ['peanuts'] }),
        makeClearingEvidence({ providerId: 'b', reliability: 'very_high' }),
      ],
    });
    expect(result.status).toBe('danger');
    expect(result.hasConflict).toBe(true);
  });

  it('keeps RED even when a higher-reliability source clears the product', () => {
    const result = assessPeanutRisk({
      evidence: [
        makeEvidence({ providerId: 'crowd', reliability: 'low', containsAllergens: ['peanuts'] }),
        makeClearingEvidence({ providerId: 'manufacturer', reliability: 'very_high' }),
      ],
    });
    expect(result.status).toBe('danger');
  });

  it('attributes every positive finding to a provider', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ providerId: 'off', containsAllergens: ['peanuts'] })],
    });
    expect(result.evidence.some((item) => item.providerId === 'off')).toBe(true);
  });
});

describe('peanut safety engine — ORANGE (insufficient_data)', () => {
  it('returns ORANGE when allergen data is missing', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ allergenDataStatus: 'missing', mayContainDataStatus: 'reported' })],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('ALLERGEN_DATA_MISSING');
  });

  it('returns ORANGE when the allergen field exists but is empty', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ allergenDataStatus: 'empty' })],
    });
    expect(result.status).toBe('insufficient_data');
  });

  it('returns ORANGE when "may contain" data is missing', () => {
    const result = assessPeanutRisk({
      evidence: [
        makeEvidence({ containsAllergens: ['milk'], mayContainDataStatus: 'missing' }),
      ],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('MAY_CONTAIN_DATA_MISSING');
  });

  it('returns ORANGE when "may contain" data is present but empty', () => {
    const result = assessPeanutRisk({
      evidence: [makeEvidence({ containsAllergens: ['milk'], mayContainDataStatus: 'empty' })],
    });
    expect(result.status).toBe('insufficient_data');
  });

  it('returns ORANGE for an identity-only provider', () => {
    const result = assessPeanutRisk({
      evidence: [
        makeEvidence({
          providerId: 'israel-retail',
          sourceType: 'retailer',
          reliability: 'high',
          providesAllergenEvidence: false,
          allergenDataStatus: 'not_supported',
          mayContainDataStatus: 'not_supported',
        }),
      ],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('NO_ALLERGEN_CAPABLE_SOURCE');
  });

  it('returns ORANGE when no source responded at all', () => {
    const result = assessPeanutRisk({ evidence: [] });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('NO_SOURCES_RESPONDED');
  });

  it.each([
    ['network failure', 'error' as const, 'NETWORK_ERROR'],
    ['provider timeout', 'error' as const, 'PROVIDER_TIMEOUT'],
    ['invalid response', 'error' as const, 'PROVIDER_INVALID_RESPONSE'],
  ])('returns ORANGE on %s', (_label, reason, detail) => {
    const result = assessPeanutRisk({
      evidence: [],
      unavailableSources: [
        { providerId: 'off', providerName: 'Open Food Facts', reason, detail },
      ],
    });
    expect(result.status).toBe('insufficient_data');
  });

  it('returns ORANGE (product not found) when every source reports not_found', () => {
    const result = assessPeanutRisk({
      evidence: [],
      unavailableSources: [
        { providerId: 'off', providerName: 'Open Food Facts', reason: 'not_found', detail: 'no product' },
      ],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('PRODUCT_NOT_FOUND');
  });

  it('returns ORANGE when a source claims complete data but reported nothing at all', () => {
    const result = assessPeanutRisk({
      evidence: [
        makeEvidence({
          allergenDataStatus: 'reported',
          mayContainDataStatus: 'reported',
          containsAllergens: [],
          mayContainAllergens: [],
          ingredientsText: undefined,
        }),
      ],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('ALLERGEN_DATA_INSUBSTANTIAL');
  });

  it('returns ORANGE when a clean source is below the reliability threshold', () => {
    const result = assessPeanutRisk({
      evidence: [makeClearingEvidence({ reliability: 'low' })],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('SOURCE_RELIABILITY_TOO_LOW');
  });

  it('returns ORANGE when sources disagree about product identity', () => {
    const result = assessPeanutRisk({
      evidence: [makeClearingEvidence({ providerId: 'a', productName: 'Bamba Classic' })],
      conflicts: [
        {
          kind: 'PRODUCT_IDENTITY_CONFLICT',
          description: 'Bamba Classic vs Bamba Nougat',
          providerIds: ['a', 'b'],
          values: ['Bamba Classic', 'Bamba Nougat'],
        },
      ],
    });
    expect(result.status).toBe('insufficient_data');
    expect(result.reasonCode).toBe('PRODUCT_IDENTITY_CONFLICT');
  });

  it('never hides a conflict', () => {
    const result = assessPeanutRisk({
      evidence: [makeClearingEvidence()],
      conflicts: [
        {
          kind: 'PRODUCT_IDENTITY_CONFLICT',
          description: 'mismatch',
          providerIds: ['a', 'b'],
          values: ['x', 'y'],
        },
      ],
    });
    expect(result.hasConflict).toBe(true);
  });
});

describe('peanut safety engine — GREEN (no_known_risk)', () => {
  it('clears only when complete contains + may-contain data show no peanut', () => {
    const result = assessPeanutRisk({ evidence: [makeClearingEvidence()] });
    expect(result.status).toBe('no_known_risk');
    expect(result.reasonCode).toBe('NO_INDICATION_IN_COMPLETE_DATA');
  });

  it('does not treat a "peanut free" declaration as a peanut indication', () => {
    const result = assessPeanutRisk({
      evidence: [makeClearingEvidence({ ingredientsText: 'סוכר, קמח, ללא בוטנים' })],
    });
    expect(result.status).toBe('no_known_risk');
  });

  it('still clears when an unrelated source merely failed', () => {
    const result = assessPeanutRisk({
      evidence: [makeClearingEvidence({ providerId: 'off' })],
      unavailableSources: [
        { providerId: 'gs1', providerName: 'GS1', reason: 'error', detail: 'disabled' },
      ],
    });
    expect(result.status).toBe('no_known_risk');
  });
});

/**
 * SECTION 37 — THE CRITICAL INVARIANT.
 * No combination of missing/broken/absent data may ever produce GREEN.
 */
describe('CRITICAL INVARIANT: missing data can never be GREEN', () => {
  const brokenEvidenceShapes: Array<[string, Partial<ProductEvidence>]> = [
    ['allergens missing', { allergenDataStatus: 'missing' }],
    ['allergens empty', { allergenDataStatus: 'empty' }],
    ['allergens not supported', { allergenDataStatus: 'not_supported' }],
    ['traces missing', { mayContainDataStatus: 'missing' }],
    ['traces empty', { mayContainDataStatus: 'empty' }],
    ['traces not supported', { mayContainDataStatus: 'not_supported' }],
    ['both missing', { allergenDataStatus: 'missing', mayContainDataStatus: 'missing' }],
    [
      'identity only',
      {
        providesAllergenEvidence: false,
        allergenDataStatus: 'not_supported',
        mayContainDataStatus: 'not_supported',
      },
    ],
    ['low reliability', { reliability: 'low' }],
    ['no product name', { productName: undefined }],
    ['undefined ingredients', { ingredientsText: undefined }],
  ];

  it.each(brokenEvidenceShapes)('never returns GREEN: %s', (_label, overrides) => {
    const result = assessPeanutRisk({ evidence: [makeEvidence(overrides)] });
    expect(result.status).not.toBe('no_known_risk');
  });

  it('never returns GREEN for any subset of broken sources combined', () => {
    const evidence = brokenEvidenceShapes.map(([label, overrides], index) =>
      makeEvidence({ providerId: `p${index}-${label}`, ...overrides }),
    );
    const result = assessPeanutRisk({ evidence });
    expect(result.status).not.toBe('no_known_risk');
  });

  it('never returns GREEN when nothing at all is known', () => {
    for (const input of [
      { evidence: [] },
      { evidence: [], unavailableSources: [] },
      { evidence: [], conflicts: [] },
    ]) {
      expect(assessPeanutRisk(input).status).toBe('insufficient_data');
    }
  });

  it('tolerates null/undefined-ish fields coming from a sloppy provider', () => {
    const sloppy = makeEvidence({
      productName: undefined,
      brand: undefined,
      ingredientsText: undefined,
      lastUpdated: undefined,
      allergenDataStatus: 'missing',
      mayContainDataStatus: 'missing',
    });
    const result = assessPeanutRisk({ evidence: [sloppy] });
    expect(result.status).toBe('insufficient_data');
  });

  it('is deterministic — the same input always yields the same output', () => {
    const input = { evidence: [makeClearingEvidence()] };
    expect(assessPeanutRisk(input)).toEqual(assessPeanutRisk(input));
  });
});
