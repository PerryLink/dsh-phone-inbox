/**
 * Shared Provider implementation for `dsh-phone-inbox`.
 *
 * Both Providers (`session` and `tempdir`) need the same second half: prove the
 * source is inside the inbox directory, pick a safe destination name, write the
 * bytes into the session workspace through a declared channel, and hash what was
 * written. Only the first half — *how the session's inbound list is obtained* —
 * differs, so it stays abstract.
 *
 * ## Why the two write channels
 *
 * The host's fs service (`ctx.fs`) writes **text** (`writeText`) under the
 * per-call sandbox policy. It has no byte-write API, so a `.docx` or a photo
 * cannot go through it without a lossy UTF-8 round trip. `node:fs` writes bytes
 * but is invisible to the fs sandbox fence (the fence wraps only
 * `SandboxedFileSystem.writeText` / `editText`).
 *
 * Neither channel is silently chosen for the other: `writeChannel` names which
 * one runs, `auto` means "fs service first for text, node:fs otherwise", and the
 * returned `copyMethod` always says which one actually wrote.
 * @module dsh-phone-inbox/provider-base
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { AdoptReason, AdoptRequest, AdoptResult, AdoptedItem, InboxItem, InboxProvider, ListResult } from './service.ts'
import { ADOPT_REASONS, LIST_REASONS } from './service.ts'
import type { ResolvedConfig, WriteChannel } from './config.ts'
import { scanAttachmentBlocks, type HostPathLookup } from './blocks.ts'
import { createMarkerMatcher, type InboundMarker, type MarkerMatcher } from './markers.ts'
import { containedJoin, contains, safeBasename } from './paths.ts'
import type { AttachmentProbe } from './probe.ts'
import { REASON_CODES, probeInbox, unavailableReason } from './probe.ts'

/** Extensions treated as UTF-8 text, i.e. safe to move through `ctx.fs.writeText`. */
export const TEXT_EXTENSIONS: readonly string[] = Object.freeze([
  '.csv', '.tsv', '.json', '.jsonl', '.txt', '.md', '.markdown', '.yaml', '.yml', '.xml', '.html', '.htm', '.log', '.ini', '.toml', '.srt', '.vtt',
])

/** Hard ceiling on one adopted file, so a mis-typed path cannot exhaust memory. */
export const MAX_ADOPT_BYTES = 256 * 1024 * 1024

/** One collected inbound attachment plus the ordering fields. */
export interface CollectedItem {
  /** The marker as parsed from the session text. */
  readonly marker: InboundMarker
  /** Which provider contributed it. */
  readonly source: string
}

/** A session carrying the fields this plugin reads. */
interface SessionLike {
  readonly header?: { readonly cwd?: unknown }
  deriveMessages(): unknown
}

/** The optional context services this plugin reads without injecting them. */
interface OptionalServices {
  readonly fs?: {
    resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
    writeText?(target: unknown, content: string, expected?: unknown, signal?: AbortSignal, policy?: unknown): Promise<unknown>
  }
  readonly attachments?: {
    saveFile?(input: { data: Uint8Array; name?: string }): Promise<{ attachmentId: string; name: string; bytes: number }>
    fileHostPath?(ref: unknown): string | undefined
    imageHostPath?(ref: unknown): string | undefined
  }
  readonly sandboxPolicy?: { resolve(request?: { session?: Session }): unknown }
}

/**
 * Read the session workspace root, or `undefined` when the session does not
 * expose one. This plugin never falls back to `process.cwd()`: an adopted file
 * landing in the harness's launch directory would be a silent, wrong success.
 * @param session - the calling session.
 * @returns the absolute workspace root, or `undefined`.
 */
export function workspaceOf(session: Session): string | undefined {
  const cwd = (session as unknown as SessionLike).header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? path.resolve(cwd) : undefined
}

/** Whether `value` is iterable (arrays and generators alike). */
function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value
}

/** Read `message.content` off an unvalidated projected message. */
function contentOf(message: unknown): unknown {
  if (typeof message !== 'object' || message === null) return undefined
  return (message as Record<string, unknown>).content
}

/**
 * Whether a projected message is a user turn. The host exposes `role` on every
 * derived message; a message without a `user` role is never scanned, so an
 * assistant echo of a path cannot be mistaken for an inbound attachment.
 * @param message - one entry of `deriveMessages()`.
 * @returns `true` for a user message.
 */
function isUserMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  return (message as Record<string, unknown>).role === 'user'
}

