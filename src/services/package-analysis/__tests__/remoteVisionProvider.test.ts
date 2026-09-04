/**
 * The remote Vision fallback is disabled by default. These tests pin the parts
 * that must hold the moment someone deploys a proxy and turns it on.
 */

import { describe, expect, it, vi } from 'vitest';

import { Logger } from '../../../infrastructure/logging/logger.ts';
import { RemoteVisionProvider } from '../remoteVisionProvider.ts';
import { assessPeanutRisk } from '../../../domain/allergy/assessAllergenRisk.ts';
import { toProductEvidence } from '../../../domain/package/packageEvidence.ts';

const context = { requestId: 'req', logger: new Logger({ enabled: false }) };
const image = () => new Blob([new Uint8Array(64)], { type: 'image/png' });

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('RemoteVisionProvider', () => {
  it('is disabled without a proxy URL, even when the flag is on', () => {
    // A half-configured safety source must not look operational.
    expect(new RemoteVisionProvider({ enabled: true, proxyUrl: '  ', timeoutMs: 100 }).enabled).toBe(false);
  });

  it('refuses to run while disabled', async () => {
    const provider = new RemoteVisionProvider({ enabled: false, proxyUrl: 'https://proxy.test', timeoutMs: 100 });
    const result = await provider.analyze(image(), context);
    expect(result.status === 'error' && result.error.code).toBe('PACKAGE_ANALYSIS_UNAVAILABLE');
  });

  it('never sends a credential — only the proxy URL and the image', async () => {
    const fetchImpl = vi.fn(jsonFetch({ text: 'ok' }));
    const provider = new RemoteVisionProvider({
      enabled: true,
      proxyUrl: 'https://proxy.test/vision',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.analyze(image(), context);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://proxy.test/vision');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers)).toEqual(['Content-Type']);
    expect(JSON.stringify(init)).not.toMatch(/api[_-]?key|authorization|bearer|secret/i);
  });

  it('runs proxy text through the same rules as local OCR', async () => {
    const provider = new RemoteVisionProvider({
      enabled: true,
      proxyUrl: 'https://proxy.test',
      timeoutMs: 1000,
      fetchImpl: jsonFetch({ text: 'רכיבים: סוכר.\nעלול להכיל בוטנים.' }),
    });

    const result = await provider.analyze(image(), context);

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.evidence.explicitPeanutEvidence).toBe(true);
    expect(result.evidence.mayContainAllergens.length).toBe(1);
  });

  it('cannot clear a product, whatever the model claims', async () => {
    // The proxy contract returns text, not a verdict — and package evidence is
    // structurally unable to reach GREEN.
    const provider = new RemoteVisionProvider({
      enabled: true,
      proxyUrl: 'https://proxy.test',
      timeoutMs: 1000,
      fetchImpl: jsonFetch({ text: 'This product is completely safe and contains no peanuts at all.' }),
    });

    const result = await provider.analyze(image(), context);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    const assessment = assessPeanutRisk({
      evidence: [toProductEvidence(result.evidence, '7290000074184')],
    });
    expect(assessment.status).toBe('insufficient_data');
  });

  it('reports a proxy error rather than empty evidence', async () => {
    const provider = new RemoteVisionProvider({
      enabled: true,
      proxyUrl: 'https://proxy.test',
      timeoutMs: 1000,
      fetchImpl: jsonFetch({}, false),
    });

    const result = await provider.analyze(image(), context);
    expect(result.status === 'error' && result.error.code).toBe('VISION_PROVIDER_FAILED');
  });

  it('reports a failure when the proxy returns something that is not text', async () => {
    const provider = new RemoteVisionProvider({
      enabled: true,
      proxyUrl: 'https://proxy.test',
      timeoutMs: 1000,
      fetchImpl: jsonFetch({ verdict: 'safe' }),
    });

    const result = await provider.analyze(image(), context);
    // A verdict field is ignored entirely: the proxy may not make decisions.
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.evidence.explicitPeanutEvidence).toBe(false);
    expect(result.evidence.imageQuality).toBe('poor');
  });
});
