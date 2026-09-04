import { describe, expect, it } from 'vitest';

import { aggregateEvidence } from '../evidenceAggregator.ts';
import { makeClearingEvidence, makeEvidence } from '../../../testing/evidenceFixtures.ts';

const BARCODE = '7290000066318';
const samePriority = () => 10;

describe('evidenceAggregator', () => {
  it('returns no identity when nothing was found', () => {
    expect(aggregateEvidence(BARCODE, [], samePriority, 'peanut').identity).toBeNull();
  });

  it('prefers the Hebrew product name for display', () => {
    const { identity } = aggregateEvidence(
      BARCODE,
      [makeEvidence({ productName: 'Bamba', productNameHebrew: 'במבה' })],
      samePriority,
      'peanut',
    );
    expect(identity?.displayName).toBe('במבה');
  });

  it('fills identity fields from the highest-priority source first', () => {
    const priority = (providerId: string) => (providerId === 'best' ? 1 : 99);
    const { identity } = aggregateEvidence(
      BARCODE,
      [
        makeEvidence({ providerId: 'worst', productName: 'Generic Snack', brand: 'Unknown' }),
        makeEvidence({ providerId: 'best', productName: 'Bamba', brand: 'Osem' }),
      ],
      priority,
      'peanut',
    );
    expect(identity?.displayName).toBe('Bamba');
    expect(identity?.brand).toBe('Osem');
    expect(identity?.contributingProviderIds).toContain('best');
  });

  it('detects a product identity conflict between sources', () => {
    const { conflicts } = aggregateEvidence(
      BARCODE,
      [
        makeEvidence({ providerId: 'a', productName: 'Bamba Classic' }),
        makeEvidence({ providerId: 'b', productName: 'Chocolate Milk Drink' }),
      ],
      samePriority,
      'peanut',
    );
    expect(conflicts.some((conflict) => conflict.kind === 'PRODUCT_IDENTITY_CONFLICT')).toBe(true);
  });

  it('does not flag near-identical names as a conflict', () => {
    const { conflicts } = aggregateEvidence(
      BARCODE,
      [
        makeEvidence({ providerId: 'a', productName: 'במבה אסם' }),
        makeEvidence({ providerId: 'b', productName: 'במבה אסם 80 גרם' }),
      ],
      samePriority,
      'peanut',
    );
    expect(conflicts).toHaveLength(0);
  });

  it('flags an allergen disagreement without resolving it', () => {
    const { conflicts } = aggregateEvidence(
      BARCODE,
      [
        makeEvidence({ providerId: 'a', containsAllergens: ['peanuts'] }),
        makeClearingEvidence({ providerId: 'b' }),
      ],
      samePriority,
      'peanut',
    );
    const conflict = conflicts.find((item) => item.kind === 'ALLERGEN_EVIDENCE_CONFLICT');
    expect(conflict).toBeDefined();
    expect(conflict?.providerIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('ignores identity-only sources when looking for allergen disagreement', () => {
    const { conflicts } = aggregateEvidence(
      BARCODE,
      [
        makeEvidence({ providerId: 'a', containsAllergens: ['peanuts'] }),
        makeEvidence({
          providerId: 'identity',
          providesAllergenEvidence: false,
          allergenDataStatus: 'not_supported',
          mayContainDataStatus: 'not_supported',
        }),
      ],
      samePriority,
      'peanut',
    );
    expect(conflicts.some((conflict) => conflict.kind === 'ALLERGEN_EVIDENCE_CONFLICT')).toBe(false);
  });
});
