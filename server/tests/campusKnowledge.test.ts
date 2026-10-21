import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  extractKnowledgeQueryTerms,
  focusedExcerpt,
  knowledgePlainText,
  normalizeKnowledgeText,
  rankKnowledgeEntries,
} from "../src/services/knowledgeText";
import { searchSchoolDocs, setSchoolDocsForTests } from "../src/services/schoolDocsKnowledge";
import { readCampusKnowledgeRefs, type CampusKnowledgeItem } from "../src/services/campusKnowledge";
import {
  attachCampusKnowledgeSources,
  buildAssistantMessages,
  campusAssistantKnowledgeQuery,
  loadCampusAssistantKnowledge,
  shouldProactivelySearchWeb,
  linkifyAssistantUrls,
  normalizeCampusAssistantAnswerText,
} from "../src/services/campusAssistant";
import { groundDepartmentContactResponse } from "../src/services/departmentContactsAssistant";
import {
  buildForumAiAnswerMessages,
  isForumAiAnswerCandidate,
  looksLikeForumQuestion,
  resolveForumAiAnswer,
  siteKnowledgeItems,
} from "../src/services/forumAiAnswer";

const schoolDocsFile = path.resolve(__dirname, "../assets/knowledge/school-docs.json");
const schoolRegulationsFile = path.resolve(__dirname, "../assets/knowledge/school-regulations.json");

function entry(title: string, body: string) {
  const titleKey = normalizeKnowledgeText(title);
  return { title, titleKey, bodyKey: `${titleKey}\n${normalizeKnowledgeText(body)}` };
}

function item(ref: string, overrides: Partial<CampusKnowledgeItem> = {}): CampusKnowledgeItem {
  return {
    ref,
    kind: "school-doc",
    title: "中国药科大学研究生学生手册",
    where: "第四部分 学业篇 > 中国药科大学研究生更换导师实施细则",
    date: null,
    status: "current",
    excerpt: "研究生因导师退休、离职等原因可以申请更换导师，联系电话：86185301。",
    source: null,
    ...overrides,
  };
}

test("query terms skip function words instead of producing cross-word bigrams", () => {
  const terms = extractKnowledgeQueryTerms("Journal of Medicinal Chemistry 在共识期刊目录里是什么级别");
  assert.ok(terms.includes("journal"));
  assert.ok(terms.includes("medicinal"));
  assert.ok(terms.includes("期刊"));
  assert.ok(terms.includes("级别"));
  for (const junk of ["在共", "录里", "里是", "什么"]) assert.ok(!terms.includes(junk), junk);
  assert.deepEqual(extractKnowledgeQueryTerms("你好"), []);
});

test("question wording maps to the words school documents use", () => {
  const terms = extractKnowledgeQueryTerms("推免申请需要注意哪些时间节点？");
  assert.deepEqual(terms, ["推免", "免申", "申请", "注意", "日程|时间|截止|日期|安排"]);
  const entries = [entry("推免工作通知", "一、工作日程：9 月 1 日推免工作开始，9 月 15 日结束，学生按时提交申请，注意材料"), entry("宿舍", "空调报修")];
  const ranked = rankKnowledgeEntries(entries, terms, { minCoverage: 0.4, limit: 3 });
  assert.equal(ranked[0]?.entry.title, "推免工作通知");
  assert.ok(focusedExcerpt("x".repeat(300) + "工作日程" + "y".repeat(300), ["日程|时间"], 40).includes("日程"));
});

test("a follow-up keeps the documents the previous answer drew on", async () => {
  const history = [
    { role: "user" as const, content: "本科生可以做什么" },
    { role: "assistant" as const, content: "推免工作 9 月 1 日开始，9 月 15 日结束。" },
  ];
  const context = { features: { forum: false, coursereview: false } as any, forumAccessEnabled: false, loggedIn: true };
  const previousOnly = await loadCampusAssistantKnowledge("本科生可以做什么", [], context);
  const followUp = await loadCampusAssistantKnowledge("推免申请需要注意哪些时间节点？", history, context);
  const previousTitles = previousOnly.filter((item) => item.kind === "school-doc").map((item) => item.title);
  assert.ok(previousTitles.length > 0);
  assert.ok(followUp.some((item) => previousTitles.includes(item.title)), "previous turn's documents must stay in view");
  assert.ok(followUp.some((item) => !previousTitles.includes(item.title)), "the follow-up's own documents must be there too");
});

