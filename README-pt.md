# dsh-phone-inbox

A caixa de entrada de anexos do telefone (ponte do WeChat) desta sessão: liste os anexos que **esta conversa** realmente recebeu e adote um no espaço de trabalho quando pedido.

![Terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-hero.png)

![Animated terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-demo.gif)

## The problem this closes

O `dsh-wechat` grava as mídias recebidas do telefone em `~/.dsh-wechat/tempfile/` — fora do espaço de trabalho da sessão — e escreve o caminho absoluto num bloco de texto simples. Duas consequências decorrem disso, e nenhuma é visível ao usuário:

1. **Ferramentas confinadas ao espaço de trabalho não conseguem lê-lo.** O `dsh-data-quality` rejeita qualquer caminho que escape do espaço de trabalho da sessão (`path-escape`), então «enviei um CSV, faça o perfil» falha mesmo com o arquivo ali.
2. **O nome do arquivo é destruído.** A ponte o nomeia `${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}`, então `材料.csv` fica no disco como `__.csv`. O usuário não reconhece o próprio arquivo.

O `dsh-phone-inbox` não adiciona canal novo e não copia nada por padrão. Ele torna endereçável a lista de entrada da própria sessão e recupera o nome que a ponte mutilou — a partir do marcador `[收到文件: <name>]` que a ponte já escreve.

## What you get

| Ferramenta | Pergunta que responde |
|---|---|
| `inbox_list` | «Onde está o arquivo que acabei de enviar do telefone?» |
| `inbox_adopt` | «Coloque-o onde minhas ferramentas confinadas ao espaço de trabalho possam lê-lo.» |

Ambas são registradas pelo plugin funcional, então aparecem na lista de ferramentas do modelo assim que a linha do bundle é montada.

## Quick start

```sh
# 1. Monte o plugin (uma linha de bundle no perfil de destino)
dsh plugin --profile <name> add dsh-phone-inbox
```

Depois, numa sessão que recebeu um anexo do telefone:

```text
inbox_list                                   # os caminhos que esta sessão recebeu
inbox_adopt { "path": "<the path from inbox_list>" }
```

`inbox_adopt` devolve `relativePath` (por exemplo `phone-inbox/材料.csv`). Passe **esse** caminho a uma ferramenta confinada ao espaço de trabalho, como `data_profile`; passe o caminho hospedeiro original apenas a consumidores que aceitam qualquer caminho absoluto.

## Install & uninstall

```sh
dsh plugin --profile <name> add dsh-phone-inbox
dsh plugin --profile <name> remove dsh-phone-inbox
```

O plugin **não tem dependências de runtime** (`dependencies` está vazio). Seus únicos pares são os pacotes hospedeiros contra os quais é compilado; veja o bloco `peerDependencies` em `package.json`.

## Compatibility

