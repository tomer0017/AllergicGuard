import { describe, expect, it } from 'vitest';

import { PEANUT_MATCHER, matchAllergenInList, matchAllergenInText, normalizeForMatching } from '../allergenMatchers.ts';

describe('allergen matching', () => {
  it('strips Open Food Facts language prefixes', () => {
    expect(normalizeForMatching('en:peanuts')).toBe('peanuts');
    expect(normalizeForMatching('he:בוטנים')).toBe('בוטנים');
  });

  it.each([
    'מכיל בוטנים',
    'עלול להכיל בוטנים',
    'עקבות בוטנים',
    'may contain traces of peanuts',
    'Peanut butter',
    'ARACHIS HYPOGAEA',
    'huile d’arachide',
  ])('matches "%s"', (text) => {
    expect(matchAllergenInText(text, PEANUT_MATCHER).matched).toBe(true);
  });

  it.each(['ללא בוטנים', 'לא מכיל בוטנים', 'peanut free', 'free from peanuts'])(
    'treats "%s" as a negation rather than an indication',
    (text) => {
      const outcome = matchAllergenInText(text, PEANUT_MATCHER);
      expect(outcome.matched).toBe(false);
      expect(outcome.onlyNegatedMatches).toBe(true);
    },
  );

  it('still matches when a negation appears elsewhere in the same text', () => {
    const text = 'ללא גלוטן. מכיל בוטנים.';
    expect(matchAllergenInText(text, PEANUT_MATCHER).matched).toBe(true);
  });

  it('handles empty, null and undefined text', () => {
    expect(matchAllergenInText(undefined, PEANUT_MATCHER).matched).toBe(false);
    expect(matchAllergenInText(null, PEANUT_MATCHER).matched).toBe(false);
    expect(matchAllergenInText('', PEANUT_MATCHER).matched).toBe(false);
  });

  it('never applies negation logic to structured declaration lists', () => {
    // An entry in a "contains" list is a declaration, not prose.
    expect(matchAllergenInList(['ללא בוטנים'], PEANUT_MATCHER).matched).toBe(true);
    expect(matchAllergenInList([], PEANUT_MATCHER).matched).toBe(false);
  });
});
