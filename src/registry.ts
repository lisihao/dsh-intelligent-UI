export interface ExperienceProviderManifest {
  id: string
  version: string
  capabilities: readonly string[]
}

export type ExperienceHandler = (input: unknown) => unknown | Promise<unknown>

export class ExperienceRegistryError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name }
}

export interface RegisteredExperienceProvider extends ExperienceProviderManifest {
  handler: ExperienceHandler
}

/** A small explicit router: registration order never selects a provider. */
export class ExperienceRegistry {
  private readonly providers = new Map<string, RegisteredExperienceProvider>()

  register(manifest: ExperienceProviderManifest, handler: ExperienceHandler): () => void {
    if (!manifest.id || !manifest.version) throw new ExperienceRegistryError('Provider id and version are required')
    if (this.providers.has(manifest.id)) throw new ExperienceRegistryError(`Provider already registered: ${manifest.id}`)
    const capabilities = [...manifest.capabilities]
    if (capabilities.length === 0) throw new ExperienceRegistryError(`Provider ${manifest.id} must declare a capability`)
    const seen = new Set<string>()
    for (const capability of capabilities) {
      if (!capability) throw new ExperienceRegistryError(`Provider ${manifest.id} declares an empty capability id`)
      if (seen.has(capability)) throw new ExperienceRegistryError(`Duplicate capability ${capability} in provider ${manifest.id}`)
      seen.add(capability)
    }
    const provider = Object.freeze({ id: manifest.id, version: manifest.version, capabilities: Object.freeze(capabilities), handler })
    this.providers.set(provider.id, provider)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  select(capability: string, providerId: string): RegisteredExperienceProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new ExperienceRegistryError(`Unknown provider: ${providerId}`)
    if (!provider.capabilities.includes(capability)) throw new ExperienceRegistryError(`Provider ${providerId} does not provide capability ${capability}`)
    return provider
  }

  async route(capability: string, providerId: string, input: unknown): Promise<unknown> {
    return await this.select(capability, providerId).handler(input)
  }

  providersFor(capability: string): readonly RegisteredExperienceProvider[] {
    return [...this.providers.values()].filter((provider) => provider.capabilities.includes(capability)).sort((a, b) => a.id.localeCompare(b.id))
  }
}
