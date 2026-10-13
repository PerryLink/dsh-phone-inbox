/**
 * A minimal in-repo implementation of the Provider-registry seam.
 *
 * ## Why this is copied instead of imported
 *
 * `@perrylink/dsh-plugin-kit` exports a general-purpose `ProviderRegistry`, and
 * this module mirrors its behaviour on purpose: a named registry of one
 * capability's implementations, `register` returning a disposer so every
 * registration is a reversible `ctx.effect`, duplicate names failing loud, and
 * `use()` resolving the configured default.
 *
 * It is copied because this plugin ships with **zero runtime dependencies**:
 * importing the kit would put ~100 KB of unrelated toolkit (approval gates,
 * sanitizers, pricing tables, judges) into the dependency graph of a plugin that
 * needs one `Map`. The kit's own seam module documents itself as the template to
 * copy — "It deliberately imports nothing from `@deepseek-ai/*` so it stays
 * usable as a zero-dependency building block".
 *
 * If the seam ever grows beyond a `Map`, depend on the kit instead of growing
 * this file.
 * @module dsh-phone-inbox/seam
 */

/** A function that reverses one registration (a Cordis-style disposer). */
export type Disposer = () => void

/** A named provider implementation registered under one capability. */
export interface ProviderEntry<T> {
  /** Stable registration key. */
  readonly name: string
  /** The implementation bound to {@link ProviderEntry.name}. */
  readonly impl: T
}

/** Options for {@link ProviderRegistry}. */
export interface ProviderRegistryOptions<T> {
  /** Optional default provider, registered immediately and resolved by {@link ProviderRegistry.use} without an argument. */
  readonly default?: ProviderEntry<T>
}

/**
 * A reversible, named registry of one capability's implementations.
 * @typeParam T - the provider interface every implementation shares.
 */
export class ProviderRegistry<T> {
  private readonly providers = new Map<string, T>()
  private defaultName: string | undefined

  /**
   * @param options - optional default provider.
   */
  constructor(options?: ProviderRegistryOptions<T>) {
    if (options?.default !== undefined) {
      this.providers.set(options.default.name, options.default.impl)
      this.defaultName = options.default.name
    }
  }

  /**
   * Register a named implementation.
   * @param name - stable registration key, unique within this registry.
   * @param impl - the implementation to bind.
   * @returns the disposer that removes exactly this registration (idempotent).
   * @throws when `name` is already registered — a duplicate is a misconfiguration, not a silent replacement.
   */
  register(name: string, impl: T): Disposer {
    if (this.providers.has(name)) throw new Error(`Provider "${name}" is already registered`)
    this.providers.set(name, impl)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.providers.delete(name)
    }
  }

  /**
   * Resolve an implementation.
   * @param name - registration key, or omitted to use the default.
   * @returns the implementation, or `undefined` when no such provider exists.
   */
  use(name?: string): T | undefined {
    const key = name ?? this.defaultName
    return key === undefined ? undefined : this.providers.get(key)
  }

  /**
   * Whether a provider is registered under `name`.
   * @param name - the registration key.
   * @returns `true` when registered.
   */
  has(name: string): boolean {
    return this.providers.has(name)
  }

  /** @returns every registered name, in insertion order. */
  names(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Change which registered provider {@link use} resolves without an argument.
   * @param name - the new default name, or `undefined` to clear it.
   */
  setDefault(name: string | undefined): void {
    this.defaultName = name
  }
}
