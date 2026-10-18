# dsh-phone-inbox

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

本会话的「手机（微信桥）入站附件」收件箱：列出**这次对话**真正收到的附件，并按需把某一条取进工作区。

![Terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-hero.png)

![Animated terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-demo.gif)

## Install & uninstall

```sh
dsh plugin --profile <name> add dsh-phone-inbox
dsh plugin --profile <name> remove dsh-phone-inbox
```

本插件**没有任何运行时依赖**（`dependencies` 为空）。它唯一的 peer 是编译所依赖的宿主包，见 `package.json` 的 `peerDependencies`。

## The problem this closes

`dsh-wechat` 把手机发来的媒体存到 `~/.dsh-wechat/tempfile/` —— 在会话工作区**之外** —— 并把绝对路径写进一个纯文本块。由此产生两个后果，而用户都看不见：

1. **强制工作区的工具读不到它。** `dsh-data-quality` 会拒绝任何逃出会话工作区的路径（`path-escape`），所以「我发了个 CSV，帮我画像」会失败，尽管文件就在那儿。
2. **文件名被摧毁。** 桥的命名是 `${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}`，于是 `材料.csv` 落到磁盘上变成 `__.csv`，用户认不出自己的文件。

`dsh-phone-inbox` 不新开通道、默认也不复制任何东西。它把本会话自己的入站清单变成可寻址的，并从桥**本来就写好的** `[收到文件: <name>]` 标记里把被压坏的文件名恢复出来。

## What you get

| 工具 | 它回答的问题 |
|---|---|
| `inbox_list` | 「我刚从手机发给你的文件在哪？」 |
| `inbox_adopt` | 「把它放到我那些强制工作区的工具能读的地方。」 |

两个工具都由函数式插件注册，bundle 行一挂载就出现在模型的工具列表里。

## Quick start

```sh
# 1. 把插件挂到目标 profile（作为 bundle 行）
dsh plugin --profile <name> add dsh-phone-inbox
```

然后，在收到过手机附件的那个会话里：

```text
inbox_list                                   # 本会话收到的路径
inbox_adopt { "path": "<inbox_list 给出的路径>" }
```

`inbox_adopt` 会返回 `relativePath`（例如 `phone-inbox/材料.csv`）。把它交给强制工作区的工具（例如 `data_profile`）；原始宿主路径只交给那些接受任意绝对路径的消费方。

## Compatibility

| Engine | Range |
|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>=0.2.1-alpha.1` |

宿主 peer 区间是生态规范的六段 OR 区间（见 `dsh-plugin-kit/data/peer-range.json`）。宿主会在 preflight 时评估 `peerDependencies`，并把区间不接受的插件行**静默 disabled** —— 所以错误的区间看起来就像「插件挂上了但什么都不做」。宿主也会单独裁决 `engines.dsh`；即使 peer 区间接受该版本，这里的区间不匹配同样可能让插件行被禁用。

## Configuration

每个字段都可选；表里给的是默认值。`cordis.patch.yml` 里有同样取值并带行内注释。

| Key | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` 时既不挂服务也不注册工具。 |
| `inboxDir` | `""` → `~/.dsh-wechat/tempfile` | 桥落入站媒体的目录。留空则推导桥自己的默认值；桥的 `storageDir` 被挪动时显式设置。 |
| `maxItems` | `5` | `inbox_list` 返回条数上限。MVP 约定是「本会话最近几条」。 |
| `provider` | `session` | 由哪个已注册 provider 回答：`session`（本对话自己的消息）或 `tempdir`（`session` 加对 `inboxDir` 的扫描）。 |
| `allowTempdirScan` | `false` | 是否启用目录扫描。默认关，因为 `inboxDir` 是全局的。 |
| `tempdirScanMaxItems` | `5` | 扫描最多贡献的条数。 |
| `tempdirScanMaxAgeMs` | `3600000` | 扫描文件的年龄上限；`0` 表示不过滤。 |
| `markers` | 见下 | 各媒体类型的标记文案，取值为 `RegExp` source。 |
| `defaultSubdir` | `phone-inbox` | `inbox_adopt` 写入的工作区子目录。 |
| `restoreOriginalName` | `true` | 用恢复出的发件人原始名作为取用后的文件名。 |
| `writeChannel` | `auto` | `auto`（文本走 fs 服务，其余走 node:fs）· `fs`（只走宿主 fs 服务）· `node`（直接写字节）。 |
| `registerAttachment` | `false` | 同时把取用的字节登记为宿主持久附件。附件对象永不被 GC。 |

`markers` 的默认文案，按媒体类型 —— 每个值都是 `RegExp` source，其**第一个捕获组是路径**：

- `image.path` — `` 文件已保存到:\s*(\S+) ``
- `file.path` — `` (?:文件已保存到|文件路径):\s*(\S+) ``
- `file.name` — `` \[收到文件:\s*([^\]\r\n]+)\] ``
- `video.path` — `` 文件已保存到:\s*(\S+) ``

标记文案是与桥的**软契约**：桥把路径写进散文，而散文可能随桥的版本无声变化。这些模式做成配置项，正是为了让文案变化成为一次配置修改，而不是一次插件发版。

## Tools & surfaces

```ts
inbox_list({
  limit?: number,            // 默认 config.maxItems
  includeTempdir?: boolean,  // 仅当 allowTempdirScan 为真才生效
})
```

