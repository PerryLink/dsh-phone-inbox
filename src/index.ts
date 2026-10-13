/**
 * `dsh-phone-inbox` — the session's inbound phone (WeChat bridge) attachment
 * inbox.
 *
 * The bridge saves inbound media to `~/.dsh-wechat/tempfile/` — **outside the
 * session workspace** — under a leaf name whose non-ASCII characters have been
 * replaced by `_`, and then writes the absolute path into a plain text block.
 * Neither fact is visible to a workspace-confined tool, and the second one is not
 * visible to the user either.
 *
 * This plugin closes exactly that gap:
 *
 * | Tool | Question it answers |
 * |---|---|
 * | `inbox_list` | "Where is the file I just sent you from my phone?" |
 * | `inbox_adopt` | "Put it somewhere my workspace-confined tools can read it." |
 *
 * It adds **no new channel and copies nothing by default**: the bridge already
 * handed the path over in the message text, and the host already has the durable,
 * content-addressed attachment store, so the plugin's whole job is to make the
 * session's own inbound list addressable and to restore the name the bridge
 * mangled.
 *
 * Three roles, one seam:
 *
 * | Role | Where |
 * |---|---|
 * | Service Definition | `service.ts` — `PhoneInboxService`, `ListResult`, `AdoptResult` |
 * | Service Provider | `provider-base.ts` (shared pipeline), `provider-session.ts` (default), `provider-tempdir.ts` (opt-in fallback) |
 * | Consumer | `tools/list.ts`, `tools/adopt.ts` |
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`, and a stray default would discard
 * `name`/`inject`/`Config`/`apply`).
 * @module dsh-phone-inbox
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { resolveConfig, type Config as PhoneInboxConfig } from './config.ts'
import { registerProviders, resolveInboxDir } from './providers.ts'
import type { InboxProvider } from './service.ts'
import { SYSTEM_PROMPT_SECTION, systemPromptText } from './prompt.ts'
import { defineAdoptTool } from './tools/adopt.ts'
import { defineListTool } from './tools/list.ts'
import { VERSION } from './version.ts'

export const name = 'phone-inbox'

/** The one hard service dependency: the tools registry this plugin registers into. */
export const inject = ['tools']

export { Config, resolveConfig } from './config.ts'
export type {
  Config as ConfigShape,
  MarkerConfig,
  MarkerTemplate,
  ResolvedConfig,
  WriteChannel,
} from './config.ts'
export { VERSION } from './version.ts'
export { DEFAULT_INBOX_DIR, PROVIDER_NAMES, providerNames, registerProviders, resolveInboxDir, type RegisteredProviders } from './providers.ts'
export {
  PhoneInboxService,
  LIST_REASONS,
  ADOPT_REASONS,
  type AdoptReason,
  type AdoptRequest,
  type AdoptResult,
  type AdoptedItem,
  type InboxItem,
  type ListReason,
  type ListResult,
} from './service.ts'
export { LocalPhoneInboxService } from './service-local.ts'
export { BasePhoneInboxService, MAX_ADOPT_BYTES, TEXT_EXTENSIONS, isTextName, toRelative, workspaceOf } from './provider-base.ts'
export { SessionPhoneInboxService } from './provider-session.ts'
export { TempdirPhoneInboxService } from './provider-tempdir.ts'
export { ProviderRegistry, type Disposer, type ProviderEntry } from './seam.ts'
export { EMPTY_BLOCK_SCAN, scanAttachmentBlocks, type AttachmentBlock, type BlockScan, type HostPathLookup } from './blocks.ts'
export {
  DEFAULT_MARKERS,
  MARKER_KINDS,
  createMarkerMatcher,
  displayNameFrom,
  markersOfContent,
  matchedAny,
  normalizeCaptured,
  textPartsOf,
  type InboundMarker,
  type MarkerKind,
  type MarkerMatcher,
  type NameRecovery,
} from './markers.ts'
export { contains, containedJoin, parseBridgeLeaf, safeBasename, type Containment, type SafeName } from './paths.ts'
export {
  REASON_CODES,
  probeInbox,
  unavailableReason,
  type AttachmentProbe,
  type InboxCapability,
  type ProbedSession,
  type ReasonCode,
} from './probe.ts'
export { SYSTEM_PROMPT_SECTION, systemPromptText } from './prompt.ts'
export { defineListTool } from './tools/list.ts'
export { defineAdoptTool } from './tools/adopt.ts'
export { adoptValue, listValue, renderAdopt, renderList, type AdoptToolValue, type ListToolValue } from './render.ts'

