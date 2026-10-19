# dsh-phone-inbox

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

इस सत्र का फ़ोन (WeChat ब्रिज) इनबाउंड अटैचमेंट इनबॉक्स: **इस बातचीत** को वास्तव में मिले अटैचमेंट की सूची दें, और माँगे जाने पर एक को कार्यक्षेत्र में ले आएँ।

![Terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-hero.png)

![Animated terminal demo of dsh-phone-inbox](docs/assets/dsh-phone-inbox-demo.gif)

## Install & uninstall

```sh
dsh plugin --profile <name> add dsh-phone-inbox
dsh plugin --profile <name> remove dsh-phone-inbox
```

इस प्लगइन की **कोई रनटाइम निर्भरता नहीं है** (`dependencies` खाली है)। इसके एकमात्र पीयर वे होस्ट पैकेज हैं जिनके विरुद्ध यह बनता है; `package.json` का `peerDependencies` ब्लॉक देखें।

## The problem this closes

`dsh-wechat` फ़ोन से आए मीडिया को `~/.dsh-wechat/tempfile/` में रखता है — सत्र के कार्यक्षेत्र के **बाहर** — और निरपेक्ष पथ को एक सादे टेक्स्ट ब्लॉक में लिख देता है। इससे दो परिणाम निकलते हैं, और दोनों उपयोगकर्ता को दिखते नहीं:

1. **कार्यक्षेत्र तक सीमित उपकरण इसे पढ़ नहीं सकते।** `dsh-data-quality` सत्र के कार्यक्षेत्र से बाहर जाने वाले हर पथ को अस्वीकार करता है (`path-escape`), इसलिए «मैंने CSV भेजा, उसका प्रोफ़ाइल बनाओ» विफल हो जाता है, जबकि फ़ाइल वहीं मौजूद है।
2. **फ़ाइल का नाम नष्ट हो जाता है।** ब्रिज नाम `${Date.now()}-${rand4hex}-${name.replace(/[^\w.-]/g, "_")}` रखता है, इसलिए `材料.csv` डिस्क पर `__.csv` बन जाता है। उपयोगकर्ता अपनी ही फ़ाइल नहीं पहचान पाता।

`dsh-phone-inbox` कोई नया चैनल नहीं जोड़ता और डिफ़ॉल्ट रूप से कुछ कॉपी नहीं करता। यह सत्र की अपनी इनबाउंड सूची को पता-योग्य बनाता है, और वह नाम बहाल करता है जिसे ब्रिज ने बिगाड़ा — उस `[收到文件: <name>]` मार्कर से जो ब्रिज पहले से ही लिखता है।

## What you get

| उपकरण | यह किस प्रश्न का उत्तर देता है |
|---|---|
| `inbox_list` | «जो फ़ाइल मैंने अभी फ़ोन से भेजी, वह कहाँ है?» |
| `inbox_adopt` | «उसे वहाँ रखो जहाँ मेरे कार्यक्षेत्र-सीमित उपकरण पढ़ सकें।» |

दोनों उपकरण फ़ंक्शन प्लगइन द्वारा पंजीकृत होते हैं, इसलिए बंडल पंक्ति माउंट होते ही वे मॉडल की उपकरण सूची में आ जाते हैं।

## Quick start

```sh
# 1. प्लगइन माउंट करें (लक्ष्य प्रोफ़ाइल में एक बंडल पंक्ति)
dsh plugin --profile <name> add dsh-phone-inbox
```

फिर, उस सत्र में जिसे फ़ोन से अटैचमेंट मिला था:

```text
inbox_list                                   # इस सत्र को मिले पथ
inbox_adopt { "path": "<the path from inbox_list>" }
```

`inbox_adopt` `relativePath` लौटाता है (जैसे `phone-inbox/材料.csv`)। **वही** `data_profile` जैसे कार्यक्षेत्र-सीमित उपकरण को दें; मूल होस्ट पथ केवल उन उपभोक्ताओं को दें जो कोई भी निरपेक्ष पथ स्वीकार करते हैं।

## Compatibility

| Engine | Range |
|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| DSH | `>=0.2.1-alpha.1` |