test("bare URLs become explicit links that stop before Chinese text", () => {
  const answer = normalizeCampusAssistantAnswerText("1. 先打开 https://i.cpu.edu.cn，确认学校统一认证能否正常登录。");
  assert.equal(answer, "1. 先打开 [https://i.cpu.edu.cn](https://i.cpu.edu.cn)，确认学校统一认证能否正常登录。");
  assert.equal(normalizeCampusAssistantAnswerText(answer), answer);
  assert.equal(linkifyAssistantUrls("见 [官网](https://www.cpu.edu.cn)、<https://a.cn/x> 和 `curl https://x.cn/a`"), "见 [官网](https://www.cpu.edu.cn)、<https://a.cn/x> 和 `curl https://x.cn/a`");
  assert.equal(linkifyAssistantUrls("下载：https://apps.apple.com/cn/app/id6811073406（需要 iOS 15）。"), "下载：[https://apps.apple.com/cn/app/id6811073406](https://apps.apple.com/cn/app/id6811073406)（需要 iOS 15）。");
  assert.equal(linkifyAssistantUrls("end https://cputime.cn."), "end [https://cputime.cn](https://cputime.cn).");
});

test("factual questions search the web unless the site or school documents already cover them", () => {
  const action = { id: "dorm-electric", label: "宿舍电费查询", description: "", url: "/services?open=electric", icon: "", owner: "", requireLogin: true };
  assert.equal(shouldProactivelySearchWeb("学校有几个门", []), true);
  assert.equal(shouldProactivelySearchWeb("江宁校区图书馆几点开门", []), true);
  assert.equal(shouldProactivelySearchWeb("学校有几个门", [], [item("R1", { coverage: 0.8 })]), false);
  assert.equal(shouldProactivelySearchWeb("学校有几个门", [], [item("R1", { coverage: 0.5 })]), true);
  assert.equal(shouldProactivelySearchWeb("宿舍电费在哪里查？", [action]), false);
  assert.equal(shouldProactivelySearchWeb("我的成绩是多少？", []), false);
  assert.equal(shouldProactivelySearchWeb("拾间AI是什么", []), false);
  assert.equal(shouldProactivelySearchWeb("你好", []), false);
  assert.equal(shouldProactivelySearchWeb("请联网搜索中国药科大学最新通知", [action]), true);
});

test("terms absent from the whole corpus do not bury the matching entry", () => {
  const entries = [
    entry("宿舍管理规定", "发现损坏及时报修，物业人员巡查宿舍卫生"),
    entry("奖学金评定", "国家奖学金评审条件"),
    entry("请假规定", "学生请假须经辅导员批准"),
  ];
  const ranked = rankKnowledgeEntries(entries, extractKnowledgeQueryTerms("宿舍报修怎么弄"), { minCoverage: 0.4, limit: 3 });
  assert.equal(ranked[0]?.entry.title, "宿舍管理规定");
  assert.equal(ranked.length, 1);
});

test("a single matching term is not enough when the query has several", () => {
  const entries = [entry("食堂开放时间", "第一食堂早上六点半开门"), entry("图书馆", "开放时间八点")];
  const ranked = rankKnowledgeEntries(entries, extractKnowledgeQueryTerms("游泳馆开放时间"), { minCoverage: 0.6, limit: 3 });
  assert.equal(ranked.length, 0);
});

test("plain text drops markup and excerpts focus on the matching part", () => {
  assert.equal(knowledgePlainText("![图](a.png) **报名** 见[通知](https://x.cn/a)"), "报名 见通知");
  const long = `${"前言".repeat(200)}复试时间为九月二十日${"附则".repeat(200)}`;
  const excerpt = focusedExcerpt(long, ["复试", "时间"], 60);
  assert.ok(excerpt.includes("复试时间"));
  assert.ok(excerpt.startsWith("…"));
});

