# dsh-phone-inbox

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

The session's inbound phone (WeChat bridge) attachment inbox: list the attachments **this conversation** actually received, and adopt one into the workspace on demand.

![Terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-hero.png)

![Animated terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-demo.gif)

## Install & uninstall

```sh
dsh plugin --profile <name> add dsh-phone-inbox
dsh plugin --profile <name> remove dsh-phone-inbox
```

The plugin has **no runtime dependencies** (`dependencies` is empty). Its only peers are the host packages it is built against; see the `peerDependencies` block in `package.json`.

## The problem this closes

`dsh-wechat` saves inbound phone media to `~/.dsh-wechat/tempfile/` — outside the session workspace — and writes the absolute path into a plain text block. Two consequences follow, and neither is visible to the user:

1. **Workspace-confined tools cannot read it.** `dsh-data-quality` rejects any path that escapes the session workspace (`path-escape`), so "I sent you a CSV, profile it" fails even though the file is right there.
2. **The file name is destroyed.** The bridge names the file `${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}`, so `材料.csv` lands on disk as `__.csv`. The user cannot recognize their own file.

`dsh-phone-inbox` adds no new channel and copies nothing by default. It makes the session's own inbound list addressable, and it restores the name the bridge mangled — from the `[收到文件: <name>]` marker the bridge already writes.

## What you get

| Tool | Question it answers |
|---|---|
| `inbox_list` | "Where is the file I just sent you from my phone?" |
| `inbox_adopt` | "Put it somewhere my workspace-confined tools can read it." |

Both tools are registered by the function plugin, so they appear in the model's tool list as soon as the bundle row is mounted.

## Quick start

```sh
# 1. Mount the plugin (a bundle row in the target profile)
dsh plugin --profile <name> add dsh-phone-inbox
```

Then, in a session that received a phone attachment:

```text
inbox_list                                   # the paths this session received
inbox_adopt { "path": "<the path from inbox_list>" }
```

`inbox_adopt` returns `relativePath` (for example `phone-inbox/材料.csv`). Pass **that** to a workspace-confined tool such as `data_profile`; pass the original host path only to consumers that accept any absolute path.

## Compatibility