/**
 * Mount the seam: resolve config (fail loud), register the Providers, publish
 * `ctx.phoneInbox`, register the two tools, and add the system-prompt section.
 * With `enabled: false` the plugin registers nothing and stays inert.
 * @param ctx - the plugin context (host).
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: PhoneInboxConfig = {}): void {
  const resolved = resolveConfig({ ...config, inboxDir: resolveInboxDir(config.inboxDir) })
  const logger = ctx.logger('phone-inbox')
  if (!resolved.enabled) {
    logger.info('disabled: enabled is false — no service or tools are mounted')
    return
  }

  const { active, registry } = registerProviders(ctx, resolved)

  ctx.effect(() => ctx.tools.register(defineListTool(active, ctx)), 'dsh-phone-inbox: inbox_list')
  ctx.effect(() => ctx.tools.register(defineAdoptTool(active)), 'dsh-phone-inbox: inbox_adopt')

  // Incremental observation. `Session.deriveMessages()` is the authoritative
  // read — seed events are never republished on `session/event` — so this is a
  // completeness aid, not the source of truth. Registered defensively because
  // `session/event` is a host surface that can change between releases.
  const emitter = ctx as unknown as { on?: (event: string, listener: (session: unknown, event: unknown) => void) => unknown }
  if (typeof emitter.on === 'function') {
    const on = emitter.on.bind(emitter)
    ctx.effect(() => {
      on('session/event', (session, event) => observe(active, session, event))
      return () => {}
    }, 'dsh-phone-inbox: session observation')
  }

  // System-prompt guidance: the capability exists, what it is for, and the two
  // rules that prevent the predictable mistakes (re-deriving the path by hand;
  // handing a host path to a workspace-confined tool). Guarded so the plugin
  // still mounts on a host without the service.
  const promptHost = ctx as unknown as { systemPrompt?: { section: (options: { name: string; order: number; text: string }) => unknown } }
  if (typeof promptHost.systemPrompt?.section === 'function') {
    const section = promptHost.systemPrompt.section.bind(promptHost.systemPrompt)
    ctx.effect(() => {
      section({ name: SYSTEM_PROMPT_SECTION.name, order: SYSTEM_PROMPT_SECTION.order, text: systemPromptText() })
      return () => {}
    }, 'dsh-phone-inbox: system prompt section')
  } else {
    logger.info('ctx.systemPrompt is unavailable on this host — the tools are registered, but the model gets no guidance section')
  }

  logger.info(`dsh-phone-inbox ${VERSION} mounted: ctx.phoneInbox (provider ${resolved.provider}, registry: ${registry.names().join(', ')}) + inbox_list/inbox_adopt`)
}

/**
 * Forward one `session/event` payload to the active provider when it is a user
 * message. Every field is read defensively: this listener runs inside the host's
 * event dispatch, so it must never throw.
 * @param service - the active provider.
 * @param session - the session the event belongs to.
 * @param event - the event payload, unvalidated.
 */
function observe(service: InboxProvider, session: unknown, event: unknown): void {
  try {
    if (typeof event !== 'object' || event === null) return
    const record = event as Record<string, unknown>
    if (record.type !== 'user/message') return
    const data = record.data
    if (typeof data !== 'object' || data === null) return
    if (typeof session !== 'object' || session === null) return
    service.observeMessage(session as never, (data as Record<string, unknown>).content)
  } catch {
    // Observation is best-effort by construction (the history read is
    // authoritative); a throwing listener would break the host's dispatch.
  }
}
