# 拾间AI 检索资料

拾间AI 和论坛“拾间AI 参考回答”检索用的学校事务资料，两份文件在 `schoolDocsKnowledge.ts` 里建成同一个索引一起排序。

## school-docs.json

研究生学生手册、推免管理办法与各学院细则、接收推免通知、2027 硕士招生简章、往年复试线与招生规模、2026 版共识期刊及会议目录等。来源是“中国药科大学_学校事务问答资料_2026-10-15”资料包。

由 `server/scripts/import-school-knowledge.mjs` 生成，不要手改：

```bash
node server/scripts/import-school-knowledge.mjs <解压后的“中国药科大学学校问答资料”目录> [资料包名称]
```

资料包的文件名是 GBK 编码，解压时要按 GBK 还原中文文件名。

整理规则（脚本会逐份打印收录和跳过的原因）：

- 只收 Markdown 正文；网页快照、解析差异补充、待核材料、目录页、与原文重复的汇编、公众号/小红书/直播稿不收。
- 名单、评定结果、加分表、一志愿名单等含学生姓名学号排名的资料整份不收；正文里出现 4 行以上学号的文件也按名单处理（例如“01-附件”）。收录的正文中仍带本科学号、推免报名号、考生编号、身份证号的行整行删除。`server/tests/campusKnowledge.test.ts` 会检查数据里没有这些号码。
- `90_历史资料` 标为 historical，`91_汇总与辅助` 标为 summary，其余为 current；检索时现行原文略优先，模型回答时按年份说明适用性。

## school-regulations.json

学校规范性文件数智化管理平台“制度公开”栏目（主动公开、全体师生可见）的规章制度原文，2026-10-22 快照，284 份。每份带文号（`docNo`）和 `note`：适用范围、被哪份新文件替代或调整、施行时间、解释部门。平台对全部文件都标“有效”，所以 `note` 和 `status` 由整理脚本从文件自身的废止条款、“仍按《…》执行”过渡条款和同名新版推断，已废止的标为 historical。

由 `server/scripts/build-campus-regulations.py` 生成，不要手改。输入是导出目录（`metadata.json` 和 `拾间数据库/work/txt/` 下每份文件的纯文本：PDF 用 pdftotext，.doc 用 LibreOffice 转文本，扫描件 OCR）：

```bash
python -I server/scripts/build-campus-regulations.py <导出目录>
```

整理规则：

- 去掉红头、页码、印发行，按 PDF 排版断开的行重新接起来；同一文件里重复的段落（.doc 导出的通知页会印两遍）只留一份。
- 每段是一条（第X条）或一小组段落，`h` 写附件、章、条的位置，回答可以引用“文号 + 条款”。
- 跨文件逐字相同的条文只保留最新文件里的那一份；`replaces` 列出 school-docs.json 里与某份制度重复的文档（按文号或标题匹配），加载时以制度原文为准。检索结果里再按文字重合度去掉手册转录稿、新旧版未改条款这类近似重复。
- `note` 另含“适用与衔接”：适用对象、“以本办法为准”、“具体标准由对应文件规定”、“某级仍按《…》执行”、“参照执行”这类决定条文对谁适用、该看哪份文件的句子；“从 2025 级开始执行，原《…》同时废止”按部分适用处理，不标已废止。
- `links` 记下替代、被替代或过渡期仍适用的相关文件。检索命中一条时，再附上同一文件里也回答这个问题的条款（最多 2 条），以及关联文件里最相关的一条；关联条款与已选条款几乎相同时只附不同的那几句（例如旧版多出的“四级≥425 分”）。
- 跨页断开的半句在切分前接回去，否则“仍按照《…》（…号）执行”会被拆成两段。
- 含学号、考生编号、身份证号的行整行删除，规则与上面相同。

## 检索方式与 school-vectors

`schoolDocsKnowledge.ts` 是一条 RAG 检索流水线：

1. 召回：关键词（字二元组 + idf，`knowledgeText.ts`）和语义向量（bge-small-zh-v1.5，`knowledgeEmbedding.ts`）各取前 60 段；口语先按 `expandCampusQuery` 补上规定写法（挂科→不及格、综测→综合素质测评……）。
2. 融合：两路分数各自归一化后加权（语义 0.4），乘时效、适用人群、专题、本科/研究生层次、点名文件等先验。
3. 选段：默认 5 段短摘录，每份文件限额、近似重复留原文和新版、各层次各有代表；由生成模型自己挑对题的段落。
4. 扩展：前 3 段附同一文件和关联文件的相关条款，文件的适用与衔接条款在 note 里。

`school-vectors.bin` / `school-vectors.json` 是每段的语义向量（int8，按段落内容哈希对齐）。资料改了以后要重算，否则改过的段落只走关键词检索，`tests/knowledgeRetrievalEval.test.ts` 也会报未对齐：

```bash
npm --prefix server run knowledge:model     # 下载模型到 server/assets/models/（不进仓库）
npm --prefix server run knowledge:vectors   # 只重算新增或改动的段落，默认 2 线程
```

模型在构建时由 `scripts/build-server.mjs` 下载（固定提交 + SHA-256 校验），随 dist 发布；线上只给问题编码（单线程，几毫秒）。模型或原生库加载失败时检索退回纯关键词。`server/.npmrc` 关掉了 onnxruntime-node 在 Linux 上默认下载 CUDA 组件的安装步骤。

`tests/fixtures/knowledgeRetrievalEval.json` 是检索评测集：学生常问的问题和答案必须出现的原文片段，CI 要求召回率 ≥ 97%。改检索逻辑或资料时先跑它。

构建时 `scripts/copy-desktop-userscripts.mjs` 把资料、向量和模型复制到 `dist/assets/`。
