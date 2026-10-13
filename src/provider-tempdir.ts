/**
 * The `tempdir` Provider — the session Provider **plus** an opt-in scan of the
 * bridge's inbox directory.
 *
 * ## Why this is off by default
 *
 * `~/.dsh-wechat/tempfile/` is a single global directory shared by every WeChat
 * sender and every session on the machine, and nothing ever cleans it up. A scan
 * therefore cannot answer "which of these did *this* conversation receive?" — it
 * can only answer "which files exist". Turning that into a session's inbox means
 * showing one user another user's attachments.
 *
 * So the scan runs only when `allowTempdirScan` is explicitly enabled **and** the
 * caller asked for it, it only accepts leaf names with the bridge's own
 * `<epoch-ms>-<8 hex>-<sanitized name>` shape (so an unrelated file dropped in
 * the directory is not surfaced), and every item it contributes is stamped
 * `source: 'tempdir'` so the model can see the attribution is weaker.
 * @module dsh-phone-inbox/provider-tempdir
 */

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import { displayNameFrom, type InboundMarker } from './markers.ts'
import { parseBridgeLeaf } from './paths.ts'
import type { CollectedItem } from './provider-base.ts'
import { SessionPhoneInboxService } from './provider-session.ts'

/** The Provider registered under the name `tempdir`. */
export class TempdirPhoneInboxService extends SessionPhoneInboxService {
  /**
   * @param ctx - the plugin context.
   * @param config - the resolved config.
   */
  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, config)
  }

  /** @returns the registered provider name. */
  override providerName(): string {
    return 'tempdir'
  }

  /**
   * Files in the inbox directory that no session marker claimed, newest last.
   * Never throws: an absent or unreadable inbox directory contributes nothing.
   * @param session - the calling session, used to exclude claimed paths.
   * @returns the collected items.
   */
  protected override async tempdirBatch(session: Session): Promise<CollectedItem[]> {
    if (!this.config.allowTempdirScan || this.config.inboxDir === '') return []
    // Exclude everything the session's own markers claimed, so a file that is
    // both claimed and scannable is attributed to the session, not the scan.
    const claimed = new Set(this.collectFromHistory(session, this.providerName()).map((item) => item.marker.hostPath.toLowerCase()))
    const entries = await readdir(this.config.inboxDir, { withFileTypes: true }).catch(() => undefined)
    if (entries === undefined) return []
    const ceiling = this.config.tempdirScanMaxAgeMs
    const now = Date.now()
    const candidates: Array<{ item: CollectedItem; mtimeMs: number }> = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const parsed = parseBridgeLeaf(entry.name)
      if (parsed === null) continue
      const hostPath = path.join(this.config.inboxDir, entry.name)
      if (claimed.has(hostPath.toLowerCase())) continue
      const stats = await stat(hostPath).catch(() => undefined)
      if (stats === undefined) continue
      if (ceiling > 0 && now - stats.mtimeMs > ceiling) continue
      candidates.push({ item: { marker: scannedMarker(entry.name, hostPath, parsed.name), source: this.providerName() }, mtimeMs: stats.mtimeMs })
    }
    return candidates
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-Math.max(0, this.config.tempdirScanMaxItems))
      .map((entry) => entry.item)
  }
}

/**
 * Build a marker record for a scanned file. The recovery level is honest about
 * what a scan knows: the leaf name's tail is the bridge's *sanitized* name, so a
 * non-ASCII original is unrecoverable here (`nameRecovery: 'unavailable'`).
 * @param leafName - the on-disk leaf name.
 * @param hostPath - the absolute path.
 * @param sanitizedName - the tail of the bridge's leaf name.
 * @returns the marker record.
 */
function scannedMarker(leafName: string, hostPath: string, sanitizedName: string): InboundMarker {
  const candidate = displayNameFrom(sanitizedName)
  return {
    kind: 'file',
    hostPath,
    leafName,
    displayName: candidate === '' ? leafName : candidate,
    nameRecovery: 'unavailable',
    inlinedName: null,
  }
}
