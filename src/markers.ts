/**
 * Pure marker parsing: turn the bridge's inbound text blocks into structured
 * {@link InboundMarker} records.
 *
 * The bridge (`dsh-wechat`'s inbound adapter) saves inbound media to
 * `~/.dsh-wechat/tempfile/` under a sanitized leaf name and then writes the
 * absolute path into a **plain text block**. There is no structured field to
 * read, so the wording is a soft contract: it can change between bridge
 * releases, which is exactly why the patterns are configurable
 * (`config.markers`) and why nothing here may silently drop a line it failed to
 * match.
 *
 * Everything in this module is pure — no I/O, no clock, no context — so the
 * whole marker contract is unit-testable against literal strings.
 * @module dsh-phone-inbox/markers
 */

import path from 'node:path'
import type { MarkerConfig, MarkerTemplate, ResolvedConfig } from './config.ts'
import { leafNameOf } from './paths.ts'

/** The media kinds the bridge distinguishes in its wording. */
export const MARKER_KINDS = ['image', 'file', 'video'] as const

/** One media kind. */
export type MarkerKind = (typeof MARKER_KINDS)[number]

/**
 * How confident we are that {@link InboundMarker.displayName} is the name the
 * sender actually chose.
 *
 * - `recovered` — the wording carried the original name verbatim
 *   (`[收到文件: <name>]`), so it is the sender's name.
 * - `absent` — the wording never carried an original name (images and videos
 *   are saved as `image.<ext>` / `video.mp4`), so there is nothing to recover.
 *   This is a documented limitation, not a guess.
 * - `unavailable` — the wording *should* have carried a name but this message
 *   did not match the name pattern; the leaf name is used as-is.
 */
export type NameRecovery = 'recovered' | 'absent' | 'unavailable'

/** One inbound attachment as recovered from the session's text blocks. */
export interface InboundMarker {
  /** Media kind as the marker wording declares it. */
  readonly kind: MarkerKind
  /** The host absolute path the bridge wrote. */
  readonly hostPath: string
  /** Leaf name as it exists on disk (already sanitized by the bridge). */
  readonly leafName: string
  /** Best available human-recognizable name; see {@link nameRecovery}. */
  readonly displayName: string
  /** How {@link displayName} was obtained. */
  readonly nameRecovery: NameRecovery
  /** The original name for files whose bytes were inlined into the message (`null` when the bridge saved a path instead). */
  readonly inlinedName: string | null
}

/** A compiled matcher for the configured marker wording. */
export interface MarkerMatcher {
  /** The templates this matcher was compiled from. */
  readonly templates: ResolvedConfig['markers']
  /** Match `text` against every template; returns the markers in template order. */
  match(text: string): InboundMarker[]
}

/** Hard ceiling on a captured path: longer captures are not filesystem paths. */
const MAX_PATH_CHARS = 4096

/** Zero-width-safe path character class: everything a path segment may contain. */
const PATH_CHARS = String.raw`[^\r\n\]]`

/**
 * Compile the marker wording into a matcher.
 * @param markers - the resolved marker templates.
 * @returns the matcher; a template whose `path` pattern is invalid throws here
 *   (the config resolver validates first, so this is a belt-and-braces guard).
 */
