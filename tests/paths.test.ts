/**
 * Containment and name-safety tests. Both directions of this plugin's data flow
 * cross a trust boundary — the source path comes from the model, the destination
 * name comes from the sender — so these are the tests that keep a tool argument
 * from becoming an arbitrary-file-read or an arbitrary-file-write.
 */

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { containedJoin, contains, parseBridgeLeaf, safeBasename } from '../src/paths.ts'

describe('contains', () => {
  it('accepts the root itself and anything below it', () => {
    const root = path.resolve('C:/ws')
    expect(contains(root, root).inside).toBe(true)
    expect(contains(root, path.join(root, 'a', 'b.csv')).inside).toBe(true)
  })

  it('rejects a sibling directory whose name merely shares a prefix', () => {
    const root = path.resolve('C:/ws')
    expect(contains(root, path.resolve('C:/ws2/x.csv')).inside).toBe(false)
  })

  it('rejects an escape through ..', () => {
    const root = path.resolve('C:/ws')
    expect(contains(root, path.resolve('C:/ws/../etc/passwd')).inside).toBe(false)
  })

  it('resolves both sides before comparing, so separators and casing cannot smuggle a path through', () => {
    const root = path.resolve('C:/ws')
    const mixed = path.join(root, 'sub') + path.sep + '.' + path.sep + 'file.csv'
    expect(contains(root, mixed).inside).toBe(true)
  })

  it('returns the resolved paths it compared, so a caller can report them', () => {
    const verdict = contains('C:/ws/./', 'C:/ws/a/../b.csv')
    expect(verdict.target).toBe(path.resolve('C:/ws/b.csv'))
    expect(verdict.root).toBe(path.resolve('C:/ws'))
  })
})

describe('containedJoin', () => {
  it('joins a plain relative subdirectory', () => {
    const root = path.resolve('C:/ws')
    expect(containedJoin(root, 'phone-inbox')).toBe(path.join(root, 'phone-inbox'))
  })

  it('refuses a subdirectory that escapes the workspace', () => {
    const root = path.resolve('C:/ws')
    expect(() => containedJoin(root, '../outside')).toThrow(/resolves outside the workspace root/u)
  })

  it('refuses an absolute subdirectory outside the workspace', () => {
    const root = path.resolve('C:/ws')
    expect(() => containedJoin(root, 'C:/elsewhere')).toThrow(/resolves outside the workspace root/u)
  })
})

describe('safeBasename', () => {
  it('keeps a Chinese file name intact — the point of the whole name recovery', () => {
    expect(safeBasename('材料.csv', 'fallback').name).toBe('材料.csv')
    expect(safeBasename('季度报表 2026.xlsx', 'fallback').name).toBe('季度报表 2026.xlsx')
  })

  it('drops every directory component', () => {
    expect(safeBasename('../../evil.csv', 'fallback').name).toBe('evil.csv')
    expect(safeBasename('/etc/passwd', 'fallback').name).toBe('passwd')
    expect(safeBasename('C:\\Windows\\System32\\cmd.exe', 'fallback').name).toBe('cmd.exe')
  })

  it('replaces the characters Windows forbids outright', () => {
    expect(safeBasename('a<b>c:d"e|f?g*h.csv', 'fallback').name).toBe('a_b_c_d_e_f_g_h.csv')
  })

  it('falls back rather than returning a name that is nothing but dots or blanks', () => {
    expect(safeBasename('..', 'fallback').name).toBe('fallback')
    expect(safeBasename('   ', 'fallback').name).toBe('fallback')
    expect(safeBasename('', 'fallback').name).toBe('fallback')
  })

  it('strips a trailing dot or space that Windows would silently swallow', () => {
    expect(safeBasename('report.csv.', 'fallback').name).toBe('report.csv')
    expect(safeBasename('report.csv ', 'fallback').name).toBe('report.csv')
  })

  it('caps the length', () => {
    const long = `${'a'.repeat(400)}.csv`
    expect(safeBasename(long, 'fallback').name.length).toBe(180)
  })

  it('reports whether it changed the input', () => {
    expect(safeBasename('材料.csv', 'fallback').changed).toBe(false)
    expect(safeBasename('../材料.csv', 'fallback').changed).toBe(true)
  })
})

describe('parseBridgeLeaf', () => {
  it('accepts the shape dsh-wechat saves under', () => {
    const parsed = parseBridgeLeaf('1750000000000-ab12cd34-材料.csv')
    expect(parsed).not.toBeNull()
    expect(parsed?.stamp).toBe(1750000000000)
    expect(parsed?.rand).toBe('ab12cd34')
    expect(parsed?.name).toBe('材料.csv')
  })

  it('accepts the sanitized shape the bridge actually writes for a Chinese name', () => {
    expect(parseBridgeLeaf('1750000000000-ab12cd34-___.csv')?.name).toBe('___.csv')
  })

  it('rejects anything else, so an unrelated file in the shared directory is never surfaced', () => {
    expect(parseBridgeLeaf('notes.txt')).toBeNull()
    expect(parseBridgeLeaf('1750000000000-ab12cd34')).toBeNull()
    expect(parseBridgeLeaf('1750000000000-ab12cd3-4-x.csv')).toBeNull()
    expect(parseBridgeLeaf('175-ab12cd34-x.csv')).toBeNull()
    expect(parseBridgeLeaf('1750000000000-AB12CD34-x.csv')).toBeNull()
  })
})