होस्ट पीयर रेंज पारिस्थितिकी तंत्र की मानक छह-खंड OR रेंज है (`dsh-plugin-kit/data/peer-range.json` देखें)। होस्ट preflight पर `peerDependencies` का मूल्यांकन करता है और ऐसी प्लगइन पंक्ति को **चुपचाप disabled** कर देता है जिसकी रेंज चल रहे संस्करण को स्वीकार न करे, इसलिए गलत रेंज «प्लगइन माउंट हुआ और कुछ नहीं करता» जैसा दिखता है। होस्ट `engines.dsh` का भी स्वतंत्र रूप से निर्णय करता है; वहाँ असंगति होने पर पंक्ति disabled हो सकती है, भले ही peer रेंज संस्करण स्वीकार करे।

## Configuration

हर फ़ील्ड वैकल्पिक है; तालिका डिफ़ॉल्ट दिखाती है। `cordis.patch.yml` में वही मान इनलाइन टिप्पणियों के साथ हैं।

| Key | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `enabled` | `true` | मास्टर स्विच; `false` पर न सेवा माउंट होती है न उपकरण। |
| `inboxDir` | `""` → `~/.dsh-wechat/tempfile` | वह डिरेक्टरी जहाँ ब्रिज इनबाउंड मीडिया रखता है। खाली छोड़ने पर ब्रिज का अपना डिफ़ॉल्ट निकाला जाता है; ब्रिज का `storageDir` हटा हो तो इसे सेट करें। |
| `maxItems` | `5` | `inbox_list` द्वारा लौटाई गई प्रविष्टियों की सीमा। MVP अनुबंध «सत्र के हाल के कुछ अटैचमेंट» है। |
| `provider` | `session` | कौन-सा पंजीकृत प्रोवाइडर उत्तर देता है: `session` (इस बातचीत के संदेश) या `tempdir` (`session` के साथ `inboxDir` का स्कैन)। |
| `allowTempdirScan` | `false` | डिरेक्टरी स्कैन को सक्षम करता है। बंद है क्योंकि `inboxDir` वैश्विक है। |
| `tempdirScanMaxItems` | `5` | एक स्कैन अधिकतम कितनी प्रविष्टियाँ जोड़ सकता है। |
| `tempdirScanMaxAgeMs` | `3600000` | स्कैन की गई फ़ाइल की आयु-सीमा; `0` फ़िल्टर बंद कर देता है। |
| `markers` | नीचे देखें | प्रत्येक मीडिया प्रकार के लिए मार्कर शब्दावली, `RegExp` स्रोत के रूप में। |
| `defaultSubdir` | `phone-inbox` | `inbox_adopt` जिस कार्यक्षेत्र उपडिरेक्टरी में लिखता है। |
| `restoreOriginalName` | `true` | बहाल किए गए मूल भेजने वाले नाम को अंगीकृत फ़ाइल नाम बनाना। |
| `writeChannel` | `auto` | `auto` (टेक्स्ट के लिए fs सेवा, अन्यथा node:fs) · `fs` (केवल होस्ट fs सेवा) · `node` (सीधे बाइट्स)। |
| `registerAttachment` | `false` | अंगीकृत बाइट्स को होस्ट के टिकाऊ अटैचमेंट के रूप में भी पंजीकृत करना। अटैचमेंट ऑब्जेक्ट कभी GC नहीं होते। |

`markers` की डिफ़ॉल्ट शब्दावली, प्रत्येक मीडिया प्रकार के लिए — हर मान एक `RegExp` स्रोत है जिसका **पहला कैप्चर समूह पथ है**:

- `image.path` — `` 文件已保存到:\s*(\S+) ``
- `file.path` — `` (?:文件已保存到|文件路径):\s*(\S+) ``
- `file.name` — `` \[收到文件:\s*([^\]\r\n]+)\] ``
- `video.path` — `` 文件已保存到:\s*(\S+) ``

मार्कर शब्दावली ब्रिज के साथ एक **कोमल अनुबंध** है: ब्रिज पथ को गद्य में लिखता है, और गद्य ब्रिज के संस्करणों के बीच बिना सूचना बदल सकता है। पैटर्न इसीलिए कॉन्फ़िगरेशन हैं ताकि शब्दावली बदलना एक कॉन्फ़िगरेशन संपादन हो, प्लगइन रिलीज़ नहीं।

## Tools & surfaces

