/**
 * The `inbox_adopt` model tool: copy one inbound attachment into the session
 * workspace so a workspace-confined consumer can read it.
 * @module dsh-phone-inbox/tools/adopt
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ADOPT_REASONS } from '../service.ts'
import type { InboxProvider } from '../service.ts'
import { adoptValue, renderAdopt, type AdoptToolValue } from '../render.ts'

/** The output schema both arms of the result share. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', required: true },
    item: {
      type: 'object',
      properties: {
        hostPath: { type: 'string', required: true },
        workspacePath: { type: 'string' },
        relativePath: { type: 'string' },
        bytes: { type: 'number', required: true },
        sha256: { type: 'string', required: true },
        copyMethod: { type: 'string', required: true },
        sourceInline: { type: 'boolean', required: true },
        attachmentId: { type: 'string' },
        attachmentHostPath: { type: 'string' },
        nameRestored: { type: 'boolean', required: true },
        sourceLeafName: { type: 'string', required: true },
      },
      additionalProperties: false,
    },
    reason: { type: 'string' },
    detail: { type: 'string' },
  },
  additionalProperties: false,
} as const

/**
 * Build the `inbox_adopt` tool against a mounted service.
 * @param service - the mounted `ctx.phoneInbox` implementation.
 * @returns the tool definition to register.
 */
export function defineAdoptTool(service: InboxProvider) {
  return defineTool({
    name: 'inbox_adopt',
    description: [
      'Copy one inbound phone (WeChat bridge) attachment into this session\'s workspace, and optionally register its bytes as a durable host attachment.',
      'Use it before calling any workspace-confined consumer — dsh-data-quality rejects a path outside the session workspace with `path-escape` — then pass the returned `relativePath` (not the host path) to that consumer.',
      'Get `path` from inbox_list. The source must live inside the configured inbox directory; any other path is refused, because the argument comes from the model.',
      'The file name defaults to the original name recovered from the bridge\'s message text, so a Chinese file name survives; the on-disk name the bridge chose has every non-ASCII character replaced by `_`.',
      'A destination that already exists is never silently overwritten: the copy gets a `-1`, `-2`, … suffix unless `overwrite` is true.',
    ].join('\n'),
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute host path of the attachment, exactly as inbox_list reported it.' },
      name: { type: 'string', description: 'Override the adopted file name. Defaults to the sender\'s original name when the message carried one, else the on-disk leaf name.' },
      subdir: { type: 'string', description: `Workspace subdirectory to write into (defaults to the configured defaultSubdir, ${service.config.defaultSubdir}).` },
      channel: { type: 'string', enum: ['auto', 'fs', 'node'], description: 'Write channel: `fs` uses the host fs service (text only, honours the fs sandbox policy), `node` writes bytes directly, `auto` (default) picks the fs service for text extensions and node otherwise.' },
      overwrite: { type: 'boolean', description: 'Replace an existing destination file instead of adding a numeric suffix (default false).' },
      register: { type: 'boolean', description: 'Also register the bytes as a durable host attachment (defaults to the configured registerAttachment, false). Attachment objects are never garbage-collected, so this leaves a permanent copy.' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderAdopt(value as AdoptToolValue) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<AdoptToolValue> {
      const session = exec.agent?.session as Session | undefined
      if (session === undefined) {
        return {
          ok: false,
          reason: ADOPT_REASONS.capabilityUnavailable,
          detail: 'this tool call has no agent-owned session, so there is no workspace to adopt into. Nothing was copied.',
        }
      }
      const channel = args.channel
      if (channel !== undefined && channel !== 'auto' && channel !== 'fs' && channel !== 'node') {
        return { ok: false, reason: ADOPT_REASONS.capabilityUnavailable, detail: `channel must be auto | fs | node, got ${JSON.stringify(channel)}` }
      }
      return adoptValue(await service.adopt(session, {
        path: args.path,
        name: args.name,
        subdir: args.subdir,
        channel,
        overwrite: args.overwrite === true,
        register: args.register,
      }))
    },
  })
}