返回 `{ ok: true, source, inboxDir, items[], attachments, deriveMessages, emptyReason?, emptyDetail?, tempdirScan, unresolvedAttachmentBlocks }`，或 `{ ok: false, reason, detail }`。

```ts
inbox_adopt({
  path: string,              // 必填：原样使用 inbox_list 给出的值
  name?: string,             // 默认：恢复出的原始文件名
  subdir?: string,           // 默认：config.defaultSubdir
  channel?: 'auto' | 'fs' | 'node',
  overwrite?: boolean,       // 默认 false：重名会加 -1 后缀
  register?: boolean,        // 默认：config.registerAttachment
})
```

成功返回 `{ ok: true, item }`，含 `hostPath`、`workspacePath`、`relativePath`、`bytes`、`sha256`、`copyMethod`、`nameRestored`、`sourceLeafName`，登记时另有 `attachmentId`/`attachmentHostPath`；失败返回 `{ ok: false, reason, detail }`。

插件还会追加一段系统提示词小节（`phone-inbox`，order 320），让模型知道这个能力存在；并订阅 `session/event` 观察 `user/message`。两者都不是正确性的前提：历史读取在每次调用时都是权威来源。

## Permissions & data

- **读** `inboxDir` 与调用会话自己的消息，别的都不读。
- **只在会话工作区内写**（`path.resolve` + 分隔符感知的包含判定），且只在调用 `inbox_adopt` 时写。
- **拒绝**不在 `inboxDir` 下的源路径、逃出工作区的 `subdir`、以及可能穿越的文件名。`path` 参数来自模型，永不被信任。
- **默认不扫描**共享的 inbox 目录，除非显式打开 `allowTempdirScan`；开启后它贡献的每一条都带 `source: "tempdir"`。
- **永不静默覆盖**。重名目标会得到 `-1`、`-2`…… 后缀，除非 `overwrite: true`。
- **默认不登记**持久附件；登记会把字节复制进宿主的附件库，而那里没有垃圾回收。

## Security boundaries

- 读不受宿主 fs 沙箱围栏（围栏只包 `writeText`/`editText`），因此本插件在复制的**两端**都自己做包含判定。
- `fs` 写通道走 `ctx.fs.writeText` 并带会话作用域的沙箱策略，所以限制型后端会像围栏 `write` 工具一样围栏它。`node` 通道按构造绕过该围栏；它存在的原因是 `ctx.fs` 没有字节写 API。返回的 `copyMethod` 永远说明到底哪条通道写了。
- `auto` 对文本优先走 fs 服务、失败回退 `node:fs`；回退原因被记录、通道被上报，绝不靠暗示。
- 目录扫描无法证明某个文件属于哪次对话。这正是它默认关闭、且其条目自带 `source` 的原因。
- 桥的 inbox 目录不保证是私有的（一次桥重构移除了显式的 `0o700`/`0o600` 处理）。本插件不假设它私有。

## Known limitations

- **路径里含字面空格会被截断**在空格处。捕获用 `(\S+)`，因为正是它阻止捕获吞掉桥写在路径后面的那句话；桥自己的临时文件名从不含空格。
- **图片与视频的 kind 都报成 `file`。** 桥对两者用同一句文案，kind 无法从文本恢复；靠叶名（`image.png`、`video.mp4`）区分。
- **图片/视频没有可恢复的原始名。** 桥把它们存成 `image.<ext>` / `video.mp4`，文案里不带原始名。插件如实报告磁盘名并说明，而不是编一个。
- **Windows 路径只在 Windows 上可用**（POSIX 路径同理）。插件按运行平台归一化分隔符。
- **`inbox_adopt` 要求文件仍然存在。** 桥从不清理 `tempfile/`，但没有任何东西保证它留着。
- **没有跑过真实微信流量。** 验收脚本说明了什么是被脚本化验证的，其输出说明了脚本化与真机的边界。

## Development

```sh
pnpm install
pnpm run typecheck && pnpm test && pnpm run build \
  && pnpm run verify:self-contained && pnpm run verify:artifacts \
  && pnpm run check:readmes && pnpm run check:lockfile
pnpm run acceptance          # 端到端：探测 -> 列表 -> 取用 -> dsh-data-quality
```

`prepublishOnly` 会重跑整条闸门链，所以发布不可能发出未构建或已漂移的树。

## Topics

`dsh` · `dsh-plugin` · `deepseek-harness` · `cordis` · `wechat` · `inbox` · `attachment` · `phone`

## Contributors

PerryLink。

## PerryLink DSH Plugin Family

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 DeepSeek Harness 插件家族成员：**87 个活跃维护**，名册共 **95** 个，其中 **5 个已冻结**、**3 个已退役**。完整名单默认折叠，避免每个 README 的首屏被长表淹没；点击展开可查看每一行，原因见「状态」列。

<details>
<summary>展开全部 95 个插件</summary>

| 插件 | 一句话 | 状态 |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 已退役 — 见仓库 README |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 已冻结 — 见仓库 README |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 已冻结 — 见仓库 README |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 已冻结 — 见仓库 README |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 已冻结 — 见仓库 README |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 已冻结 — 见仓库 README |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 已退役 — 见仓库 README |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 已退役 — 见仓库 README |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

## License

Apache-2.0。本仓每个文件都受其覆盖。