/**
 * The base Provider both concrete Providers extend.
 *
 * It is deliberately **not** a Cordis `Service`: exactly one object may register
 * the `phoneInbox` name on a context, and this plugin ships two interchangeable
 * Providers behind a config value. `LocalPhoneInboxService` is that one published
 * service, and it delegates here.
 */
export abstract class BasePhoneInboxService implements InboxProvider {
  /** The resolved config this provider was mounted with. */
  readonly config: ResolvedConfig
  /** The plugin context (kept for optional-service lookups). */
  protected readonly pluginCtx: Context
  /** The compiled marker matcher. */
  protected readonly matcher: MarkerMatcher
  /** How many structured attachment blocks the last history read could not resolve. */
  protected unresolvedBlocks = 0

  /**
   * Why the `auto` channel fell back from the fs service to `node:fs` on the
   * last write (`undefined` when it did not fall back). Diagnostic only: it
   * never changes what was written, it only makes the fallback explainable.
   */
  lastFallbackReason: string | undefined

  /**
   * Resolve a structured attachment ref to a host path through the optional
   * attachment service. Returns `undefined` when this host cannot answer, which
   * is what makes `BlockScan.unresolved` meaningful.
   * @param kind - the block's media kind.
   * @param ref - the attachment reference, unvalidated.
   * @returns the host path, or `undefined`.
   */
  private readonly hostPathLookup: HostPathLookup = (kind, ref) => {
    const attachments = this.services().attachments
    if (attachments === undefined) return undefined
    if (kind === 'image') {
      return typeof attachments.imageHostPath === 'function' ? toAbsolutePath(attachments.imageHostPath(ref)) : undefined
    }
    return typeof attachments.fileHostPath === 'function' ? toAbsolutePath(attachments.fileHostPath(ref)) : undefined
  }

  /**
   * @param ctx - the plugin context.
   * @param config - the resolved config.
   */
  constructor(ctx: Context, config: ResolvedConfig) {
    this.pluginCtx = ctx
    this.config = config
    this.matcher = createMarkerMatcher(config.markers)
  }

  /** @returns the optional host services this plugin reads. */
  protected services(): OptionalServices {
    return this.pluginCtx as unknown as OptionalServices
  }

  /** @returns what the host's attachment store can do on this build. */
  protected attachmentProbe(): AttachmentProbe {
    const attachments = this.services().attachments
    if (typeof attachments !== 'object' || attachments === null) {
      return { service: false, fileHostPath: false, imageHostPath: false }
    }
    const record = attachments as Record<string, unknown>
    return {
      service: true,
      fileHostPath: typeof record.fileHostPath === 'function',
      imageHostPath: typeof record.imageHostPath === 'function',
    }
  }

  /**
   * Read every user message of a session and parse the configured markers out
   * of it. This is the authoritative, incremental-safe read: it runs on every
   * call, so history that predates the plugin's mount (seed events are never
   * republished on `session/event`) is still seen.
   * @param session - the session to read.
   * @param source - the provider name to stamp on the collected items.
   * @returns the collected markers, newest last.
   */
  protected collectFromHistory(session: Session, source: string): CollectedItem[] {
    this.unresolvedBlocks = 0
    const messages = (session as unknown as SessionLike).deriveMessages()
    if (!isIterable(messages)) return []
    const ordered: CollectedItem[] = []
    for (const message of messages) {
      if (!isUserMessage(message)) continue
      const content = contentOf(message)
      for (const text of textsOf(content)) {
        for (const marker of this.matcher.match(text)) ordered.push({ marker, source })
      }
      // Structured attachment blocks are the host's own vocabulary, so they are
      // read as well as the bridge's wording: a message that carries one keeps
      // working after the wording changes. Unresolvable blocks are counted, not
      // dropped silently.
      const scan = scanAttachmentBlocks(content, this.hostPathLookup)
      this.unresolvedBlocks += scan.unresolved
      for (const block of scan.blocks) {
        if (block.hostPath === undefined) continue
        ordered.push({
          marker: {
            kind: block.kind,
            hostPath: block.hostPath,
            leafName: path.basename(block.hostPath),
            displayName: block.name ?? path.basename(block.hostPath),
            nameRecovery: block.nameRecovery,
            inlinedName: null,
          },
          source,
        })
      }
    }
    return ordered
  }

