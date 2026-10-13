/**
 * Capability-probe tests.
 *
 * These are the tests that keep version drift honest. The two outcomes a model
 * must be able to tell apart are "this host cannot answer the question" and
 * "this session received nothing", and every case below asserts that
 * `probeInbox` produces the first only when a surface is genuinely missing.
 *
 * The `exec` argument is a structural test double: `probeInbox` reads exactly
 * `exec.agent?.session`, and nothing in the production path hands it a real
 * `ToolExecution` that a unit test could build.
 */

import { describe, expect, it } from 'vitest'
import { REASON_CODES, probeInbox, unavailableReason } from '../src/probe.ts'

/** Build the smallest `exec` shape the probe reads. */
function execWith(session: unknown): never {
  return { agent: session === undefined ? undefined : { session } } as never
}

/** A session double with the two fields the probe reads. */
function sessionDouble(overrides: Record<string, unknown> = {}): unknown {
  return {
    header: { cwd: 'C:\\ws' },
    deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  }
}

describe('probeInbox', () => {
  it('reports ok when the session exposes deriveMessages and a workspace', () => {
    const probed = probeInbox(execWith(sessionDouble()))
    expect(probed.capability.state).toBe('ok')
  })

  it('reports no-agent-session rather than an empty inbox when the call has no agent', () => {
    const probed = probeInbox(execWith(undefined))
    expect(probed.capability.state).toBe('unavailable')
    if (probed.capability.state !== 'unavailable') return
    expect(probed.capability.reason).toBe(REASON_CODES.noAgentSession)
  })

  it('reports no-derive-messages when the host renamed or removed the message surface', () => {
    const session = { header: { cwd: 'C:/ws' } }
    const probed = probeInbox(execWith(session))
    expect(probed.capability.state).toBe('unavailable')
    if (probed.capability.state !== 'unavailable') return
    expect(probed.capability.reason).toBe(REASON_CODES.noDeriveMessages)
    expect(probed.capability.detail).toContain('deriveMessages')
  })

  it('reports derive-messages-error when deriveMessages throws', () => {
    const session = sessionDouble({ deriveMessages: () => { throw new Error('internal shape changed') } })
    const probed = probeInbox(execWith(session))
    expect(probed.capability.state).toBe('unavailable')
    if (probed.capability.state !== 'unavailable') return
    expect(probed.capability.reason).toBe(REASON_CODES.deriveMessagesError)
    expect(probed.capability.detail).toContain('internal shape changed')
  })

  it('reports derive-messages-error when deriveMessages stops returning an array', () => {
    const session = sessionDouble({ deriveMessages: () => ({ messages: [] }) })
    const probed = probeInbox(execWith(session))
    expect(probed.capability.state).toBe('unavailable')
    if (probed.capability.state !== 'unavailable') return
    expect(probed.capability.reason).toBe(REASON_CODES.deriveMessagesError)
    expect(probed.capability.detail).toContain('instead of an array')
  })

  it('accepts an empty message list as a working capability, not a failure', () => {
    const session = sessionDouble({ deriveMessages: () => [] })
    expect(probeInbox(execWith(session)).capability.state).toBe('ok')
  })

  it('reports no-workspace when header.cwd is missing, because adopting would have nowhere to land', () => {
    const session = sessionDouble({ header: {} })
    const probed = probeInbox(execWith(session))
    expect(probed.capability.state).toBe('unavailable')
    if (probed.capability.state !== 'unavailable') return
    expect(probed.capability.reason).toBe(REASON_CODES.noWorkspace)
  })

  it('probes the optional attachment service instead of assuming it exists', () => {
    const withoutService = probeInbox(execWith(sessionDouble()), {})
    if (withoutService.capability.state !== 'ok') throw new Error('expected ok')
    expect(withoutService.capability.attachments).toEqual({ service: false, fileHostPath: false, imageHostPath: false })

    const withService = probeInbox(execWith(sessionDouble()), { attachments: { fileHostPath: () => '/x' } })
    if (withService.capability.state !== 'ok') throw new Error('expected ok')
    expect(withService.capability.attachments).toEqual({ service: true, fileHostPath: true, imageHostPath: false })
  })

  it('returns the session it probed, so a caller does not re-narrow it', () => {
    const session = sessionDouble()
    expect(probeInbox(execWith(session)).session).toBe(session)
  })
})

describe('unavailableReason', () => {
  it('never renders as an empty success', () => {
    const probed = probeInbox(execWith(undefined))
    if (probed.capability.state !== 'unavailable') throw new Error('expected unavailable')
    const text = unavailableReason(probed.capability, 'C:\\inbox')
    expect(text).toContain('cannot')
    expect(text).toContain('not an empty inbox')
  })

  it('names the inbox directory so the model can fall back to the raw path', () => {
    const probed = probeInbox(execWith(undefined))
    if (probed.capability.state !== 'unavailable') throw new Error('expected unavailable')
    expect(unavailableReason(probed.capability, 'C:\\inbox')).toContain('C:\\inbox')
  })

  it('tells the model to read the path from the message text when the message surface is gone', () => {
    const probed = probeInbox(execWith({ header: { cwd: 'C:/ws' } }))
    if (probed.capability.state !== 'unavailable') throw new Error('expected unavailable')
    expect(unavailableReason(probed.capability, '')).toContain('Read the path directly from the message text')
  })
})
