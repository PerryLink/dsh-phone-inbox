# AGENTS.md

Repo-local decisions for `dsh-phone-inbox`. Development follows the DeepSeek
Harness plugin contract; this file records only what is decided *here*.

## Layout

- `src/index.ts` — function-plugin contract (`name`/`inject`/`Config`/`apply`; NO
  default export). Resolves config, registers the Providers, publishes
  `ctx.phoneInbox`, registers the two tools, adds the system-prompt section, and
  subscribes to `session/event`.
- `src/service.ts` — the Service Definition: `InboxProvider` (what a Provider
  implements), `PhoneInboxService` (the one published `ctx.phoneInbox` service),
  the `ListResult`/`AdoptResult` discriminated unions, and the reason-code
  constants.
- `src/service-local.ts` — the published facade. It exists because exactly **one**
  object may register the `phoneInbox` name on a context while the plugin ships
  two interchangeable Providers.
- `src/provider-base.ts` — the shared pipeline: history read, merge, stat,
  containment, destination planning, the two write channels, registration.
  **Not** a Cordis `Service`.
- `src/provider-session.ts` / `src/provider-tempdir.ts` — the two Providers.
- `src/probe.ts` — `probeInbox`, the capability probe, plus the remediation text.
- `src/markers.ts` / `src/config.ts` — the marker contract (pure) and its
  validated configuration.
- `src/blocks.ts` — structured attachment blocks (`{ type: 'file' | 'image',
  attachment }`) resolved through the host attachment store.
- `src/paths.ts` — containment, safe names, the bridge leaf-name shape, and the
  separator-agnostic `leafNameOf`.
- `src/seam.ts` — the in-repo Provider registry (see "Zero runtime dependencies").
- `src/prompt.ts` — the system-prompt section text and its order.
- `src/tools/*.ts` — the two `defineTool` Consumers; all work goes through the
  service layer.
- `scripts/` — `verify-self-contained.mjs`, `verify-artifacts.mjs`,
  `check-readme-sync.mjs`, `check-lockfile-drift.mjs`, `acceptance.mjs`.
- `tests/` — vitest; real `Context`/`SessionStore`/`Session` where the test needs
  them, and per-test inbox directories.

## Hard rules applied here

- **Zero runtime dependencies.** `dependencies` stays empty and
  `verify:self-contained` fails if it does not. The Provider registry is
  implemented in `src/seam.ts` following the `@perrylink/dsh-plugin-kit` template
  shape rather than depending on the kit; if the seam ever grows beyond a `Map`,
  depend on the kit instead of growing the file.
- **Never report an empty inbox for an unreachable one.** `inbox_list` and
  `ctx.phoneInbox.list` both return `ok: false` with a reason when a host surface
  is missing, and `emptyReason: "no-inbound-source"` when the capability works but
  nothing matched. A model cannot tell those apart from `items: []`, which is why
  the distinction is in the return type.
- **The model's `path` argument is untrusted.** `inbox_adopt` proves the source is
  under `inboxDir` before reading it, containment-checks `subdir` against the
  session workspace, and reduces a name to one safe segment. The `session` module's
  `workspaceOf` never falls back to `process.cwd()`.
- **A file name may be hostile.** It originates in message text, so it is reduced
  to a single safe path segment before use, and Windows-forbidden characters are
  replaced on every platform.
- **The marker wording is a soft contract, not a constant.** It is configurable
  (`markers`), documented in the README's configuration table, and the shipped
  defaults are the wordings observed in `dsh-wechat`'s inbound adapter. A wording
  change must be a config edit, never a code edit that pins a line number: the
  bridge is under active development in another repository and its line numbers
  drift.
- **Same wording, one fact.** The bridge uses the same sentence for images,
  videos and bare files, so a matched path is reported **once**. A recovered
  `[收到文件: …]` name is treated as evidence of the kind; without it the generic
  `file` kind is reported rather than a guess.
- **The write channel is never implicit.** `fs` honours the fs sandbox policy;
  `node` does not; `auto` prefers the service and falls back visibly. The result
  always names the channel (`copyMethod`) and the fallback reason is recorded.
- **This plugin registers no waterfall listeners.** If one is ever added,
  allow/passthrough MUST call `next()`.

## Checks

```sh
pnpm run typecheck && pnpm test && pnpm run build \
  && pnpm run verify:self-contained && pnpm run verify:artifacts \
  && pnpm run check:readmes && pnpm run check:lockfile
pnpm run acceptance
```

`prepublishOnly` runs the same gate minus `check:lockfile` (the release workflow
owns that).

## Docs

Five-language READMEs (`README.md`, `README-zh.md`, `README-es.md`,
`README-pt.md`, `README-hi.md`). The English file is the source of truth and the
`## ` headings stay in English; `check:readmes` holds the other four to the same
section count, the same install command and the same configuration keys.

## License

Apache-2.0. Every file in this repository is covered by it.
