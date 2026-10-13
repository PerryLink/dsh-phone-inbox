/**
 * Tool-facing presentation. Pure functions from a canonical tool value to the
 * text the model reads — no context, no I/O.
 *
 * Two presentation rules this module exists to enforce:
 *
 * 1. **A failure is never rendered as an empty success.** Every `ok: false`
 *    render begins with the reason code and ends with what to do instead.
 * 2. **A listed path is always accompanied by the correct consumption hint.**
 *    Most checker plugins accept an absolute path anywhere on the machine, but
 *    the workspace-confined ones (`dsh-data-quality`'s `path-escape`) do not, so
 *    each item says which form to use.
 * @module dsh-phone-inbox/render
 */

import type { AdoptResult, AdoptedItem, InboxItem, ListResult } from './service.ts'

/** The value shape `inbox_list`'s output schema declares. */
export interface ListToolValue {
  readonly ok: boolean
  readonly source?: string
  readonly inboxDir?: string
  /** Mutable array: the host's output schema is a mutable `items`, so the canonical value must be one too. */
  readonly items?: InboxItem[]
  readonly attachments?: { readonly service: boolean; readonly fileHostPath: boolean; readonly imageHostPath: boolean }
  readonly deriveMessages?: boolean
  readonly emptyReason?: string
  readonly emptyDetail?: string
  readonly tempdirScan?: boolean
  readonly unresolvedAttachmentBlocks?: number
  readonly reason?: string
  readonly detail?: string
}

/** The value shape `inbox_adopt`'s output schema declares. */
export interface AdoptToolValue {
  readonly ok: boolean
  readonly item?: AdoptedItem
  readonly reason?: string
  readonly detail?: string
}

/** Human-readable byte count. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** One line describing an item's name recovery, so a `_`-mangled name is explained rather than hidden. */
function nameNote(item: InboxItem): string {
  if (item.nameRecovery === 'recovered') {
    return item.displayName === item.name ? '' : ` (on disk as ${item.name}; the bridge replaces non-ASCII characters)`
  }
  if (item.nameRecovery === 'absent') {
    return ` (the bridge does not carry an original name for ${item.kind} attachments, so this is the name it saved under)`
  }
  return ' (the original name could not be recovered from the message text)'
}

/**
 * Render one `inbox_list` result.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
export function renderList(value: ListToolValue): string {
  if (value.ok !== true) {
    return [
      `phone-inbox could not list this session's inbound attachments.`,
      `reason: ${value.reason ?? 'unknown'}`,
      value.detail ?? '',
    ].filter((line) => line !== '').join('\n')
  }
  const items = value.items ?? []
  const lines: string[] = []
  if (items.length === 0) {
    lines.push(`No inbound phone attachments to show for this session (source: ${value.source ?? 'session'}, reason: ${value.emptyReason ?? 'empty'}).`)
    if (value.emptyDetail !== undefined) lines.push(value.emptyDetail)
  } else {
    lines.push(`${items.length} inbound phone attachment(s), newest first (source: ${value.source ?? 'session'}).`)
    for (const item of items) {
      const where = item.inWorkspace ? 'inside the workspace' : 'outside the workspace'
      const facts = [formatBytes(item.bytes), where, `source: ${item.source}`].join(', ')
      lines.push(`- [${item.kind}] ${item.displayName}${nameNote(item)}`)
      lines.push(`  path: ${item.path}`)
      lines.push(`  ${facts}`)
    }
    lines.push('')
    lines.push('Consumption: checkers that take an absolute `file` path (the compliance-checker family) can read these paths directly. Workspace-confined tools (for example dsh-data-quality, which rejects any path that escapes the session workspace) cannot — call inbox_adopt first and pass the `relativePath` it returns.')
  }
  const attachments = value.attachments
  if (attachments !== undefined) {
    lines.push(`Host attachment-path resolution: ${attachments.service ? (attachments.fileHostPath ? 'available' : 'service present but fileHostPath is missing') : 'unavailable on this host build'}.`)
  }
  if ((value.unresolvedAttachmentBlocks ?? 0) > 0) {
    lines.push(`${value.unresolvedAttachmentBlocks} structured attachment block(s) in this session could not be resolved to a path on this host build, so this list is incomplete. Do not read this as "no such attachment".`)
  }
  if (value.tempdirScan === true) lines.push('Some entries came from a directory scan, not from this session\'s own messages — their attribution to this conversation is not proven.')
  return lines.join('\n')
}

/**
 * Render one `inbox_adopt` result.
 * @param value - the canonical tool value.
 * @returns the model-facing text.
 */
export function renderAdopt(value: AdoptToolValue): string {
  if (value.ok !== true || value.item === undefined) {
    return [
      'phone-inbox could not adopt that attachment.',
      `reason: ${value.reason ?? 'unknown'}`,
      value.detail ?? '',
    ].filter((line) => line !== '').join('\n')
  }
  const item = value.item
  const lines = [`Adopted ${item.sourceLeafName} into the workspace.`]
  lines.push(`host path: ${item.hostPath}`)
  if (item.workspacePath !== undefined) lines.push(`workspace path: ${item.workspacePath}`)
  if (item.relativePath !== undefined) lines.push(`workspace-relative path: ${item.relativePath}`)
  lines.push(`bytes: ${item.bytes}, sha256: ${item.sha256}, written via: ${item.copyMethod}`)
  if (item.nameRestored) lines.push(`file name: restored the sender's original name (the bridge had saved it as ${item.sourceLeafName})`)
  if (item.attachmentId !== undefined) lines.push(`attachment id: ${item.attachmentId}`)
  if (item.attachmentHostPath !== undefined) lines.push(`attachment host path (read-only copy): ${item.attachmentHostPath}`)
  if (item.relativePath !== undefined) {
    lines.push(`Pass \`${item.relativePath}\` to workspace-confined consumers (for example data_profile).`)
  }
  return lines.join('\n')
}

/** Narrow a service {@link ListResult} to the tool value. */
export function listValue(result: ListResult): ListToolValue {
  if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail }
  return { ...result, ok: true, items: [...result.items] }
}

/** Narrow a service {@link AdoptResult} to the tool value. */
export function adoptValue(result: AdoptResult): AdoptToolValue {
  return result.ok ? { ok: true, item: result.item } : { ok: false, reason: result.reason, detail: result.detail }
}
