/**
 * Config schema and resolution for `dsh-phone-inbox`. Every tunable is a
 * validated {@link Config} field changeable from `cordis.patch.yml`, and
 * {@link resolveConfig} supplies the defaults explicitly so no run path hides
 * a `?? default`.
 * @module dsh-phone-inbox/config
 */

import z from '@deepseek-ai/schemastery'

/** One inbound-marker template family: how the bridge words one media kind. */
export interface MarkerTemplate {
  /**
   * `RegExp` source (flags are always `u` + `g`) whose **first capture group**
   * is the absolute path the bridge saved the media to.
   */
  path: string
  /**
   * `RegExp` source (flags are always `u` + `g`) whose **first capture group**
   * is the original file name as the sender wrote it, when the bridge wording
   * carries one. Omitted for kinds whose wording drops the original name.
   */
  name?: string
}

/**
 * The marker contract. Marker texts are a **soft contract** with the bridge —
 * it writes the saved path into a plain text block, and its wording can change
 * between bridge releases without notice. These are configurable precisely so a
 * wording change is a config edit rather than a plugin release.
 *
 * Defaults are the wordings observed in `dsh-wechat`'s inbound adapter
 * (`src/adapter/inbound.ts`, `saveToTemp` + `weixinMessageToPrompt`): every
 * path is emitted as `文件已保存到: <absolute path>`; the plain-file kind
 * additionally emits `[收到文件: <original name>]`, and the text-file variant
 * uses `文件路径: <absolute path>` instead.
 */
export interface MarkerConfig {
  image?: MarkerTemplate
  file?: MarkerTemplate
  video?: MarkerTemplate
}

/** How `inbox_adopt` writes the file into the workspace. */
export type WriteChannel = 'fs' | 'node' | 'auto'

/** Raw plugin config — every field optional; {@link resolveConfig} fills the defaults. */
export interface Config {
  /** Master switch; `false` mounts nothing. */
  enabled?: boolean
  /** Directory the bridge drops inbound media into. Defaults to `~/.dsh-wechat/tempfile`. */
  inboxDir?: string
  /**
   * Cap on entries `inbox_list` returns. The MVP contract is "the session's
   * most recent few attachments", so the default is deliberately small.
   */
  maxItems?: number
  /** Which provider `ProviderRegistry` resolves: `session` (default) or `tempdir`. */
  provider?: string
  /**
   * Fallback provider: additionally scan `inboxDir` for files that no session
   * marker claims. **Default off** — that directory is global and shared by
   * every WeChat sender and every session, so scanning it leaks other people's
   * attachments into this session's view.
   */
  allowTempdirScan?: boolean
  /** How many entries a tempdir scan may contribute. */
  tempdirScanMaxItems?: number
  /** Age ceiling (ms) for a tempdir scan; `0` disables the filter. */
  tempdirScanMaxAgeMs?: number
  /** Marker wording per media kind. */
  markers?: MarkerConfig
  /** Subdirectory of the session workspace `inbox_adopt` writes into. */
  defaultSubdir?: string
  /**
   * Restore the sender's original file name (recovered from the marker text)
   * as the adopted file name. Default on: the bridge's on-disk leaf name has
   * every non-ASCII character replaced by `_`, so a Chinese file name is
   * otherwise unreadable.
   */
  restoreOriginalName?: boolean
  /** Write channel `inbox_adopt` prefers. */
  writeChannel?: WriteChannel
  /** Also register the adopted bytes as a durable host attachment. */
  registerAttachment?: boolean
}

/** Fully resolved config handed to the runtime. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly inboxDir: string
  readonly maxItems: number
  readonly provider: string
  readonly allowTempdirScan: boolean
  readonly tempdirScanMaxItems: number
  readonly tempdirScanMaxAgeMs: number
  readonly markers: Required<MarkerConfig>
  readonly defaultSubdir: string
  readonly restoreOriginalName: boolean
  readonly writeChannel: WriteChannel
  readonly registerAttachment: boolean
}

/**
 * Bridge wordings observed in `dsh-wechat`'s inbound adapter. Kept as the
 * shipped defaults so a fresh install works with no config; a bridge wording
 * change is a one-line override here.
 *
 * The path capture is `(\S+)`: the bridge writes the path as one whitespace-free
 * token right after the colon, so this stops exactly at the end of the path — no
 * greedy `(.+)` swallowing the 你可以… sentence (and then the next message), and
 * no lazy `(.+?)` truncating the match before the separator. The consequence,
 * stated rather than hidden: a path containing a literal space cannot be
 * captured by the default wording. The bridge's own temp names never contain
 * one (`${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}`), so this is
 * a documented limit of the wording contract, not a silent truncation.
 */
export const DEFAULT_MARKERS: Required<MarkerConfig> = Object.freeze({
  image: Object.freeze({ path: String.raw`文件已保存到:\s*(\S+)` }),
  file: Object.freeze({ path: String.raw`(?:文件已保存到|文件路径):\s*(\S+)`, name: String.raw`\[收到文件:\s*([^\]\r\n]+)\]` }),
  video: Object.freeze({ path: String.raw`文件已保存到:\s*(\S+)` }),
})