export function createMarkerMatcher(markers: ResolvedConfig['markers']): MarkerMatcher {
  const compiled = MARKER_KINDS.map((kind) => {
    const template: MarkerTemplate = markers[kind]
    return {
      kind,
      path: new RegExp(template.path, 'gu'),
      name: template.name === undefined ? null : new RegExp(template.name, 'gu'),
    }
  })

  const firstGroup = (regex: RegExp, text: string): string | null => {
    regex.lastIndex = 0
    const match = regex.exec(text)
    const captured = match?.[1]
    return captured === undefined ? null : captured.trim()
  }

  return {
    templates: markers,
    match(text: string): InboundMarker[] {
      if (typeof text !== 'string' || text === '') return []
      // `文件内容:` distinguishes the bridge's inlined-bytes variant (the bytes
      // are in the text and no path-usable file was saved separately) from the
      // saved-file variant. Computed once per text, not once per match.
      const inlined = /文件内容[:：]/u.test(text)
      // One entry per DISTINCT path: the wording for an image, a video and a bare
      // file is the same string, so all three templates necessarily match the same
      // line, and reporting the same file three times under three kinds would be
      // three lies instead of one fact.
      const byPath = new Map<string, { kind: MarkerKind; recovered: string | null }[]>()
      for (const entry of compiled) {
        const recovered = entry.name === null ? null : firstGroup(entry.name, text)
        entry.path.lastIndex = 0
        for (const match of text.matchAll(entry.path)) {
          // The path is the first capturing group. A template may add further
          // groups for its own purposes, but only the first is the path.
          const raw = match[1]?.trim()
          if (raw === undefined || raw === '' || raw.length > MAX_PATH_CHARS) continue
          // A "path" that starts with a JSON shape is a structured payload that
          // happens to contain the wording, not a saved-file line. Skip it
          // rather than reporting a path that cannot exist.
          if (/^[[{]/u.test(raw)) continue
          const hostPath = normalizeCaptured(raw)
          // The bridge always writes an absolute path; anything else is prose
          // that merely resembles the wording. The check is separator-led rather
          // than `path.isAbsolute`, because a POSIX absolute path must still be
          // recognized on a Windows host (and vice versa).
          if (hostPath === '' || !isAbsolutePath(hostPath)) continue
          const candidates = byPath.get(hostPath) ?? []
          candidates.push({ kind: entry.kind, recovered })
          byPath.set(hostPath, candidates)
        }
      }
      const found: InboundMarker[] = []
      for (const [hostPath, candidates] of byPath) {
        // A recovered original name is evidence of the kind: only the plain-file
        // wording carries `[收到文件: …]`. When exactly one candidate has that
        // evidence, it is the kind; otherwise the ambiguity is real and the
        // generic `file` kind is reported rather than a guess.
        const named = candidates.filter((candidate) => candidate.recovered !== null)
        const chosen = named.length === 1 ? named[0] : undefined
        const kind = chosen?.kind ?? (candidates.some((candidate) => candidate.kind === 'file') ? 'file' : candidates[0]?.kind ?? 'file')
        const recovered = chosen?.recovered ?? null
        found.push(build(kind, hostPath, recovered, inlined ? recovered : null))
      }
      // Deterministic order: by first appearance in the text is not recoverable
      // from a Map keyed by path, so order by path. Callers that need newest-first
      // ordering sort by mtime anyway.
      return found.sort((left, right) => (left.hostPath < right.hostPath ? -1 : left.hostPath > right.hostPath ? 1 : 0))
    },
  }
}

/**
 * Normalize a captured path: trim surrounding whitespace, trim a single layer
 * of quoting, strip trailing separators and trailing end-of-sentence
 * punctuation, then collapse separator and `.`/`..` noise **without changing
 * the separator convention**.
 *
 * ⚠️ Why not `path.normalize`: it is platform-specific, so it folds the *other*
 * convention to this host's. On POSIX it rewrites `C:\Users\...\x.csv` to
 * `C:/Users/.../x.csv`; on Windows it rewrites `/home/u/x.csv` to
 * `\home\u\x.csv`. Either way `hostPath` would stop being the path the bridge
 * actually wrote — and accepting a path written in the other convention is the
 * whole point of the contract below (a Windows host must read a POSIX path and
 * vice versa). The folding here is therefore hand-rolled and
 * separator-preserving. Caught by CI on Linux, where a Windows-shaped fixture
 * came back rewritten and the marker no longer matched.
 * @param raw - the first capturing group of the path wording.
 * @returns the normalized path (empty when nothing usable remains).
 */
export function normalizeCaptured(raw: string): string {
  let value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim()
  }
  // Trailing end-of-sentence punctuation is never part of a path the bridge
  // wrote; a trailing separator is not either (the captured value is a file).
  value = value.replace(/[.,;:。，、;!?！？)\]}>]+$/u, '').replace(/[\\/]+$/u, '')
  if (value === '') return ''
  return collapsePath(value)
}

/**
 * Collapse repeated separators and `.`/`..` segments while preserving whichever
 * separator the input used. Mixed input keeps each segment's own separator, so a
 * path is never rewritten into a convention its author did not use.
 * @param value - a non-empty captured path.
 * @returns the collapsed path.
 */
