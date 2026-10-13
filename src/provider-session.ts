/**
 * The `session` Provider — the default, and the only path that is correct by
 * construction.
 *
 * It reads the **calling session's own** message history
 * (`Session.deriveMessages()`, which includes the seed events that
 * `session/event` never republishes) and parses the bridge's marker wording out
 * of the user turns. Because the scope is exactly one session, it can never show
 * one WeChat sender's attachment to another session, and it can restore the
 * sender's original file name from the marker text — something the on-disk leaf
 * name has lost.
 * @module dsh-phone-inbox/provider-session
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import { displayNameFrom } from './markers.ts'
import { BasePhoneInboxService, type CollectedItem } from './provider-base.ts'

/** The Provider registered under the name `session`. */
export class SessionPhoneInboxService extends BasePhoneInboxService {
  /**
   * Display names recovered from the sender's own marker text, keyed by host
   * path, refreshed on every {@link historyBatch} call.
   */
  private readonly recoveredNames = new Map<string, string>()

  /**
   * @param ctx - the plugin context.
   * @param config - the resolved config.
   */
  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, config)
  }

  /** @returns the registered provider name. */
  providerName(): string {
    return 'session'
  }

  /**
   * The session's own inbound markers, newest last, plus the name index
   * {@link preferredName} reads. The shared history read is authoritative on
   * every call, so no incremental cache is kept: a stale cache would be the only
   * way this could be wrong.
   * @param session - the calling session.
   * @returns the collected items.
   */
  protected override historyBatch(session: Session): CollectedItem[] {
    const items = this.collectFromHistory(session, this.providerName())
    this.recoveredNames.clear()
    for (const item of items) {
      if (item.marker.nameRecovery === 'recovered') this.recoveredNames.set(item.marker.hostPath, item.marker.displayName)
    }
    return items
  }

  /**
   * Prefer the sender's original file name when the marker wording carried it.
   * The bridge's on-disk leaf name has every non-ASCII character replaced by
   * `_` (`dsh-wechat`'s `saveToTemp`), so `材料.csv` on the phone exists on disk
   * as `___.csv`; the only place the original name survives is the
   * `[收到文件: <name>]` marker text.
   * @param hostPath - the source path.
   * @param fallback - the sanitized on-disk leaf name.
   * @returns the name to adopt under.
   */
  override preferredName(hostPath: string, fallback: string): string {
    if (!this.config.restoreOriginalName) return fallback
    const recovered = this.recoveredNames.get(hostPath)
    if (recovered === undefined) return fallback
    const cleaned = displayNameFrom(recovered)
    return cleaned === '' ? fallback : cleaned
  }
}
