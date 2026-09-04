import { describe, expect, it } from 'vitest';

import { LookupCache } from '../lookupCache.ts';
import { makeClearingEvidence } from '../../../testing/evidenceFixtures.ts';

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

const BARCODE = '7290000066318';

describe('LookupCache', () => {
  it('stores and returns evidence within the TTL', () => {
    const cache = new LookupCache({ enabled: true, ttlMs: 60_000, storage: new MemoryStorage() });
    cache.set('off', BARCODE, makeClearingEvidence({ barcode: BARCODE }));
    expect(cache.get('off', BARCODE)?.evidence.barcode).toBe(BARCODE);
  });

  it('discards expired entries instead of serving stale allergen data', () => {
    const cache = new LookupCache({ enabled: true, ttlMs: -1, storage: new MemoryStorage() });
    cache.set('off', BARCODE, makeClearingEvidence({ barcode: BARCODE }));
    expect(cache.get('off', BARCODE)).toBeNull();
  });

  it('discards corrupt entries', () => {
    const storage = new MemoryStorage();
    const cache = new LookupCache({ enabled: true, ttlMs: 60_000, storage });
    storage.setItem('allergicguard:evidence:v1:off:' + BARCODE, 'not-json');
    expect(cache.get('off', BARCODE)).toBeNull();
  });

  it('rejects an entry whose evidence is for a different barcode', () => {
    const cache = new LookupCache({ enabled: true, ttlMs: 60_000, storage: new MemoryStorage() });
    cache.set('off', BARCODE, makeClearingEvidence({ barcode: '7290004131074' }));
    expect(cache.get('off', BARCODE)).toBeNull();
  });

  it('is a no-op when disabled or when storage is unavailable', () => {
    const disabled = new LookupCache({ enabled: false, ttlMs: 60_000, storage: new MemoryStorage() });
    disabled.set('off', BARCODE, makeClearingEvidence());
    expect(disabled.get('off', BARCODE)).toBeNull();

    const noStorage = new LookupCache({ enabled: true, ttlMs: 60_000, storage: null });
    noStorage.set('off', BARCODE, makeClearingEvidence());
    expect(noStorage.get('off', BARCODE)).toBeNull();
  });
});
