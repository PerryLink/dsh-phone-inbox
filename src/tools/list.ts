/**
 * The `inbox_list` model tool: answer "where is the file I just sent you from my
 * phone?" without the model having to regex the conversation history itself.
 * @module dsh-phone-inbox/tools/list
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { REASON_CODES, probeInbox, unavailableReason } from '../probe.ts'
import { listValue, renderList, type ListToolValue } from '../render.ts'
import type { InboxProvider } from '../service.ts'

/** The output schema both arms of the result share. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', required: true },
    source: { type: 'string' },
    inboxDir: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
          displayName: { type: 'string', required: true },
          nameRecovery: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          inWorkspace: { type: 'boolean', required: true },
          bytes: { type: 'number' },
          mtimeMs: { type: 'number' },
          source: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
    },
    attachments: {
      type: 'object',
      properties: {
        service: { type: 'boolean', required: true },
        fileHostPath: { type: 'boolean', required: true },
        imageHostPath: { type: 'boolean', required: true },
      },
      additionalProperties: false,
    },
    deriveMessages: { type: 'boolean' },
    emptyReason: { type: 'string' },
    emptyDetail: { type: 'string' },
    tempdirScan: { type: 'boolean' },
    unresolvedAttachmentBlocks: { type: 'number' },
    reason: { type: 'string' },
    detail: { type: 'string' },
  },
  additionalProperties: false,
} as const

/**
 * Build the `inbox_list` tool against a mounted service.
 * @param service - the mounted `ctx.phoneInbox` implementation.
 * @param ctx - the plugin context, for the attachment-capability probe.
 * @returns the tool definition to register.
 */
export function defineListTool(service: InboxProvider, ctx: unknown) {
  return defineTool({
    name: 'inbox_list',
    description: [
      'List the attachments this session received from the user\'s phone (the WeChat bridge), newest first, with the absolute host path of each one.',
      'Use it whenever the user refers to a file they sent — "the table I sent", "我发的表", "the photo just now" — instead of reconstructing the path from the conversation text.',
      'Those paths are outside the session workspace. Checkers that accept an absolute `file` path (the compliance-checker family) can read them directly; workspace-confined tools (dsh-data-quality, whose `path-escape` check rejects anything outside the workspace) cannot, so call inbox_adopt first for those.',
      'If this host build cannot expose the session\'s messages the tool returns ok:false with the reason — it never reports an unreachable inbox as an empty one.',
    ].join('\n'),
    parameters: {
      limit: { type: 'number', description: 'Maximum number of attachments to return (defaults to the configured maxItems, 5).' },
      includeTempdir: {
        type: 'boolean',
        description: 'Also scan the bridge\'s inbox directory for files no message claimed. Only honoured when the plugin config enables allowTempdirScan; that directory is shared by every WeChat sender, so those entries\' attribution to this session is not proven.',
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderList(value as ListToolValue) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ListToolValue> {
      const probed = probeInbox(exec, ctx)
      const capability = probed.capability
      if (capability.state === 'unavailable') {
        return { ok: false, reason: capability.reason, detail: unavailableReason(capability, service.config.inboxDir) }
      }
      const session = exec.agent?.session as Session | undefined
      if (session === undefined) {
        return {
          ok: false,
          reason: REASON_CODES.noAgentSession,
          detail: unavailableReason({ state: 'unavailable', reason: REASON_CODES.noAgentSession, detail: 'no agent-owned session' }, service.config.inboxDir),
        }
      }
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.trunc(args.limit))
        : service.config.maxItems
      return listValue(await service.list(session, { limit, includeTempdir: args.includeTempdir === true }))
    },
  })
}
