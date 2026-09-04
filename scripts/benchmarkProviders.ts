/**
 * Development-only provider benchmark: run REAL barcodes against every
 * configured provider and print one row per provider per barcode.
 *
 *   npm run benchmark
 *   npm run benchmark -- 7290000066318 7290004131074
 *
 * Answers the question "is this provider worth enabling?" with measurements
 * rather than opinion — coverage, which fields actually arrive, and whether a
 * peanut signal is present.
 *
 * IT NEVER FABRICATES A RESULT. A provider without credentials reports
 * `not-implemented` and is listed as such; that is a finding, not a gap to
 * paper over. This tool is not part of the app bundle.
 */

import { assessPeanutRisk } from '../src/domain/allergy/assessAllergenRisk.ts';
import { PEANUT_MATCHER, matchAllergenInList, matchAllergenInText } from '../src/domain/allergy/allergenMatchers.ts';
import type { ProductEvidence } from '../src/domain/product/productEvidence.ts';
import { Logger } from '../src/infrastructure/logging/logger.ts';
import { ProviderRegistry } from '../src/services/product-data/providerRegistry.ts';
import { ProductLookupService } from '../src/services/product-data/productLookupService.ts';
import { OpenFoodFactsProvider } from '../src/services/product-data/providers/openFoodFacts/openFoodFactsProvider.ts';
import { Gs1IsraelProvider } from '../src/services/product-data/providers/gs1Israel/gs1IsraelProvider.ts';
import { IsraelRetailProvider } from '../src/services/product-data/providers/israelRetail/israelRetailProvider.ts';
import { FatSecretProvider } from '../src/services/product-data/providers/fatSecret/fatSecretProvider.ts';

/**
 * The field-testing regression set. Every one of these was scanned on a real
 * shelf in Israel, and each represents a different failure mode.
 */
const DEFAULT_BARCODES: readonly { readonly barcode: string; readonly label: string }[] = [
  { barcode: '7290000446547', label: 'B&D natural peanut butter — declared peanuts' },
  { barcode: '7290000074184', label: 'Osem Petit Beurre — identified, no allergen fields' },
  { barcode: '037600309417', label: 'Skippy peanut butter — 12-digit UPC, zero-padded by OFF' },
  { barcode: '7290105693341', label: 'Bamba — peanut snack with NO allergen fields in OFF' },
];

const requested = process.argv.slice(2);
const barcodes = requested.length > 0
  ? requested.map((barcode) => ({ barcode, label: 'ad-hoc' }))
  : DEFAULT_BARCODES;

const logger = new Logger({ minLevel: 'error', enabled: true });

// Providers are constructed with the SAME options the app would use. Ones
// without credentials stay disabled and are reported as disabled.
const registry = new ProviderRegistry([
  new OpenFoodFactsProvider({
    enabled: true,
    baseUrl: process.env.OPEN_FOOD_FACTS_BASE_URL ?? 'https://world.openfoodfacts.org',
    timeoutMs: 10_000,
    retryAttempts: 1,
    userAgent: 'AllergicGuard/0.1 (development provider benchmark)',
  }),
  new Gs1IsraelProvider({ enabled: false, baseUrl: '' }),
  new IsraelRetailProvider({ enabled: false, baseUrl: '' }),
  new FatSecretProvider({ enabled: false, proxyUrl: '' }),
]);

const service = new ProductLookupService({ registry, logger, allergen: 'peanut' });

function yesNo(value: unknown): string {
  return value ? 'yes' : 'no';
}

/** Does this evidence carry a peanut signal, and from which field? */
function peanutSignal(evidence: ProductEvidence): string {
  const hits: string[] = [];
  if (matchAllergenInList(evidence.containsAllergens, PEANUT_MATCHER).matched) hits.push('contains');
  if (matchAllergenInList(evidence.mayContainAllergens, PEANUT_MATCHER).matched) hits.push('may-contain');
  if (matchAllergenInText(evidence.ingredientsText, PEANUT_MATCHER).matched) hits.push('ingredients');
  if (matchAllergenInText(`${evidence.productNameHebrew ?? ''} ${evidence.productName ?? ''}`, PEANUT_MATCHER).matched) {
    hits.push('product-name');
  }
  return hits.length > 0 ? hits.join('+') : 'none';
}

const rows: Record<string, string>[] = [];

console.log(`\nProvider benchmark — ${new Date().toISOString()}`);
console.log(`enabled:  ${registry.enabled().map((p) => p.id).join(', ') || '(none)'}`);
console.log(`disabled: ${registry.disabled().map((p) => p.id).join(', ') || '(none)'}`);

for (const { barcode, label } of barcodes) {
  console.log(`\n${'='.repeat(78)}\n${barcode}  —  ${label}\n${'='.repeat(78)}`);

  const result = await service.lookup(barcode);
  const byProvider = new Map(result.evidence.map((item) => [item.providerId, item]));

  for (const record of result.providerResults) {
    const evidence = byProvider.get(record.providerId);
    const row = {
      barcode,
      provider: record.providerId,
      status: record.status,
      found: yesNo(evidence),
      name: evidence?.productNameHebrew ?? evidence?.productName ?? '—',
      brand: evidence?.brand ?? '—',
      image: yesNo(evidence?.imageUrl),
      ingredients: yesNo(evidence?.ingredientsText ?? evidence?.ingredientsTextHebrew),
      allergens: evidence?.allergenDataStatus ?? '—',
      traces: evidence?.mayContainDataStatus ?? '—',
      peanut: evidence ? peanutSignal(evidence) : '—',
      reliability: evidence?.reliability ?? '—',
      updated: evidence?.lastUpdated?.slice(0, 10) ?? '—',
      ms: String(record.diagnostics.durationMs),
      error: record.error ? `${record.error.code}` : '—',
    };
    rows.push(row);
    for (const [key, value] of Object.entries(row)) {
      if (key !== 'barcode') console.log(`  ${key.padEnd(13)} ${value}`);
    }
    console.log('  ' + '-'.repeat(60));
  }

  console.log(`  FINAL        ${result.assessment.status}  (${result.assessment.reasonCode})`);

  // Determinism check: the printed verdict must match a fresh engine run.
  if (assessPeanutRisk({ evidence: result.evidence, conflicts: result.conflicts }).status !== result.assessment.status) {
    console.error('  !! engine determinism mismatch');
    process.exitCode = 1;
  }
}

console.log(`\n${'='.repeat(78)}\nSUMMARY (${rows.length} provider responses)\n${'='.repeat(78)}`);
const header = ['barcode', 'provider', 'status', 'found', 'allergens', 'traces', 'peanut'];
console.log(header.map((key) => key.padEnd(15)).join(''));
for (const row of rows) {
  console.log(header.map((key) => (row[key] ?? '—').slice(0, 14).padEnd(15)).join(''));
}
console.log();
