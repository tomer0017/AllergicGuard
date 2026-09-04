/**
 * Allergen text/tag matching.
 *
 * Deliberately kept separate from the decision engine so that new allergens or
 * new spellings can be added without touching safety logic.
 *
 * Matching philosophy: recall over precision. A false positive costs one
 * unnecessary "check the package"; a false negative can hospitalize a child.
 */

import type { AllergenCode } from './allergenTypes.ts';

export interface AllergenMatcherDefinition {
  readonly allergen: AllergenCode;
  /** Substrings matched against normalized (lowercased) text. */
  readonly patterns: readonly string[];
  /**
   * Substrings that, when they surround a pattern hit, mean the *absence* of
   * the allergen is being declared ("peanut free" / "ללא בוטנים").
   */
  readonly negationPatterns: readonly string[];
}

/** Shared negations — "free from X" style declarations in Hebrew and English. */
const COMMON_NEGATIONS = [
  'ללא',
  'לא מכיל',
  'אינו מכיל',
  'נטול',
  'free from',
  'free of',
  'without',
  'no ',
  'does not contain',
  'not contain',
] as const;

export const PEANUT_MATCHER: AllergenMatcherDefinition = {
  allergen: 'peanut',
  patterns: [
    // Hebrew
    'בוטן',
    'בוטנים',
    'בטנים',
    'אגוזי אדמה',
    // English
    'peanut',
    'peanuts',
    'ground nut',
    'groundnut',
    'monkey nut',
    // Scientific / regulatory
    'arachis',
    'arachis hypogaea',
    'arachide',
    'arachidi',
    'erdnuss',
    'cacahuete',
    'cacahuète',
    'amendoim',
    // Open Food Facts canonical tags
    'en:peanuts',
    'en:peanut',
  ],
  negationPatterns: COMMON_NEGATIONS,
};

/**
 * Only the peanut matcher is wired into the MVP. Other allergens are listed in
 * AllergenCode so the engine stays generic; add a definition here to enable one.
 */
export const ALLERGEN_MATCHERS: Partial<Record<AllergenCode, AllergenMatcherDefinition>> = {
  peanut: PEANUT_MATCHER,
};

export function getMatcher(allergen: AllergenCode): AllergenMatcherDefinition {
  const matcher = ALLERGEN_MATCHERS[allergen];
  if (!matcher) {
    throw new Error(
      `No allergen matcher configured for "${allergen}". Add one in allergenMatchers.ts.`,
    );
  }
  return matcher;
}

/**
 * Normalizes provider text/tags for matching:
 *  - lowercases,
 *  - strips Open Food Facts language prefixes ("en:", "he:"),
 *  - collapses punctuation and whitespace.
 *
 * Note: OFF tags are not always canonical — real responses contain values such
 * as `en:בוטנים` (Hebrew text behind an `en:` prefix), which is exactly why we
 * match on normalized text rather than on an assumed tag taxonomy.
 */
export function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]{2,3}:/g, ' ')
    .replace(/[_\-.,;:()[\]{}'"\\/|*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How far before a hit we look for a negation such as "ללא". */
const NEGATION_LOOKBEHIND_CHARS = 24;
/** How far after a hit we look for a trailing negation such as "peanut free". */
const NEGATION_LOOKAHEAD_CHARS = 14;

/**
 * Words that re-assert presence. If one of these sits between a negation and
 * the allergen hit, the negation belongs to a different item:
 * "ללא גלוטן. מכיל בוטנים" must stay a match.
 */
const POSITIVE_DECLARATION_TERMS = [
  'מכיל',
  'עלול',
  'עקבות',
  'contains',
  'traces',
  'may contain',
] as const;

const TRAILING_NEGATION = /^\s*(free|נטול)\b/;

/**
 * Decides whether an allergen hit is inside a "free from" style declaration
 * rather than an actual indication.
 *
 * Being wrong in the "not negated" direction only costs an extra warning;
 * being wrong the other way could hide a real peanut warning, so the rules
 * here are deliberately narrow.
 */
function isNegatedAt(
  normalizedText: string,
  hitIndex: number,
  hitLength: number,
  negations: readonly string[],
): boolean {
  const before = normalizedText.slice(Math.max(0, hitIndex - NEGATION_LOOKBEHIND_CHARS), hitIndex);

  let negationEnd = -1;
  for (const negation of negations) {
    const index = before.lastIndexOf(negation);
    if (index !== -1) negationEnd = Math.max(negationEnd, index + negation.length);
  }

  if (negationEnd !== -1) {
    const between = before.slice(negationEnd);
    const reasserted = POSITIVE_DECLARATION_TERMS.some((term) => between.includes(term));
    if (!reasserted) return true;
  }

  // Trailing form: "peanut free", "בוטנים נטול".
  const after = normalizedText.slice(hitIndex + hitLength, hitIndex + hitLength + NEGATION_LOOKAHEAD_CHARS);
  return TRAILING_NEGATION.test(after);
}

export interface MatchOutcome {
  /** At least one non-negated occurrence was found. */
  readonly matched: boolean;
  /** Occurrences were found, but every one of them was inside a negation. */
  readonly onlyNegatedMatches: boolean;
  /** The normalized snippets that matched, for transparency and logging. */
  readonly matchedTerms: string[];
}

const EMPTY_MATCH: MatchOutcome = { matched: false, onlyNegatedMatches: false, matchedTerms: [] };

/** Matches an allergen inside a free-text blob (ingredients, warnings, …). */
export function matchAllergenInText(
  text: string | undefined | null,
  matcher: AllergenMatcherDefinition,
): MatchOutcome {
  if (!text) return EMPTY_MATCH;
  const normalized = normalizeForMatching(text);
  if (!normalized) return EMPTY_MATCH;

  const matchedTerms: string[] = [];
  let sawNegatedHit = false;

  for (const pattern of matcher.patterns) {
    const needle = normalizeForMatching(pattern);
    if (!needle) continue;
    let index = normalized.indexOf(needle);
    while (index !== -1) {
      if (isNegatedAt(normalized, index, needle.length, matcher.negationPatterns)) {
        sawNegatedHit = true;
      } else {
        matchedTerms.push(needle);
        break;
      }
      index = normalized.indexOf(needle, index + needle.length);
    }
  }

  if (matchedTerms.length > 0) {
    return { matched: true, onlyNegatedMatches: false, matchedTerms: [...new Set(matchedTerms)] };
  }
  return { matched: false, onlyNegatedMatches: sawNegatedHit, matchedTerms: [] };
}

/**
 * Matches an allergen inside a structured allergen list (allergens_tags etc.).
 *
 * Structured lists are declarations, not prose, so negation handling does not
 * apply: an entry in a "contains" list means the allergen is present.
 */
export function matchAllergenInList(
  values: readonly string[],
  matcher: AllergenMatcherDefinition,
): MatchOutcome {
  const matchedTerms: string[] = [];
  for (const value of values) {
    const normalized = normalizeForMatching(value);
    if (!normalized) continue;
    for (const pattern of matcher.patterns) {
      const needle = normalizeForMatching(pattern);
      if (needle && normalized.includes(needle)) {
        matchedTerms.push(normalized);
        break;
      }
    }
  }
  return matchedTerms.length > 0
    ? { matched: true, onlyNegatedMatches: false, matchedTerms: [...new Set(matchedTerms)] }
    : EMPTY_MATCH;
}
