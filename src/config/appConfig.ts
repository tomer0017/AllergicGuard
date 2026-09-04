/**
 * Centralized configuration. Nothing else in the codebase reads import.meta.env.
 *
 * No secrets belong here: everything in this file ships to the browser.
 * A provider that needs a secret credential must be proxied by a backend
 * (see README → "Future GS1 Israel integration").
 */

import type { LogLevel } from '../infrastructure/logging/logger.ts';

interface RawEnv {
  readonly [key: string]: string | boolean | undefined;
}

const env: RawEnv = import.meta.env as unknown as RawEnv;

function readBoolean(key: string, fallback: boolean): boolean {
  const value = env[key];
  if (value === undefined || value === '') return fallback;
  return value === true || value === 'true' || value === '1';
}

function readString(key: string, fallback: string): string {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readNumber(key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface AppConfig {
  readonly isDevelopment: boolean;
  readonly logLevel: LogLevel;
  /** Debug panel is development-only and can additionally be turned off. */
  readonly debugPanelEnabled: boolean;

  readonly providers: {
    readonly openFoodFacts: { readonly enabled: boolean; readonly baseUrl: string };
    readonly gs1Israel: { readonly enabled: boolean; readonly baseUrl: string };
    readonly israelRetail: { readonly enabled: boolean; readonly baseUrl: string };
  };

  readonly http: {
    readonly timeoutMs: number;
    readonly retryAttempts: number;
    readonly userAgent: string;
  };

  readonly cache: {
    readonly enabled: boolean;
    readonly ttlMs: number;
  };

  readonly scanner: {
    /** Ignore repeats of the same barcode for this long. */
    readonly duplicateScanCooldownMs: number;
  };

  /**
   * Package-photo analysis. Browser-only by design: no API key exists in this
   * object because none may exist in a static build. A future hosted Vision
   * provider must be reached through a proxy URL, never a credential.
   */
  readonly packageAnalysis: {
    readonly enabled: boolean;
    /** Tesseract language codes. Hebrew first: Israeli labels are the target. */
    readonly languages: string;
    /** Optional self-hosted mirrors for the WASM core / language data. */
    readonly corePath?: string;
    readonly langPath?: string;
  };
}

const isDevelopment = env.DEV === true || env.DEV === 'true';

export const appConfig: AppConfig = {
  isDevelopment,
  logLevel: readString('VITE_LOG_LEVEL', isDevelopment ? 'debug' : 'warn') as LogLevel,
  debugPanelEnabled: isDevelopment && readBoolean('VITE_ENABLE_DEBUG_PANEL', true),

  providers: {
    openFoodFacts: {
      enabled: readBoolean('VITE_ENABLE_OPEN_FOOD_FACTS', true),
      baseUrl: readString('VITE_OPEN_FOOD_FACTS_BASE_URL', 'https://world.openfoodfacts.org'),
    },
    // Disabled: no official public API documentation/credentials available yet.
    gs1Israel: {
      enabled: readBoolean('VITE_ENABLE_GS1', false),
      baseUrl: readString('VITE_GS1_BASE_URL', ''),
    },
    // Disabled: Israeli price-transparency portals require per-chain credentials
    // and carry no allergen data. See README.
    israelRetail: {
      enabled: readBoolean('VITE_ENABLE_ISRAEL_RETAIL', false),
      baseUrl: readString('VITE_ISRAEL_RETAIL_BASE_URL', ''),
    },
  },

  http: {
    timeoutMs: readNumber('VITE_HTTP_TIMEOUT_MS', 8000),
    retryAttempts: readNumber('VITE_HTTP_RETRY_ATTEMPTS', 1),
    userAgent: readString('VITE_USER_AGENT', 'AllergicGuard/0.1 (peanut-allergy-check)'),
  },

  cache: {
    enabled: readBoolean('VITE_ENABLE_CACHE', true),
    // Deliberately short: the cache is a speed optimization, never a safety source.
    ttlMs: readNumber('VITE_CACHE_TTL_MS', 10 * 60 * 1000),
  },

  scanner: {
    duplicateScanCooldownMs: readNumber('VITE_SCAN_COOLDOWN_MS', 3000),
  },

  packageAnalysis: {
    enabled: readBoolean('VITE_ENABLE_PACKAGE_SCAN', true),
    languages: readString('VITE_PACKAGE_SCAN_LANGUAGES', 'heb+eng'),
    // Empty means "use the library's jsDelivr default".
    corePath: readString('VITE_PACKAGE_SCAN_CORE_PATH', '') || undefined,
    langPath: readString('VITE_PACKAGE_SCAN_LANG_PATH', '') || undefined,
  },
};
