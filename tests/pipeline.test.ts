/**
 * Adopt-pipeline tests.
 *
 * Both Cordis services these tests touch — the plugin's own `phoneInbox` and
 * `SessionStore`'s `sessions` — are registered per context and refuse a second
 * registration in the same scope, so every case gets a context with both names
 * isolated. That is the framework's rule, not this plugin's, and isolating is
 * cheaper than serialising the whole file.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { contains } from '../src/paths.ts'
import { SessionPhoneInboxService } from '../src/provider-session.ts'
import { ADOPT_REASONS, LIST_REASONS } from '../src/service.ts'
import type { Session } from '@deepseek-ai/dsh-session'

let root: string
let inbox: string
let workspace: string
/** Every context this file builds, disposed together at the end. */
const contexts: Context[] = []

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dsh-test-phone-inbox-pipeline-'))
  inbox = path.join(root, '.dsh-wechat', 'tempfile')
  workspace = path.join(root, 'workspace')
  await mkdir(inbox, { recursive: true })
  await mkdir(workspace, { recursive: true })
})

afterAll(async () => {
  for (const context of contexts) await context.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

/**
 * A Provider on a context whose `phoneInbox` scope is its own.
 * @param config - config overrides.
 * @param services - extra `ctx.*` service doubles.
 * @returns the Provider.
 */
function provider(config: Record<string, unknown> = {}, services: Record<string, unknown> = {}): SessionPhoneInboxService {
  const base = new Context()
  Object.assign(base as unknown as Record<string, unknown>, services)
  const ctx = base.isolate('phoneInbox')
  contexts.push(base)
  return new SessionPhoneInboxService(ctx, resolveConfig({ inboxDir: inbox, ...config }))
}

/**
 * A session double carrying projected messages and a workspace.
 * @param texts - the user-message texts to project.
 * @param header - the session header.
 * @returns the session.
 */
function sessionWith(texts: readonly string[], header: Record<string, unknown> = { cwd: workspace }): Session {
  return {
    header,
    deriveMessages: () => texts.map((text, index) => ({ id: `m${index}`, role: 'user', content: [{ type: 'text', text }] })),
  } as unknown as Session
}

/** The bridge's saved-file wording. */
function saved(hostPath: string, name: string): string {
  return `[收到文件: ${name}] 文件已保存到: ${hostPath}\n你可以使用这个路径来读取或处理文件。`
}

/**
 * Write a fixture file into the inbox.
 * @param name - the sender's file name (sanitized the way the bridge does).
 * @param body - the file body.
 * @returns the absolute host path.
 */
async function put(name: string, body: string): Promise<string> {
  const target = path.join(inbox, `${Date.now()}-ab12cd34-${name.replace(/[^\w.-]/g, '_')}`)
  await writeFile(target, body, 'utf8')
  return target
}

/**
 * Build a session whose messages contain one bridge delivery, and run `list`
 * once so the Provider's recovered-name index is populated the way it is in
 * production (`inbox_list` before `inbox_adopt`).
 * @param instance - the Provider.
 * @param hostPath - the saved path.
 * @param originalName - the sender's file name.
 * @returns the session.
 */
async function listedSession(instance: SessionPhoneInboxService, hostPath: string, originalName: string): Promise<Session> {
  const session = sessionWith([saved(hostPath, originalName)])
  const result = await instance.list(session, { limit: 5, includeTempdir: false })
  if (!result.ok) throw new Error('expected ok')
  return session
}

describe('list pipeline', () => {
  it('returns an empty result with no-inbound-source rather than throwing', async () => {
    const result = await provider().list(sessionWith([]), { limit: 5, includeTempdir: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([])
    expect(result.emptyReason).toBe(LIST_REASONS.noInboundSource)
  })

  it('fails loud on a session with no workspace instead of falling back to process.cwd()', async () => {
    const result = await provider().list(sessionWith([], {}), { limit: 5, includeTempdir: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no-workspace')
  })

  it('runs with no optional host services at all and says so', async () => {
    const hostPath = await put('材料.csv', 'a,b\n1,2\n')
    const result = await provider().list(sessionWith([saved(hostPath, '材料.csv')]), { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items).toHaveLength(1)
    expect(result.attachments).toEqual({ service: false, fileHostPath: false, imageHostPath: false })
    expect(result.unresolvedAttachmentBlocks).toBe(0)
  })

  it('rejects a structured block it cannot resolve, and counts it', async () => {
    const session = {
      header: { cwd: workspace },
      deriveMessages: () => [{ id: 'm0', role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:x', name: 'a.csv', bytes: 3 } }] }],
    } as unknown as Session
    const result = await provider().list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.unresolvedAttachmentBlocks).toBe(1)
    expect(result.items).toEqual([])
    expect(result.emptyReason).toBe(LIST_REASONS.noInboundSource)
  })

  it('resolves a structured block through an injected attachment store', async () => {
    const hostPath = await put('block.csv', 'a\n1\n')
    const session = {
      header: { cwd: workspace },
      deriveMessages: () => [{ id: 'm0', role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:x', name: '块.csv', bytes: 3 } }] }],
    } as unknown as Session
    const result = await provider({}, { attachments: { fileHostPath: () => hostPath } }).list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.displayName).toBe('块.csv')
    expect(result.unresolvedAttachmentBlocks).toBe(0)
  })

  it('ignores a non-user message that echoes a path', async () => {
    const hostPath = await put('echo.csv', 'a\n1\n')
    const session = {
      header: { cwd: workspace },
      deriveMessages: () => [{ id: 'a0', role: 'assistant', content: [{ type: 'text', text: saved(hostPath, 'echo.csv') }] }],
    } as unknown as Session
    const result = await provider().list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items).toEqual([])
  })

  it('reports a path inside the workspace as inWorkspace, not as an escape', async () => {
    const inside = path.join(workspace, 'inside.csv')
    await writeFile(inside, 'a\n1\n', 'utf8')
    const result = await provider().list(sessionWith([saved(inside, 'inside.csv')]), { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items[0]?.inWorkspace).toBe(true)
  })
})

describe('adopt pipeline', () => {
  it('copies a text file and reports the fs-service channel when ctx.fs is present', async () => {
    const hostPath = await put('fs.csv', 'a,b\n1,2\n')
    const writes: string[] = []
    const host = {
      fs: {
        resolve: async (p: string) => ({ path: p }),
        writeText: async (target: unknown, content: string) => {
          const file = (target as { path: string }).path
          writes.push(file)
          // The real service creates the parent directory; the double must too,
          // or the assertion would be measuring the double's gap.
          await mkdir(path.dirname(file), { recursive: true })
          await writeFile(file, content, 'utf8')
          return {}
        },
      },
    }
    const instance = provider({}, host)
    const session = await listedSession(instance, hostPath, 'fs.csv')
    const adopted = await instance.adopt(session, { path: hostPath })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(adopted.item.copyMethod).toBe('fs-service')
    expect(instance.lastFallbackReason).toBeUndefined()
    expect(writes).toHaveLength(1)
  })

  it('never silently substitutes node:fs for an explicit fs channel, but does fall back under auto', async () => {
    const hostPath = await put('nofs.csv', 'a,b\n1,2\n')
    const instance = provider({ writeChannel: 'fs' })
    const session = await listedSession(instance, hostPath, 'nofs.csv')
    const explicit = await instance.adopt(session, { path: hostPath })
    expect(explicit.ok).toBe(false)
    if (!explicit.ok) {
      expect(explicit.reason).toBe(ADOPT_REASONS.writeFailed)
      expect(explicit.detail).toContain('writeText is unavailable')
    }

    const auto = provider()
    const autoSession = await listedSession(auto, hostPath, 'nofs.csv')
    const adopted = await auto.adopt(autoSession, { path: hostPath })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    // The fallback happened, and it is visible in the result rather than implied.
    expect(adopted.item.copyMethod).toBe('node-fs')
  })

  it('falls back to node:fs for a binary extension under auto, without touching the fs service', async () => {
    const target = path.join(inbox, `${Date.now()}-ab12cd34-__.png`)
    await writeFile(target, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    let fsTouched = false
    const host = {
      fs: {
        resolve: async () => { fsTouched = true; throw new Error('unreachable') },
        writeText: async () => { fsTouched = true; throw new Error('unreachable') },
      },
    }
    const adopted = await provider({}, host).adopt(sessionWith([]), { path: target })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(adopted.item.copyMethod).toBe('node-fs')
    expect(fsTouched).toBe(false)
    expect(await readFile(adopted.item.workspacePath ?? '')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('reports write-failed with the channel error when the fs channel refuses', async () => {
    const hostPath = await put('refused.csv', 'a\n1\n')
    const host = {
      fs: {
        resolve: async () => { throw new Error('FS_SANDBOX_DENIED') },
        writeText: async () => { throw new Error('unreachable') },
      },
    }
    const adopted = await provider({ writeChannel: 'fs' }, host).adopt(sessionWith([]), { path: hostPath })
    expect(adopted.ok).toBe(false)
    if (adopted.ok) return
    expect(adopted.reason).toBe(ADOPT_REASONS.writeFailed)
    expect(adopted.detail).toContain('FS_SANDBOX_DENIED')
  })

  it('honours restoreOriginalName: false by keeping the on-disk leaf name', async () => {
    const hostPath = await put('材料.csv', 'a\n1\n')
    const instance = provider({ restoreOriginalName: false })
    const session = await listedSession(instance, hostPath, '材料.csv')
    const adopted = await instance.adopt(session, { path: hostPath })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(path.basename(adopted.item.workspacePath ?? '')).toBe(path.basename(hostPath))
    expect(adopted.item.nameRestored).toBe(false)
  })

  it('uses the recovered name for the default destination, and a `-1` suffix without overwriting', async () => {
    const hostPath = await put('材料.csv', 'a\n1\n')
    const instance = provider()
    const session = await listedSession(instance, hostPath, '材料.csv')
    const first = await instance.adopt(session, { path: hostPath })
    const second = await instance.adopt(session, { path: hostPath })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(path.basename(first.item.workspacePath ?? '')).toBe('材料.csv')
    expect(path.basename(second.item.workspacePath ?? '')).toBe('材料-1.csv')
    expect(await readFile(first.item.workspacePath ?? '', 'utf8')).toBe('a\n1\n')
  })

  it('keeps the adopted file inside the configured subdirectory and inside the workspace', async () => {
    const hostPath = await put('sub.csv', 'a\n1\n')
    const adopted = await provider({ defaultSubdir: 'inbox/deep' }).adopt(sessionWith([]), { path: hostPath })
    if (!adopted.ok) throw new Error('expected ok')
    expect(contains(workspace, adopted.item.workspacePath ?? '').inside).toBe(true)
    expect(adopted.item.relativePath?.startsWith('inbox/deep/')).toBe(true)
  })

  it('round-trips a structured block all the way to a workspace file', async () => {
    const hostPath = await put('roundtrip.csv', 'name,value\n甲,1\n')
    const session = {
      header: { cwd: workspace },
      deriveMessages: () => [{ id: 'm0', role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:x', name: '往返.csv', bytes: 20 } }] }],
    } as unknown as Session
    const instance = provider({}, { attachments: { fileHostPath: () => hostPath } })
    const listed = await instance.list(session, { limit: 5, includeTempdir: false })
    if (!listed.ok) throw new Error('expected ok')
    const adopted = await instance.adopt(session, { path: listed.items[0]?.path ?? '' })
    if (!adopted.ok) throw new Error('expected ok')
    expect(path.basename(adopted.item.workspacePath ?? '')).toBe('往返.csv')
    expect(await readFile(adopted.item.workspacePath ?? '', 'utf8')).toBe('name,value\n甲,1\n')
  })
})
