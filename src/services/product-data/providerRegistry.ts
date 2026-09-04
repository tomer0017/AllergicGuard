/**
 * The single place that knows which providers exist and which are enabled.
 * Nothing else in the codebase branches on provider identity.
 */

import type { ProductDataProvider } from './providerTypes.ts';

export class ProviderRegistry {
  private readonly providers = new Map<string, ProductDataProvider>();

  constructor(providers: readonly ProductDataProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: ProductDataProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): ProductDataProvider | undefined {
    return this.providers.get(providerId);
  }

  all(): readonly ProductDataProvider[] {
    return [...this.providers.values()];
  }

  /** Enabled providers, ordered by allergen-evidence priority. */
  enabled(): readonly ProductDataProvider[] {
    return this.all()
      .filter((provider) => provider.enabled)
      .sort((a, b) => a.allergenEvidencePriority - b.allergenEvidencePriority);
  }

  /** Enabled providers, ordered by how much we trust their product identity. */
  enabledByIdentityPriority(): readonly ProductDataProvider[] {
    return this.all()
      .filter((provider) => provider.enabled)
      .sort((a, b) => a.identityPriority - b.identityPriority);
  }

  disabled(): readonly ProductDataProvider[] {
    return this.all().filter((provider) => !provider.enabled);
  }
}
