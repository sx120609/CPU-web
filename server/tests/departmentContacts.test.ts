import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import data from "../src/data/departmentContacts.json";
import { departmentContactsTool, getDepartmentContact, queryDepartmentContacts,
  contactTelephoneUrl, safeContactUrl } from "../src/services/departmentContacts";
import { answerDepartmentContactRequest } from "../src/services/departmentContactsAssistant";
import { departmentContactsRouter } from "../src/routes/departmentContacts";

test("real Library dataset retains all records, sources, scope and conflicts", () => {
  assert.equal(data.contacts.length, 262);
  assert.equal(data.sources.length, 77);
  assert.equal(data.gaps.length, 24);
  assert.equal(new Set(data.contacts.map((record) => record.id)).size, 262);
  assert.equal(data.contacts.filter((record) => record.suggestedDefaultDisplay).length, 190);
  assert.equal(data.meta.notOfficialDirectory, true);
  for (const record of data.contacts) {
    assert.ok(record.sourceIds.length);
    assert.equal(record.checkedAt, "2026-10-03");
    for (const id of record.sourceIds) assert.ok(data.sources.some((source) => source.sourceId === id));
    for (const url of record.sourceUrls) assert.ok(safeContactUrl(url));
  }
});

test("Chinese intent search uses actual card department records and requires campus", () => {
  const result = queryDepartmentContacts({ q: "我想补办校园卡" });
  assert.equal(result.intent, "campus-card");
  assert.match(result.clarification!, /校区/u);
  assert.deepEqual(result.contacts.map((record) => record.id), ["CPU-0035", "CPU-0036"]);
  assert.equal(queryDepartmentContacts({ q: "玄武门补办校园卡" }).total, 0);
  const card = queryDepartmentContacts({ q: "江宁补办校园卡" });
  assert.equal(card.clarification, null);
  assert.equal(card.contacts[0].phones[0].number, "025-86185446");
  assert.equal(card.contacts[0].sources[0].url, "https://xxh.cpu.edu.cn/9460/list.htm");
});

test("repair intent uses standing property office, never summer apartment duty", () => {
  const result = departmentContactsTool.execute({ q: "玄武门宿舍漏水报修" });
  assert.deepEqual(result.contacts.map((record) => record.id), ["CPU-0024"]);
  assert.equal(result.contacts[0].phones[0].number, "025-83271470");
  assert.equal(result.contacts[0].purpose, "物业服务中心");
  assert.equal(result.contacts[0].sourceDate, null);
});

test("academic ambiguity, specific windows, classification, campus and pagination", () => {
  assert.match(queryDepartmentContacts({ q: "教务咨询" }).clarification!, /本科生|研究生/u);
  assert.deepEqual(queryDepartmentContacts({ q: "选课咨询电话" }).contacts.map((item) => item.id), ["CPU-0200"]);
  assert.deepEqual(queryDepartmentContacts({ q: "学生证补办电话" }).contacts.map((item) => item.id), ["CPU-0199"]);
  const category = queryDepartmentContacts({ category: "信息化与校园卡", campus: "江宁", limit: 2 });
  assert.equal(category.contacts.length, 2);
  assert.ok(category.contacts.every((item) => item.category === "信息化与校园卡" && item.campus === "江宁"));
  const second = queryDepartmentContacts({ category: "信息化与校园卡", campus: "江宁", offset: 2, limit: 2 });
  assert.notEqual(second.contacts[0].id, category.contacts[0].id);
  assert.ok(queryDepartmentContacts({ q: "学工处电话" }).contacts.every((item) => item.department === "学生工作处"));
  assert.ok(queryDepartmentContacts({ q: "学工处电话" }).total > 0);
});

test("historical, recruitment and conflicting evidence remains explicitly scoped", () => {
  const all = queryDepartmentContacts({ includeSpecial: true, limit: 50 });
  assert.equal(all.total, 262);
  const seasonal = getDepartmentContact("CPU-0228")!;
  assert.match(seasonal.note, /07-13至08-30/u);
  assert.ok(seasonal.warnings.some((value) => value.includes("季节性")));
  const conflict = data.contacts.find((record) => record.recordType === "official_conflict")!;
  assert.ok(getDepartmentContact(conflict.id)!.warnings.some((value) => value.includes("冲突")));
  assert.ok(!queryDepartmentContacts({ q: conflict.phones[0] }).contacts.some((value) => value.id === conflict.id));
  const recruitment = data.contacts.find((record) => record.recordType === "recruitment_contact")!;
  assert.match(getDepartmentContact(recruitment.id)!.warnings.join(" "), /人才招聘/u);
  const older = data.contacts.find((record) => record.evidenceStatus.includes("较早"))!;
  assert.match(getDepartmentContact(older.id)!.warnings.join(" "), /较早/u);
});

