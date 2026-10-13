# Security Policy

## Supported versions

Only the latest published `0.1.x` line of `dsh-phone-inbox` receives security
fixes.

## Reporting a vulnerability

Open a private security advisory through the repository's **Security** tab, or
email the maintainer listed in `package.json`. Please do not open a public issue
for a suspected vulnerability. Expect an acknowledgement within a few days.

## Security model of this plugin

`dsh-phone-inbox` crosses a trust boundary in both directions, and the model is
the untrusted party on one end:

- **Inbound paths come from the model.** The `path` argument of `inbox_adopt` is
  never trusted: the source must resolve inside the configured `inboxDir`, and a
  path that does not is refused with `not-in-inbox`.
- **Outbound names come from the sender.** A file name can carry directory
  separators (`../../evil.csv`) because it originates in the message text, so it
  is reduced to a single safe path segment before it becomes a destination. The
  `subdir` argument is likewise resolved and containment-checked against the
  session workspace.
- **Reads are not fenced by the host's fs sandbox.** The sandbox wraps only
  `writeText`/`editText`; reads pass through in every mode. This plugin therefore
  enforces its own containment on both ends of the copy instead of relying on the
  sandbox.
- **The `fs` write channel honours the sandbox policy** (the session-scoped
  policy is passed to `ctx.fs.writeText`, exactly as the official `write` tool
  does). The `node` channel writes bytes directly and is *not* fenced; it exists
  because `ctx.fs` has no byte-write API. The returned `copyMethod` always names
  the channel that ran, so an unfenced write is never implicit.
- **The shared inbox directory cannot prove session ownership.** The tempdir scan
  is off by default for that reason, accepts only leaf names with the bridge's
  own `<epoch-ms>-<8 hex>-<name>` shape, and stamps its entries
  `source: "tempdir"`.
- **Nothing is registered as a durable attachment unless asked.** Registration
  copies bytes into the host attachment store, which has no garbage collection —
  a permanent copy. `registerAttachment` defaults to `false`.
- **The plugin stores no credentials and opens no network connections.** It reads
  the local inbox directory and the calling session's own messages, and writes
  inside the session workspace.