/** The permitted `writeChannel` values, in the order the README documents them. */
export const WRITE_CHANNELS: readonly WriteChannel[] = Object.freeze(['fs', 'node', 'auto'])

/** Throw unless `value` is a plain object (not an array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one marker template at mount time. A malformed pattern must fail
 * loud here rather than silently matching nothing at run time.
 * @param kind - the media kind, for the error message.
 * @param template - the raw template.
 * @returns the template with validated sources.
 */
function checkTemplate(kind: string, template: MarkerTemplate): MarkerTemplate {
  for (const field of ['path', 'name'] as const) {
    const source = template[field]
    if (source === undefined) continue
    if (typeof source !== 'string' || source.trim() === '') {
      throw new Error(`phone-inbox: markers.${kind}.${field} must be a non-empty RegExp source`)
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(source, 'gu')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`phone-inbox: markers.${kind}.${field} is not a valid RegExp source (${detail})`)
    }
  }
  if (template.path === undefined) throw new Error(`phone-inbox: markers.${kind}.path is required`)
  return template
}

/**
 * Apply defaults, validate bounds, and freeze the result. Misconfiguration
 * fails loud at mount — a bad `inboxDir` or a malformed marker pattern must not
 * turn into a silently empty inbox.
 * @param config - the raw plugin config as loaded from cordis.
 * @returns the resolved config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const maxItems = config.maxItems ?? 5
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) {
    throw new Error(`phone-inbox: maxItems must be a positive integer, got ${String(config.maxItems)}`)
  }
  const tempdirScanMaxItems = config.tempdirScanMaxItems ?? 5
  if (!Number.isSafeInteger(tempdirScanMaxItems) || tempdirScanMaxItems < 0) {
    throw new Error(`phone-inbox: tempdirScanMaxItems must be a non-negative integer, got ${String(config.tempdirScanMaxItems)}`)
  }
  const tempdirScanMaxAgeMs = config.tempdirScanMaxAgeMs ?? 3_600_000
  if (!Number.isSafeInteger(tempdirScanMaxAgeMs) || tempdirScanMaxAgeMs < 0) {
    throw new Error(`phone-inbox: tempdirScanMaxAgeMs must be a non-negative integer, got ${String(config.tempdirScanMaxAgeMs)}`)
  }
  const subdir = config.defaultSubdir ?? 'phone-inbox'
  if (typeof subdir !== 'string') throw new Error('phone-inbox: defaultSubdir must be a string')
  const writeChannel = config.writeChannel ?? 'auto'
  if (!WRITE_CHANNELS.includes(writeChannel)) {
    throw new Error(`phone-inbox: writeChannel must be one of ${WRITE_CHANNELS.join(' | ')}, got ${String(writeChannel)}`)
  }
  const provider = config.provider ?? 'session'
  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new Error('phone-inbox: provider must be a non-empty string')
  }
  const inboxDir = config.inboxDir ?? ''
  if (typeof inboxDir !== 'string') throw new Error('phone-inbox: inboxDir must be a string')

  const rawMarkers = isRecord(config.markers) ? config.markers : {}
  const templateOf = (kind: 'image' | 'file' | 'video'): MarkerTemplate => {
    const raw = rawMarkers[kind]
    return isRecord(raw) ? (raw as unknown as MarkerTemplate) : DEFAULT_MARKERS[kind]
  }
  const markers: Required<MarkerConfig> = {
    image: checkTemplate('image', templateOf('image')),
    file: checkTemplate('file', templateOf('file')),
    video: checkTemplate('video', templateOf('video')),
  }

  return Object.freeze({
    enabled: config.enabled ?? true,
    inboxDir,
    maxItems,
    provider,
    allowTempdirScan: config.allowTempdirScan ?? false,
    tempdirScanMaxItems,
    tempdirScanMaxAgeMs,
    markers: Object.freeze(markers),
    defaultSubdir: subdir,
    restoreOriginalName: config.restoreOriginalName ?? true,
    writeChannel,
    registerAttachment: config.registerAttachment ?? false,
  })
}

/** Schemastery schema: the loader validates and fills defaults before `apply`. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  inboxDir: z.string().default(''),
  maxItems: z.number().default(5),
  provider: z.string().default('session'),
  allowTempdirScan: z.boolean().default(false),
  tempdirScanMaxItems: z.number().default(5),
  tempdirScanMaxAgeMs: z.number().default(3_600_000),
  markers: z
    .object({
      image: z.object({ path: z.string(), name: z.string() }).default(DEFAULT_MARKERS.image),
      file: z.object({ path: z.string(), name: z.string() }).default(DEFAULT_MARKERS.file),
      video: z.object({ path: z.string(), name: z.string() }).default(DEFAULT_MARKERS.video),
    })
    .default(DEFAULT_MARKERS),
  defaultSubdir: z.string().default('phone-inbox'),
  restoreOriginalName: z.boolean().default(true),
  writeChannel: z.union(WRITE_CHANNELS).default('auto'),
  registerAttachment: z.boolean().default(false),
})
