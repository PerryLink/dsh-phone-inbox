/**
 * Provider-integration tests: a real Cordis `Context`, a real `SessionStore` and
 * `Session` (with the message surface the host actually projects), real files
 * under a `dsh-test-` temporary tree, and the plugin's own Provider and facade.
 *
 * The three cases this file exists for:
 *
 * 1. **A Chinese file name.** The bridge's on-disk leaf name has every
 *    non-ASCII character replaced by `_`; the plugin must recover the sender's
 *    name from the marker text rather than hand the user `___.csv`.
 * 2. **A path outside the workspace.** The inbound file is outside
 *    `session.header.cwd` by construction, which is the whole problem this
 *    plugin addresses; `inbox_adopt` must land it inside.
 * 3. **The workspace-confined consumer.** `dsh-data-quality` refuses a path that
 *    escapes the session workspace, so the test asserts the exact resolution
 *    rule that makes the adopted path the only usable one.
 *
 * Two isolation rules make the file trustworthy:
 *
 * - Both Cordis services involved — the plugin's `phoneInbox` and
 *   `SessionStore`'s `sessions` — refuse a second registration in one scope, so
 *   every case gets a context with both isolated.
 * - Every case gets its **own inbox directory**, because a shared one would make
 *   each `items` assertion depend on test order.
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { contains } from '../src/paths.ts'
import { LocalPhoneInboxService } from '../src/service-local.ts'
import { SessionPhoneInboxService } from '../src/provider-session.ts'
import { TempdirPhoneInboxService } from '../src/provider-tempdir.ts'
import { ADOPT_REASONS, LIST_REASONS } from '../src/service.ts'

/**
 * The bridge's `saveToTemp` sanitization, reproduced verbatim from
 * `dsh-wechat`'s inbound adapter: `${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}`.
 *
 * The bridge's random part is 4 bytes of randomness; a hash of a counter is used
 * here instead so two fixtures created in the same millisecond can never collide
 * on disk, which would make an ordering assertion meaningless.
 * @param name - the sender's original file name.
 * @returns the leaf name the bridge would write.
 */
let leafCounter = 0
function bridgeLeaf(name: string): string {
  leafCounter += 1
  const random = createHash('sha256').update(`${Date.now()}-${leafCounter}`).digest('hex').slice(0, 8)
  return `${Date.now()}-${random}-${name.replace(/[^\w.-]/g, '_')}`
}

/**
 * The bridge's saved-file wording, reproduced verbatim.
 * @param hostPath - the saved path.
 * @param originalName - the sender's file name.
 * @returns the message text.
 */
function savedFileText(hostPath: string, originalName: string): string {
  return `[收到文件: ${originalName}] 文件已保存到: ${hostPath}\n你可以使用这个路径来读取或处理文件。`
}

/** The fixture tree root: a workspace, plus per-case inbox directories under it. */
interface Fixture {
  readonly root: string
  readonly workspace: string
}

let fixture: Fixture
/** Every context this file builds, disposed together at the end. */
const contexts: Context[] = []
let inboxCounter = 0

/**
 * A fresh inbox directory for one test case.
 * @returns the absolute directory.
 */
async function freshInbox(): Promise<string> {
  inboxCounter += 1
  const dir = path.join(fixture.root, 'inboxes', String(inboxCounter))
  await mkdir(dir, { recursive: true })
  return dir
}

/** A built case: the facade, its contexts, its inbox, and its session. */
interface Case {
  readonly service: LocalPhoneInboxService
  readonly ctx: Context
  readonly sessionCtx: Context
  readonly inbox: string
  readonly session: Session
}

/**
 * Build a case: an inbox, a context with `phoneInbox` and `sessions` isolated, a
 * Provider, the published facade, and a session whose workspace is the fixture
 * workspace.
 * @param id - the session id to create.
 * @param overrides - config overrides (an explicit `inboxDir` is honoured as-is).
 * @param services - extra `ctx.*` service doubles.
 * @returns the case.
 */
