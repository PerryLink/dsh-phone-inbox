// Verify the built artifacts after `pnpm run build`: syntax-check the ESM
// entry, import it under plain Node, and assert the shipped files exist.
// Guards against TypeScript-only syntax leaking into shipped output and against
// a tarball missing the bundle patch or the licence.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const required = [
  pkg.main,
  pkg.types,
  'cordis.patch.yml',
  'LICENSE',
  'README.md',
  'README-zh.md',
  'README-es.md',
  'README-pt.md',
  'README-hi.md',
  'CHANGELOG.md',
  'SECURITY.md',
]
for (const rel of required) {
  if (typeof rel !== 'string' || rel === '') throw new Error(`package.json is missing a required path field (${String(rel)})`)
  if (!existsSync(path.join(root, rel))) throw new Error(`missing artifact: ${rel}`)
}

// 1. Syntax-check the ESM entry (plain Node parse; no execution).
execFileSync(process.execPath, ['--check', path.join(root, pkg.main)], { stdio: 'inherit' })

// 2. The plugin face must import under plain Node (no tsx, no checkout paths),
//    and must expose the function-plugin contract plus the seam vocabulary the
//    tools are built from.
const index = await import(pathToFileURL(path.join(root, pkg.main)).href)
const requiredExports = [
  'name',
  'inject',
  'apply',
  'Config',
  'resolveConfig',
  'PhoneInboxService',
  'LocalPhoneInboxService',
  'SessionPhoneInboxService',
  'TempdirPhoneInboxService',
  'ProviderRegistry',
  'probeInbox',
  'createMarkerMatcher',
  'defineListTool',
  'defineAdoptTool',
  'SYSTEM_PROMPT_SECTION',
]
for (const key of requiredExports) {
  if (index[key] === undefined) throw new Error(`lib entry does not export ${key}`)
}
if (index.name !== 'phone-inbox') throw new Error(`plugin name is ${JSON.stringify(index.name)}, expected "phone-inbox"`)
if (!Array.isArray(index.inject) || !index.inject.includes('tools')) {
  throw new Error('plugin must inject the tools service')
}
// A stray default export would make the Loader discard name/inject/Config/apply.
if (Object.prototype.hasOwnProperty.call(index, 'default')) {
  throw new Error('lib entry must not have a default export (the Loader unwraps exports.default ?? exports)')
}

// 3. The bundle patch must reference the package by its own name.
const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes(pkg.name)) {
  throw new Error(`cordis.patch.yml does not reference ${pkg.name}`)
}

console.log(`artifacts OK: ${required.length} shipped files, syntax + ESM import (${requiredExports.length} exports checked), bundle patch references ${pkg.name}`)
