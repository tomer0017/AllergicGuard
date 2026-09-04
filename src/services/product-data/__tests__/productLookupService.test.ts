import { describe, expect, it } from 'vitest';

import { ProductLookupService } from '../productLookupService.ts';
import { ProviderRegistry } from '../providerRegistry.ts';
import { Logger } from '../../../infrastructure/logging/logger.ts';
import { makeClearingEvidence, makeEvidence } from '../../../testing/evidenceFixtures.ts';
import type { ProductEvidence } from '../../../domain/product/productEvidence.ts';
import { createAppError } from '../../../domain/errors/appError.ts';
import {
  buildDiagnostics,
  type LookupContext,
  type ProductDataProvider,
  type ProductSourceResult,
} from '../providerTypes.ts';

const BARCODE = '7290000066318';
const OTHER_BARCODE = '7290004131074';

type Behaviour =
  | { kind: 'success'; evidence: ProductEvidence }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'throw' };

class StubProvider implements ProductDataProvider {
  readonly sourceType = 'crowdsourced' as const;
  readonly reliability = 'medium' as const;
  readonly providesAllergenEvidence: boolean;
  readonly identityPriority: number;
  readonly allergenEvidencePriority: number;

  readonly id: string;
  readonly enabled: boolean;
  private readonly behaviour: Behaviour;

  constructor(
    id: string,
    behaviour: Behaviour,
    enabled = true,
    options: { providesAllergenEvidence?: boolean; identityPriority?: number } = {},
  ) {
    this.id = id;
    this.behaviour = behaviour;
    this.enabled = enabled;
    this.providesAllergenEvidence = options.providesAllergenEvidence ?? true;
    this.identityPriority = options.identityPriority ?? 10;
    this.allergenEvidencePriority = this.identityPriority;
  }

  get name(): string {
    return `Stub ${this.id}`;
  }

  async lookupByBarcode(barcode: string, context: LookupContext): Promise<ProductSourceResult> {
    const diagnostics = buildDiagnostics({
      provider: this,
      requestId: context.requestId,
      barcode,
      startedAtMs: Date.now(),
    });
    switch (this.behaviour.kind) {
      case 'success':
        return { status: 'success', evidence: this.behaviour.evidence, diagnostics };
      case 'not_found':
        return { status: 'not_found', diagnostics };
      case 'error':
        return {
          status: 'error',
          error: createAppError('NETWORK_ERROR', 'stub failure', { providerId: this.id }),
          diagnostics,
        };
      case 'throw':
        throw new Error('provider exploded');
    }
  }
}

function makeService(providers: ProductDataProvider[]) {
  return new ProductLookupService({
    registry: new ProviderRegistry(providers),
    logger: new Logger({ enabled: false }),
  });
}

