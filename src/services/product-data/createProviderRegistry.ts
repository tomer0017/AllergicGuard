/**
 * Composition root for data providers.
 *
 * This is the ONLY place that decides which providers exist. To add a provider:
 * implement ProductDataProvider, then register it here and add its flag to
 * appConfig. No React component changes.
 */

import type { AppConfig } from '../../config/appConfig.ts';
import { ProviderRegistry } from './providerRegistry.ts';
import { OpenFoodFactsProvider } from './providers/openFoodFacts/openFoodFactsProvider.ts';
import { Gs1IsraelProvider } from './providers/gs1Israel/gs1IsraelProvider.ts';
import { IsraelRetailProvider } from './providers/israelRetail/israelRetailProvider.ts';

export function createProviderRegistry(
  config: AppConfig,
  overrides: { fetchImpl?: typeof fetch } = {},
): ProviderRegistry {
  return new ProviderRegistry([
    new OpenFoodFactsProvider({
      enabled: config.providers.openFoodFacts.enabled,
      baseUrl: config.providers.openFoodFacts.baseUrl,
      timeoutMs: config.http.timeoutMs,
      retryAttempts: config.http.retryAttempts,
      userAgent: config.http.userAgent,
      fetchImpl: overrides.fetchImpl,
    }),
    new Gs1IsraelProvider({
      enabled: config.providers.gs1Israel.enabled,
      baseUrl: config.providers.gs1Israel.baseUrl,
    }),
    new IsraelRetailProvider({
      enabled: config.providers.israelRetail.enabled,
      baseUrl: config.providers.israelRetail.baseUrl,
    }),
  ]);
}
