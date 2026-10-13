/**
 * Structured attachment blocks.
 *
 * A user message can carry two shapes that name a saved file:
 *
 * 1. a **text block** with the bridge's marker wording (what `dsh-wechat`
 *    writes today), and
 * 2. a **structured block** — `{ type: 'file', attachment: FileAttachmentRef }`
 *    or `{ type: 'image', attachment: ImageAttachmentRef }` — which
 *    `ctx.attachments.fileHostPath()` / `imageHostPath()` turns into a host path.
 *
 * Shape 2 is the host's own vocabulary and therefore the more durable contract:
 * a message that carries a structured reference keeps working after the bridge's
 * wording changes. It needs the optional `dsh-attachment` service, so it can be
 * absent — and the plugin must say so rather than quietly dropping those blocks,
 * which is exactly the difference between "no attachments" and "attachments I
 * could not resolve".
 *
 * Everything here is pure: the host-path lookup is injected as a function, so
 * both the resolution logic and its absence are unit-testable without a host.
 * @module dsh-phone-inbox/blocks
 */

import type { MarkerKind, NameRecovery } from './markers.ts'

/** A structured attachment block recovered from a message. */
export interface AttachmentBlock {
  /** Media kind the block declares. */
  readonly kind: MarkerKind
  /** The host path, or `undefined` when the host could not resolve the ref. */
  readonly hostPath: string | undefined
  /** The leaf name the block carries, when it carries one. */
  readonly name: string | undefined
  /** How confident the recovered name is. */
  readonly nameRecovery: NameRecovery
  /** The block's declared byte length, when it declares one. */
  readonly bytes: number | undefined
}

/**
 * Where a structured block's host path comes from: the host's attachment
 * service, resolved by the Provider. Returns `undefined` when this host cannot
 * map the reference to a path (no service, no method, or a non-local backend).
 */
export type HostPathLookup = (kind: MarkerKind, ref: unknown) => string | undefined

/** What one message's blocks yielded. */
export interface BlockScan {
  /** The structured attachment blocks, in block order. */
  readonly blocks: readonly AttachmentBlock[]
  /**
   * How many structured attachment blocks were present but could not be
   * resolved to a host path. Non-zero means "this inbox is incomplete for a
   * stated reason", never "this inbox is empty".
   */
  readonly unresolved: number
}

/** An empty scan. */
export const EMPTY_BLOCK_SCAN: BlockScan = Object.freeze({ blocks: Object.freeze([]), unresolved: 0 }) as BlockScan

/** Read a non-empty string field off an unknown record. */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Read a finite non-negative number field off an unknown record. */
function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Scan one message's `content` for structured attachment blocks.
 *
 * Unknown block types are ignored on purpose: this function's job is to find the
 * two shapes that name a saved file, and a new block type is not this plugin's
 * business.
 * @param content - `message.content` from `Session.deriveMessages()`.
 * @param lookup - the host-path resolver for an attachment ref.
 * @returns the scan; {@link BlockScan.unresolved} counts what could not resolve.
 */
export function scanAttachmentBlocks(content: unknown, lookup: HostPathLookup): BlockScan {
  if (!Array.isArray(content)) return EMPTY_BLOCK_SCAN
  const blocks: AttachmentBlock[] = []
  let unresolved = 0
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const record = part as Record<string, unknown>
    const type = record.type
    if (type !== 'file' && type !== 'image') continue
    const kind: MarkerKind = type === 'file' ? 'file' : 'image'
    const attachment = record.attachment
    if (typeof attachment !== 'object' || attachment === null) continue
    const ref = attachment as Record<string, unknown>
    const declaredName = stringField(ref, 'name')
    const hostPath = lookup(kind, ref)
    if (hostPath === undefined) {
      unresolved += 1
      continue
    }
    blocks.push({
      kind,
      hostPath,
      name: declaredName,
      nameRecovery: declaredName === undefined ? 'absent' : 'recovered',
      bytes: numberField(ref, 'bytes'),
    })
  }
  return { blocks, unresolved }
}
