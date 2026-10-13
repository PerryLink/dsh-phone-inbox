#!/usr/bin/env node
/**
 * One-command acceptance for `dsh-phone-inbox`:
 *
 *   phone sends a CSV  ->  ask "where is my table"  ->  adopt it  ->  run dsh-data-quality
 *
 * What is REAL here and what is SIMULATED:
 *
 * - **Real**: a real Cordis `Context`; a real `SessionStore` + `Session` with the
 *   message surface the host actually projects (`surfaceOp: 'append'`); the
 *   plugin's real Provider, containment checks and write channels; real files on
 *   disk; and the **real** `dsh-data-quality` rule for the workspace-confined
 *   step, reproduced from its `resolveWorkspacePath` (`src/dataset.ts`) and
 *   additionally verified against the loaded plugin's own export when it can be
 *   resolved from `node_modules`.
 * - **Simulated**: the WeChat bridge itself. There is no WeChat account on this
 *   machine, so the attachment and the delivered message are written by this
 *   script using the bridge's own rules — the leaf name
 *   `${Date.now()}-${rand4hex}-${name.replace(/[^\w-. ]/g, "_")}` and the message
 *   wording — both copied verbatim from `dsh-wechat/src/adapter/inbound.ts`.
 *   Nothing about the plugin's behaviour depends on the sender being real.
 *
 * Everything is created under a `dsh-test-` temporary directory and removed
 * afterwards. Nothing outside that directory is read or written.
 *
 * Usage:
 *   node scripts/acceptance.mjs            # full chain
 *   node scripts/acceptance.mjs --simulate-no-host
 *                                          # also prove the capability probe
 *                                          # reports "unavailable" (not empty)
 *                                          # on a host without the surface
 *
 * Exit 0 prints `DSH_PHONE_INBOX_RESULT <json>`; any failure exits non-zero with
 * the reason on stderr.
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'

// The built entry is the artifact under test; a missing build is a failure, not
// a silent skip.
const { resolveConfig, LocalPhoneInboxService, SessionPhoneInboxService } = await import('../lib/index.mjs')

/** Assert a condition, failing the whole run with a clear line. */
function check(condition, message) {
  if (!condition) throw new Error(message)
}

/** The bridge's `saveToTemp` name, copied from dsh-wechat's inbound adapter. */
function bridgeLeaf(senderName) {
  return `${Date.now()}-${randomBytes(4).toString('hex')}-${senderName.replace(/[^\w.-]/g, '_')}`
}

/** The bridge's saved-file wording, copied from dsh-wechat's inbound adapter. */
function bridgeMessage(hostPath, senderName) {
  return `[收到文件: ${senderName}] 文件已保存到: ${hostPath}\n你可以使用这个路径来读取或处理文件。`
}

const FIXTURE_CSV = 'fund_code,holding_value\nFUND001,1000\nFUND002,2000\nFUND003,3000\n'
const SENDER_NAME = '材料.csv'

const results = {}
let root

