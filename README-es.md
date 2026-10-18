# dsh-phone-inbox

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

La bandeja de entrada de adjuntos del teléfono (puente de WeChat) de esta sesión: enumera los adjuntos que **esta conversación** recibió realmente y adopta uno en el espacio de trabajo cuando se pida.

![Terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-hero.png)

![Animated terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-demo.gif)

## Install & uninstall

```sh
dsh plugin --profile <name> add dsh-phone-inbox
dsh plugin --profile <name> remove dsh-phone-inbox
```

El plugin **no tiene dependencias en tiempo de ejecución** (`dependencies` está vacío). Sus únicas dependencias entre pares son los paquetes anfitriones contra los que se compila; véase el bloque `peerDependencies` en `package.json`.

## The problem this closes

`dsh-wechat` guarda los medios entrantes del teléfono en `~/.dsh-wechat/tempfile/` — fuera del espacio de trabajo de la sesión — y escribe la ruta absoluta en un bloque de texto plano. Se siguen dos consecuencias, y ninguna es visible para el usuario:

1. **Las herramientas confinadas al espacio de trabajo no pueden leerlo.** `dsh-data-quality` rechaza cualquier ruta que escape del espacio de trabajo de la sesión (`path-escape`), así que «te envié un CSV, perfílalo» falla aunque el archivo esté ahí mismo.
2. **El nombre del archivo queda destruido.** El puente lo nombra `${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}`, así que `材料.csv` acaba en disco como `__.csv`. El usuario no reconoce su propio archivo.

`dsh-phone-inbox` no añade ningún canal nuevo y no copia nada por defecto. Hace direccionable la lista entrante de la propia sesión y recupera el nombre que el puente destrozó — a partir del marcador `[收到文件: <name>]` que el puente ya escribe.

## What you get

| Herramienta | Pregunta que responde |
|---|---|
| `inbox_list` | «¿Dónde está el archivo que acabo de enviarte desde el teléfono?» |
| `inbox_adopt` | «Ponlo donde mis herramientas confinadas al espacio de trabajo puedan leerlo.» |

Ambas herramientas las registra el plugin funcional, así que aparecen en la lista de herramientas del modelo en cuanto se monta la fila del bundle.

## Quick start

```sh
# 1. Montar el plugin (una fila de bundle en el perfil destino)
dsh plugin --profile <name> add dsh-phone-inbox
```

Después, en una sesión que recibió un adjunto del teléfono:

```text
inbox_list                                   # las rutas que recibió esta sesión
inbox_adopt { "path": "<the path from inbox_list>" }
```

`inbox_adopt` devuelve `relativePath` (por ejemplo `phone-inbox/材料.csv`). Pasa **esa** ruta a una herramienta confinada al espacio de trabajo como `data_profile`; pasa la ruta anfitriona original solo a consumidores que aceptan cualquier ruta absoluta.

## Compatibility

