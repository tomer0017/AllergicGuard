import { describe, expect, it } from 'vitest';

import { OpenFoodFactsProvider } from '../openFoodFactsProvider.ts';
import { Logger } from '../../../../../infrastructure/logging/logger.ts';
import type { LookupContext } from '../../../providerTypes.ts';
import { assessPeanutRisk } from '../../../../../domain/allergy/assessAllergenRisk.ts';

const BARCODE = '7290000066318';

function makeContext(): LookupContext {
  return { requestId: 'test01', logger: new Logger({ enabled: false }) };
}

function makeProvider(fetchImpl: typeof fetch) {
  return new OpenFoodFactsProvider({
    enabled: true,
    baseUrl: 'https://world.openfoodfacts.org',
    timeoutMs: 1000,
    retryAttempts: 0,
    userAgent: 'AllergicGuard/test',
    fetchImpl,
  });
}

function jsonResponse(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

/** Shape captured from the live API on a real Israeli product. */
const bambaResponse = {
  code: BARCODE,
  status: 1,
  status_verbose: 'product found',
  product: {
    code: BARCODE,
    product_name: 'במבה',
    product_name_he: 'במבה',
    brands: 'אסם',
    ingredients_text: 'בוטנים טחונים (54%)\r\nגריסי תירס\r\nשמן חמניות',
    allergens: 'בוטנים',
    allergens_tags: ['en:בוטנים'],
    traces: 'soybeans',
    traces_tags: ['en:soybeans'],
    last_modified_t: 1776098343,
    image_front_url: 'https://images.openfoodfacts.org/front_he.jpg',
  },
};

describe('OpenFoodFactsProvider', () => {
  it('normalizes a successful Hebrew lookup', async () => {
    const result = await makeProvider(jsonResponse(bambaResponse)).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.evidence.productNameHebrew).toBe('במבה');
    expect(result.evidence.brand).toBe('אסם');
    expect(result.evidence.sourceType).toBe('crowdsourced');
    expect(result.evidence.reliability).toBe('medium');
    expect(result.evidence.allergenDataStatus).toBe('reported');
    expect(result.evidence.mayContainDataStatus).toBe('reported');
    expect(result.evidence.lastUpdated).toMatch(/^\d{4}-/);
    expect(result.evidence.providerId).toBe('open-food-facts');
  });

  it('produces RED end-to-end for a Hebrew "contains peanuts" product', async () => {
    const result = await makeProvider(jsonResponse(bambaResponse)).lookupByBarcode(BARCODE, makeContext());
    if (result.status !== 'success') throw new Error('expected success');
    expect(assessPeanutRisk({ evidence: [result.evidence] }).status).toBe('danger');
  });

  it('normalizes English content', async () => {
    const result = await makeProvider(
      jsonResponse({
        code: '3017620422003',
        status: 1,
        product: {
          code: '3017620422003',
          product_name: 'Nutella',
          allergens: 'milk, nuts, soybeans',
          allergens_tags: ['en:milk', 'en:nuts', 'en:soybeans'],
          traces: '',
          traces_tags: [],
        },
      }),
    ).lookupByBarcode('3017620422003', makeContext());

    if (result.status !== 'success') throw new Error('expected success');
    expect(result.evidence.productName).toBe('Nutella');
    expect(result.evidence.allergenDataStatus).toBe('reported');
    // Empty traces in a crowdsourced DB means "unknown", never "none".
    expect(result.evidence.mayContainDataStatus).toBe('empty');
    expect(assessPeanutRisk({ evidence: [result.evidence] }).status).toBe('insufficient_data');
  });

  it('reports not_found when status is 0', async () => {
    const result = await makeProvider(
      jsonResponse({ code: BARCODE, status: 0, status_verbose: 'product not found' }),
    ).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('not_found');
  });

  it('reports not_found on HTTP 404', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const result = await makeProvider(fetchImpl).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('not_found');
  });

  it('reports an error on HTTP 500', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const result = await makeProvider(fetchImpl).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('PROVIDER_HTTP_ERROR');
  });

  it('reports an error on invalid JSON', async () => {
    const fetchImpl = (async () =>
      new Response('<html>not json</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch;
    const result = await makeProvider(fetchImpl).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('accepts the zero-padded EAN-13 form of a 12-digit UPC', async () => {
    // Real case: Skippy peanut butter. Open Food Facts stores UPC-A codes
    // padded to 13 digits, and treating that as a different product used to
    // discard allergen data we actually had.
    const upc = '037600309417';
    const padded = '0037600309417';
    const result = await makeProvider(
      jsonResponse({
        code: padded,
        status: 1,
        product: {
          code: padded,
          product_name: 'Skippy Peanut Butter',
          allergens_tags: ['en:peanuts'],
          traces_tags: [],
        },
      }),
    ).lookupByBarcode(upc, makeContext());

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(assessPeanutRisk({ evidence: [result.evidence] }).status).toBe('danger');
  });

  it('still rejects a response for a genuinely different product', async () => {
    const result = await makeProvider(
      jsonResponse({
        code: '7290000446547',
        status: 1,
        product: { code: '7290000446547', product_name: 'Something else' },
      }),
    ).lookupByBarcode(BARCODE, makeContext());

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('reports an error on schema mismatch', async () => {
    const result = await makeProvider(jsonResponse({ unexpected: true })).lookupByBarcode(
      BARCODE,
      makeContext(),
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('reports an error on an empty response body', async () => {
    const result = await makeProvider(jsonResponse(null)).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('error');
  });

  it('reports a timeout', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const provider = new OpenFoodFactsProvider({
      enabled: true,
      baseUrl: 'https://world.openfoodfacts.org',
      timeoutMs: 20,
      retryAttempts: 0,
      userAgent: 'AllergicGuard/test',
      fetchImpl,
    });
    const result = await provider.lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('reports a network error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const result = await makeProvider(fetchImpl).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('NETWORK_ERROR');
  });

  it('rejects a response for a different barcode', async () => {
    const result = await makeProvider(
      jsonResponse({ code: '1234567890128', status: 1, product: { code: '1234567890128', product_name: 'Other' } }),
    ).lookupByBarcode(BARCODE, makeContext());
    expect(result.status).toBe('error');
  });

  it('marks missing allergen fields explicitly instead of assuming "none"', async () => {
    const result = await makeProvider(
      jsonResponse({ code: BARCODE, status: 1, product: { code: BARCODE, product_name: 'Mystery' } }),
    ).lookupByBarcode(BARCODE, makeContext());

    if (result.status !== 'success') throw new Error('expected success');
    expect(result.evidence.allergenDataStatus).toBe('missing');
    expect(result.evidence.mayContainDataStatus).toBe('missing');
    expect(result.evidence.containsAllergens).toEqual([]);
    expect(assessPeanutRisk({ evidence: [result.evidence] }).status).toBe('insufficient_data');
  });

  it('produces diagnostics with attribution, timing and field coverage', async () => {
    const result = await makeProvider(jsonResponse(bambaResponse)).lookupByBarcode(BARCODE, makeContext());
    const diagnostics = result.diagnostics;
    expect(diagnostics.providerId).toBe('open-food-facts');
    expect(diagnostics.requestId).toBe('test01');
    expect(diagnostics.barcode).toBe(BARCODE);
    expect(diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.fieldsPresent).toContain('allergens_tags');
    expect(diagnostics.fieldsMissing).toContain('quantity');
    expect(diagnostics.url).toContain('/api/v2/product/');
  });
});
