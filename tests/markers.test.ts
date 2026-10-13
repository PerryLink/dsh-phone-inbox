/**
 * Marker-contract tests. Every case is a literal string, because the contract
 * being tested *is* a set of literal strings — the bridge's wording.
 *
 * The wordings asserted here were read out of `dsh-wechat`'s inbound adapter
 * (`src/adapter/inbound.ts`): the image line, the saved-file line, the
 * inlined-bytes file line, and the video line.
 */

import pathModule from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKERS, resolveConfig } from '../src/config.ts'
import { createMarkerMatcher, displayNameFrom, markersOfContent, normalizeCaptured, textPartsOf } from '../src/markers.ts'

const matcher = createMarkerMatcher(DEFAULT_MARKERS)

/** The bridge's saved-file wording, with a Windows path. */
const savedFile = (hostPath: string, originalName: string): string =>
  `[收到文件: ${originalName}] 文件已保存到: ${hostPath}\n你可以使用这个路径来读取或处理文件。`

/** The bridge's inlined-bytes wording for a small text file. */
const inlinedFile = (hostPath: string, originalName: string): string =>
  `[收到文件: ${originalName}]\n文件路径: ${hostPath}\n\n文件内容:\ncol_a,col_b\n1,2`

describe('marker matching', () => {
  it('reads the saved-file wording and the original name', () => {
    const path = 'C:\\Users\\somebody\\.dsh-wechat\\tempfile\\1750000000000-ab12cd34-___.csv'
    const found = matcher.match(savedFile(path, '材料.csv'))
    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('file')
    expect(found[0]?.hostPath).toBe(path)
    expect(found[0]?.displayName).toBe('材料.csv')
    expect(found[0]?.nameRecovery).toBe('recovered')
    expect(found[0]?.inlinedName).toBeNull()
  })

  it('reads the inlined-bytes wording and marks the message as inlined', () => {
    const path = 'C:\\Users\\somebody\\.dsh-wechat\\tempfile\\1750000000001-ab12cd34-report.csv'
    const found = matcher.match(inlinedFile(path, 'report.csv'))
    expect(found).toHaveLength(1)
    expect(found[0]?.hostPath).toBe(path)
    expect(found[0]?.inlinedName).toBe('report.csv')
  })

  it('reads the image wording, and reports that no original name exists for images', () => {
    const target = 'C:\\Users\\somebody\\.dsh-wechat\\tempfile\\1750000000002-ab12cd34-image.png'
    const found = matcher.match(`[收到图片] 文件已保存到: ${target}`)
    expect(found).toHaveLength(1)
    expect(found[0]?.hostPath).toBe(target)
    expect(found[0]?.leafName).toBe('1750000000002-ab12cd34-image.png')
    // The bridge saves images as `image.<ext>`; there is no original name to
    // recover, and the plugin must not invent one. The on-disk leaf name is what
    // the user will recognize.
    expect(found[0]?.nameRecovery).toBe('absent')
    expect(found[0]?.displayName).toBe('1750000000002-ab12cd34-image.png')
  })

  it('reads the video wording', () => {
    const target = `${pathModule.sep}home${pathModule.sep}somebody${pathModule.sep}.dsh-wechat${pathModule.sep}tempfile${pathModule.sep}1750000000003-ab12cd34-video.mp4`
    const found = matcher.match(`[收到视频] 文件已保存到: ${target}`)
    expect(found).toHaveLength(1)
    // The wording for an image and a video is the same string, so the kind is
    // reported as the generic `file` rather than a guess. The leaf name is what
    // tells the two apart, and the leaf name is preserved.
    expect(found[0]?.kind).toBe('file')
    expect(found[0]?.leafName).toBe('1750000000003-ab12cd34-video.mp4')
    expect(found[0]?.hostPath).toBe(pathModule.normalize(target))
  })

  it('captures a path in the other separator convention without treating it as one long name', () => {
    // A Windows path seen by a POSIX process: `path.basename` would return the
    // whole string, so the leaf name is what proves the separator handling is
    // convention-agnostic rather than platform-dependent. The `___` is the
    // bridge's own sanitization of the Chinese name, reproduced here verbatim.
    const target = 'C:\\Users\\somebody\\.dsh-wechat\\tempfile\\1750000000007-ab12cd34-___.csv'
    const found = matcher.match(savedFile(target, '报表.csv'))
    expect(found).toHaveLength(1)
    expect(found[0]?.leafName).toBe('1750000000007-ab12cd34-___.csv')
    expect(found[0]?.displayName).toBe('报表.csv')
  })

  it('accepts a POSIX path on this host too', () => {
    const target = `${pathModule.sep}var${pathModule.sep}tmp${pathModule.sep}1750000000008-ab12cd34-a.csv`
    const found = matcher.match(savedFile(target, 'a.csv'))
    expect(found).toHaveLength(1)
    expect(found[0]?.hostPath).toBe(pathModule.normalize(target))
    expect(found[0]?.displayName).toBe('a.csv')
  })

  it('stops at the first whitespace, and that truncation is asserted rather than left implicit', () => {
    // `(\S+)` is what stops the capture at the end of the path instead of
    // swallowing the sentence after it. The cost is that a path containing a
    // literal space would be truncated at the space; the bridge's own temp names
    // never contain one, so this documents the limit instead of hiding it.
    const found = matcher.match('[收到文件: my report.csv] 文件已保存到: C:\\tmp\\my report.csv')
    expect(found).toHaveLength(1)
    expect(found[0]?.hostPath).toBe(pathModule.normalize('C:\\tmp\\my'))
  })

  it('drops trailing sentence punctuation that is not part of the path', () => {
    const target = `${pathModule.sep}home${pathModule.sep}somebody${pathModule.sep}.dsh-wechat${pathModule.sep}tempfile${pathModule.sep}1750000000005-ab12cd34-a.csv`
    const found = matcher.match(`[收到文件: a.csv] 文件已保存到: ${target}.`)
    expect(found[0]?.hostPath).toBe(pathModule.normalize(target))
  })

  it('matches nothing when the wording has changed (no silent empty list, an honest empty match)', () => {
    const found = matcher.match('I have put your file somewhere you will find it later.')
    expect(found).toEqual([])
  })

  it('refuses a relative capture, because the bridge always writes an absolute path', () => {
    const found = matcher.match('[收到文件: a.csv] 文件已保存到: tempfile/a.csv')
    expect(found).toEqual([])
  })

  it('refuses a JSON-shaped capture that merely contains the wording', () => {
    const found = matcher.match('[收到文件: a.csv] 文件已保存到: {"path":"/tmp/x.csv"}')
    expect(found).toEqual([])
  })

  it('collects from both projected content shapes and de-duplicates repeated paths', () => {
    const path = '/home/somebody/.dsh-wechat/tempfile/1750000000006-ab12cd34-a.csv'
    const first = markersOfContent(matcher, savedFile(path, 'a.csv'))
    expect(first).toHaveLength(1)
    const second = markersOfContent(matcher, [{ type: 'text', text: savedFile(path, 'a.csv') }, { type: 'image', data: 'ignored' }])
    expect(second).toHaveLength(1)
  })

  it('reads text parts and ignores non-text parts', () => {
    expect(textPartsOf('plain')).toEqual(['plain'])
    expect(textPartsOf([{ type: 'image', data: 'x' }, { type: 'text', text: 'kept' }])).toEqual(['kept'])
    expect(textPartsOf(undefined)).toEqual([])
    expect(textPartsOf({ type: 'text', text: 'not an array' })).toEqual([])
  })

  it('normalizes surrounding quotes and trailing separators, and folds separators only as the platform does', () => {
    const posix = pathModule.normalize('/tmp/a.csv')
    expect(normalizeCaptured('"/tmp/a.csv"')).toBe(posix)
    expect(normalizeCaptured("'/tmp/a.csv'")).toBe(posix)
    expect(normalizeCaptured('/tmp/dir/')).toBe(pathModule.normalize('/tmp/dir'))
  })

  it('accepts a custom wording, so a bridge change is a config edit', () => {
    const custom = createMarkerMatcher({
      image: { path: 'saved at<([^>]+)>' },
      file: { path: 'saved at<([^>]+)>', name: 'name=([^;]+);' },
      video: { path: 'saved at<([^>]+)>' },
    })
    const target = pathModule.isAbsolute(pathModule.join('tmp', 'x-___.csv'))
      ? pathModule.join('tmp', 'x-___.csv')
      : pathModule.join(pathModule.sep, 'tmp', 'x-___.csv')
    const found = custom.match(`[file] name=材料.csv; saved at<${target}>`)
    expect(found).toHaveLength(1)
    expect(found[0]?.hostPath).toBe(pathModule.normalize(target))
    // The custom name pattern plus the plain-file kind recovers the sender's name.
    expect(found[0]?.displayName).toBe('材料.csv')
    expect(found[0]?.kind).toBe('file')
  })
})