| Engine | Range |
|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>=0.2.1-alpha.1` |

O intervalo de pares do hospedeiro é o intervalo OR canônico de seis cláusulas do ecossistema (veja `dsh-plugin-kit/data/peer-range.json`). O hospedeiro avalia `peerDependencies` no preflight e **desativa silenciosamente** uma linha de plugin cujo intervalo não admita a versão em execução, então um intervalo errado parece «o plugin montou e não faz nada». O hospedeiro também avalia `engines.dsh` de forma independente; uma divergência ali pode desativar a linha mesmo que o intervalo de pares aceite a versão.

## Configuration

Todos os campos são opcionais; a tabela traz o padrão. O `cordis.patch.yml` tem os mesmos valores com comentários em linha.

| Key | Padrão | Significado |
|---|---|---|
| `enabled` | `true` | Chave mestra; `false` não monta serviço nem ferramentas. |
| `inboxDir` | `""` → `~/.dsh-wechat/tempfile` | Diretório onde a ponte deposita mídias recebidas. Vazio deriva o padrão da ponte; defina-o quando o `storageDir` da ponte foi movido. |
| `maxItems` | `5` | Teto de entradas que `inbox_list` devolve. O contrato do MVP é «os últimos anexos da sessão». |
| `provider` | `session` | Qual provedor registrado responde: `session` (as mensagens desta conversa) ou `tempdir` (`session` mais uma varredura de `inboxDir`). |
| `allowTempdirScan` | `false` | Habilita a varredura do diretório. Desligada porque `inboxDir` é global. |
| `tempdirScanMaxItems` | `5` | Teto de entradas que uma varredura pode contribuir. |
| `tempdirScanMaxAgeMs` | `3600000` | Limite de idade de um arquivo varrido; `0` desativa o filtro. |
| `markers` | veja abaixo | Redação do marcador por tipo de mídia, como fontes `RegExp`. |
| `defaultSubdir` | `phone-inbox` | Subdiretório do espaço de trabalho onde `inbox_adopt` escreve. |
| `restoreOriginalName` | `true` | Usar o nome original recuperado do remetente como nome adotado. |
| `writeChannel` | `auto` | `auto` (serviço fs para texto, node:fs caso contrário) · `fs` (apenas o serviço fs do hospedeiro) · `node` (bytes diretamente). |
| `registerAttachment` | `false` | Registrar também os bytes adotados como anexo durável do hospedeiro. Objetos de anexo nunca são coletados. |

A redação padrão de `markers`, por tipo de mídia — cada valor é uma fonte `RegExp` cujo **primeiro grupo de captura é o caminho**:

- `image.path` — `` 文件已保存到:\s*(\S+) ``
- `file.path` — `` (?:文件已保存到|文件路径):\s*(\S+) ``
- `file.name` — `` \[收到文件:\s*([^\]\r\n]+)\] ``
- `video.path` — `` 文件已保存到:\s*(\S+) ``

A redação do marcador é um **contrato mole** com a ponte: ela escreve o caminho em prosa, e a prosa pode mudar entre versões da ponte sem aviso. Os padrões são configuração exatamente para que uma mudança de redação seja uma edição de configuração, não uma publicação do plugin.

## Tools & surfaces

```ts
inbox_list({
  limit?: number,            // padrão: config.maxItems
  includeTempdir?: boolean,  // só é honrado quando allowTempdirScan é true
})
```

Devolve `{ ok: true, source, inboxDir, items[], attachments, deriveMessages, emptyReason?, emptyDetail?, tempdirScan, unresolvedAttachmentBlocks }`, ou `{ ok: false, reason, detail }`.

```ts
inbox_adopt({
  path: string,              // obrigatório: exatamente o que inbox_list informou
  name?: string,             // padrão: o nome original recuperado
  subdir?: string,           // padrão: config.defaultSubdir
  channel?: 'auto' | 'fs' | 'node',
  overwrite?: boolean,       // padrão false: um duplicado recebe sufixo -1
  register?: boolean,        // padrão: config.registerAttachment
})
```

Devolve `{ ok: true, item }` com `hostPath`, `workspacePath`, `relativePath`, `bytes`, `sha256`, `copyMethod`, `nameRestored`, `sourceLeafName`, e `attachmentId`/`attachmentHostPath` quando registrado; ou `{ ok: false, reason, detail }`.

O plugin também acrescenta uma seção ao prompt do sistema (`phone-inbox`, ordem 320) para o modelo saber que a capacidade existe, e assina `session/event` para observar `user/message`. Nenhuma das duas é necessária à correção: a leitura do histórico é autoritativa em cada chamada.

## Permissions & data

- **Lê** `inboxDir` e as mensagens da própria sessão chamadora. Nada mais.
- **Escreve** apenas dentro do espaço de trabalho da sessão (`path.resolve` mais uma verificação de contenção ciente do separador), e apenas quando `inbox_adopt` é chamado.
- **Recusa** um caminho de origem fora de `inboxDir`, um `subdir` que escape do espaço de trabalho e um nome que possa atravessar diretórios. O argumento `path` vem do modelo e nunca é confiado.
- **Não varre** o diretório de caixa de entrada compartilhado a menos que `allowTempdirScan` esteja explicitamente habilitado; quando varre, cada entrada que contribui leva `source: "tempdir"`.
- **Nunca sobrescreve** em silêncio. Um destino duplicado recebe sufixo `-1`, `-2`, … a menos que `overwrite: true`.
- **Não registra nada** como anexo durável a menos que pedido; o registro copia bytes para o armazenamento de anexos do hospedeiro, que não tem coleta de lixo.

## Security boundaries

- As leituras não são cercadas pelo sandbox fs do hospedeiro (a cerca envolve apenas `writeText`/`editText`), então este plugin aplica sua própria contenção em **ambas** as pontas da cópia.
- O canal de escrita `fs` passa por `ctx.fs.writeText` com a política de sandbox do escopo da sessão, então um backend restritivo o cerca exatamente como cerca a ferramenta `write`. O canal `node` contorna essa cerca por construção; ele existe porque `ctx.fs` não tem API de escrita de bytes. O `copyMethod` devolvido sempre diz qual foi executado.
- `auto` prefere o serviço fs para texto e recorre a `node:fs`; o motivo do recuo é registrado e o canal é informado, nunca implícito.
- A varredura do diretório temporário não consegue provar a qual conversa um arquivo pertence. Por isso está desligada por padrão e por isso suas entradas carregam o próprio `source`.
- Não há garantia de que o diretório de caixa de entrada da ponte seja privado (uma refatoração da ponte removeu o tratamento explícito de `0o700`/`0o600`). Este plugin não assume o contrário.

## Known limitations

- **Um caminho com espaço literal é truncado** no espaço. A captura é `(\S+)` porque é isso que impede que ela engula a frase que a ponte escreve depois do caminho; os nomes temporários da própria ponte nunca contêm espaço.
- **Os tipos imagem e vídeo são informados como `file`.** A ponte usa a mesma redação para ambos, então o tipo não é recuperável do texto; o nome folha (`image.png`, `video.mp4`) os distingue.
- **Uma imagem ou um vídeo não têm nome original recuperável.** A ponte os salva como `image.<ext>` / `video.mp4` e a redação não traz nome original. O plugin informa o nome em disco e o diz, em vez de inventar um.
- **Um caminho Windows só é utilizável no Windows** (e um POSIX apenas no POSIX). O plugin normaliza os separadores conforme a plataforma em execução.
- **O `inbox_adopt` exige que o arquivo ainda exista.** A ponte nunca limpa `tempfile/`, mas nada garante que ele permaneça.
- **Nenhum tráfego real de WeChat foi exercitado.** O script de aceitação mostra o que *é* verificado, e sua saída indica a fronteira entre o scriptado e o real.

## Development

```sh
pnpm install
pnpm run typecheck && pnpm test && pnpm run build \
  && pnpm run verify:self-contained && pnpm run verify:artifacts \
  && pnpm run check:readmes && pnpm run check:lockfile
pnpm run acceptance          # ponta a ponta: sondagem -> lista -> adoção -> dsh-data-quality
```

O `prepublishOnly` executa o portão novamente, então uma publicação não pode enviar uma árvore não construída ou desviada.

## Topics

`dsh` · `dsh-plugin` · `deepseek-harness` · `cordis` · `wechat` · `inbox` · `attachment` · `phone`

## Contributors

PerryLink.

## License

Apache-2.0. Todos os arquivos deste repositório estão cobertos por ela.