  /**
   * Merge collected items into one deterministic order: newest last, duplicate
   * paths collapsed. Later occurrences win, so incremental observations
   * override the history-derived copy of the same file.
   * @param batches - item batches, each newest-last.
   * @returns the merged items, newest last.
   */
  protected merge(batches: readonly CollectedItem[][]): CollectedItem[] {
    const byPath = new Map<string, CollectedItem>()
    for (const batch of batches) {
      for (const item of batch) {
        // Re-insert so the map's insertion order tracks last-seen order.
        byPath.delete(item.marker.hostPath)
        byPath.set(item.marker.hostPath, item)
      }
    }
    return [...byPath.values()]
  }

  /**
   * Decorate a collected marker with filesystem facts and turn it into a
   * listed item. A path that no longer exists is reported with `bytes`
   * undefined rather than dropped — "the bridge said it saved here and it is
   * gone" is information, not noise.
   * @param item - the collected marker.
   * @param workspace - the session workspace root.
   * @returns the listed item.
   */
  protected async describe(item: CollectedItem, workspace: string): Promise<InboxItem> {
    const { marker } = item
    const stats = await stat(marker.hostPath).catch(() => undefined)
    const base: InboxItem = {
      path: marker.hostPath,
      name: marker.leafName,
      displayName: marker.displayName,
      nameRecovery: marker.nameRecovery,
      kind: marker.kind,
      inWorkspace: contains(workspace, marker.hostPath).inside,
      source: item.source,
    }
    if (stats === undefined) return base
    return { ...base, bytes: stats.size, mtimeMs: stats.mtimeMs }
  }

  /**
   * Sort described items newest first and cap them. Items whose file is gone
   * sort after the ones that exist.
   * @param items - the described items.
   * @param limit - the cap.
   * @returns the capped list.
   */
  protected order(items: readonly InboxItem[], limit: number): InboxItem[] {
    return [...items]
      .sort((left, right) => (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0))
      .slice(0, Math.max(0, limit))
  }

  /** The capability-unavailable result, with remediation text. */
  protected unavailable(reason: string, detail: string): Extract<ListResult, { ok: false }> {
    return { ok: false, reason, detail }
  }

  /**
   * The main listing pipeline. Subclasses supply the session-derived batch by
   * overriding {@link historyBatch}; everything after it is shared.
   * @param session - the calling session.
   * @param options - the requested cap and tempdir policy.
   * @returns the listing result.
   */
  async list(session: Session, options: { limit: number; includeTempdir: boolean }): Promise<ListResult> {
    // Probe the session first and return the probe's own verdict. The Provider
    // reaches the same message surface the tool-layer probe checks, so running it
    // here too is what makes a drift report ("this host cannot answer") identical
    // through either entry point — and it is why this method never has to guess
    // whether an empty history means "nothing arrived" or "nothing readable".
    const probed = probeInbox({ agent: { session } } as unknown as ToolExecution, this.pluginCtx)
    if (probed.capability.state === 'unavailable') {
      return this.unavailable(probed.capability.reason, unavailableReason(probed.capability, this.config.inboxDir))
    }
    if (probed.session === undefined) {
      const capability = {
        state: 'unavailable' as const,
        reason: REASON_CODES.noAgentSession,
        detail: 'this call carries no session, so there is no conversation whose attachments could be listed',
      }
      return this.unavailable(capability.reason, unavailableReason(capability, this.config.inboxDir))
    }
    const workspace = workspaceOf(session)
    if (workspace === undefined) {
      const capability = {
        state: 'unavailable' as const,
        reason: REASON_CODES.noWorkspace,
        detail: 'the session has no usable header.cwd, so an adopted file would have no workspace to land in',
      }
      return this.unavailable(capability.reason, unavailableReason(capability, this.config.inboxDir))
    }
    const history = this.historyBatch(session)

    const batches: CollectedItem[][] = [history]
    let tempdirScan = false
    if (options.includeTempdir && this.config.allowTempdirScan) {
      const scanned = await this.tempdirBatch(session)
      if (scanned.length > 0) {
        batches.push(scanned)
        tempdirScan = true
      }
    }
    const merged = this.merge(batches)
    const described = await Promise.all(merged.map((item) => this.describe(item, workspace)))
    const items = this.order(described, options.limit)
    const sources = new Set(items.map((item) => item.source))
    const source = sources.size === 0 ? this.providerName() : sources.size > 1 ? 'hybrid' : [...sources][0] ?? this.providerName()

    if (items.length === 0) return this.emptyResult(source, { workspace, history })
    return {
      ok: true,
      source,
      inboxDir: this.config.inboxDir,
      items,
      attachments: this.attachmentProbe(),
      deriveMessages: true,
      tempdirScan,
      unresolvedAttachmentBlocks: this.unresolvedBlocks,
    }
  }