function collapsePath(value: string): string {
  const isSeparator = (char: string): boolean => char === '/' || char === '\\'
  // Preserve a leading separator run verbatim: POSIX root `/`, or a UNC `\\host`
  // prefix. Rewriting it would change which root the path names.
  let leading = ''
  let rest = value
  while (rest !== '' && isSeparator(rest.charAt(0))) {
    leading += rest.charAt(0)
    rest = rest.slice(1)
  }
  const segments: string[] = []
  for (const segment of rest.split(/[\\/]+/u)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  // Join with the convention the path itself used. The separator to use is read
  // from the ORIGINAL value, not from the remainder: a segment can itself begin
  // with the separator, so `split` on the remainder loses it (`C:\a\.b` splits to
  // `['C:', 'a', '.b']` and the backslash is gone).
  const separator = leading !== '' ? leading.charAt(0) : (value.match(/[\\/]/u)?.[0] ?? '/')
  const prefix = leading !== '' ? leading : ''
  if (segments.length === 0) return prefix
  return prefix + segments.join(separator)
}

/**
 * Whether a captured value is an absolute path in *either* separator
 * convention. `path.isAbsolute` is platform-specific, but the marker text is
 * not: a Windows host can read a message that carries a POSIX path, and a POSIX
 * host can read a Windows one, so the contract must accept both.
 *
 * ⚠️ The drive form must be recognized **without** `path.isAbsolute`. On POSIX
 * that function returns `false` for `C:\Users\…`, so a Windows path captured on a
 * Linux host was rejected here and every marker on that line was dropped — the
 * exact failure CI reported (`expected [] to have a length of 1`). A Windows path
 * in a message is a Windows path regardless of which OS is reading it.
 * @param value - the normalized candidate.
 * @returns `true` for a separator-led or drive-led path.
 */
export function isAbsolutePath(value: string): boolean {
  if (value.startsWith('/') || value.startsWith('\\')) return true
  // Drive form (`C:\…` or `C:/…`), valid on every host.
  if (/^[A-Za-z]:[\\/]/u.test(value)) return true
  return path.isAbsolute(value)
}

/**
 * Build one marker record from a captured path and an optional recovered name.
 * @param kind - the media kind.
 * @param hostPath - the normalized host path.
 * @param recoveredName - the original name the wording carried, when it did.
 * @param inlinedName - set when the message inlined the file bytes instead of only a path.
 * @returns the marker record.
 */
function build(kind: MarkerKind, hostPath: string, recoveredName: string | null, inlinedName: string | null): InboundMarker {
  const leafName = leafNameOf(hostPath)
  const cleaned = recoveredName === null ? '' : displayNameFrom(recoveredName)
  if (cleaned !== '') {
    return { kind, hostPath, leafName, displayName: cleaned, nameRecovery: 'recovered', inlinedName }
  }
  return {
    kind,
    hostPath,
    leafName,
    displayName: leafName,
    nameRecovery: recoveredName === null ? 'absent' : 'unavailable',
    inlinedName,
  }
}

/**
 * Turn a recovered original name into a safe *display* name: separators and
 * control characters become `_`. This value is for the model and the user to
 * read, and it is also the default adopted file name, so it must never be able
 * to escape a directory.
 * @param raw - the name the marker wording carried.
 * @returns the sanitized display name (empty when nothing usable remains).
 */
export function displayNameFrom(raw: string): string {
  const withoutControl = [...raw].map((char) => (char.codePointAt(0) ?? 0) < 0x20 ? '_' : char).join('')
  const cleaned = withoutControl.replace(/[\\/]+/gu, '_').replace(/^\.+$/u, '').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return ''
  return cleaned.slice(0, 200)
}

/**
 * Read the text of the content parts of a projected message. Handles both
 * shapes the session projection can produce (a plain string, or a list of
 * parts) and ignores every non-text part — an image part carries no path.
 *
 * Exported so the host-version drift this guards against is unit-testable.
 * @param content - `message.content` from `Session.deriveMessages()`.
 * @returns the text parts, in order.
 */
export function textPartsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (typeof part !== 'object' || part === null) continue
    const record = part as Record<string, unknown>
    if (record.type !== 'text' && record.type !== 'input_text') continue
    if (typeof record.text === 'string') parts.push(record.text)
  }
  return parts
}

/**
 * Collect inbound markers from one message's content parts, dropping duplicate
 * paths (the bridge can mention the same saved file twice in one block).
 * @param matcher - the compiled marker matcher.
 * @param content - `message.content` from `Session.deriveMessages()`.
 * @returns the markers found, in part order.
 */
export function markersOfContent(matcher: MarkerMatcher, content: unknown): InboundMarker[] {
  const found: InboundMarker[] = []
  const seen = new Set<string>()
  for (const text of textPartsOf(content)) {
    for (const marker of matcher.match(text)) {
      if (seen.has(marker.hostPath)) continue
      seen.add(marker.hostPath)
      found.push(marker)
    }
  }
  return found
}

/**
 * Whether the configured marker contract matches anything at all in a sample
 * of session text. Used by the capability probe to distinguish "the contract is
 * live" from "no attachment ever arrived".
 * @param matcher - the compiled marker matcher.
 * @param sample - one or more message texts.
 * @returns `true` when at least one marker matched.
 */
export function matchedAny(matcher: MarkerMatcher, sample: readonly string[]): boolean {
  return sample.some((text) => matcher.match(text).length > 0)
}

/** Re-exported for callers that only need the template type. */
export type { MarkerConfig, MarkerTemplate }

/** Re-exported so Consumers can build a matcher without importing the config module. */
export { DEFAULT_MARKERS } from './config.ts'