| Engine | Range |
|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>=0.2.1-alpha.1` |

El rango de pares del anfitrión es el rango OR canónico de seis cláusulas del ecosistema (véase `dsh-plugin-kit/data/peer-range.json`). El anfitrión evalúa `peerDependencies` en el preflight y **desactiva silenciosamente** una fila de plugin cuyo rango no admita la versión en ejecución, así que un rango equivocado parece «el plugin se montó y no hace nada». El anfitrión también evalúa `engines.dsh` de forma independiente; una discrepancia ahí puede desactivar la fila aunque el rango de pares admita la versión.

## Configuration

Todos los campos son opcionales; la tabla indica el valor por defecto. `cordis.patch.yml` contiene los mismos valores con comentarios en línea.

| Key | Por defecto | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor maestro; `false` no monta servicio ni herramientas. |
| `inboxDir` | `""` → `~/.dsh-wechat/tempfile` | Directorio donde el puente deja los medios entrantes. Vacío deriva el valor por defecto del puente; se fija cuando se movió su `storageDir`. |
| `maxItems` | `5` | Tope de entradas que devuelve `inbox_list`. El contrato del MVP es «los últimos adjuntos de la sesión». |
| `provider` | `session` | Qué proveedor registrado responde: `session` (los mensajes de esta conversación) o `tempdir` (`session` más un escaneo de `inboxDir`). |
| `allowTempdirScan` | `false` | Habilita el escaneo del directorio. Desactivado porque `inboxDir` es global. |
| `tempdirScanMaxItems` | `5` | Tope de entradas que puede aportar un escaneo. |
| `tempdirScanMaxAgeMs` | `3600000` | Límite de antigüedad de un archivo escaneado; `0` desactiva el filtro. |
| `markers` | véase abajo | Redacción del marcador por tipo de medio, como fuentes `RegExp`. |
| `defaultSubdir` | `phone-inbox` | Subdirectorio del espacio de trabajo donde escribe `inbox_adopt`. |
| `restoreOriginalName` | `true` | Usar el nombre original recuperado del remitente como nombre adoptado. |
| `writeChannel` | `auto` | `auto` (servicio fs para texto, node:fs en caso contrario) · `fs` (solo el servicio fs del anfitrión) · `node` (bytes directamente). |
| `registerAttachment` | `false` | Registrar también los bytes adoptados como adjunto duradero del anfitrión. Los objetos de adjunto nunca se recolectan. |

La redacción por defecto de `markers`, por tipo de medio — cada valor es una fuente `RegExp` cuyo **primer grupo de captura es la ruta**:

- `image.path` — `` 文件已保存到:\s*(\S+) ``
- `file.path` — `` (?:文件已保存到|文件路径):\s*(\S+) ``
- `file.name` — `` \[收到文件:\s*([^\]\r\n]+)\] ``
- `video.path` — `` 文件已保存到:\s*(\S+) ``

La redacción del marcador es un **contrato blando** con el puente: escribe la ruta en prosa y la prosa puede cambiar entre versiones del puente sin aviso. Los patrones son configuración precisamente para que un cambio de redacción sea una edición de configuración y no una publicación del plugin.

## Tools & surfaces

```ts
inbox_list({
  limit?: number,            // por defecto: config.maxItems
  includeTempdir?: boolean,  // solo se honra cuando allowTempdirScan es true
})
```

Devuelve `{ ok: true, source, inboxDir, items[], attachments, deriveMessages, emptyReason?, emptyDetail?, tempdirScan, unresolvedAttachmentBlocks }`, o `{ ok: false, reason, detail }`.

```ts
inbox_adopt({
  path: string,              // obligatorio: exactamente lo que informó inbox_list
  name?: string,             // por defecto: el nombre original recuperado
  subdir?: string,           // por defecto: config.defaultSubdir
  channel?: 'auto' | 'fs' | 'node',
  overwrite?: boolean,       // por defecto false: un duplicado recibe sufijo -1
  register?: boolean,        // por defecto: config.registerAttachment
})
```

Devuelve `{ ok: true, item }` con `hostPath`, `workspacePath`, `relativePath`, `bytes`, `sha256`, `copyMethod`, `nameRestored`, `sourceLeafName`, y `attachmentId`/`attachmentHostPath` cuando se registra; o `{ ok: false, reason, detail }`.

El plugin también añade una sección al prompt del sistema (`phone-inbox`, orden 320) para que el modelo sepa que la capacidad existe, y se suscribe a `session/event` para observar `user/message`. Ninguna de las dos es necesaria para la corrección: la lectura del historial es autoritativa en cada llamada.

## Permissions & data

- **Lee** `inboxDir` y los mensajes de la propia sesión llamante. Nada más.
- **Escribe** solo dentro del espacio de trabajo de la sesión (`path.resolve` más una comprobación de contención consciente del separador), y solo cuando se llama a `inbox_adopt`.
- **Rechaza** una ruta de origen que no esté bajo `inboxDir`, un `subdir` que escape del espacio de trabajo y un nombre que pudiera atravesar directorios. El argumento `path` viene del modelo y nunca se confía en él.
- **No escanea** el directorio de bandeja compartido salvo que `allowTempdirScan` esté habilitado explícitamente; cuando lo hace, cada entrada que aporta lleva `source: "tempdir"`.
- **Nunca sobrescribe** en silencio. Un destino duplicado recibe un sufijo `-1`, `-2`, … salvo `overwrite: true`.
- **No registra nada** como adjunto duradero salvo que se pida; el registro copia bytes al almacén de adjuntos del anfitrión, que no tiene recolección de basura.

## Security boundaries

- Las lecturas no están cercadas por el sandbox fs del anfitrión (la cerca solo envuelve `writeText`/`editText`), así que este plugin aplica su propia contención en **ambos** extremos de la copia.
- El canal de escritura `fs` pasa por `ctx.fs.writeText` con la política de sandbox del ámbito de sesión, así que un backend restrictivo lo cerca exactamente igual que cerca la herramienta `write`. `node` omite esa cerca por construcción; existe porque `ctx.fs` no tiene API de escritura de bytes. El `copyMethod` devuelto siempre dice cuál se ejecutó.
- `auto` prefiere el servicio fs para texto y recurre a `node:fs`; el motivo del repliegue se registra y el canal se informa, nunca se insinúa.
- El escaneo del directorio temporal no puede demostrar a qué conversación pertenece un archivo. Por eso está desactivado por defecto y por eso sus entradas llevan su propio `source`.
- No se garantiza que el directorio de bandeja del puente sea privado (una refactorización del puente eliminó el manejo explícito de `0o700`/`0o600`). Este plugin no supone lo contrario.

## Known limitations

- **Una ruta con un espacio literal se trunca** en el espacio. La captura es `(\S+)` porque eso es lo que impide que se trague la frase que el puente escribe tras la ruta; los nombres temporales del propio puente nunca contienen un espacio.
- **Los tipos imagen y vídeo se informan como `file`.** El puente usa la misma redacción para ambos, así que el tipo no es recuperable del texto; el nombre de hoja (`image.png`, `video.mp4`) los distingue.
- **Una imagen o un vídeo no tienen nombre original recuperable.** El puente los guarda como `image.<ext>` / `video.mp4` y la redacción no lleva nombre original. El plugin informa el nombre en disco y lo dice, en lugar de inventarlo.
- **Una ruta de Windows solo es utilizable en Windows** (y una de POSIX solo en POSIX). El plugin normaliza los separadores como lo hace la plataforma en ejecución.
- **`inbox_adopt` necesita que el archivo siga existiendo.** El puente nunca limpia `tempfile/`, pero nada garantiza que permanezca.
- **No se ha ejercitado tráfico real de WeChat.** El script de aceptación muestra qué *sí* está verificado, y su salida indica la frontera entre lo scriptado y lo real.

## Development

```sh
pnpm install
pnpm run typecheck && pnpm test && pnpm run build \
  && pnpm run verify:self-contained && pnpm run verify:artifacts \
  && pnpm run check:readmes && pnpm run check:lockfile
pnpm run acceptance          # de extremo a extremo: sonda -> lista -> adopción -> dsh-data-quality
```

`prepublishOnly` vuelve a ejecutar la compuerta, así que una publicación no puede enviar un árbol sin construir o desviado.

## Topics

`dsh` · `dsh-plugin` · `deepseek-harness` · `cordis` · `wechat` · `inbox` · `attachment` · `phone`

## Contributors

PerryLink.

## PerryLink DSH Plugin Family

Este proyecto es uno de los **87 plugins activamente mantenidos** de DeepSeek Harness de [PerryLink](https://github.com/PerryLink). El registro familiar tiene **95** plugins — **5 congelados**, **3 retirados** — y permanece plegado abajo para que cada README conserve una primera pantalla corta. Expándelo para ver cada fila, con el motivo en la columna Estado.

<details>
<summary>Expandir los 95 plugins</summary>

| Plugin | Una línea | Estado |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
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
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

## License

Apache-2.0. Todos los archivos de este repositorio están cubiertos por ella.