describe('displayNameFrom', () => {
  it('keeps Chinese characters, which is the whole point of recovering the name', () => {
    expect(displayNameFrom('材料.csv')).toBe('材料.csv')
    expect(displayNameFrom('季度 报表(2026).xlsx')).toBe('季度 报表(2026).xlsx')
  })

  it('neutralizes directory separators so a display name can never traverse', () => {
    expect(displayNameFrom('..\\..\\evil.csv')).toBe('.._.._evil.csv')
    expect(displayNameFrom('/etc/passwd')).toBe('_etc_passwd')
  })

  it('rejects a name that is nothing but dots', () => {
    expect(displayNameFrom('..')).toBe('')
    expect(displayNameFrom('.')).toBe('')
  })
})

describe('resolveConfig', () => {
  it('defaults maxItems to the MVP contract of 5', () => {
    expect(resolveConfig({}).maxItems).toBe(5)
  })

  it('leaves the tempdir scan off by default', () => {
    expect(resolveConfig({}).allowTempdirScan).toBe(false)
  })

  it('fails loud on a malformed marker pattern instead of matching nothing', () => {
    expect(() => resolveConfig({ markers: { file: { path: '([unclosed' } } })).toThrow(/not a valid RegExp source/u)
  })

  it('fails loud on a non-positive maxItems', () => {
    expect(() => resolveConfig({ maxItems: 0 })).toThrow(/positive integer/u)
  })

  it('fails loud on an unknown write channel', () => {
    expect(() => resolveConfig({ writeChannel: 'teleport' as never })).toThrow(/writeChannel must be one of/u)
  })

  it('keeps an explicitly empty inboxDir, so a deployment can mean "no inbox"', () => {
    expect(resolveConfig({ inboxDir: '' }).inboxDir).toBe('')
  })
})