test("school documents answer handbook and recommendation questions", () => {
  const advisor = searchSchoolDocs("研究生可以换导师吗");
  assert.ok(advisor.some((hit) => hit.documentId === "S0024" && /更换导师/u.test(`${hit.heading}${hit.excerpt}`)));
  const score = searchSchoolDocs("推免综合成绩怎么算");
  assert.ok(score.some((hit) => /综合成绩/u.test(hit.excerpt)));
  const fee = searchSchoolDocs("硕士学费多少");
  assert.ok(fee.some((hit) => /学费标准/u.test(hit.excerpt)));
  assert.deepEqual(searchSchoolDocs("你好"), []);
});

test("regulations answer with the current version, its document number and applicability", () => {
  const amount = searchSchoolDocs("优秀学生奖学金一等奖多少钱");
  const current = amount.find((hit) => hit.docNo === "药大学〔2024〕109号");
  assert.ok(current && /3500/u.test(current.excerpt), JSON.stringify(amount.map((hit) => [hit.docNo, hit.heading])));
  assert.match(current.heading, /附件1.*第五条/u);
  // The 2019 article is word-for-word the same amount; only one copy may take a slot.
  assert.ok(!amount.some((hit) => hit.docNo === "药大学〔2019〕381号" && /3500/u.test(hit.excerpt)));

  const old = searchSchoolDocs("2019年优秀学生奖学金评选办法药大学〔2019〕381号还有效吗");
  const legacy = old.find((hit) => hit.docNo === "药大学〔2019〕381号");
  assert.ok(legacy, JSON.stringify(old.map((hit) => hit.docNo)));
  assert.match(legacy.note || "", /部分适用.*药大学〔2024〕109号.*2020级至2022级/u);

  const repealed = searchSchoolDocs("异地研究院知识产权转化收益分配指导原则");
  const hit = repealed.find((item) => item.docNo === "药大科〔2022〕124号");
  assert.ok(hit && hit.status === "historical" && /已废止/u.test(hit.note || ""));
});

test("a school-docs copy of a regulation is replaced by the regulation original", () => {
  const hits = searchSchoolDocs("本科生综合素质测评办法 测评内容");
  assert.ok(hits.length);
  assert.ok(!hits.some((hit) => hit.documentId === "S0272"), "S0272 is the same file as 药大学〔2023〕160号");
  assert.ok(hits.some((hit) => hit.docNo === "药大学〔2023〕160号"));
});

test("near-duplicate passages from different files take one slot", () => {
  const doc = (id: string, title: string) => ({ id, title, category: "测试", status: "current" as const, date: null, sourceUrl: null, extracted: null });
  const text = "第十条 学生请假三天以内由辅导员审批，三天以上七天以内由学院分管领导审批，超过七天报学生工作处备案。";
  setSchoolDocsForTests([
    { version: 1, source: "a", documents: [doc("S1", "研究生学生手册")], chunks: [{ d: 0, h: "请假", t: text }] },
    { version: 1, source: "b", documents: [{ ...doc("R1", "学生请假管理办法"), docNo: "药大学〔2025〕1号" }],
      chunks: [{ d: 0, h: "第十条", t: text.replace("。", "，并录入系统。") }] },
  ]);
  try {
    assert.equal(searchSchoolDocs("学生请假审批 辅导员 学院").length, 1);
  } finally {
    setSchoolDocsForTests();
  }
});

for (const file of [schoolDocsFile, schoolRegulationsFile]) {
  test(`${path.basename(file)} carries no student numbers or name lists`, () => {
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      documents: Array<{ id: string; title: string }>;
      chunks: Array<{ t: string }>;
    };
    const text = data.chunks.map((chunk) => chunk.t).join("\n");
    assert.equal(text.match(/(?<!\d)20[0-3]\d{7,8}(?!\d)/gu), null, "student or application numbers left in the corpus");
    assert.equal(text.match(/(?<!\d)\d{17}[\dXx](?![\dXx])/gu), null, "ID card numbers left in the corpus");
    for (const doc of data.documents) {
      assert.doesNotMatch(doc.title, /名单|评定结果|加分公示|一志愿/u, `${doc.id} ${doc.title}`);
    }
    assert.ok(!data.documents.some((doc) => doc.id === "S0290"), "the recommended-student list must stay out");
  });
}

