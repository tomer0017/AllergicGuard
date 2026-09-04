/**
 * Allergen vocabulary.
 *
 * The MVP UI is peanut-only, but the domain engine is allergen-generic so that
 * adding an allergen means adding a matcher definition, not rewriting logic.
 */

export type AllergenCode =
  | 'peanut'
  | 'tree_nuts'
  | 'milk'
  | 'egg'
  | 'sesame'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'gluten';

export const ALLERGEN_HEBREW_NAME: Record<AllergenCode, string> = {
  peanut: 'בוטנים',
  tree_nuts: 'אגוזים',
  milk: 'חלב',
  egg: 'ביצים',
  sesame: 'שומשום',
  soy: 'סויה',
  fish: 'דגים',
  shellfish: 'פירות ים',
  gluten: 'גלוטן',
};