  /**
   * Record one inbound message incrementally. The history read is
   * authoritative — it sees the seed events that `session/event` never
   * republishes — so the default implementation is a no-op and a subclass only
   * overrides it if it has something to cache. `Session.deriveMessages()`
   * remains the source of truth either way.
   * @param _session - the session the message belongs to.
   * @param _content - the message's `content` field, unvalidated.
   */
  observeMessage(_session: Session, _content: unknown): void {
    // Intentionally empty; see the method doc.
  }

  /**
   * This provider's registered name, stamped on the items it contributes.
   * @returns the registered provider name.
   */
  abstract providerName(): string

  /**
   * This provider's session-derived batch, newest last. Must be synchronous and
   * cheap: it runs on every tool call.
   * @param session - the calling session.
   * @returns the collected items.
   */
  protected abstract historyBatch(session: Session): CollectedItem[]

  /**
   * This provider's inbox-directory batch, newest last. The base implementation
   * contributes nothing; `provider-tempdir` overrides it.
   * @param session - the calling session, for claimed-path exclusion.
   * @returns the collected items.
   */
  protected async tempdirBatch(session: Session): Promise<CollectedItem[]> {
    void session
    return []
  }

  /**
   * Build the "capability works, nothing to show" result, distinguishing an
   * idle inbox from an unreachable one.
   * @param source - the provider name.
   * @param context - the workspace and the history batch, for the diagnosis.
   * @returns the empty listing result.
   */
  protected emptyResult(source: string, context: { workspace: string; history: CollectedItem[] }): ListResult {
    const inboxDir = this.config.inboxDir
    if (context.history.length > 0) {
      return {
        ok: true,
        source,
        inboxDir,
        items: [],
        attachments: this.attachmentProbe(),
        deriveMessages: true,
        emptyReason: LIST_REASONS.sourceMissing,
        emptyDetail: `${context.history.length} inbound marker(s) were found in this session's messages, but none of the referenced files still exist under ${inboxDir === '' ? 'the inbox directory' : inboxDir}. The bridge's temp files may have been cleaned up.`,
        tempdirScan: false,
        unresolvedAttachmentBlocks: this.unresolvedBlocks,
      }
    }
    return {
      ok: true,
      source,
      inboxDir,
      items: [],
      attachments: this.attachmentProbe(),
      deriveMessages: true,
      emptyReason: LIST_REASONS.noInboundSource,
      emptyDetail: `no inbound attachment marker matched in this session's user messages. Either no attachment was sent to this session, or the bridge's wording changed — the patterns are configurable under \`markers\` (see the README). This is not a capability failure.`,
      tempdirScan: false,
      unresolvedAttachmentBlocks: this.unresolvedBlocks,
    }
  }

