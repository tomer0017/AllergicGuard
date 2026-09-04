/**
 * Application composition root — wires configuration, logging, cache,
 * providers and the lookup service together exactly once.
 *
 * React components consume `appServices`; they never construct providers or
 * touch HTTP themselves.
 */

import { appConfig } from '../config/appConfig.ts';
import { LookupCache } from '../infrastructure/cache/lookupCache.ts';
import { Logger } from '../infrastructure/logging/logger.ts';
import { createProviderRegistry } from '../services/product-data/createProviderRegistry.ts';
import { ProductLookupService } from '../services/product-data/productLookupService.ts';

const logger = new Logger({ minLevel: appConfig.logLevel, enabled: true });

const registry = createProviderRegistry(appConfig);

const cache = new LookupCache({
  enabled: appConfig.cache.enabled,
  ttlMs: appConfig.cache.ttlMs,
});

const lookupService = new ProductLookupService({
  registry,
  logger,
  cache,
  allergen: 'peanut',
});

logger.info('APP', 'services initialized', {
  enabledProviders: registry.enabled().map((provider) => provider.id),
  disabledProviders: registry.disabled().map((provider) => provider.id),
  cacheEnabled: appConfig.cache.enabled,
});

export const appServices = {
  config: appConfig,
  logger,
  registry,
  cache,
  lookupService,
} as const;
