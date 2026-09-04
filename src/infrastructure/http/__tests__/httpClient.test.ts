import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { fetchJson } from '../httpClient.ts';

const schema = z.object({ value: z.string() });

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchJson', () => {
  it('returns validated data on success', async () => {
    const fetchImpl = vi.fn(async () => respond({ value: 'ok' })) as unknown as typeof fetch;
    const result = await fetchJson({ url: 'https://example.test', schema, timeoutMs: 500, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.value).toBe('ok');
  });

  it('fails closed on schema mismatch instead of passing raw JSON through', async () => {
    const fetchImpl = (async () => respond({ value: 42 })) as unknown as typeof fetch;
    const result = await fetchJson({ url: 'https://example.test', schema, timeoutMs: 500, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('retries a 500 a bounded number of times', async () => {
    const fetchImpl = vi.fn(async () => respond({}, 500));
    const result = await fetchJson({
      url: 'https://example.test',
      schema,
      timeoutMs: 500,
      retryAttempts: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries, never more
  });

  it('does not retry a 4xx', async () => {
    const fetchImpl = vi.fn(async () => respond({}, 400));
    await fetchJson({
      url: 'https://example.test',
      schema,
      timeoutMs: 500,
      retryAttempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caps retries even when a caller asks for an absurd number', async () => {
    const fetchImpl = vi.fn(async () => respond({}, 503));
    await fetchJson({
      url: 'https://example.test',
      schema,
      timeoutMs: 500,
      retryAttempts: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('reports a timeout distinctly from a network error', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const result = await fetchJson({ url: 'https://example.test', schema, timeoutMs: 20, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_TIMEOUT');
  });
});
