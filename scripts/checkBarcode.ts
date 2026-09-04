/**
 * Development-only research tool: run a REAL barcode against the LIVE
 * providers and print everything the pipeline saw and decided.
 *
 *   npm run check:barcode -- 7290000066318 [more barcodes...]
 *
 * This is not part of the app bundle and is never used by the UI. Automated
 * tests never touch the network — see the provider tests for mocked coverage.
 */

import { assessPeanutRisk } from '../src/domain/allergy/assessAllergenRisk.ts';
import { Logger } from '../src/infrastructure/logging/logger.ts';
import { ProviderRegistry } from '../src/services/product-data/providerRegistry.ts';
import { ProductLookupService } from '../src/services/product-data/productLookupService.ts';
import { OpenFoodFactsProvider } from '../src/services/product-data/providers/openFoodFacts/openFoodFactsProvider.ts';

const barcodes = process.argv.slice(2);

if (barcodes.length === 0) {
  console.error('Usage: npm run check:barcode -- <barcode> [barcode...]');
  process.exit(1);
}

const logger = new Logger({ minLevel: 'debug', enabled: true });

const registry = new ProviderRegistry([
  new OpenFoodFactsProvider({
    enabled: true,
    baseUrl: process.env.OPEN_FOOD_FACTS_BASE_URL ?? 'https://world.openfoodfacts.org',
    timeoutMs: 10_000,
    retryAttempts: 1,
    userAgent: 'AllergicGuard/0.1 (development barcode check)',
  }),
]);

const service = new ProductLookupService({ registry, logger, allergen: 'peanut' });

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(26)} ${value === undefined || value === '' ? '—' : String(value)}`);
}

for (const barcode of barcodes) {
  console.log(`\n${'='.repeat(72)}\nBARCODE ${barcode}\n${'='.repeat(72)}`);

  const result = await service.lookup(barcode);

  console.log('\n--- PRODUCT ---');
  line('found', result.evidence.length > 0 ? 'yes' : 'no');
  line('name', result.product?.displayName);
  line('brand', result.product?.brand);
  line('quantity', result.product?.quantity);

  console.log('\n--- PROVIDERS ---');
  for (const record of result.providerResults) {
    line(record.providerId, `${record.status} (http ${record.diagnostics.httpStatus ?? '—'}, ${record.diagnostics.durationMs}ms, cache=${record.fromCache})`);
    if (record.error) line('  error', `${record.error.code}: ${record.error.technicalMessage}`);
    line('  fields present', record.diagnostics.fieldsPresent.join(', '));
    line('  fields missing', record.diagnostics.fieldsMissing.join(', '));
  }

  console.log('\n--- NORMALIZED EVIDENCE ---');
  for (const evidence of result.evidence) {
    line('provider', `${evidence.providerName} (${evidence.sourceType}, reliability ${evidence.reliability})`);
    line('ingredients available', Boolean(evidence.ingredientsText ?? evidence.ingredientsTextHebrew));
    line('allergens status', evidence.allergenDataStatus);
    line('contains', evidence.containsAllergens.join(', '));
    line('traces status', evidence.mayContainDataStatus);
    line('may contain', evidence.mayContainAllergens.join(', '));
    line('last updated', evidence.lastUpdated);
    for (const warning of evidence.warnings) line('  warning', warning);
  }

  console.log('\n--- CONFLICTS ---');
  if (result.conflicts.length === 0) console.log('  none');
  for (const conflict of result.conflicts) line(conflict.kind, conflict.description);

  console.log('\n--- ASSESSMENT ---');
  line('status', result.assessment.status);
  line('reasonCode', result.assessment.reasonCode);
  line('reason', result.assessment.reason);
  line('conflict flag', result.assessment.hasConflict);

  // Sanity check: the printed decision must match a fresh run of the pure engine.
  const recomputed = assessPeanutRisk({ evidence: result.evidence, conflicts: result.conflicts });
  if (recomputed.status !== result.assessment.status) {
    console.error('  !! engine determinism mismatch');
    process.exitCode = 1;
  }
}
