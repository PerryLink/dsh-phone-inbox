/**
 * Capability probing for `dsh-phone-inbox`.
 *
 * The plugin reads inbound attachment paths out of *session message text* and
 * optional attachment-path resolution off the host's attachment service. Both
 * are host-version-dependent surfaces: a host release may rename
 * `Session.deriveMessages`, change the projected message shape, or ship an
 * attachment store without `fileHostPath`. When that happens the plugin must
 * say so — an empty inbox and an unreachable inbox look identical to a model,
 * and only one of them is true.
 *
 * {@link probeInbox} therefore returns a discriminated verdict rather than a
 * possibly-empty list, and {@link unavailableReason} turns each failure into
 * actionable text naming the surface that was missing.
 * @module dsh-phone-inbox/probe
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Whether the host's attachment store can turn an attachment ref into a host path. */
export interface AttachmentProbe {
  /** The `ctx.attachments` service is present. */
  readonly service: boolean
  /** `ctx.attachments.fileHostPath(ref)` exists and is a function. */
  readonly fileHostPath: boolean
  /** `ctx.attachments.imageHostPath(ref)` exists and is a function. */
  readonly imageHostPath: boolean
}

/** The verdict of {@link probeInbox}. */
export type InboxCapability =
  | {
    readonly state: 'ok'
    /** Whether the session exposes `deriveMessages()`. */
    readonly deriveMessages: boolean
    /** Whether the session's `header.cwd` is a usable workspace root. */
    readonly sessionCwd: boolean
    readonly attachments: AttachmentProbe
  }
  | {
    readonly state: 'unavailable'
    /** One of the {@link ReasonCode} values. */
    readonly reason: string
    /** What exactly was found (or not), for the model and the user. */
    readonly detail: string
  }

/** The reason codes {@link probeInbox} can report. */
export const REASON_CODES = {
  /** The tool ran without an agent-owned session. */
  noAgentSession: 'no-agent-session',
  /** The session object has no `deriveMessages` — the message-reading surface is gone. */
  noDeriveMessages: 'no-derive-messages',
  /** `deriveMessages()` is not iterable on this host. */
  deriveMessagesError: 'derive-messages-error',
  /** The session has no usable `header.cwd`, so there is no workspace to adopt into. */
  noWorkspace: 'no-workspace',
} as const

/** The union of {@link REASON_CODES} values. */
export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES]

/** A probe verdict bound to the session it was taken from. */
export interface ProbedSession {
  /** The probe verdict. */
  readonly capability: InboxCapability
  /** The session, when the execution context had one. */
  readonly session: unknown
}

/** The structural shape this plugin needs from a session. */
interface DerivableSession {
  deriveMessages(): unknown
  header?: { cwd?: unknown }
}

/** Read `ctx.attachments` off a plugin context without assuming its shape. */
function probeAttachments(ctx: unknown): AttachmentProbe {
  const attachments = (ctx as { attachments?: unknown } | undefined)?.attachments
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
 * Decide, from observed structure only, whether this host can answer the
 * session's inbound-attachment question.
 *
 * The assertions are deliberately shallow — "is `deriveMessages` callable?"
 * and "does it yield an iterable?" — because those are the two places a host
 * rename actually lands. Marker wording is *not* probed here: wording drift is
 * a live-contract question answered per message, and it is reported separately
 * as `emptyReason: 'no-inbound-source'` so an idle inbox is never called a
 * broken capability.
 * @param exec - the tool-execution context.
 * @param ctx - the plugin context (for the attachment service probe).
 * @returns the verdict, bound to the session when one exists.
 */
export function probeInbox(exec: ToolExecution, ctx?: unknown): ProbedSession {
  const attachments = probeAttachments(ctx)
  const session = exec.agent?.session as unknown as DerivableSession | undefined
  if (session === undefined || session === null) {
    return {
      capability: {
        state: 'unavailable',
        reason: REASON_CODES.noAgentSession,
        detail: 'this tool call has no agent-owned session, so there is no conversation whose attachments could be listed',
      },
      session: undefined,
    }
  }
  if (typeof session.deriveMessages !== 'function') {
    return {
      capability: {
        state: 'unavailable',
        reason: REASON_CODES.noDeriveMessages,
        detail: `the session object exposes no deriveMessages() function on this host (found: ${describeKeys(session)})`,
      },
      session,
    }
  }
  let messages: unknown
  try {
    messages = session.deriveMessages()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      capability: {
        state: 'unavailable',
        reason: REASON_CODES.deriveMessagesError,
        detail: `session.deriveMessages() threw on this host: ${detail}`,
      },
      session,
    }
  }
  if (!Array.isArray(messages)) {
    return {
      capability: {
        state: 'unavailable',
        reason: REASON_CODES.deriveMessagesError,
        detail: `session.deriveMessages() returned ${describe(messages)} instead of an array of messages`,
      },
      session,
    }
  }
  const cwd = session.header?.cwd
  const sessionCwd = typeof cwd === 'string' && cwd.trim() !== ''
  if (!sessionCwd) {
    return {
      capability: {
        state: 'unavailable',
        reason: REASON_CODES.noWorkspace,
        detail: 'the session has no usable header.cwd, so an adopted file would have no workspace to land in',
      },
      session,
    }
  }
  return {
    capability: { state: 'ok', deriveMessages: true, sessionCwd: true, attachments },
    session,
  }
}

/** One-line description of an unknown value, for a failure detail. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/** The own keys of an unknown object, for a failure detail. */
function describeKeys(value: unknown): string {
  if (typeof value !== 'object' || value === null) return typeof value
  const keys = Object.keys(value)
  return keys.length === 0 ? 'no own keys' : `keys: ${keys.slice(0, 12).join(', ')}`
}

/**
 * Turn an unavailable capability into text a model can act on. Every failure
 * path ends by naming the surface that was missing and the fallback that still
 * works, so a host change degrades into an instruction rather than an empty
 * result.
 * @param capability - the unavailable verdict.
 * @param inboxDir - the resolved inbox directory, when one is known.
 * @returns the remediation text.
 */
export function unavailableReason(capability: Extract<InboxCapability, { state: 'unavailable' }>, inboxDir?: string): string {
  const suffix = inboxDir === undefined || inboxDir === ''
    ? ''
    : ` The bridge writes inbound media to ${inboxDir}.`
  switch (capability.reason) {
    case REASON_CODES.noAgentSession:
      return `phone-inbox cannot list attachments: ${capability.detail}.${suffix} Nothing was returned — this is not an empty inbox.`
    case REASON_CODES.noDeriveMessages:
      return `phone-inbox cannot read this session's messages on this host build: ${capability.detail}.${suffix} Read the path directly from the message text the bridge sent you instead.`
    case REASON_CODES.deriveMessagesError:
      return `phone-inbox could not read this session's messages: ${capability.detail}.${suffix} This is not an empty inbox; read the path from the message text instead.`
    case REASON_CODES.noWorkspace:
      return `phone-inbox cannot adopt a file: ${capability.detail}.${suffix} Listing still works when the message surface does.`
    default:
      return `phone-inbox is unavailable on this host: ${capability.detail}.${suffix}`
  }
}
