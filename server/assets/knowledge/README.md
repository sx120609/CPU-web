# 拾间AI 检索资料

`school-docs.json` 是拾间AI 和论坛“拾间AI 参考回答”检索用的学校事务资料：研究生学生手册、推免管理办法与各学院细则、接收推免通知、2027 硕士招生简章、往年复试线与招生规模、2026 版共识期刊及会议目录等。来源是“中国药科大学_学校事务问答资料_2026-10-15”资料包。

由 `server/scripts/import-school-knowledge.mjs` 生成，不要手改：

```bash
node server/scripts/import-school-knowledge.mjs <解压后的“中国药科大学学校问答资料”目录> [资料包名称]
```

资料包的文件名是 GBK 编码，解压时要按 GBK 还原中文文件名。

整理规则（脚本会逐份打印收录和跳过的原因）：

- 只收 Markdown 正文；网页快照、解析差异补充、待核材料、目录页、与原文重复的汇编、公众号/小红书/直播稿不收。
- 名单、评定结果、加分表、一志愿名单等含学生姓名学号排名的资料整份不收；正文里出现 4 行以上学号的文件也按名单处理（例如“01-附件”）。收录的正文中仍带本科学号、推免报名号、考生编号、身份证号的行整行删除。`server/tests/campusKnowledge.test.ts` 会检查数据里没有这些号码。
- `90_历史资料` 标为 historical，`91_汇总与辅助` 标为 summary，其余为 current；检索时现行原文略优先，模型回答时按年份说明适用性。

构建时 `scripts/copy-desktop-userscripts.mjs` 把这个文件复制到 `dist/assets/knowledge/`。
