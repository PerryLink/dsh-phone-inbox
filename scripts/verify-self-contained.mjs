// Rejects dependency specs that leave the repository root (file/link/portal/
// workspace/git/http paths) so the published package stays installable from
// the registry or a tarball with no external references.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const failures = []
const check = (deps, label) => {
  for (const [name, spec] of Object.entries(deps ?? {})) {
    if (/^(?:file|link|portal|workspace|git\+|https?):/iu.test(spec) || spec.startsWith('.') || path.isAbsolute(spec)) {
      failures.push(`${label} "${name}" uses out-of-repo spec ${JSON.stringify(spec)}`)
    }
  }
}
check(pkg.dependencies, 'dependencies')
check(pkg.devDependencies, 'devDependencies')
check(pkg.peerDependencies, 'peerDependencies')

// This plugin's own contract: no runtime dependencies at all. The Provider
// registry seam is implemented in-repo (src/seam.ts) precisely so the published
// package needs nothing beyond its peers.
if (Object.keys(pkg.dependencies ?? {}).length > 0) {
  failures.push(`dependencies must stay empty for a zero-runtime-dependency plugin, found: ${Object.keys(pkg.dependencies).join(', ')}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('self-contained: all dependency specs resolve from the registry, and dependencies is empty')