describe('ProductLookupService', () => {
  it('rejects an invalid barcode without querying providers and never returns GREEN', async () => {
    const result = await makeService([
      new StubProvider('a', { kind: 'success', evidence: makeClearingEvidence() }),
    ]).lookup('123');

    expect(result.inputError?.code).toBe('INVALID_BARCODE');
    expect(result.providerResults).toHaveLength(0);
    expect(result.assessment.status).toBe('insufficient_data');
  });

  it('queries every enabled provider rather than stopping at the first success', async () => {
    const result = await makeService([
      new StubProvider('a', { kind: 'success', evidence: makeClearingEvidence({ providerId: 'a' }) }),
      new StubProvider('b', { kind: 'error' }),
      new StubProvider('c', { kind: 'not_found' }),
    ]).lookup(BARCODE);

    expect(result.providerResults.map((record) => record.providerId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips disabled providers', async () => {
    const result = await makeService([
      new StubProvider('a', { kind: 'success', evidence: makeClearingEvidence({ providerId: 'a' }) }),
      new StubProvider('disabled', { kind: 'success', evidence: makeClearingEvidence() }, false),
    ]).lookup(BARCODE);

    expect(result.providerResults.map((record) => record.providerId)).toEqual(['a']);
  });

  it('keeps RED when one provider reports peanuts and another clears the product', async () => {
    const result = await makeService([
      new StubProvider('peanut-source', {
        kind: 'success',
        evidence: makeEvidence({ providerId: 'peanut-source', containsAllergens: ['en:peanuts'] }),
      }),
      new StubProvider('silent-source', {
        kind: 'success',
        evidence: makeClearingEvidence({ providerId: 'silent-source' }),
      }),
    ]).lookup(BARCODE);

    expect(result.assessment.status).toBe('danger');
    expect(result.conflicts.some((conflict) => conflict.kind === 'ALLERGEN_EVIDENCE_CONFLICT')).toBe(true);
  });

  it('flags a product identity conflict and refuses to clear', async () => {
    const result = await makeService([
      new StubProvider('a', {
        kind: 'success',
        evidence: makeClearingEvidence({ providerId: 'a', productName: 'Bamba Classic' }),
      }),
      new StubProvider('b', {
        kind: 'success',
        evidence: makeClearingEvidence({ providerId: 'b', productName: 'Chocolate Nougat Wafer' }),
      }),
    ]).lookup(BARCODE);

    expect(result.conflicts.some((conflict) => conflict.kind === 'PRODUCT_IDENTITY_CONFLICT')).toBe(true);
    expect(result.assessment.status).toBe('insufficient_data');
    expect(result.assessment.reasonCode).toBe('PRODUCT_IDENTITY_CONFLICT');
  });

  it('degrades a throwing provider to ORANGE instead of crashing', async () => {
    const result = await makeService([new StubProvider('boom', { kind: 'throw' })]).lookup(BARCODE);
    expect(result.providerResults[0]?.status).toBe('error');
    expect(result.assessment.status).toBe('insufficient_data');
  });

  it('returns ORANGE when no provider is enabled', async () => {
    const result = await makeService([
      new StubProvider('a', { kind: 'success', evidence: makeClearingEvidence() }, false),
    ]).lookup(BARCODE);
    expect(result.assessment.status).toBe('insufficient_data');
  });

  it('never clears from an identity-only provider', async () => {
    const result = await makeService([
      new StubProvider(
        'identity',
        {
          kind: 'success',
          evidence: makeEvidence({
            providerId: 'identity',
            providesAllergenEvidence: false,
            allergenDataStatus: 'not_supported',
            mayContainDataStatus: 'not_supported',
            productName: 'שוקולד פרה',
          }),
        },
        true,
        { providesAllergenEvidence: false },
      ),
    ]).lookup(BARCODE);

    expect(result.product?.displayName).toBe('שוקולד פרה');
    expect(result.assessment.status).toBe('insufficient_data');
    expect(result.assessment.reasonCode).toBe('NO_ALLERGEN_CAPABLE_SOURCE');
  });

  it('prefers identity fields from the higher-priority source', async () => {
    const result = await makeService([
      new StubProvider(
        'low-priority',
        { kind: 'success', evidence: makeClearingEvidence({ providerId: 'low-priority', productName: 'במבה אסם' }) },
        true,
        { identityPriority: 50 },
      ),
      new StubProvider(
        'high-priority',
        { kind: 'success', evidence: makeClearingEvidence({ providerId: 'high-priority', productName: 'במבה אסם' }) },
        true,
        { identityPriority: 1 },
      ),
    ]).lookup(BARCODE);

    expect(result.product?.contributingProviderIds).toContain('high-priority');
  });

  it('attributes every provider result and records timings', async () => {
    const result = await makeService([
      new StubProvider('a', { kind: 'success', evidence: makeClearingEvidence({ providerId: 'a' }) }),
    ]).lookup(OTHER_BARCODE);

    const record = result.providerResults[0]!;
    expect(record.diagnostics.requestId).toBe(result.requestId);
    expect(record.diagnostics.barcode).toBe(OTHER_BARCODE);
    expect(result.assessment.evidence.every((item) => item.providerId.length > 0)).toBe(true);
  });

  it('clears only when a complete source reports no peanut', async () => {
    const result = await makeService([
      new StubProvider('a', { kind: 'success', evidence: makeClearingEvidence({ providerId: 'a' }) }),
    ]).lookup(BARCODE);
    expect(result.assessment.status).toBe('no_known_risk');
  });
});