test("the prompt shows a regulation's document number and applicability note", () => {
  const regulation = item("R1", {
    title: "中国药科大学优秀学生奖学金评选办法",
    docNo: "药大学〔2019〕381号",
    note: "部分适用：药大学〔2024〕109号规定2020级至2022级学生仍按本办法执行",
  });
  const system = String(buildAssistantMessages("优秀奖学金", [], [], true, "test-model", [], undefined, [], undefined, [regulation])[0].content);
  assert.match(system, /"docNo":"药大学〔2019〕381号"/u);
  assert.match(system, /"note":"部分适用/u);
});

test("follow-up questions are searched together with the previous question", () => {
  assert.equal(
    campusAssistantKnowledgeQuery("那第二批呢", [{ role: "user", content: "预推免什么时候报名" }, { role: "assistant", content: "……" }]),
    "那第二批呢\n预推免什么时候报名",
  );
  assert.equal(campusAssistantKnowledgeQuery("研究生请假需要哪些手续和审批流程", []), "研究生请假需要哪些手续和审批流程");
});

test("the assistant prompt carries campus knowledge only when something was found", () => {
  const plain = buildAssistantMessages("怎么换导师", [], [], true, "test-model");
  assert.doesNotMatch(String(plain[0].content), /campus_knowledge=/u);
  const withKnowledge = buildAssistantMessages("怎么换导师", [], [], true, "test-model", [], undefined, [], undefined, [item("R1")]);
  const system = String(withKnowledge[0].content);
  assert.match(system, /campus_knowledge=\[\{"ref":"R1","kind":"school-doc"/u);
  assert.match(system, /knowledgeRefs/u);
});

test("cited knowledge becomes response sources; uncited and unlinked items do not", () => {
  const items = [
    item("R1", { source: { title: "学校文件 · 推免办法", url: "https://jwc.cpu.edu.cn/a.htm" } }),
    item("R2"),
    item("R3", { kind: "forum", source: { title: "论坛 · 换导师经验", url: "/forum/topic/12" }, topicId: 12 }),
  ];
  assert.deepEqual(readCampusKnowledgeRefs({ knowledgeRefs: ["r3", "R9", "R1", "R3"] }, items).map((value) => value.ref), ["R3", "R1"]);
  const response = attachCampusKnowledgeSources(
    { answer: "可以申请。", actions: [], suggestions: [], fallback: false },
    { knowledgeRefs: ["R1", "R2", "R3"] },
    items,
  );
  assert.deepEqual(response.sources, [
    { title: "学校文件 · 推免办法", url: "https://jwc.cpu.edu.cn/a.htm" },
    { title: "论坛 · 换导师经验", url: "/forum/topic/12" },
  ]);
  const fallback = attachCampusKnowledgeSources({ answer: "x", actions: [], suggestions: [], fallback: true }, { knowledgeRefs: ["R1"] }, items);
  assert.equal(fallback.sources, undefined);
});

test("phones and emails quoted from retrieved documents pass the contact grounding check", () => {
  const response = { answer: "可以联系研究生院 025-86185301，或发邮件到 yjsy@cpu.edu.cn。", actions: [], suggestions: [], fallback: false };
  assert.throws(() => groundDepartmentContactResponse(response, {}, undefined, ""), /DEPARTMENT_CONTACT_UNGROUNDED/u);
  const grounded = groundDepartmentContactResponse(response, {}, undefined, "联系电话：86185301；邮箱 yjsy@cpu.edu.cn");
  assert.equal(grounded.answer, response.answer);
});

test("only question-like posts on answerable boards get an AI answer", () => {
  const base = { hidden: false, author: { role: "user" } };
  assert.ok(isForumAiAnswerCandidate({ ...base, title: "研究生换导师要走什么流程", content: "", board: { type: "question", slug: "question" } }));
  assert.ok(isForumAiAnswerCandidate({ ...base, title: "宿舍空调坏了怎么报修", content: "", board: { type: "normal", slug: "life" } }));
  assert.ok(!isForumAiAnswerCandidate({ ...base, title: "今天食堂的鸡腿真好吃", content: "分享一下", board: { type: "normal", slug: "life" } }));
  assert.ok(!isForumAiAnswerCandidate({ ...base, title: "有人和我一样难过吗", content: "", board: { type: "normal", slug: "treehole" } }));
  assert.ok(!isForumAiAnswerCandidate({ ...base, title: "出二手自行车，有人要吗", content: "", board: { type: "market", slug: "market" } }));
  assert.ok(!isForumAiAnswerCandidate({ ...base, hidden: true, title: "补考什么时候", content: "", board: { type: "question", slug: "question" } }));
  assert.ok(!isForumAiAnswerCandidate({ ...base, author: { role: "bot" }, title: "关于补考安排的通知？", content: "", board: { type: "normal", slug: "life" } }));
  assert.ok(looksLikeForumQuestion("求问", "第二批预推免还能报名吗"));
});

test("course time questions get the jwxt course search as site knowledge", () => {
  const items = siteKnowledgeItems(
    "公选课",
    "想知道公选课《中药和天然药现代研发范例解读》和《基于中药和天然药物的新药发现》每周什么时间在哪个教室上课呢？想去旁听",
    1,
  );
  const jwxt = items.find((entry) => entry.title === "教务数据");
  assert.ok(jwxt, "教务数据 should be offered");
  assert.match(jwxt.excerpt, /课表检索可按课程、教师、教室或班级查询/u);
  assert.equal(jwxt.ref, `R${items.indexOf(jwxt) + 1}`);
});

test("forum answers need a question, enough confidence and real citations", () => {
  const items = [item("R1"), item("R2", { kind: "forum", title: "换导师经验", where: "提问广场", topicId: 7, source: { title: "论坛 · 换导师经验", url: "/forum/topic/7" } })];
  const answer = "可以。导师退休或离职时可以申请更换导师 [R2]。手册规定需要提交申请 [R1]，往期帖子里有同学提到要先和原导师沟通 [R2]。";
  assert.equal(resolveForumAiAnswer({ isQuestion: false, answerable: true, confidence: 90, answer, citations: ["R1"] }, items, 75).ok, false);
  assert.equal(resolveForumAiAnswer({ isQuestion: true, answerable: false, confidence: 90, answer, citations: ["R1"] }, items, 75).ok, false);
  const low = resolveForumAiAnswer({ isQuestion: true, answerable: true, confidence: 60, answer, citations: ["R1"] }, items, 75);
  assert.equal(low.ok, false);
  assert.equal(low.confidence, 60);
  assert.equal(resolveForumAiAnswer({ isQuestion: true, answerable: true, confidence: 90, answer: "可以申请更换导师，按规定提交申请即可。", citations: ["R9"] }, items, 75).ok, false);

  const accepted = resolveForumAiAnswer({ isQuestion: true, answerable: true, confidence: 88, answer, citations: ["R1", "R2"] }, items, 75);
  assert.ok(accepted.ok);
  if (!accepted.ok) return;
  // 来源按正文里第一次出现的顺序编号。
  assert.equal(accepted.answer, "可以。导师退休或离职时可以申请更换导师 [1]。手册规定需要提交申请 [2]，往期帖子里有同学提到要先和原导师沟通 [1]。");
  assert.deepEqual(accepted.sources.map((source) => [source.n, source.kind, source.url]), [[1, "forum", "/forum/topic/7"], [2, "school-doc", null]]);
});

test("forum answers with invented contacts are dropped", () => {
  const items = [item("R1")];
  const invented = resolveForumAiAnswer({
    isQuestion: true, answerable: true, confidence: 90, citations: ["R1"],
    answer: "可以申请更换导师，具体问研究生院 025-12345678 [R1]。",
  }, items, 75);
  assert.equal(invented.ok, false);
  const quoted = resolveForumAiAnswer({
    isQuestion: true, answerable: true, confidence: 90, citations: ["R1"],
    answer: "可以申请更换导师，具体问研究生院 025-86185301 [R1]。",
  }, items, 75);
  assert.ok(quoted.ok);
});

test("the forum answer prompt sends the post and sources but no author", () => {
  const messages = buildForumAiAnswerMessages({ boardName: "提问广场", title: "换导师流程", content: "**急** 想换导师" }, [item("R1")], new Date("2026-10-17T02:00:00Z"));
  const payload = JSON.parse(String(messages[1].content));
  assert.equal(payload.today, "2026-10-17");
  assert.deepEqual(payload.post, { board: "提问广场", title: "换导师流程", content: "急 想换导师" });
  assert.equal(payload.sources[0].ref, "R1");
  assert.match(String(messages[0].content), /isQuestion/u);
});