  /**
   * The adopt pipeline: contain, stat, name, write, hash, optionally register.
   * @param session - the calling session (supplies the workspace).
   * @param request - the source path plus naming/write options.
   * @returns the adopt result.
   */
  async adopt(session: Session, request: AdoptRequest): Promise<AdoptResult> {
    const workspace = workspaceOf(session)
    if (workspace === undefined) {
      return this.fail(ADOPT_REASONS.noWorkspace, 'the session has no usable header.cwd, so there is no workspace to adopt into')
    }
    const inboxDir = this.config.inboxDir
    if (inboxDir === '') {
      return this.fail(ADOPT_REASONS.notInInbox, 'no inboxDir is configured, so no source path can be proven to come from the bridge')
    }
    const requestedPath = typeof request.path === 'string' ? request.path.trim() : ''
    if (requestedPath === '') return this.fail(ADOPT_REASONS.notInInbox, 'path must be a non-empty string')
    const source = contains(inboxDir, requestedPath)
    if (!source.inside) {
      return this.fail(
        ADOPT_REASONS.notInInbox,
        `${source.target} is not inside the inbox directory ${source.root}; this plugin only adopts files the bridge saved there`,
      )
    }
    const stats = await stat(source.target).catch(() => undefined)
    if (stats === undefined) return this.fail(ADOPT_REASONS.sourceMissing, `${source.target} does not exist`)
    if (!stats.isFile()) return this.fail(ADOPT_REASONS.sourceNotFile, `${source.target} is not a regular file`)
    if (stats.size > MAX_ADOPT_BYTES) {
      return this.fail(ADOPT_REASONS.sourceTooLarge, `${source.target} is ${stats.size} bytes, above the ${MAX_ADOPT_BYTES}-byte ceiling`)
    }

    let subdir: string
    try {
      subdir = containedJoin(workspace, request.subdir ?? this.config.defaultSubdir)
    } catch (error) {
      return this.fail(ADOPT_REASONS.notInInbox, error instanceof Error ? error.message : String(error))
    }

    const leaf = path.basename(source.target)
    const fallback = safeBasename(leaf, 'attachment').name
    const requestedName = request.name !== undefined && request.name.trim() !== '' ? request.name : undefined
    const candidateName = requestedName ?? this.preferredName(source.target, fallback)
    const name = safeBasename(candidateName, fallback).name
    const overwrite = request.overwrite === true
    const channel: WriteChannel = isChannel(request.channel) ? request.channel : this.config.writeChannel

    const data = await readFile(source.target).catch(() => undefined)
    if (data === undefined) return this.fail(ADOPT_REASONS.sourceMissing, `${source.target} could not be read`)
    const sha256 = createHash('sha256').update(data).digest('hex')

    const planned = await this.planDestination(subdir, name, overwrite)
    if ('failed' in planned) return planned.failed
    const written = await this.write(planned.target, data, channel, session)
    if ('failed' in written) return written.failed

    const item: AdoptedItem = {
      hostPath: source.target,
      workspacePath: planned.target,
      relativePath: toRelative(workspace, planned.target),
      bytes: data.byteLength,
      sha256,
      copyMethod: written.method,
      sourceInline: false,
      nameRestored: name !== leaf,
      sourceLeafName: leaf,
    }
    const registered = await this.register(data, name, request.register ?? this.config.registerAttachment)
    return { ok: true, item: registered === undefined ? item : { ...item, ...registered } }
  }

  /**
   * The file name `inbox_adopt` uses when the caller gave none. Implementations
   * may prefer a recovered original name (the session provider does).
   * @param hostPath - the source path.
   * @param fallback - the already-sanitized on-disk leaf name.
   * @returns the preferred candidate name.
   */
  preferredName(hostPath: string, fallback: string): string {
    void hostPath
    return fallback
  }

  /** Build a failed adopt result. */
  protected fail(reason: AdoptReason, detail: string): AdoptResult {
    return { ok: false, reason, detail }
  }

  /**
   * Choose a non-colliding destination path, adding `-1`, `-2`, … so a
   * duplicate name never silently loses the previous copy unless the caller
   * asked for an overwrite.
   * @param dir - the destination directory.
   * @param name - the sanitized file name.
   * @param overwrite - whether an existing file may be replaced.
   * @returns the chosen target, or the failure to return.
   */
  protected async planDestination(dir: string, name: string, overwrite: boolean): Promise<{ target: string } | { failed: AdoptResult }> {
    if (overwrite) return { target: path.join(dir, name) }
    const extension = path.extname(name)
    const stem = extension === '' ? name : name.slice(0, -extension.length)
    for (let index = 0; index < 100; index += 1) {
      const candidate = path.join(dir, index === 0 ? name : `${stem}-${index}${extension}`)
      const exists = await stat(candidate).then(() => true).catch(() => false)
      if (!exists) return { target: candidate }
    }
    return {
      failed: this.fail(
        ADOPT_REASONS.destinationExists,
        `${path.join(dir, name)} and 99 numbered alternatives already exist; pass overwrite: true to replace one, or name to choose another`,
      ),
    }
  }

