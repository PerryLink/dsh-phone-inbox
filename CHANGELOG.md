# Changelog

## [0.1.4] - 2026-10-31

### Changed

- Docs: document provider support (`dsh-wechat` optional, custom providers allowed); no code change.

## [0.1.3] - 2026-10-18

### Changed

- Add a 1280×720 hero and a 960×540, 4-second terminal GIF; `screenshots.json` and `capture.json` describe them.

## [0.1.2] - 2026-10-18

### Fixed

- **README no longer says `engines.dsh` is unread.** The host adjudicates it independently; all five languages now state that a mismatch can disable the row even when the peer range admits the version. Added the `dsh-working-directory` devDependency.

All notable changes to `dsh-phone-inbox` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-14

### Fixed

- **Path handling no longer depends on which host reads the message.** Three
  platform-specific `node:path` calls broke the module's own contract — that a
  path written in *either* separator convention must be accepted on *any* host —
  and all three passed on Windows while failing on Linux CI:

  - `normalizeCaptured` used `path.normalize`, which folds the *other*
    convention into this host's (on Windows a POSIX path came back with `\`). It
    now collapses repeated separators and `.`/`..` segments while preserving the
    convention the path was written in.
  - `isAbsolutePath` fell through to `path.isAbsolute`, which returns `false`
    for `C:\Users\…` on POSIX — so a Windows path read on Linux was judged
    invalid and **every marker on that line was dropped**. The drive form
    (`^[A-Za-z]:[\\/]`) is now recognized explicitly, on every host.
  - `containedJoin` relied on `path.resolve` to decide whether `subdir` was
    absolute, so `C:/elsewhere` was refused on Windows but silently accepted as
    a relative name on POSIX. A drive-absolute `subdir` is now refused on every
    host, because the argument is required to be relative.

  Note on verification: this class of defect is invisible to the Windows test
  suite (all 94 tests passed locally both before and after). It was found and
  confirmed by CI on Linux (`##[error]AssertionError: expected [] to have a
  length of 1 but got +0`).

## [0.1.0] - 2026-10-13

### Added

- **`inbox_list`** — lists this session's most recent inbound phone (WeChat
  bridge) attachments with their absolute host paths, the sender's recovered
  original file name, and whether each path is inside the session workspace.
  Reports `ok: false` with a reason instead of an empty list when the host
  cannot expose the session's messages, and distinguishes an idle inbox
  (`emptyReason: "no-inbound-source"`) from a broken one.
- **`inbox_adopt`** — copies one inbound attachment into the session workspace
  and returns the workspace-relative path that workspace-confined consumers
  (`dsh-data-quality`'s `path-escape` rule) require. Refuses a source outside
  the configured inbox directory, a `subdir` that escapes the workspace, and a
  name that could traverse; never overwrites silently.
- **Capability probe** (`probeInbox`) — decides from observed structure whether
  this host build can answer the question (`Session.deriveMessages`,
  `header.cwd`, and the optional `ctx.attachments.fileHostPath` /
  `imageHostPath`), and turns each failure into actionable text. A host rename
  degrades into "this host cannot answer", never into an empty inbox.
- **Original-name recovery** — the bridge replaces every non-ASCII character in
  the on-disk name with `_` (`材料.csv` → `__.csv`); the sender's name is
  recovered from the `[收到文件: <name>]` marker and used as the adopted file
  name.
- **Structured attachment blocks** — user messages carrying
  `{ type: "file", attachment }` / `{ type: "image", attachment }` are resolved
  through the host attachment store as well as the bridge's wording, and an
  unresolvable block is **counted** (`unresolvedAttachmentBlocks`) rather than
  dropped.
- **Two Providers behind one seam** — `session` (default: the calling session's
  own messages) and `tempdir` (`session` plus an opt-in scan of the bridge's
  shared inbox directory). The scan is off by default, only accepts leaf names
  with the bridge's own shape, and stamps every entry it contributes with
  `source: "tempdir"`.
- **System-prompt section** (`phone-inbox`, order 320) so the model knows the
  capability exists and which path form each consumer needs.
- **Two write channels** — the host fs service (text, honours the fs sandbox
  policy) and `node:fs` (bytes). `auto` prefers the service for text and falls
  back visibly; `copyMethod` always reports which one ran.
- **Zero runtime dependencies.** The Provider-registry seam is implemented
  in-repo (`src/seam.ts`) after the `@perrylink/dsh-plugin-kit` template shape,
  so `dependencies` stays empty and `verify:self-contained` enforces it.
- **Acceptance script** (`scripts/acceptance.mjs`) — probe → list → adopt →
  workspace-confined read, plus negative cases for capability drift, source
  containment, subdir containment and name neutralization.

### Known limitations

- A path containing a literal space is truncated at the space by the default
  marker wording (the capture is `(\S+)`, which is what stops it swallowing the
  sentence the bridge writes after the path). The bridge's own temp names never
  contain a space.
- Image and video kinds are reported as `file`: the bridge uses the same wording
  for both. The leaf name (`image.png`, `video.mp4`) distinguishes them.
- Images and videos have no recoverable original name; the plugin reports the
  on-disk name and says so rather than inventing one.
- No real WeChat traffic has been exercised on this machine.
