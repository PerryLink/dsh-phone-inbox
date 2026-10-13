/**
 * The published `ctx.phoneInbox` surface: a thin facade over the active
 * {@link InboxProvider} implementation.
 *
 * The facade exists because exactly **one** object may register the `phoneInbox`
 * service name on a context — Cordis rejects a second registration — while the
 * plugin still wants two interchangeable Providers behind a config value. So the
 * Providers are plain classes, the registry selects one, and this facade is the
 * single published service.
 * @module dsh-phone-inbox/service-local
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { InboxProvider } from './service.ts'
import type { ResolvedConfig } from './config.ts'
import { PhoneInboxService, type AdoptRequest, type AdoptResult, type ListResult } from './service.ts'

/** The published `ctx.phoneInbox` implementation. */
export class LocalPhoneInboxService extends PhoneInboxService {
  /** The resolved config of the active provider. */
  readonly config: ResolvedConfig
  private readonly active: InboxProvider

  /**
   * @param ctx - the plugin context; constructing this publishes `ctx.phoneInbox`.
   * @param active - the Provider the registry resolved for this deployment.
   */
  constructor(ctx: Context, active: InboxProvider) {
    super(ctx)
    this.active = active
    this.config = active.config
  }

  /** @returns the active provider's registered name (`session` or `tempdir`). */
  activeProvider(): string {
    return (this.active as InboxProvider & { providerName?: () => string }).providerName?.() ?? 'unknown'
  }

  /**
   * @param session - the session the message belongs to.
   * @param content - the message's `content` field.
   */
  observeMessage(session: Session, content: unknown): void {
    this.active.observeMessage(session, content)
  }

  /**
   * @param session - the calling session.
   * @param options - the requested cap and tempdir policy.
   * @returns the listing result.
   */
  list(session: Session, options: { limit: number; includeTempdir: boolean }): Promise<ListResult> {
    return this.active.list(session, options)
  }

  /**
   * @param session - the calling session.
   * @param request - the source path plus naming/write options.
   * @returns the adopt result.
   */
  adopt(session: Session, request: AdoptRequest): Promise<AdoptResult> {
    return this.active.adopt(session, request)
  }
}
