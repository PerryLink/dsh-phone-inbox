/**
 * Provider registration and inbox-directory resolution.
 *
 * Two Providers exist, and the choice is a real trade-off rather than a
 * preference:
 *
 * - **`session`** (default) reads only the calling session's own messages, so
 *   attribution is proven and the sender's original file name can be restored.
 * - **`tempdir`** is `session` **plus** an opt-in scan of the bridge's inbox
 *   directory for files no message claimed. It exists for the case where the
 *   marker wording changed and the session read finds nothing; it can never
 *   prove which conversation a scanned file belongs to.
 *
 * Registering both into one {@link ProviderRegistry} keeps the selection a
 * config value (`provider`) instead of a branch inside the tool, so a deployment
 * can add a third implementation without touching this plugin's Consumers.
 * @module dsh-phone-inbox/providers
 */

import { homedir } from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.ts'
import type { BasePhoneInboxService } from './provider-base.ts'
import type { InboxProvider } from './service.ts'
import { SessionPhoneInboxService } from './provider-session.ts'
import { TempdirPhoneInboxService } from './provider-tempdir.ts'
import { LocalPhoneInboxService } from './service-local.ts'
import { ProviderRegistry } from './seam.ts'

/** The provider names this plugin registers, in registration order. */
export const PROVIDER_NAMES: readonly string[] = Object.freeze(['session', 'tempdir'])

/** The default inbox directory: the bridge's own temp directory. */
export const DEFAULT_INBOX_DIR = path.join(homedir(), '.dsh-wechat', 'tempfile')

/** The registry plus the service it published. */
export interface RegisteredProviders {
  /** The registry the tools resolve the active provider from. */
  readonly registry: ProviderRegistry<InboxProvider>
  /** The provider the registry resolved for this deployment. */
  readonly active: InboxProvider
  /** The published `ctx.phoneInbox` service (a facade over {@link active}). */
  readonly service: LocalPhoneInboxService
}

/** @returns every registered provider name. */
export function providerNames(): string[] {
  return [...PROVIDER_NAMES]
}

/**
 * Resolve the inbox directory. The bridge's default is
 * `~/.dsh-wechat/tempfile`, and it is derived here rather than assumed so a
 * deployment that moved `storageDir` can point the plugin at the real place.
 * @param configured - the raw `inboxDir` config value.
 * @returns the absolute inbox directory (`''` only when explicitly configured so).
 */
export function resolveInboxDir(configured: string | undefined): string {
  if (configured === undefined) return DEFAULT_INBOX_DIR
  const trimmed = configured.trim()
  if (trimmed === '') return ''
  return path.resolve(trimmed)
}

/**
 * Build both Providers, register them, and publish `ctx.phoneInbox`.
 *
 * The Providers are plain classes: exactly one `Service` may own the
 * `phoneInbox` name, so {@link LocalPhoneInboxService} is the single published
 * facade and the registry selects which Provider sits behind it.
 * @param ctx - the plugin context.
 * @param config - the resolved config.
 * @returns the registry plus the published service.
 */
export function registerProviders(ctx: Context, config: ResolvedConfig): RegisteredProviders {
  const registry = new ProviderRegistry<InboxProvider>({
    default: { name: 'session', impl: new SessionPhoneInboxService(ctx, config) },
  })
  ctx.effect(() => registry.register('tempdir', new TempdirPhoneInboxService(ctx, config)), 'dsh-phone-inbox: tempdir provider')
  if (config.provider === 'tempdir') registry.setDefault('tempdir')
  const active = registry.use(config.provider)
  if (active === undefined) {
    throw new Error(`phone-inbox: no provider registered for provider "${config.provider}" (have: ${registry.names().join(', ')})`)
  }
  const service = new LocalPhoneInboxService(ctx, active)
  return { registry, active, service }
}
