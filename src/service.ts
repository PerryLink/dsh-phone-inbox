/**
 * Service Definition of the `dsh-phone-inbox` capability seam: the
 * `ctx.phoneInbox` surface other plugins may optionally consume, plus the
 * request/result types the local Providers and the tool Consumers share.
 *
 * Three roles, one seam:
 *
 * | Role | Where |
 * |---|---|
 * | Service Definition | this module — {@link PhoneInboxService}, {@link ListResult}, {@link AdoptResult} |
 * | Service Provider | `provider-session.ts` (the live path) and `provider-tempdir.ts` (the off-by-default fallback) |
 * | Consumer | `tools/list.ts` and `tools/adopt.ts` |
 *
 * Both results are **discriminated unions, not exceptions**, for the one case
 * that matters operationally: "this host cannot answer the question". A thrown
 * error at a tool boundary becomes a tool failure the model may retry forever;
 * an `ok: false` verdict is information the model can act on.
 * @module dsh-phone-inbox/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import type { InboundMarker, MarkerKind } from './markers.ts'
import type { AttachmentProbe } from './probe.ts'

/** One listed inbound attachment, as the tools and external consumers see it. */
export interface InboxItem {
  /** Host absolute path the bridge saved the media to (or a scanned inbox path). */
  readonly path: string
  /** Leaf name on disk, i.e. the bridge-sanitized name. */
  readonly name: string
  /** Best human-recognizable name; equals {@link name} when nothing better exists. */
  readonly displayName: string
  /** How {@link displayName} was obtained (`recovered` | `absent` | `unavailable`). */
  readonly nameRecovery: string
  /** Media kind. */
  readonly kind: MarkerKind | string
  /** Whether the item's path resolves inside the session workspace. */
  readonly inWorkspace: boolean
  /** Size in bytes, when it could be read. */
  readonly bytes?: number
  /** Last-modified time in epoch ms, when it could be read. */
  readonly mtimeMs?: number
  /** Which provider contributed the item (`session` | `tempdir`). */
  readonly source: string
}

/** Failure reasons `inbox_list` reports instead of an empty list. */
export const LIST_REASONS = {
  /** The host cannot expose this session's messages or its workspace. */
  capabilityUnavailable: 'capability-unavailable',
  /** The bridge's wording is not in any message, so no path could be recovered. */
  noInboundSource: 'no-inbound-source',
  /** The bridge wording matched, but every matched file is gone from disk. */
  sourceMissing: 'source-missing',
} as const

/** The union of {@link LIST_REASONS} values. */
export type ListReason = (typeof LIST_REASONS)[keyof typeof LIST_REASONS]

/** The value `ctx.phoneInbox.list` returns (tool canonical value minus presentation). */
export type ListResult =
  | {
    readonly ok: true
    /** Where the items came from (`session`, `tempdir`, or `hybrid`). */
    readonly source: string
    readonly inboxDir: string
    readonly items: readonly InboxItem[]
    /** Whether the host's attachment store can resolve an attachment ref to a path. */
    readonly attachments: AttachmentProbe
    /** Whether the session exposes the message-reading surface this plugin needs. */
    readonly deriveMessages: boolean
    /** `'empty'` when the capability works but nothing arrived; see {@link ListReason} otherwise. */
    readonly emptyReason?: ListReason
    /** Human-readable explanation of {@link emptyReason}. */
    readonly emptyDetail?: string
    /** Whether the tempdir fallback contributed items. */
    readonly tempdirScan: boolean
    /**
     * How many structured attachment blocks were present in this session's
     * messages but could not be resolved to a host path. Non-zero means this
     * listing is incomplete for a stated reason (usually: the host build has no
     * attachment store with `fileHostPath`/`imageHostPath`), never that the
     * inbox is empty.
     */
    readonly unresolvedAttachmentBlocks: number
  }
  | {
    readonly ok: false
    readonly reason: string
    /** Actionable text: what was missing and what still works. */
    readonly detail: string
  }

/** Failure reasons `inbox_adopt` reports. */
export const ADOPT_REASONS = {
  /** Same capability failure as `inbox_list`. */
  capabilityUnavailable: 'capability-unavailable',
  /** The requested path is not under the inbox directory. */
  notInInbox: 'not-in-inbox',
  /** The requested path does not exist. */
  sourceMissing: 'source-missing',
  /** The source exists but is not a regular file. */
  sourceNotFile: 'source-not-file',
  /** The source exceeds the size ceiling. */
  sourceTooLarge: 'source-too-large',
  /** The destination already exists and no target name can be chosen. */
  destinationExists: 'destination-exists',
  /** Both write channels failed. */
  writeFailed: 'write-failed',
  /** The workspace could not be determined. */
  noWorkspace: 'no-workspace',
} as const

/** The union of {@link ADOPT_REASONS} values. */
export type AdoptReason = (typeof ADOPT_REASONS)[keyof typeof ADOPT_REASONS]