```ts
inbox_list({
  limit?: number,            // डिफ़ॉल्ट: config.maxItems
  includeTempdir?: boolean,  // केवल तब माना जाता है जब allowTempdirScan true हो
})
```

लौटाता है `{ ok: true, source, inboxDir, items[], attachments, deriveMessages, emptyReason?, emptyDetail?, tempdirScan, unresolvedAttachmentBlocks }`, या `{ ok: false, reason, detail }`।

```ts
inbox_adopt({
  path: string,              // अनिवार्य: ठीक वही जो inbox_list ने बताया
  name?: string,             // डिफ़ॉल्ट: बहाल किया गया मूल नाम
  subdir?: string,           // डिफ़ॉल्ट: config.defaultSubdir
  channel?: 'auto' | 'fs' | 'node',
  overwrite?: boolean,       // डिफ़ॉल्ट false: डुप्लिकेट को -1 प्रत्यय मिलता है
  register?: boolean,        // डिफ़ॉल्ट: config.registerAttachment
})
```

लौटाता है `{ ok: true, item }` जिसमें `hostPath`, `workspacePath`, `relativePath`, `bytes`, `sha256`, `copyMethod`, `nameRestored`, `sourceLeafName` हैं, और पंजीकरण पर `attachmentId`/`attachmentHostPath`; या `{ ok: false, reason, detail }`।

प्लगइन सिस्टम प्रॉम्प्ट में एक अनुभाग (`phone-inbox`, क्रम 320) भी जोड़ता है ताकि मॉडल को इस क्षमता का पता रहे, और `user/message` देखने के लिए `session/event` की सदस्यता लेता है। शुद्धता के लिए दोनों में से कोई आवश्यक नहीं: हर कॉल पर इतिहास-पठन ही प्रामाणिक स्रोत है।

## Permissions & data

- **पढ़ता है** `inboxDir` और कॉल करने वाले सत्र के अपने संदेश। और कुछ नहीं।
- **लिखता है** केवल सत्र के कार्यक्षेत्र के भीतर (`path.resolve` और विभाजक-सजग containment जाँच), और केवल जब `inbox_adopt` कहा जाए।
- **अस्वीकार करता है** `inboxDir` के बाहर का स्रोत पथ, कार्यक्षेत्र से भागने वाला `subdir`, और ऐसा नाम जो पथ-भेद कर सके। `path` तर्क मॉडल से आता है और उस पर कभी भरोसा नहीं किया जाता।
- **स्कैन नहीं करता** साझा inbox डिरेक्टरी, जब तक `allowTempdirScan` स्पष्ट रूप से सक्षम न हो; सक्षम होने पर वह जोड़ी गई हर प्रविष्टि `source: "tempdir"` लेकर आती है।
- **कभी चुपचाप अधिलेखन नहीं** करता। डुप्लिकेट गंतव्य को `-1`, `-2`, … प्रत्यय मिलता है, जब तक `overwrite: true` न हो।
- **कुछ भी पंजीकृत नहीं** करता टिकाऊ अटैचमेंट के रूप में, जब तक माँगा न जाए; पंजीकरण बाइट्स को होस्ट के अटैचमेंट स्टोर में कॉपी करता है, जहाँ कोई कचरा-संग्रह नहीं है।

## Security boundaries

- पठन होस्ट के fs सैंडबॉक्स से घिरा नहीं है (बाड़ केवल `writeText`/`editText` को लपेटती है), इसलिए यह प्लगइन प्रतिलिपि के **दोनों** सिरों पर अपनी containment लागू करता है।
- `fs` लेखन चैनल `ctx.fs.writeText` से जाता है और सत्र-क्षेत्र की सैंडबॉक्स नीति साथ लाता है, इसलिए सीमित करने वाला बैकएंड उसे ठीक वैसे ही घेरता है जैसे `write` उपकरण को। `node` चैनल रचना से उस बाड़ को छोड़ देता है; यह इसलिए है क्योंकि `ctx.fs` में बाइट-लेखन API नहीं है। लौटाया गया `copyMethod` हमेशा बताता है कि कौन चला।
- `auto` टेक्स्ट के लिए fs सेवा को प्राथमिकता देता है और अन्यथा `node:fs` पर लौटता है; पतन का कारण दर्ज होता है और चैनल बताया जाता है, कभी इशारे से नहीं।
- डिरेक्टरी स्कैन यह सिद्ध नहीं कर सकता कि कोई फ़ाइल किस बातचीत की है। इसीलिए यह डिफ़ॉल्ट रूप से बंद है और इसीलिए इसकी प्रविष्टियाँ अपना `source` साथ रखती हैं।
- ब्रिज की inbox डिरेक्टरी के निजी होने की कोई गारंटी नहीं है (ब्रिज के एक पुनर्गठन ने स्पष्ट `0o700`/`0o600` व्यवहार हटा दिया)। यह प्लगइन ऐसा नहीं मानता।