| Engine | Range |
|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>=0.2.1-alpha.1` |

The host peer range is the ecosystem's canonical six-clause OR range (see `dsh-plugin-kit/data/peer-range.json`). The host evaluates `peerDependencies` at preflight and **silently disables** a plugin row whose range does not admit the running version, so a wrong range looks like "the plugin mounted and does nothing". The host also adjudicates `engines.dsh` independently; a mismatch there can disable the row even when the peer range admits the version.

## Configuration

Every field is optional; the table lists the default. See `cordis.patch.yml` for the same values with inline comments.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; `false` mounts no service and no tools. |
| `inboxDir` | `""` → `~/.dsh-wechat/tempfile` | Directory the bridge drops inbound media into. Empty derives the bridge's own default; set it when the bridge's `storageDir` was moved. |
| `maxItems` | `5` | Cap on entries `inbox_list` returns. The MVP contract is "the session's most recent few". |
| `provider` | `session` | Which registered provider answers: `session` (this conversation's own messages) or `tempdir` (`session` plus a scan of `inboxDir`). |
| `allowTempdirScan` | `false` | Enables the directory scan at all. Off because `inboxDir` is global. |
| `tempdirScanMaxItems` | `5` | Cap on entries a scan may contribute. |
| `tempdirScanMaxAgeMs` | `3600000` | Age ceiling for a scanned file; `0` disables the filter. |
| `markers` | see below | Marker wording per media kind, as `RegExp` sources. |
| `defaultSubdir` | `phone-inbox` | Workspace subdirectory `inbox_adopt` writes into. |
| `restoreOriginalName` | `true` | Use the sender's recovered original name as the adopted file name. |
| `writeChannel` | `auto` | `auto` (fs service for text, node:fs otherwise) · `fs` (host fs service only) · `node` (bytes directly). |
| `registerAttachment` | `false` | Also register adopted bytes as a durable host attachment. Attachment objects are never garbage-collected. |

The `markers` default wording, per media kind — each value is a `RegExp` source whose **first capture group is the path**:

- `image.path` — `` 文件已保存到:\s*(\S+) ``
- `file.path` — `` (?:文件已保存到|文件路径):\s*(\S+) ``
- `file.name` — `` \[收到文件:\s*([^\]\r\n]+)\] ``
- `video.path` — `` 文件已保存到:\s*(\S+) ``

Marker wording is a **soft contract** with the bridge: it writes the path into prose, and the prose can change between bridge releases without notice. The patterns are configuration precisely so a wording change is a config edit rather than a plugin release.

## Tools & surfaces

```ts
inbox_list({
  limit?: number,            // default: config.maxItems
  includeTempdir?: boolean,  // only honoured when allowTempdirScan is true
})
```

Returns `{ ok: true, source, inboxDir, items[], attachments, deriveMessages, emptyReason?, emptyDetail?, tempdirScan, unresolvedAttachmentBlocks }`, or `{ ok: false, reason, detail }`.

```ts
inbox_adopt({
  path: string,              // required: exactly what inbox_list reported
  name?: string,             // default: the recovered original name
  subdir?: string,           // default: config.defaultSubdir
  channel?: 'auto' | 'fs' | 'node',
  overwrite?: boolean,       // default false: a duplicate gets a -1 suffix
  register?: boolean,        // default: config.registerAttachment
})
```

Returns `{ ok: true, item }` with `hostPath`, `workspacePath`, `relativePath`, `bytes`, `sha256`, `copyMethod`, `nameRestored`, `sourceLeafName`, and `attachmentId`/`attachmentHostPath` when registered; or `{ ok: false, reason, detail }`.

The plugin also appends one system-prompt section (`phone-inbox`, order 320) so the model knows the capability exists, and subscribes to `session/event` for `user/message` observation. Neither is required for correctness: the history read is authoritative on every call.

## Permissions & data

- **Reads** `inboxDir` and the calling session's own messages. Nothing else.
- **Writes** only inside the session workspace (`path.resolve` + a separator-aware containment check), and only when `inbox_adopt` is called.
- **Refuses** a source path that is not under `inboxDir`, a `subdir` that escapes the workspace, and a name that could traverse. The `path` argument comes from the model and is never trusted.
- **Does not scan** the shared inbox directory unless `allowTempdirScan` is explicitly enabled; when it does, every entry it contributes is stamped `source: "tempdir"`.
- **Never overwrites** silently. A duplicate destination gets a `-1`, `-2`, … suffix unless `overwrite: true`.
- **Registers nothing** as a durable attachment unless asked; registration copies bytes into the host's attachment store, which has no garbage collection.

## Security boundaries

- Reads are not fenced by the host's fs sandbox (the fence wraps only `writeText`/`editText`), so this plugin enforces its own containment on **both** ends of the copy.
- The `fs` write channel goes through `ctx.fs.writeText` with the session-scoped sandbox policy, so a confining backend fences it exactly as it fences the `write` tool. `node` bypasses that fence by construction; it exists because `ctx.fs` has no byte-write API. The returned `copyMethod` always says which one ran.
- `auto` prefers the fs service for text and falls back to `node:fs`; the fallback reason is recorded and the channel is reported, never implied.
- The tempdir scan cannot prove which conversation a file belongs to. That is why it is off by default and why its items carry their own `source`.
- The bridge's inbox directory is not guaranteed to be private (a bridge refactor removed the explicit `0o700`/`0o600` handling). This plugin does not assume otherwise.

## Known limitations

- **A path containing a literal space is truncated** at the space by the default marker wording. The capture is `(\S+)` because that is what stops it from swallowing the sentence the bridge writes after the path; the bridge's own temp names never contain a space.
- **Image and video kinds are reported as `file`.** The bridge uses the same wording for both, so the kind is not recoverable from the text; the leaf name (`image.png`, `video.mp4`) tells them apart.
- **An image or video has no recoverable original name.** The bridge saves them as `image.<ext>` / `video.mp4` and the wording carries no original name. The plugin reports the on-disk name and says so rather than inventing one.
- **A Windows path is only usable on Windows** (and a POSIX path only on POSIX). The plugin normalizes separators the way the running platform does.
- **`inbox_adopt` needs the file to still exist.** The bridge never cleans `tempfile/`, but nothing guarantees it stays.
- **No real WeChat traffic has been exercised.** See the acceptance script for what *is* verified, and its output for the scripted-vs-real boundary.

## Development

```sh
pnpm install
pnpm run typecheck && pnpm test && pnpm run build \
  && pnpm run verify:self-contained && pnpm run verify:artifacts \
  && pnpm run check:readmes && pnpm run check:lockfile
pnpm run acceptance          # end-to-end: probe -> list -> adopt -> dsh-data-quality
```

`prepublishOnly` re-runs the gate, so a release cannot ship an unbuilt or drifted tree.

## Topics

`dsh` · `dsh-plugin` · `deepseek-harness` · `cordis` · `wechat` · `inbox` · `attachment` · `phone`

## Contributors

PerryLink.

## PerryLink DSH Plugin Family

This project is part of the DeepSeek Harness plugin family from [PerryLink](https://github.com/PerryLink). The roster stays collapsed below so every README keeps a short first screen; expand it to see every row and its status.

<details>
<summary>Expand all plugins</summary>

| Plugin | Status |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** |  |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** |  |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** |  |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 FROZEN — see the repo README |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 FROZEN — see the repo README |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 FROZEN — see the repo README |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 FROZEN — see the repo README |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 FROZEN — see the repo README |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 RETIRED — see the repo README |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 RETIRED — see the repo README |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 RETIRED — see the repo README |

</details>## License

Apache-2.0. Every file in this repository is covered by it.
