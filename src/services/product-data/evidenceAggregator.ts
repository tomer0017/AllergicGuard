/**
 * Merges evidence from several providers into one product identity and detects
 * disagreements between sources.
 *
 * It never resolves an allergen disagreement — that is the safety engine's job.
 * Its only allergen-related output is a *flag* saying the sources disagree.
 */

import type { ProductEvidence } from '../../domain/product/productEvidence.ts';
import type { ProductIdentity, SourceConflict } from '../../domain/product/productIdentity.ts';
import { getMatcher, matchAllergenInList, matchAllergenInText, normalizeForMatching } from '../../domain/allergy/allergenMatchers.ts';
import type { AllergenCode } from '../../domain/allergy/allergenTypes.ts';

export interface AggregationResult {
  readonly identity: ProductIdentity | null;
  readonly conflicts: readonly SourceConflict[];
}

/** Provider order used when picking identity fields (lower priority number first). */
export interface IdentityPriorityLookup {
  (providerId: string): number;
}

function firstDefined<T>(
  evidenceList: readonly ProductEvidence[],
  select: (evidence: ProductEvidence) => T | undefined,
): { value: T; providerId: string } | undefined {
  for (const evidence of evidenceList) {
    const value = select(evidence);
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 0)) {
      return { value, providerId: evidence.providerId };
    }
  }
  return undefined;
}

/** Two product names are "the same product" if their word sets overlap enough. */
function namesLikelyDiffer(a: string, b: string): boolean {
  const tokenize = (value: string) =>
    new Set(
      normalizeForMatching(value)
        .split(' ')
        .filter((token) => token.length > 1),
    );
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  const overlap = shared / Math.min(tokensA.size, tokensB.size);
  return overlap < 0.5;
}

export function aggregateEvidence(
  barcode: string,
  evidenceList: readonly ProductEvidence[],
  identityPriority: IdentityPriorityLookup,
  allergen: AllergenCode,
): AggregationResult {
  if (evidenceList.length === 0) return { identity: null, conflicts: [] };

  const ordered = [...evidenceList].sort(
    (a, b) => identityPriority(a.providerId) - identityPriority(b.providerId),
  );

  const displayName = firstDefined(ordered, (evidence) => evidence.productNameHebrew ?? evidence.productName);
  const brand = firstDefined(ordered, (evidence) => evidence.brand);
  const manufacturer = firstDefined(ordered, (evidence) => evidence.manufacturer ?? evidence.brand);
  const quantity = firstDefined(ordered, (evidence) => evidence.quantity);
  const imageUrl = firstDefined(ordered, (evidence) => evidence.imageUrl);

  const identity: ProductIdentity = {
    barcode,
    displayName: displayName?.value,
    brand: brand?.value,
    manufacturer: manufacturer?.value,
    quantity: quantity?.value,
    imageUrl: imageUrl?.value,
    contributingProviderIds: [
      ...new Set(
        [displayName, brand, manufacturer, quantity, imageUrl]
          .filter((entry): entry is { value: string; providerId: string } => entry !== undefined)
          .map((entry) => entry.providerId),
      ),
    ],
  };

  return {
    identity,
    conflicts: [...detectIdentityConflicts(ordered), ...detectAllergenConflicts(ordered, allergen)],
  };
}

function detectIdentityConflicts(evidenceList: readonly ProductEvidence[]): SourceConflict[] {
  const named = evidenceList
    .map((evidence) => ({
      providerId: evidence.providerId,
      name: evidence.productNameHebrew ?? evidence.productName,
    }))
    .filter((entry): entry is { providerId: string; name: string } => Boolean(entry.name));

  const conflicts: SourceConflict[] = [];
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const left = named[i]!;
      const right = named[j]!;
      if (namesLikelyDiffer(left.name, right.name)) {
        conflicts.push({
          kind: 'PRODUCT_IDENTITY_CONFLICT',
          description: `Sources disagree on the product name: "${left.name}" (${left.providerId}) vs "${right.name}" (${right.providerId})`,
          providerIds: [left.providerId, right.providerId],
          values: [left.name, right.name],
        });
      }
    }
  }
  return conflicts;
}

/**
 * Flags the case where one source reports the allergen and another reports
 * complete data without it. The disagreement is recorded, never resolved here —
 * the safety engine always keeps the more conservative outcome.
 */
function detectAllergenConflicts(
  evidenceList: readonly ProductEvidence[],
  allergen: AllergenCode,
): SourceConflict[] {
  const matcher = getMatcher(allergen);
  const reporting: string[] = [];
  const silentWithCompleteData: string[] = [];

  for (const evidence of evidenceList) {
    if (!evidence.providesAllergenEvidence) continue;
    const indicated =
      matchAllergenInList(evidence.containsAllergens, matcher).matched ||
      matchAllergenInList(evidence.mayContainAllergens, matcher).matched ||
      matchAllergenInText(evidence.ingredientsText, matcher).matched;

    if (indicated) {
      reporting.push(evidence.providerId);
    } else if (
      evidence.allergenDataStatus === 'reported' &&
      evidence.mayContainDataStatus === 'reported'
    ) {
      silentWithCompleteData.push(evidence.providerId);
    }
  }

  if (reporting.length > 0 && silentWithCompleteData.length > 0) {
    return [
      {
        kind: 'ALLERGEN_EVIDENCE_CONFLICT',
        description: `Sources disagree about ${allergen}: reported by [${reporting.join(', ')}], not reported by [${silentWithCompleteData.join(', ')}]. The conservative result is kept.`,
        providerIds: [...reporting, ...silentWithCompleteData],
        values: [allergen],
      },
    ];
  }
  return [];
}
