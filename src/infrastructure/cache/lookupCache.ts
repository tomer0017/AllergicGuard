/**
 * Short-lived cache of *provider evidence* (never of assessments).
 *
 * SAFETY RULES
 * ------------
 *  1. The cache stores raw normalized evidence only. The safety engine re-runs
 *     on every scan, so a cached GREEN can never be replayed as a decision.
 *  2. Entries expire (default 10 minutes). An expired or unparsable entry is
 *     discarded and the provider is queried again; it never degrades to a
 *     silent "no data" that could look like clearance.
 *  3. Only successful lookups are cached. Errors, timeouts and not-found are
 *     never cached, so a transient failure is always retried.
 *
 * localStorage is used deliberately: no database, no schema migrations, and a
 * corrupt value simply results in a cache miss.
 */

import type { ProductEvidence } from '../../domain/product/productEvidence.ts';

const STORAGE_PREFIX = 'allergicguard:evidence:v1:';

interface CacheRecord {
  readonly barcode: string;
  readonly providerId: string;
  readonly retrievedAt: number;
  readonly evidence: ProductEvidence;
}

export interface CacheHit {
  readonly evidence: ProductEvidence;
  readonly retrievedAt: number;
  readonly ageMs: number;
}

export interface LookupCacheOptions {
  readonly enabled: boolean;
  readonly ttlMs: number;
  readonly storage?: Storage | null;
}

function resolveStorage(storage: Storage | null | undefined): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private mode / blocked storage — caching is optional, never required.
    return null;
  }
}

export class LookupCache {
  private readonly enabled: boolean;
  private readonly ttlMs: number;
  private readonly storage: Storage | null;

  constructor(options: LookupCacheOptions) {
    this.storage = resolveStorage(options.storage);
    this.enabled = options.enabled && this.storage !== null;
    this.ttlMs = options.ttlMs;
  }

  get(providerId: string, barcode: string): CacheHit | null {
    if (!this.enabled || !this.storage) return null;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key(providerId, barcode));
    } catch {
      return null;
    }
    if (!raw) return null;

    let record: CacheRecord;
    try {
      record = JSON.parse(raw) as CacheRecord;
    } catch {
      this.delete(providerId, barcode);
      return null;
    }

    const ageMs = Date.now() - record.retrievedAt;
    // Expired, or a clock jump made the entry look like it came from the future.
    if (!record.evidence || ageMs < 0 || ageMs > this.ttlMs) {
      this.delete(providerId, barcode);
      return null;
    }
    if (record.evidence.barcode !== barcode) {
      this.delete(providerId, barcode);
      return null;
    }

    return { evidence: record.evidence, retrievedAt: record.retrievedAt, ageMs };
  }

  set(providerId: string, barcode: string, evidence: ProductEvidence): void {
    if (!this.enabled || !this.storage) return;
    const record: CacheRecord = { barcode, providerId, retrievedAt: Date.now(), evidence };
    try {
      this.storage.setItem(this.key(providerId, barcode), JSON.stringify(record));
    } catch {
      // Quota exceeded or storage blocked — caching is best-effort by design.
    }
  }

  delete(providerId: string, barcode: string): void {
    try {
      this.storage?.removeItem(this.key(providerId, barcode));
    } catch {
      // ignore
    }
  }

  clear(): void {
    if (!this.storage) return;
    try {
      const keys: string[] = [];
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) this.storage.removeItem(key);
    } catch {
      // ignore
    }
  }

  private key(providerId: string, barcode: string): string {
    return `${STORAGE_PREFIX}${providerId}:${barcode}`;
  }
}