/** The request `ctx.phoneInbox.adopt` accepts. */
export interface AdoptRequest {
  /** Host absolute path as `inbox_list` reported it. */
  readonly path: string
  /** Overrides the derived file name. */
  readonly name?: string | undefined
  /** Subdirectory of the session workspace to write into. */
  readonly subdir?: string | undefined
  /** Which write channel to use. */
  readonly channel?: string | undefined
  /** Overwrite an existing destination. */
  readonly overwrite?: boolean | undefined
  /** Also register the bytes as a durable host attachment. */
  readonly register?: boolean | undefined
}

/** A successfully adopted attachment. */
export interface AdoptedItem {
  /** The original host path. */
  readonly hostPath: string
  /** Workspace-absolute path when a copy was written. */
  readonly workspacePath?: string
  /**
   * Workspace-relative path with `/` separators — this is the form the
   * workspace-confined consumers want (e.g. `dsh-data-quality`'s `path`).
   */
  readonly relativePath?: string
  /** Byte count actually written. */
  readonly bytes: number
  /** Lowercase hex sha256 of the written bytes. */
  readonly sha256: string
  /** Which channel performed the write (`fs-service` | `node-fs`). */
  readonly copyMethod: string
  /** Whether the file bytes were inlined in the message rather than saved to a path. */
  readonly sourceInline: boolean
  /** Attachment id, when the bytes were also registered in the host attachment store. */
  readonly attachmentId?: string
  /** Attachment host path, when the host could resolve the registered ref. */
  readonly attachmentHostPath?: string
  /** Whether the restored display name differs from the on-disk leaf name. */
  readonly nameRestored: boolean
  /** The on-disk leaf name the bridge chose. */
  readonly sourceLeafName: string
}

/** The value `ctx.phoneInbox.adopt` returns. */
export type AdoptResult =
  | { readonly ok: true; readonly item: AdoptedItem }
  | { readonly ok: false; readonly reason: string; readonly detail: string }

/**
 * The capability interface a Provider implements: everything the published
 * service does, without the Cordis registration.
 *
 * Providers implement this rather than extending {@link PhoneInboxService}
 * directly, because exactly one object may register the `phoneInbox` name on a
 * context and this plugin ships two interchangeable Providers behind a config
 * value. {@link PhoneInboxService} is that one published service; it delegates.
 */
export interface InboxProvider {
  /** The resolved config this provider was mounted with. */
  readonly config: ResolvedConfig

  /**
   * Record one inbound message for incremental collection.
   * @param session - the session the message belongs to.
   * @param content - the message's `content` field, unvalidated.
   */
  observeMessage(session: Session, content: unknown): void

  /**
   * List this session's most recent inbound attachments.
   * @param session - the calling session.
   * @param options - the requested cap and whether to include the tempdir fallback.
   * @returns a discriminated result; `ok: false` means the capability is
   *   unavailable or nothing could be recovered, never "empty inbox".
   */
  list(session: Session, options: { limit: number; includeTempdir: boolean }): Promise<ListResult>

  /**
   * Copy one inbound attachment into the session workspace, and optionally
   * register its bytes as a durable host attachment.
   * @param session - the calling session (supplies the workspace root).
   * @param request - the source path plus naming/write options.
   * @returns a discriminated result; `ok: false` carries the reason.
   */
  adopt(session: Session, request: AdoptRequest): Promise<AdoptResult>
}

/**
 * The `ctx.phoneInbox` service. Providers implement it; Consumers (the tools
 * and third-party plugins) never re-implement the parsing or the containment
 * checks.
 */
export abstract class PhoneInboxService extends Service {
  /**
   * Register as `phoneInbox` on the context.
   * @param ctx - the plugin context.
   */
  constructor(ctx: Context) {
    super(ctx, 'phoneInbox')
  }

  /** The resolved config the active provider was mounted with. */
  abstract readonly config: ResolvedConfig

  /**
   * Record one inbound message for incremental collection. Called for every
   * `user/message` session event; implementations that read history directly
   * may ignore it.
   * @param session - the session the message belongs to.
   * @param content - the message's `content` field, unvalidated.
   */
  abstract observeMessage(session: Session, content: unknown): void

  /**
   * List this session's most recent inbound attachments.
   * @param session - the calling session.
   * @param options - the requested cap and whether to include the tempdir fallback.
   * @returns a discriminated result; `ok: false` means the capability is
   *   unavailable or nothing could be recovered, never "empty inbox".
   */
  abstract list(session: Session, options: { limit: number; includeTempdir: boolean }): Promise<ListResult>

  /**
   * Copy one inbound attachment into the session workspace, and optionally
   * register its bytes as a durable host attachment.
   * @param session - the calling session (supplies the workspace root).
   * @param request - the source path plus naming/write options.
   * @returns a discriminated result; `ok: false` carries the reason.
   */
  abstract adopt(session: Session, request: AdoptRequest): Promise<AdoptResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The session's inbound phone (WeChat bridge) attachment inbox, when the dsh-phone-inbox bundle is mounted. */
    phoneInbox: PhoneInboxService
  }
}

/** Re-exports so consumers pull the whole seam vocabulary from one module. */
export type { InboundMarker, MarkerKind } from './markers.ts'
export type { AttachmentProbe, InboxCapability, ProbedSession } from './probe.ts'
export type { Config, MarkerConfig, ResolvedConfig, WriteChannel } from './config.ts'
