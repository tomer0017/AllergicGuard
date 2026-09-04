/**
 * Runtime schema for the Open Food Facts v2 product endpoint.
 *
 * Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 * Endpoint: GET /api/v2/product/{barcode}.json?fields=...
 *
 * Everything except `status` is optional on purpose: OFF is crowdsourced and
 * any field can be absent. Optional here means "we must detect it", not
 * "we may ignore it" — the normalizer converts absence into an explicit
 * AllergenDataStatus.
 */

import { z } from 'zod';

/** OFF sometimes returns numeric-ish values in string fields; accept both. */
const looseString = z.union([z.string(), z.number()]).transform(String).optional();

const stringArray = z.array(z.union([z.string(), z.number()]).transform(String)).optional();

export const openFoodFactsProductSchema = z.object({
  code: looseString,
  product_name: looseString,
  product_name_he: looseString,
  generic_name: looseString,
  brands: looseString,
  quantity: looseString,
  ingredients_text: looseString,
  ingredients_text_he: looseString,
  allergens: looseString,
  allergens_tags: stringArray,
  traces: looseString,
  traces_tags: stringArray,
  image_front_url: looseString,
  image_url: looseString,
  last_modified_t: z.union([z.number(), z.string()]).optional(),
  countries_tags: stringArray,
  states_tags: stringArray,
});

export const openFoodFactsResponseSchema = z.object({
  /** 1 = found, 0 = not found. OFF also returns status_verbose. */
  status: z.union([z.literal(0), z.literal(1), z.number()]),
  status_verbose: z.string().optional(),
  code: looseString,
  product: openFoodFactsProductSchema.optional(),
});

export type OpenFoodFactsResponse = z.infer<typeof openFoodFactsResponseSchema>;
export type OpenFoodFactsProduct = z.infer<typeof openFoodFactsProductSchema>;

/** Fields we request from the API. Also used to compute present/missing diagnostics. */
export const OPEN_FOOD_FACTS_REQUESTED_FIELDS = [
  'code',
  'product_name',
  'product_name_he',
  'generic_name',
  'brands',
  'quantity',
  'ingredients_text',
  'ingredients_text_he',
  'allergens',
  'allergens_tags',
  'traces',
  'traces_tags',
  'image_front_url',
  'image_url',
  'last_modified_t',
  'countries_tags',
  'states_tags',
] as const;