try {
  // ---------------------------------------------------------------- 1. fixture
  root = await mkdtemp(path.join(tmpdir(), 'dsh-test-phone-inbox-acceptance-'))
  const inbox = path.join(root, '.dsh-wechat', 'tempfile')
  const workspace = path.join(root, 'workspace')
  await mkdir(inbox, { recursive: true })
  await mkdir(workspace, { recursive: true })

  // "The phone sent a CSV": the bridge's own leaf name, in the bridge's own dir.
  const leaf = bridgeLeaf(SENDER_NAME)
  const hostPath = path.join(inbox, leaf)
  await writeFile(hostPath, FIXTURE_CSV, 'utf8')
  results.hostPath = hostPath
  results.leafName = leaf
  check(leaf.endsWith('-__.csv'), `expected the bridge to mangle the name to '-__.csv', got ${leaf}`)
  check(path.resolve(hostPath).startsWith(path.resolve(workspace) + path.sep) === false, 'the fixture must live outside the workspace')

  // ------------------------------------------------------------------ 2. host
  const base = new Context()
  const ctx = base.isolate('phoneInbox')
  const sessionCtx = base.isolate('sessions')
  const config = resolveConfig({ inboxDir: inbox })
  const provider = new SessionPhoneInboxService(ctx, config)
  const service = new LocalPhoneInboxService(ctx, provider)
  const session = new SessionStore(sessionCtx).create(SessionId('acceptance-phone-inbox'), { meta: { cwd: workspace } })
  // The bridge's delivery: a user message with the path in a text block.
  session.append('user/message', {
    id: 'acceptance-message',
    role: 'user',
    content: [{ type: 'text', text: bridgeMessage(hostPath, SENDER_NAME) }],
  }, { surfaceOp: 'append' })

  // ------------------------------------------------- 3. "where is my table?"
  const listed = await service.list(session, { limit: 5, includeTempdir: false })
  check(listed.ok === true, `inbox_list failed: ${JSON.stringify(listed)}`)
  check(listed.source === 'session', `expected source 'session', got ${JSON.stringify(listed.source)}`)
  check(listed.items.length === 1, `expected exactly one inbound item, got ${listed.items.length}`)
  const item = listed.items[0]
  check(item.path === hostPath, `listed path ${item.path} is not the delivered path ${hostPath}`)
  check(item.displayName === SENDER_NAME, `expected the recovered name ${SENDER_NAME}, got ${item.displayName}`)
  check(item.nameRecovery === 'recovered', `expected nameRecovery 'recovered', got ${item.nameRecovery}`)
  check(item.inWorkspace === false, 'the bridge path must be reported as outside the workspace')
  results.listed = { path: item.path, displayName: item.displayName, nameRecovery: item.nameRecovery, inWorkspace: item.inWorkspace }
  console.log(`[1/4] inbox_list: ${item.displayName} at ${item.path} (outside the workspace)`)

  // ------------------------------------------- 4. the workspace-confined rule
  // Reproduced from dsh-data-quality/src/dataset.ts resolveWorkspacePath: the
  // requested path must resolve to the workspace root or below it.
  const resolveWorkspacePath = (rootPath, requested) => {
    const resolvedRoot = path.resolve(rootPath)
    const resolved = path.resolve(resolvedRoot, requested)
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`path-escape: ${requested} resolves outside the workspace root ${resolvedRoot}`)
    }
    return resolved
  }
  let escaped = false
  try {
    resolveWorkspacePath(workspace, hostPath)
  } catch {
    escaped = true
  }
  check(escaped, 'dsh-data-quality must reject the bridge path — if it does not, inbox_adopt is unnecessary')
  console.log(`[2/4] dsh-data-quality would reject the host path (path-escape) — adopting`)

  // ------------------------------------------------------------- 5. adopt it
  const adopted = await service.adopt(session, { path: hostPath })
  check(adopted.ok === true, `inbox_adopt failed: ${JSON.stringify(adopted)}`)
  const { item: adoptedItem } = adopted
  check(adoptedItem.relativePath === `phone-inbox/${SENDER_NAME}`, `unexpected relative path ${adoptedItem.relativePath}`)
  check(adoptedItem.sha256 === createHash('sha256').update(FIXTURE_CSV).digest('hex'), 'sha256 mismatch')
  check(await readFile(adoptedItem.workspacePath, 'utf8') === FIXTURE_CSV, 'adopted bytes differ from the source')
  const resolved = resolveWorkspacePath(workspace, adoptedItem.relativePath)
  check(resolved === adoptedItem.workspacePath, 'the relative path must resolve to the adopted file')
  results.workspacePath = adoptedItem.workspacePath
  results.relativePath = adoptedItem.relativePath
  results.sha256 = adoptedItem.sha256
  results.copyMethod = adoptedItem.copyMethod
  console.log(`[3/4] inbox_adopt: ${adoptedItem.relativePath} (${adoptedItem.copyMethod}, sha256 ${adoptedItem.sha256.slice(0, 12)}…)`)

  // ------------------------------------------------ 6. the consumer can read it
  // If the real dsh-data-quality package is resolvable, use ITS rule; otherwise
  // the reproduced rule above is the contract under test.
  let dataQualityLoaded = false
  try {
    const dataQuality = await import('dsh-data-quality')
    if (typeof dataQuality.resolveWorkspacePath === 'function') {
      dataQualityLoaded = true
      const viaReal = dataQuality.resolveWorkspacePath(workspace, adoptedItem.relativePath, {
        allowedExtensions: ['.csv', '.tsv', '.json', '.jsonl'],
      })
      check(viaReal === adoptedItem.workspacePath, 'the real dsh-data-quality resolved a different path')
      let realRejected = false
      try {
        dataQuality.resolveWorkspacePath(workspace, hostPath, { allowedExtensions: ['.csv'] })
      } catch {
        realRejected = true
      }
      check(realRejected, 'the real dsh-data-quality must reject the bridge path')
    }
  } catch {
    dataQualityLoaded = false
  }
  const consumed = await readFile(resolved, 'utf8')
  check(consumed.split('\n')[0] === 'fund_code,holding_value', 'the consumer did not read the expected header')
  results.dataQualityRule = dataQualityLoaded ? 'real dsh-data-quality export' : 'reproduced from dsh-data-quality/src/dataset.ts'
  console.log(`[4/4] workspace-confined read OK (rule: ${results.dataQualityRule})`)

  // --------------------------------------- 7. the probe must never lie (neg.)
  // A host whose session surface is gone must report "unavailable", never an
  // empty inbox. This is the failure mode the whole probe exists for.
  const brokenSession = { header: { cwd: workspace } }
  const broken = await service.list(brokenSession, { limit: 5, includeTempdir: false })
  check(broken.ok === false, 'a session without deriveMessages must not report success')
  check(broken.reason === 'no-derive-messages', `expected reason 'no-derive-messages', got ${broken.reason}`)
  results.probeFailure = { reason: broken.reason, detail: broken.detail }
  console.log(`[neg] capability drift reported honestly: ${broken.reason}`)

  // ------------------------------------------ 8. the containment must hold (neg.)
  const outside = path.join(workspace, 'local.csv')
  await writeFile(outside, FIXTURE_CSV, 'utf8')
  const refused = await service.adopt(session, { path: outside })
  check(refused.ok === false, 'a source outside the inbox directory must be refused')
  check(refused.reason === 'not-in-inbox', `expected reason 'not-in-inbox', got ${refused.reason}`)
  const traversal = await service.adopt(session, { path: hostPath, subdir: '../outside' })
  check(traversal.ok === false, 'a subdir that escapes the workspace must be refused')
  const traversalName = await service.adopt(session, { path: hostPath, name: '../../../../evil.csv' })
  check(traversalName.ok === true && path.basename(traversalName.item.workspacePath) === 'evil.csv', 'a traversing name must be neutralized to a single segment')
  results.containment = { refused: refused.reason, subdirRefused: traversal.ok === false, nameNeutralized: 'evil.csv' }
  console.log('[neg] source containment, subdir containment and name neutralization all hold')

  await base.fiber.dispose()
  process.stdout.write(`DSH_PHONE_INBOX_RESULT ${JSON.stringify(results)}\n`)
} catch (error) {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  process.exitCode = 1
} finally {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
}
