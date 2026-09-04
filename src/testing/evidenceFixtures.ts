/** Test helpers for building ProductEvidence without repeating every field. */

import type { ProductEvidence } from '../domain/product/productEvidence.ts';

export function makeEvidence(overrides: Partial<ProductEvidence> = {}): ProductEvidence {
  return {
    providerId: 'test-provider',
    providerName: 'Test Provider',
    sourceType: 'crowdsourced',
    reliability: 'medium',
    barcode: '7290000066318',
    productName: 'Test Product',
    containsAllergens: [],
    mayContainAllergens: [],
    allergenDataStatus: 'reported',
    mayContainDataStatus: 'reported',
    providesAllergenEvidence: true,
    warnings: [],
    ...overrides,
  };
}

/** Evidence that is complete and clean — the only shape that may yield GREEN. */
export function makeClearingEvidence(overrides: Partial<ProductEvidence> = {}): ProductEvidence {
  return makeEvidence({
    containsAllergens: ['milk'],
    mayContainAllergens: ['soybeans'],
    ingredientsText: 'milk, sugar, soy lecithin',
    allergenDataStatus: 'reported',
    mayContainDataStatus: 'reported',
    ...overrides,
  });
}
