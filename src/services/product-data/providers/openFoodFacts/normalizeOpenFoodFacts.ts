/**
 * Converts an Open Food Facts product into normalized ProductEvidence.
 *
 * THE CENTRAL JUDGEMENT CALL OF THIS FILE
 * ---------------------------------------
 * OFF returns `traces: ""` / `traces_tags: []` both for "the contributor
 * checked and there are no traces" and for "nobody ever filled this in".
 * The two are indistinguishable in the API, so we treat an empty value as
 * `empty` (unusable), not as "none". Consequence: a product whose traces field
 * was never filled in yields ORANGE, not GREEN. That is the intended, safe
 * behaviour — see README → SAFETY-CRITICAL DESIGN DECISIONS.
 */

import type { AllergenDataStatus, ProductEvidence } from '../../../../domain/product/productEvidence.ts';
import type { OpenFoodFactsProduct } from './openFoodFactsSchema.ts';

export const OPEN_FOOD_FACTS_PROVIDER_ID = 'open-food-facts';
export const OPEN_FOOD_FACTS_PROVIDER_NAME = 'Open Food Facts';

function statusOf(text: string | undefined, tags: readonly string[] | undefined): AllergenDataStatus {
  const hasTags = Array.isArray(tags) && tags.some((tag) => tag.trim().length > 0);
  const hasText = typeof text === 'string' && text.trim().length > 0;
  if (hasTags || hasText) return 'reported';
  // The field came back as "" or [] — present but blank, meaning unknown.
  if (tags !== undefined || text !== undefined) return 'empty';
  return 'missing';
}

function mergeValues(text: string | undefined, tags: readonly string[] | undefined): string[] {
  const values = [...(tags ?? [])];
  if (text && text.trim().length > 0) values.push(text.trim());
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result && result.length > 0 ? result : undefined;
}

function toIsoDate(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

export interface NormalizationOutput {
  readonly evidence: ProductEvidence;
  readonly fieldsPresent: string[];
  readonly fieldsMissing: string[];
}

export function normalizeOpenFoodFactsProduct(
  barcode: string,
  product: OpenFoodFactsProduct,
  requestedFields: readonly string[],
): NormalizationOutput {
  const warnings: string[] = [];

  const allergenDataStatus = statusOf(product.allergens, product.allergens_tags);
  const mayContainDataStatus = statusOf(product.traces, product.traces_tags);

  if (allergenDataStatus !== 'reported') {
    warnings.push('Open Food Facts reported no usable allergen information for this product.');
  }
  if (mayContainDataStatus !== 'reported') {
    warnings.push(
      'Open Food Facts reported no usable "may contain"/traces information. An empty traces field in a crowdsourced database means unknown, not none.',
    );
  }

  const record = product as unknown as Record<string, unknown>;
  const fieldsPresent: string[] = [];
  const fieldsMissing: string[] = [];
  for (const field of requestedFields) {
    const value = record[field];
    const isPresent =
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && value.trim() === '') &&
      !(Array.isArray(value) && value.length === 0);
    (isPresent ? fieldsPresent : fieldsMissing).push(field);
  }

  const evidence: ProductEvidence = {
    providerId: OPEN_FOOD_FACTS_PROVIDER_ID,
    providerName: OPEN_FOOD_FACTS_PROVIDER_NAME,
    // Crowdsourced: useful, but never presented as manufacturer-authoritative.
    sourceType: 'crowdsourced',
    reliability: 'medium',
    barcode,
    productName: trimmed(product.product_name) ?? trimmed(product.generic_name),
    productNameHebrew: trimmed(product.product_name_he),
    brand: trimmed(product.brands),
    quantity: trimmed(product.quantity),
    imageUrl: trimmed(product.image_front_url) ?? trimmed(product.image_url),
    ingredientsText: trimmed(product.ingredients_text),
    ingredientsTextHebrew: trimmed(product.ingredients_text_he),
    containsAllergens: mergeValues(product.allergens, product.allergens_tags),
    mayContainAllergens: mergeValues(product.traces, product.traces_tags),
    allergenDataStatus,
    mayContainDataStatus,
    providesAllergenEvidence: true,
    lastUpdated: toIsoDate(product.last_modified_t),
    sourceUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`,
    warnings,
  };

  return { evidence, fieldsPresent, fieldsMissing };
}