  /**
   * Write the bytes through the requested channel.
   * @param target - the absolute destination.
   * @param data - the bytes.
   * @param channel - the requested channel.
   * @param session - the calling session, for the per-call sandbox policy.
   * @returns the channel that wrote, or the failure to return.
   */
  protected async write(target: string, data: Buffer, channel: WriteChannel, session?: Session): Promise<{ method: string } | { failed: AdoptResult }> {
    const errors: string[] = []
    const tryNode = async (): Promise<{ method: string } | { failed: AdoptResult }> => {
      try {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, data)
        return { method: 'node-fs' }
      } catch (error) {
        errors.push(`node:fs: ${error instanceof Error ? error.message : String(error)}`)
        return { failed: this.fail(ADOPT_REASONS.writeFailed, `could not write ${target} (${errors.join('; ')})`) }
      }
    }
    const tryFs = async (): Promise<{ method: string } | { failed: AdoptResult }> => {
      const fs = this.services().fs
      if (fs === undefined || typeof fs.resolve !== 'function' || typeof fs.writeText !== 'function') {
        errors.push('ctx.fs: writeText is unavailable on this host')
        return { failed: this.fail(ADOPT_REASONS.writeFailed, `could not write ${target} (${errors.join('; ')})`) }
      }
      try {
        // Same pairing the official fs tools use: the session-scoped policy, so
        // a confining backend fences this write exactly as it fences `write`.
        const policy = this.services().sandboxPolicy?.resolve(session === undefined ? undefined : { session })
        const resolvedTarget = await fs.resolve(target, { cwd: path.dirname(target) })
        await fs.writeText(resolvedTarget, data.toString('utf8'), undefined, undefined, policy)
        return { method: 'fs-service' }
      } catch (error) {
        errors.push(`ctx.fs: ${error instanceof Error ? error.message : String(error)}`)
        return { failed: this.fail(ADOPT_REASONS.writeFailed, `could not write ${target} (${errors.join('; ')})`) }
      }
    }

    // An explicit channel is a request the plugin does not second-guess: if the
    // caller named `fs`, a host without a usable fs service gets an error, not a
    // silent node:fs write.
    if (channel === 'node') return tryNode()
    if (channel === 'fs') return tryFs()
    // `auto`: prefer the host fs service where the bytes are text (it honours the
    // fs sandbox policy), and fall back to node:fs when that service is missing
    // or refuses — the returned `copyMethod` always says which one ran.
    if (isTextName(target)) {
      const viaFs = await tryFs()
      if (!('failed' in viaFs)) return viaFs
      // The fs service was preferred for text but did not write. Record why, so
      // a caller that later sees `node-fs` can tell a policy refusal from a
      // missing service instead of guessing.
      this.lastFallbackReason = errors[errors.length - 1] ?? 'ctx.fs refused the write'
      return tryNode()
    }
    return tryNode()
  }

  /**
   * Register the adopted bytes as a durable host attachment, when the host
   * offers the seam and the caller asked for it.
   * @param data - the bytes.
   * @param name - the file name.
   * @param register - whether registration was requested.
   * @returns the attachment fields to merge, or `undefined` to skip.
   */
  protected async register(data: Buffer, name: string, register: boolean): Promise<Partial<AdoptedItem> | undefined> {
    if (!register) return undefined
    const attachments = this.services().attachments
    if (attachments === undefined || typeof attachments.saveFile !== 'function') return undefined
    const ref = await attachments.saveFile({ data, name }).catch(() => undefined)
    if (ref === undefined) return undefined
    const hostPath = typeof attachments.fileHostPath === 'function' ? attachments.fileHostPath(ref) : undefined
    return hostPath === undefined
      ? { attachmentId: ref.attachmentId }
      : { attachmentId: ref.attachmentId, attachmentHostPath: hostPath }
  }
}

/** Whether `value` is a declared write channel. */
export function isChannel(value: unknown): value is WriteChannel {
  return value === 'fs' || value === 'node' || value === 'auto'
}

/**
 * Normalize a host path returned by the attachment service. A host that answers
 * with an empty string answered "no path", not "the root directory".
 * @param value - the value the host returned.
 * @returns the path, or `undefined` when there is none.
 */
function toAbsolutePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : path.resolve(trimmed)
}

/** Whether a file name looks like UTF-8 text (safe for the fs text channel). */
export function isTextName(target: string): boolean {
  return TEXT_EXTENSIONS.includes(path.extname(target).toLowerCase())
}

/**
 * Render a workspace-relative path with `/` separators. This is the form the
 * workspace-confined consumers want, so the model can pass it straight through.
 * @param workspace - the absolute workspace root.
 * @param target - the absolute target.
 * @returns the relative path.
 */
export function toRelative(workspace: string, target: string): string {
  return path.relative(workspace, target).split(path.sep).join('/')
}

/** Read the text of content parts, tolerating both projected shapes. */
function textsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      texts.push(part)
      continue
    }
    if (typeof part !== 'object' || part === null) continue
    const record = part as Record<string, unknown>
    if (record.type !== 'text' && record.type !== 'input_text') continue
    if (typeof record.text === 'string') texts.push(record.text)
  }
  return texts
}