test("unknown and hostile input remains literal and bounded, URLs and dial links are safe", () => {
  for (const q of ["不存在的宇宙办公室", "<script>alert(1)</script>", "'; DROP TABLE user;--", ".*[", "__proto__"]) {
    assert.equal(queryDepartmentContacts({ q }).total, 0);
  }
  assert.equal(safeContactUrl("javascript:alert(1)"), null);
  assert.equal(safeContactUrl("https://user:pass@cpu.edu.cn/"), null);
  assert.equal(contactTelephoneUrl("025-83271510转0"), "tel:02583271510;ext=0");
  assert.equal(contactTelephoneUrl("javascript:123"), null);
  assert.equal(contactTelephoneUrl("025-86185446"), "tel:02586185446");
  assert.equal(getDepartmentContact("../secrets"), null);
});

test("assistant really calls the shared lookup, cites sources and carries clarification", () => {
  const clarify = answerDepartmentContactRequest("补办校园卡")!;
  assert.match(clarify.answer, /校区/u);
  assert.doesNotMatch(clarify.answer, /025-/u);
  const reply = answerDepartmentContactRequest("江宁校区", [
    { role: "user", content: "补办校园卡" }, { role: "assistant", content: clarify.answer },
  ])!;
  assert.match(reply.answer, /025-86185446/u);
  assert.match(reply.answer, /图书馆|校园卡部/u);
  assert.match(reply.answer, /来源发布：未标日期/u);
  assert.match(reply.answer, /资料核对：2026-10-03/u);
  assert.ok(reply.sources?.some((source) => source.url === "https://xxh.cpu.edu.cn/9460/list.htm"));
  assert.ok(reply.actions.every((action) => action.url.startsWith("/services/tools/department_contacts?id=")));
  assert.doesNotMatch(reply.answer, /tel:|mailto:/u);
  assert.equal(answerDepartmentContactRequest("你好"), null);
  assert.equal(answerDepartmentContactRequest("江宁校区"), null);
  const academic = answerDepartmentContactRequest("教务咨询")!;
  assert.doesNotMatch(academic.answer, /025-/u);
  assert.match(answerDepartmentContactRequest("本科生选课咨询电话", [
    { role: "user", content: "教务咨询" }, { role: "assistant", content: academic.answer },
  ])!.answer, /025-86185797/u);
  const followUp = answerDepartmentContactRequest("本科生，选课", [
    { role: "user", content: "教务咨询" }, { role: "assistant", content: academic.answer },
  ])!;
  assert.match(followUp.answer, /025-86185797/u);
  const unsupported = answerDepartmentContactRequest("本科生学籍咨询电话")!;
  assert.doesNotMatch(unsupported.answer, /025-/u);
  assert.match(unsupported.answer, /没有找到/u);
  const graduate = answerDepartmentContactRequest("研究生成绩单咨询电话")!;
  assert.match(graduate.answer, /研究生院/u);
  assert.match(graduate.answer, /成绩单及证明/u);
});

test("assistant cannot invent an unknown number or use conflicting candidates", () => {
  const reply = answerDepartmentContactRequest("不存在的宇宙办公室电话")!;
  assert.doesNotMatch(reply.answer, /025-/u);
  assert.match(reply.answer, /没有找到/u);
  const conflict = data.contacts.find((record) => record.recordType === "official_conflict")!;
  const result = answerDepartmentContactRequest(`${conflict.phones[0]}电话`)!;
  assert.doesNotMatch(result.answer, new RegExp(conflict.phones[0]));
  const library = answerDepartmentContactRequest("图书馆借阅电话")!;
  assert.match(library.answer, /未核实借阅/u);
  assert.ok(library.sources?.some((source) => source.url === "https://lib.cpu.edu.cn/"));
});

test("actual ordinary and streaming assistant transports dispatch to the same contact tool", async () => {
  const { askCampusAssistant, streamCampusAssistant, searchCampusAssistantActions } = await import("../src/services/campusAssistant");
  const context = { features: {} as any, forumAccessEnabled: false, loggedIn: true };
  const input = { message: "江宁补办校园卡", history: [], context };
  const ordinary = await askCampusAssistant(input);
  let streamed = "";
  const streaming = await streamCampusAssistant(input, (delta) => { streamed += delta; });
  assert.deepEqual(streaming, ordinary);
  assert.equal(streamed, ordinary.answer);
  assert.match(streamed, /025-86185446/u);
  assert.ok(searchCampusAssistantActions("部门联系", context).some((action) => action.id === "department-contacts"));
});

test("HTTP public read-only API validates input and returns the shared query result", async () => {
  const app = express();
  app.use("/contacts", departmentContactsRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/contacts`;
  try {
    const response = await fetch(`${url}?q=${encodeURIComponent("江宁补办校园卡")}`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.data.contacts.map((item: any) => item.id), ["CPU-0035", "CPU-0036"]);
    assert.equal((await fetch(`${url}/CPU-0035`)).status, 200);
    assert.equal((await fetch(`${url}/CPU-9999`)).status, 404);
    assert.equal((await fetch(`${url}?q[]=教务`)).status, 400);
    assert.equal((await fetch(`${url}?limit=100000`)).status, 400);
    assert.equal((await fetch(`${url}?q=${"a".repeat(161)}`)).status, 400);
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