## Known limitations

- **शाब्दिक स्पेस वाला पथ** स्पेस पर काट दिया जाता है। कैप्चर `(\S+)` है क्योंकि यही उसे ब्रिज द्वारा पथ के बाद लिखे गए वाक्य को निगलने से रोकता है; ब्रिज के अपने अस्थायी नामों में कभी स्पेस नहीं होता।
- **छवि और वीडियो प्रकार `file` के रूप में बताए जाते हैं।** ब्रिज दोनों के लिए एक ही शब्दावली रखता है, इसलिए प्रकार टेक्स्ट से पुनर्प्राप्त नहीं हो सकता; लीफ़ नाम (`image.png`, `video.mp4`) इन्हें अलग करता है।
- **छवि या वीडियो का कोई बहाल-योग्य मूल नाम नहीं होता।** ब्रिज उन्हें `image.<ext>` / `video.mp4` के रूप में सहेजता है और शब्दावली में मूल नाम नहीं होता। प्लगइन डिस्क का नाम बताता है और यह कह देता है, बनाता नहीं।
- **Windows पथ केवल Windows पर उपयोगी है** (और POSIX पथ केवल POSIX पर)। प्लगइन विभाजकों को चल रहे प्लेटफ़ॉर्म के अनुसार सामान्य करता है।
- **`inbox_adopt` को फ़ाइल का अब भी मौजूद होना चाहिए।** ब्रिज `tempfile/` कभी साफ़ नहीं करता, पर उसके बने रहने की कोई गारंटी नहीं।
- **कोई वास्तविक WeChat ट्रैफ़िक नहीं चलाया गया।** स्वीकृति स्क्रिप्ट दिखाती है कि क्या *सत्यापित* है, और उसका आउटपुट स्क्रिप्टेड बनाम वास्तविक की सीमा बताता है।

## Development

```sh
pnpm install
pnpm run typecheck && pnpm test && pnpm run build \
  && pnpm run verify:self-contained && pnpm run verify:artifacts \
  && pnpm run check:readmes && pnpm run check:lockfile
pnpm run acceptance          # शुरू से अंत तक: प्रोब -> सूची -> अंगीकरण -> dsh-data-quality
```

`prepublishOnly` गेट दोबारा चलाता है, इसलिए कोई रिलीज़ अनिर्मित या विचलित ट्री नहीं भेज सकती।

## Topics

`dsh` · `dsh-plugin` · `deepseek-harness` · `cordis` · `wechat` · `inbox` · `attachment` · `phone`

## Contributors

PerryLink.

## PerryLink DSH Plugin Family

यह प्रोजेक्ट [PerryLink](https://github.com/PerryLink) के DeepSeek Harness प्लगइन परिवार का हिस्सा है। पूरी सूची नीचे संक्षिप्त रखी गई है ताकि हर README की पहली स्क्रीन छोटी रहे; हर पंक्ति और उसकी स्थिति देखने के लिए इसे खोलें।

<details>
<summary>सभी प्लगइन खोलें</summary>

| प्लगइन | स्थिति |
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
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 फ़्रोज़न — रिपॉज़िटरी README देखें |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 फ़्रोज़न — रिपॉज़िटरी README देखें |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 फ़्रोज़न — रिपॉज़िटरी README देखें |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 फ़्रोज़न — रिपॉज़िटरी README देखें |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 फ़्रोज़न — रिपॉज़िटरी README देखें |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 सेवानिवृत्त — रिपॉज़िटरी README देखें |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 सेवानिवृत्त — रिपॉज़िटरी README देखें |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 सेवानिवृत्त — रिपॉज़िटरी README देखें |

</details>

## License

Apache-2.0। इस रिपॉज़िटरी की हर फ़ाइल इसके अंतर्गत है।
