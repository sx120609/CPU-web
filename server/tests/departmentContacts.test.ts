import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import data from "../src/data/departmentContacts.json";
import { departmentContactsTool, getDepartmentContact, queryDepartmentContacts,
  isDepartmentContactCampus, detectDepartmentContactCampus, contactTelephoneUrl, safeContactUrl } from "../src/services/departmentContacts";

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


test("campus cleaning and identification follow directory additions and removals literally", () => {
  const original = [...data.contacts];
  try {
    const template = data.contacts.find((record) => record.suggestedDefaultDisplay && record.campus)!;
    for (const campus of ["江北", "无锡", "新城(东)+", "新城"]) {
      data.contacts.push({ ...template, id: `fixture-${campus}`, campus,
        department: "测试业务部门", office: "专属窗口", purpose: "测试业务" });
      assert.equal(isDepartmentContactCampus(campus), true);
      assert.equal(detectDepartmentContactCampus(`${campus}校区测试业务电话`), campus);
      for (const q of [`${campus}校区测试业务电话`, `${campus}测试业务部门电话`]) {
        const result = queryDepartmentContacts({ q });
        assert.equal(result.campus, campus);
        assert.deepEqual(result.contacts.map((record) => record.id), [`fixture-${campus}`]);
      }
    }
    data.contacts.splice(0, data.contacts.length, ...data.contacts.filter((record) => record.campus !== "新城(东)+"));
    assert.equal(isDepartmentContactCampus("新城(东)+"), false);
    assert.ok(!queryDepartmentContacts().campuses.includes("新城(东)+"));
    assert.equal(queryDepartmentContacts({ q: "新城(东)+测试业务电话" }).total, 0);
  } finally { data.contacts.splice(0, data.contacts.length, ...original); }
});

test("campus clarification follows eligible business candidates before pagination", () => {
  const original = [...data.contacts];
  try {
    const card = data.contacts.find((record) => record.office.includes("校园卡部") && record.suggestedDefaultDisplay)!;
    data.contacts.splice(0, data.contacts.length, ...data.contacts.filter((record) =>
      !/校园卡部|卡务中心/u.test(record.department + record.office + record.purpose)));
    for (const campus of ["江北", "无锡"]) data.contacts.push({ ...card, id: `card-${campus}`, campus });
    data.contacts.push({ ...card, id: "hidden-card", campus: "隐藏校区", suggestedDefaultDisplay: false });
    data.contacts.push({ ...card, id: "private-card", campus: "未公开校区", contactFieldsPubliclyPublished: false });
    const choices = queryDepartmentContacts().campuses.filter((campus) => ["江北", "无锡"].includes(campus));
    assert.equal(queryDepartmentContacts({ q: "补办校园卡", limit: 1 }).clarification, `请确认办理校区：${choices.join("、")}？`);
    assert.equal(queryDepartmentContacts({ q: "江北补办校园卡" }).clarification, null);
    assert.equal(queryDepartmentContacts({ q: "无锡补办校园卡" }).contacts[0].id, "card-无锡");
    assert.equal(queryDepartmentContacts({ q: "补办校园卡", includeSpecial: true }).clarification,
      `请确认办理校区：${[...choices, "隐藏校区"].join("、")}？`);
    data.contacts.splice(0, data.contacts.length, ...data.contacts.filter((record) => record.campus !== "江北"));
    assert.equal(queryDepartmentContacts({ q: "补办校园卡" }).clarification, "请确认办理校区：无锡？");
    data.contacts.splice(0, data.contacts.length);
    assert.equal(queryDepartmentContacts({ q: "补办校园卡" }).clarification, "请确认你需要办理业务的校区。");
  } finally { data.contacts.splice(0, data.contacts.length, ...original); }
});
