/**
 * Containment self-checks for `dsh-phone-inbox`.
 *
 * Both directions of this plugin's data flow cross a trust boundary:
 *
 * - **in** — a source path arrives from the *model* (a tool argument), and the
 *   model may have invented it. It must be proven to live under the bridge's
 *   inbox directory before the plugin reads it.
 * - **out** — a destination path is built from a tool argument plus a file
 *   name. It must be proven to live under the session workspace before the
 *   plugin writes it.
 *
 * Every comparison resolves first, because on Windows a lexical prefix check on
 * the raw strings is wrong (`C:/a` vs `C:\a`, and short names). Windows path
 * comparison is case-insensitive; POSIX is not.
 * @module dsh-phone-inbox/paths
 */

import path from 'node:path'

/** A containment verdict plus the two resolved paths it compared. */
export interface Containment {
  /** Whether {@link target} resolves to {@link root} itself or below it. */
  readonly inside: boolean
  /** The resolved target. */
  readonly target: string
  /** The resolved root. */
  readonly root: string
}

/** Whether path comparison is case-insensitive on this platform. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * The final segment of a path in **either** separator convention.
 *
 * `path.basename` is platform-specific, and a path's origin is not: a Windows
 * host can be handed a POSIX path in a message and vice versa, and a Windows form
 * must not survive as one long file name containing separators just because this
 * process is not Windows.
 * @param value - the path.
 * @returns the last segment (the whole value when it has no separator).
 */
export function leafNameOf(value: string): string {
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return index === -1 ? value : value.slice(index + 1)
}

/**
 * Whether `target` resolves to `root` itself or to a path below it.
 *
 * Containment is decided on resolved paths and with a separator-aware prefix
 * comparison: `C:\ws\nope` must not be judged inside `C:\ws\n`, and `C:\ws2`
 * must not be judged inside `C:\ws`.
 * @param root - the containing directory.
 * @param target - the candidate path.
 * @returns the verdict and the two resolved paths.
 */
export function contains(root: string, target: string): Containment {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const normalize = (value: string): string => (CASE_INSENSITIVE ? value.toLowerCase() : value)
  const a = normalize(resolvedRoot)
  const b = normalize(resolvedTarget)
  const inside = b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep)
  return { inside, target: resolvedTarget, root: resolvedRoot }
}

/**
 * Join a relative directory under a root, refusing an escape. Used for the
 * `subdir` tool argument, which the model also controls.
 * @param root - the containing directory (the session workspace).
 * @param relative - the caller-supplied relative directory.
 * @returns the resolved absolute directory.
 * @throws when the joined path escapes `root`.
 */
export function containedJoin(root: string, relative: string): string {
  const joined = path.resolve(root, relative)
  const check = contains(root, joined)
  if (!check.inside) {
    throw new Error(`subdir ${JSON.stringify(relative)} resolves outside the workspace root ${JSON.stringify(check.root)}`)
  }
  return joined
}

/** Result of {@link safeBasename}. */
export interface SafeName {
  /** The usable file name (`''` when nothing survived sanitization). */
  readonly name: string
  /** Whether sanitization changed the input. */
  readonly changed: boolean
}

/**
 * Reduce a candidate file name to a single safe path segment: drop every
 * directory component, replace separators and control characters with `_`,
 * neutralize `.` / `..`, strip characters Windows forbids in a file name, and
 * cap the length.
 *
 * A file name is *always* attacker-adjacent input here (it can come from the
 * sender's own file name, via the marker text), so this never returns a value
 * that could traverse or that a filesystem would reject silently.
 * @param raw - the candidate name.
 * @param fallback - used when nothing usable survives; must itself be safe.
 * @returns the safe name and whether it differs from the input.
 */
export function safeBasename(raw: string, fallback: string): SafeName {
  const original = typeof raw === 'string' ? raw : ''
  // Split on both separator conventions rather than using `path.basename`: this
  // process's platform is not the platform the name came from, and a Windows form
  // on a POSIX host would otherwise survive as one long "file name" containing
  // separators.
  const base = leafNameOf(original)
  const cleaned = [...base]
    .map((char) => (char.codePointAt(0) ?? 0) < 0x20 ? '_' : char)
    .join('')
    // Windows forbids these outright; POSIX allows them but they make a name
    // unshareable, so they go on every platform.
    .replace(/[<>:"|?*]/gu, '_')
    .replace(/^\.+$/u, '')
    .replace(/^[.\s]+/u, '')
    .replace(/[.\s]+$/u, '')
    .trim()
  const name = cleaned.slice(0, 180)
  if (name === '' || name === '.' || name === '..') return { name: fallback, changed: true }
  return { name, changed: name !== original }
}

/**
 * Whether `candidate` is one of the bridge's own sanitized leaf names —
 * `<13-digit epoch ms>-<8 hex chars>-<sanitized original name>`, as produced by
 * `dsh-wechat`'s `saveToTemp`.
 *
 * Only names of this shape may be offered as a tempdir-scan fallback, so the
 * fallback cannot surface a file some *other* process happened to drop in the
 * inbox directory.
 * @param candidate - the leaf name to test.
 * @returns the parsed parts, or `null` when the name does not have the shape.
 */
export function parseBridgeLeaf(candidate: string): { stamp: number; rand: string; name: string } | null {
  const match = /^(\d{13})-([0-9a-f]{8})-(.+)$/u.exec(candidate)
  if (match === null) return null
  const stamp = Number(match[1])
  if (!Number.isSafeInteger(stamp)) return null
  return { stamp, rand: match[2] ?? '', name: match[3] ?? '' }
}