async function newCase(id: string, overrides: Record<string, unknown> = {}, services: Record<string, unknown> = {}): Promise<Case> {
  const inbox = overrides.inboxDir === undefined ? await freshInbox() : String(overrides.inboxDir)
  const base = new Context()
  Object.assign(base as unknown as Record<string, unknown>, services)
  contexts.push(base)
  const ctx = base.isolate('phoneInbox')
  const sessionCtx = base.isolate('sessions')
  const config = resolveConfig({ ...overrides, inboxDir: inbox })
  const impl = config.provider === 'tempdir'
    ? new TempdirPhoneInboxService(ctx, config)
    : new SessionPhoneInboxService(ctx, config)
  const service = new LocalPhoneInboxService(ctx, impl)
  const session = new SessionStore(sessionCtx).create(SessionId(id), { meta: { cwd: fixture.workspace } })
  return { service, ctx, sessionCtx, inbox, session }
}

/**
 * Append one user turn carrying the bridge's wording.
 * @param session - the receiving session.
 * @param text - the message text.
 */
function deliver(session: Session, text: string): void {
  session.append('user/message', {
    id: `msg-${Math.random().toString(16).slice(2)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } as never, { surfaceOp: 'append' } as never)
}

/**
 * Write a fixture file into this case's inbox under a bridge-shaped leaf name.
 * The bridge's own sanitization is applied here (`[^\w.-]` → `_`), so a Chinese
 * sender name lands on disk exactly the way it does in production.
 * @param inbox - the case's inbox directory.
 * @param senderName - the sender's file name.
 * @param body - the file body.
 * @returns the absolute host path.
 */
async function putInInbox(inbox: string, senderName: string, body: string): Promise<string> {
  leafCounter += 1
  const random = createHash('sha256').update(`${Date.now()}-${leafCounter}`).digest('hex').slice(0, 8)
  const target = path.join(inbox, `${Date.now()}-${random}-${senderName.replace(/[^\w.-]/g, '_')}`)
  await writeFile(target, body, 'utf8')
  return target
}

beforeAll(async () => {
  // Only a directory this test created, under the platform temp dir, prefixed
  // `dsh-test-` (the brief's exception). Nothing pre-existing is touched.
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-test-phone-inbox-'))
  fixture = { root, workspace: path.join(root, 'workspace') }
  await mkdir(fixture.workspace, { recursive: true })
})

afterAll(async () => {
  for (const context of contexts) await context.fiber.dispose()
  if (fixture !== undefined) await rm(fixture.root, { recursive: true, force: true })
})

describe('session provider', () => {
  it('lists an inbound CSV that lives outside the workspace, with the sender\'s original Chinese name', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-cjk')
    const hostPath = await putInInbox(inbox, '材料.csv', 'name,value\n甲,1\n乙,2\n')
    // The bridge's sanitization is exactly why the on-disk name is unreadable:
    // `材料.csv` becomes `__.csv` (two characters, two underscores).
    expect(path.basename(hostPath)).toMatch(/-__\.csv$/u)
    deliver(session, savedFileText(hostPath, '材料.csv'))

    const result = await service.list(session, { limit: 5, includeTempdir: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toBe('session')
    expect(result.items).toHaveLength(1)
    const item = result.items[0]
    expect(item?.path).toBe(hostPath)
    expect(item?.name).toBe(path.basename(hostPath))
    // The recovered name, not `___.csv`.
    expect(item?.displayName).toBe('材料.csv')
    expect(item?.nameRecovery).toBe('recovered')
    // The whole point: the bridge wrote it outside the session workspace.
    expect(item?.inWorkspace).toBe(false)
    expect(item?.bytes).toBe(Buffer.byteLength('name,value\n甲,1\n乙,2\n', 'utf8'))
  })

  it('returns newest first and honours limit', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-order')
    const oldest = await putInInbox(inbox, 'old.csv', 'a\n1\n')
    const newest = await putInInbox(inbox, 'new.csv', 'b\n2\n')
    // Backdate the first file so the ordering assertion cannot depend on fs timing.
    const past = new Date(Date.now() - 60_000)
    await utimes(oldest, past, past)
    deliver(session, savedFileText(oldest, 'old.csv'))
    deliver(session, savedFileText(newest, 'new.csv'))

    const both = await service.list(session, { limit: 5, includeTempdir: false })
    if (!both.ok) throw new Error('expected ok')
    expect(both.items.map((item) => item.name)).toEqual([path.basename(newest), path.basename(oldest)])

    const capped = await service.list(session, { limit: 1, includeTempdir: false })
    if (!capped.ok) throw new Error('expected ok')
    expect(capped.items).toHaveLength(1)
    expect(capped.items[0]?.name).toBe(path.basename(newest))
  })

  it('says "no inbound source" rather than an empty inbox when the wording does not match', async () => {
    const { service, session } = await newCase('phone-inbox-nowording')
    deliver(session, 'here is my file, somewhere, trust me')
    const result = await service.list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items).toEqual([])
    expect(result.emptyReason).toBe(LIST_REASONS.noInboundSource)
    expect(result.emptyDetail).toContain('not a capability failure')
  })

  it('lists a marker whose file is already gone, and reports it as size-unknown rather than dropping it silently', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-gone')
    const gone = path.join(inbox, bridgeLeaf('gone.csv'))
    deliver(session, savedFileText(gone, 'gone.csv'))
    const result = await service.list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    // "The bridge said it saved here and it is gone" is information, not noise:
    // dropping the entry would make a deleted file indistinguishable from a
    // message that never carried one.
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.bytes).toBeUndefined()
    expect(result.items[0]?.displayName).toBe('gone.csv')
  })

  it('reports source-missing when markers matched but every referenced file is gone', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-all-gone')
    const one = path.join(inbox, bridgeLeaf('one.csv'))
    const two = path.join(inbox, bridgeLeaf('two.csv'))
    deliver(session, savedFileText(one, 'one.csv'))
    deliver(session, savedFileText(two, 'two.csv'))
    // Nothing was ever written, so every referenced file is gone.
    const result = await service.list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items).toHaveLength(2)
    expect(result.items.every((item) => item.bytes === undefined)).toBe(true)
  })

  it('reports a capability failure, not an empty list, when deriveMessages throws', async () => {
    const { service, session } = await newCase('phone-inbox-drift')
    Object.defineProperty(session, 'deriveMessages', { value: () => { throw new Error('projection shape changed') } })
    const result = await service.list(session, { limit: 5, includeTempdir: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('derive-messages-error')
    expect(result.detail).toContain('projection shape changed')
    expect(result.reason).not.toBe(LIST_REASONS.noInboundSource)
  })

  it('reports a capability failure when deriveMessages stops returning an array', async () => {
    const { service, session } = await newCase('phone-inbox-not-array')
    Object.defineProperty(session, 'deriveMessages', { value: () => ({ messages: [] }) })
    const result = await service.list(session, { limit: 5, includeTempdir: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('derive-messages-error')
    expect(result.detail).toContain('instead of an array')
  })

  it('does not scan the shared inbox directory unless the config enables it', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-noscan')
    const unclaimed = await putInInbox(inbox, 'unclaimed.csv', 'x\n1\n')
    const result = await service.list(session, { limit: 20, includeTempdir: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.tempdirScan).toBe(false)
    expect(result.items.map((item) => item.name)).not.toContain(path.basename(unclaimed))
  })

  it('scans the inbox directory when enabled and stamps scanned items with their weaker provenance', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-scan', { provider: 'tempdir', allowTempdirScan: true, tempdirScanMaxItems: 50 })
    const scanned = await putInInbox(inbox, 'scanned.csv', 'y\n1\n')
    await writeFile(path.join(inbox, 'not-a-bridge-file.csv'), 'z\n1\n', 'utf8')

    const result = await service.list(session, { limit: 50, includeTempdir: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.tempdirScan).toBe(true)
    const item = result.items.find((candidate) => candidate.name === path.basename(scanned))
    expect(item?.source).toBe('tempdir')
    // A scan cannot recover a name it never saw: the sanitized tail is all there is.
    expect(item?.nameRecovery).toBe('unavailable')
    // A file without the bridge's leaf shape is never surfaced.
    expect(result.items.map((candidate) => candidate.name)).not.toContain('not-a-bridge-file.csv')
  })

  it('scans nothing when the tempdir provider is selected but the scan is not enabled', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-scan-off', { provider: 'tempdir', allowTempdirScan: false })
    const leaf = await putInInbox(inbox, 'off.csv', 'y\n1\n')
    const result = await service.list(session, { limit: 50, includeTempdir: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.tempdirScan).toBe(false)
    expect(result.items.map((item) => item.name)).not.toContain(path.basename(leaf))
  })
})

describe('inbox_adopt', () => {
  it('copies an out-of-workspace inbound file into the workspace under the recovered name', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-adopt')
    const body = 'name,value\n甲,1\n乙,2\n'
    const hostPath = await putInInbox(inbox, '季度报表.csv', body)
    deliver(session, savedFileText(hostPath, '季度报表.csv'))

    const listed = await service.list(session, { limit: 5, includeTempdir: false })
    if (!listed.ok) throw new Error('expected ok')

    const adopted = await service.adopt(session, { path: listed.items[0]?.path ?? '' })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    // The user's own name survived, so the file is recognizable.
    expect(path.basename(adopted.item.workspacePath ?? '')).toBe('季度报表.csv')
    expect(adopted.item.nameRestored).toBe(true)
    expect(adopted.item.sourceLeafName).toBe(path.basename(hostPath))
    expect(adopted.item.copyMethod).toBe('node-fs')
    expect(adopted.item.sha256).toBe(createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex'))
    // Landed inside the workspace, and the bytes are intact.
    expect(contains(fixture.workspace, adopted.item.workspacePath ?? '').inside).toBe(true)
    expect(contains(fixture.workspace, hostPath).inside).toBe(false)
    expect(await readFile(adopted.item.workspacePath ?? '', 'utf8')).toBe(body)
    // The relative path is what a workspace-confined consumer needs.
    expect(adopted.item.relativePath).toBe('phone-inbox/季度报表.csv')
  })

  it('writes through the host fs service when asked to', async () => {
    // A minimal `ctx.fs` double: the host owns real behaviour, this asserts the
    // plugin routes through the service instead of node:fs when asked.
    const written: string[] = []
    const fsHost = {
      resolve: async (p: string) => ({ path: p }),
      writeText: async (target: unknown, content: string) => {
        const file = (target as { path: string }).path
        written.push(file)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, content, 'utf8')
        return {}
      },
    }
    const { service, session, inbox } = await newCase('phone-inbox-fs-channel', { writeChannel: 'fs' }, { fs: fsHost })
    const hostPath = await putInInbox(inbox, 'fs-channel.csv', 'a,b\n1,2\n')
    deliver(session, savedFileText(hostPath, 'fs-channel.csv'))

    const adopted = await service.adopt(session, { path: hostPath })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(adopted.item.copyMethod).toBe('fs-service')
    expect(written).toHaveLength(1)
    expect(await readFile(adopted.item.workspacePath ?? '', 'utf8')).toBe('a,b\n1,2\n')
  })

  it('refuses a source outside the inbox directory', async () => {
    const { service, session } = await newCase('phone-inbox-refuse')
    const outside = path.join(fixture.workspace, 'local.csv')
    await writeFile(outside, 'a\n1\n', 'utf8')
    const adopted = await service.adopt(session, { path: outside })
    expect(adopted.ok).toBe(false)
    if (adopted.ok) return
    expect(adopted.reason).toBe(ADOPT_REASONS.notInInbox)
    expect(adopted.detail).toContain('is not inside the inbox directory')
  })

  it('refuses to escape through the subdir argument', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-subdir-escape')
    const hostPath = await putInInbox(inbox, 'escape.csv', 'a\n1\n')
    const adopted = await service.adopt(session, { path: hostPath, subdir: '../outside' })
    expect(adopted.ok).toBe(false)
    if (adopted.ok) return
    expect(adopted.detail).toContain('resolves outside the workspace root')
  })

  it('refuses a name that tries to traverse, and keeps the file inside the workspace', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-name-escape')
    const hostPath = await putInInbox(inbox, 'traverse.csv', 'a\n1\n')
    const adopted = await service.adopt(session, { path: hostPath, name: '../../../../evil.csv' })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(path.basename(adopted.item.workspacePath ?? '')).toBe('evil.csv')
    expect(contains(fixture.workspace, adopted.item.workspacePath ?? '').inside).toBe(true)
  })

  it('never silently overwrites: a second adopt of the same file gets a suffix', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-twice')
    const hostPath = await putInInbox(inbox, 'twice.csv', 'a\n1\n')
    const first = await service.adopt(session, { path: hostPath, name: 'twice.csv' })
    const second = await service.adopt(session, { path: hostPath, name: 'twice.csv' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(path.basename(first.item.workspacePath ?? '')).toBe('twice.csv')
    expect(path.basename(second.item.workspacePath ?? '')).toBe('twice-1.csv')
  })

  it('replaces the destination when overwrite is explicit', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-overwrite')
    const hostPath = await putInInbox(inbox, 'replace.csv', 'a\n1\n')
    const first = await service.adopt(session, { path: hostPath, name: 'replace.csv' })
    if (!first.ok) throw new Error('expected ok')
    await writeFile(hostPath, 'b\n2\n', 'utf8')
    const second = await service.adopt(session, { path: hostPath, name: 'replace.csv', overwrite: true })
    if (!second.ok) throw new Error('expected ok')
    expect(second.item.workspacePath).toBe(first.item.workspacePath)
    expect(await readFile(second.item.workspacePath ?? '', 'utf8')).toBe('b\n2\n')
  })

  it('refuses a source that does not exist and a source that is a directory', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-badsource')
    const missing = await service.adopt(session, { path: path.join(inbox, bridgeLeaf('nope.csv')) })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe(ADOPT_REASONS.sourceMissing)

    const dir = path.join(inbox, 'subdir-as-file')
    await mkdir(dir, { recursive: true })
    const notFile = await service.adopt(session, { path: dir })
    expect(notFile.ok).toBe(false)
    if (!notFile.ok) expect(notFile.reason).toBe(ADOPT_REASONS.sourceNotFile)
  })

  it('refuses every path when no inbox directory is configured', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-noinbox', { inboxDir: '' })
    const adopted = await service.adopt(session, { path: path.join(inbox, bridgeLeaf('x.csv')) })
    expect(adopted.ok).toBe(false)
    if (!adopted.ok) expect(adopted.reason).toBe(ADOPT_REASONS.notInInbox)
  })

  it('registers the bytes as a durable attachment when the host offers the seam and it is requested', async () => {
    const saved: Array<{ bytes: number; name: string }> = []
    const attachments = {
      saveFile: async ({ data, name }: { data: Uint8Array; name?: string }) => {
        saved.push({ bytes: data.byteLength, name: name ?? '' })
        return { attachmentId: 'sha256:deadbeef', name: name ?? '', bytes: data.byteLength }
      },
      fileHostPath: (ref: unknown) => `/host/attachments/${(ref as { attachmentId: string }).attachmentId}`,
    }
    const { service, session, inbox } = await newCase('phone-inbox-register', {}, { attachments })
    const hostPath = await putInInbox(inbox, 'durable.csv', 'a\n1\n')
    const adopted = await service.adopt(session, { path: hostPath, register: true })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(adopted.item.attachmentId).toBe('sha256:deadbeef')
    expect(adopted.item.attachmentHostPath).toContain('sha256:deadbeef')
    expect(saved).toHaveLength(1)
    expect(saved[0]?.name).toBe(path.basename(hostPath))
  })

  it('skips registration without failing when the host has no attachment store, and still copies', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-noattachment')
    const hostPath = await putInInbox(inbox, 'noattachment.csv', 'a\n1\n')
    const adopted = await service.adopt(session, { path: hostPath, register: true })
    expect(adopted.ok).toBe(true)
    if (!adopted.ok) return
    expect(adopted.item.attachmentId).toBeUndefined()
    expect(await stat(adopted.item.workspacePath ?? '')).toBeTruthy()
  })
})

describe('harvesting a name from a structured attachment block', () => {
  it('resolves a file block through the host attachment store and adopts under the block name', async () => {
    const lookupCalls: string[] = []
    let resolved = ''
    const attachments = {
      fileHostPath: (ref: unknown) => {
        lookupCalls.push((ref as { attachmentId: string }).attachmentId)
        return resolved
      },
    }
    const { service, session, inbox } = await newCase('phone-inbox-block', {}, { attachments })
    resolved = await putInInbox(inbox, 'block.csv', 'a\n1\n')
    session.append('user/message', {
      id: 'msg-block',
      role: 'user',
      content: [{ type: 'file', attachment: { attachmentId: 'sha256:abc', name: '块材料.csv', bytes: 6 } }],
      source: { kind: 'user' },
    } as never, { surfaceOp: 'append' } as never)

    const result = await service.list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(lookupCalls).toEqual(['sha256:abc'])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.path).toBe(resolved)
    expect(result.items[0]?.displayName).toBe('块材料.csv')
    expect(result.attachments.fileHostPath).toBe(true)
    expect(result.unresolvedAttachmentBlocks).toBe(0)

    const adopted = await service.adopt(session, { path: resolved })
    if (!adopted.ok) throw new Error('expected ok')
    expect(path.basename(adopted.item.workspacePath ?? '')).toBe('块材料.csv')
  })

  it('counts an unresolvable block instead of pretending the inbox is empty', async () => {
    const { service, session } = await newCase('phone-inbox-block-unresolved')
    session.append('user/message', {
      id: 'msg-block-unresolved',
      role: 'user',
      content: [{ type: 'file', attachment: { attachmentId: 'sha256:abc', name: 'x.csv', bytes: 6 } }],
      source: { kind: 'user' },
    } as never, { surfaceOp: 'append' } as never)

    const result = await service.list(session, { limit: 5, includeTempdir: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.items).toEqual([])
    expect(result.unresolvedAttachmentBlocks).toBe(1)
    expect(result.attachments.service).toBe(false)
  })
})

describe('workspace-confined consumer compatibility', () => {
  it('leaves the host path unusable and the adopted path usable for a path-escape check', async () => {
    const { service, session, inbox } = await newCase('phone-inbox-data-quality')
    const hostPath = await putInInbox(inbox, '表格.csv', 'name,value\n甲,1\n')
    deliver(session, savedFileText(hostPath, '表格.csv'))

    // The rule under test is the one `dsh-data-quality` enforces in
    // `resolveWorkspacePath` (src/dataset.ts): a requested path must resolve to
    // the workspace root itself or below it.
    const resolvesInWorkspace = (requested: string): string => {
      const root = path.resolve(fixture.workspace)
      const resolvedPath = path.resolve(root, requested)
      if (resolvedPath !== root && !resolvedPath.startsWith(root + path.sep)) {
        throw new Error(`path-escape: ${requested} resolves outside the workspace root`)
      }
      return resolvedPath
    }

    // The bridge's path is rejected — this is the whole reason inbox_adopt exists.
    expect(() => resolvesInWorkspace(hostPath)).toThrow(/path-escape/u)

    const listed = await service.list(session, { limit: 5, includeTempdir: false })
    if (!listed.ok) throw new Error('expected ok')
    const adopted = await service.adopt(session, { path: listed.items[0]?.path ?? '' })
    if (!adopted.ok) throw new Error('expected ok')

    // The adopted relative path is accepted AND resolves to the real file.
    const resolvedPath = resolvesInWorkspace(adopted.item.relativePath ?? '')
    expect(resolvedPath).toBe(adopted.item.workspacePath)
    expect(await readFile(resolvedPath, 'utf8')).toBe('name,value\n甲,1\n')
  })
})
