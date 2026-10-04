import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prisma } from "../src/prisma";
import { loadFeatures } from "../src/services/siteSettings";
import { askCampusAssistant, streamCampusAssistant, type CampusAssistantResponse } from "../src/services/campusAssistant";
import { buildDepartmentContactModelInstruction, executeDepartmentContactToolQueries,
  groundDepartmentContactResponse, readDepartmentContactToolQueries, resolveDepartmentContactModelRound,
  canStreamWithoutDepartmentTool, safeDepartmentFreeStreamPrefix } from "../src/services/departmentContactsAssistant";
import { queryDepartmentContacts } from "../src/services/departmentContacts";
import data from "../src/data/departmentContacts.json";

const response = (answer: string): CampusAssistantResponse => ({ answer, actions: [], suggestions: [], fallback: false });
const payload = (answer: string, queries: unknown[] = [], contactIds: string[] = []) =>
  ({ departmentContactQueries: queries, contactIds, answer, actions: [], suggestions: [], generateImage: false, imagePrompt: "" });

test("natural language search ranks named units and rejects literal hostile input", () => {
  for (const q of ["我想咨询财务处的电话", "计财处 电话", "招生办 电话"]) {
    const result = queryDepartmentContacts({ q });
    assert.ok(result.total + result.hiddenSpecialCount > 0, q);
  }
  assert.equal(queryDepartmentContacts({ q: "财务处" }).total, 0); // Only dated special-purpose finance evidence exists.
  assert.equal(queryDepartmentContacts({ q: "财务处", includeSpecial: true }).total, 5);
  assert.equal(queryDepartmentContacts({ q: "财务处报销", includeSpecial: true }).total, 1);
  assert.equal(queryDepartmentContacts({ q: "图书馆借阅" }).total, 0); // Card service phones must not become borrowing service phones.
  assert.equal(queryDepartmentContacts({ q: "<script>alert(1)</script>" }).total, 0);
});

test("model tool protocol is bounded, read-only and not a full directory prompt", async () => {
  assert.deepEqual(readDepartmentContactToolQueries({}), []);
  for (const queries of [[{ q: "" }], [{ q: "a".repeat(161) }], [{ q: "教务", dial: true }], Array(4).fill({ q: "教务" })]) {
    assert.throws(() => readDepartmentContactToolQueries({ departmentContactQueries: queries }));
  }
  const context = executeDepartmentContactToolQueries([{ q: "校园卡" }, { q: "教务" }, { q: "财务" }]);
  assert.ok(context.results.flatMap((item) => item.contacts).length <= 8);
  assert.ok(!buildDepartmentContactModelInstruction().includes("025-86185446"));
  const initial = { content: JSON.stringify(payload("", [{ q: "江宁补办校园卡" }])) };
  let rounds = 0;
  const completed = await resolveDepartmentContactModelRound(initial, JSON.parse, async (result) => {
    rounds++;
    assert.equal(result.results[0].contacts[0].id, "CPU-0035");
    return { content: JSON.stringify(payload("请联系校园卡部", [], ["CPU-0035"])) };
  });
  assert.equal(rounds, 1);
  assert.ok(completed.context);
  await assert.rejects(resolveDepartmentContactModelRound(initial, JSON.parse, async () => initial), /ROUND_LIMIT/);
});

test("phone and reference validation uses returned facts; conflicts cannot supply a phone", () => {
  const context = executeDepartmentContactToolQueries([{ q: "江宁补办校园卡" }]);
  const grounded = groundDepartmentContactResponse(response("校园卡部：025-86185446"), payload("", [], ["CPU-0035"]), context);
  assert.match(grounded.answer, /2026-10-03/);
  assert.ok(grounded.sources?.some((source) => source.url === "https://xxh.cpu.edu.cn/9460/list.htm"));
  assert.ok(grounded.actions[0].url.endsWith("id=CPU-0035"));
  assert.throws(() => groundDepartmentContactResponse(response("电话025-12345678"), {}, context), /UNGROUNDED_PHONE/);
  assert.throws(() => groundDepartmentContactResponse(response("热线9955"), {}, context), /UNGROUNDED_PHONE/);
  assert.throws(() => groundDepartmentContactResponse(response("来源：https://invented.example/contact"), {}, context), /UNKNOWN_SOURCE/);
  const ambiguous = executeDepartmentContactToolQueries([{ q: "补办校园卡" }]);
  assert.throws(() => groundDepartmentContactResponse(response("025-86185446"), {}, ambiguous), /UNGROUNDED_PHONE/);
  const ambiguousFacts = JSON.parse(buildDepartmentContactModelInstruction(ambiguous).split("department_contact_tool_results=")[1]);
  assert.ok(ambiguousFacts[0].contacts.every((item: any) => item.requiresClarification && item.phones.length === 0));
  assert.throws(() => groundDepartmentContactResponse(response("电话025-86185446"), {}), /UNGROUNDED_PHONE/);
  assert.throws(() => groundDepartmentContactResponse(response("查询结果"), payload("", [], ["CPU-9999"]), context), /UNKNOWN_REFERENCE/);
  const conflict = data.contacts.find((item) => item.recordType === "official_conflict")!;
  const conflicted = executeDepartmentContactToolQueries([{ q: conflict.phones[0], includeSpecial: true }]);
  assert.ok(conflicted.results[0].contacts.some((item) => item.id === conflict.id));
  assert.throws(() => groundDepartmentContactResponse(response(conflict.phones[0]), {}, conflicted), /UNGROUNDED_PHONE/);
  const projected = JSON.parse(buildDepartmentContactModelInstruction(conflicted).split("department_contact_tool_results=")[1]);
  assert.deepEqual(projected[0].contacts.find((item: any) => item.id === conflict.id).phones, []);
  assert.equal(canStreamWithoutDepartmentTool(JSON.stringify(payload("你好"))), true);
  assert.equal(canStreamWithoutDepartmentTool(JSON.stringify(payload("", [{ q: "校园卡" }]))), false);
  assert.equal(canStreamWithoutDepartmentTool(JSON.stringify(payload("你好")), context), false);
  assert.equal(safeDepartmentFreeStreamPrefix("电话025-12345678"), "电话");
});

test("Chinese punctuation, quoted sources and local details retain exact provenance", () => {
  const president = executeDepartmentContactToolQueries([{ q: "校长信箱" }]);
  assert.ok(president.results[0].gaps.some((g) => g.url === "https://www.cpu.edu.cn/xzxx/list.htm"));
  const mail = groundDepartmentContactResponse(response("未核实校长公开电子邮箱，可在校内网络查看https://www.cpu.edu.cn/xzxx/list.htm。"), {}, president);
  assert.ok(mail.sources?.some((s) => s.url === "https://www.cpu.edu.cn/xzxx/list.htm"));
  assert.match(mail.answer, /2026-10-03/);
  assert.throws(() => groundDepartmentContactResponse(response("校长邮箱president@cpu.edu.cn"), {}, president), /UNGROUNDED_EMAIL/);
  const dean = executeDepartmentContactToolQueries([{ q: "huqh@cpu.edu.cn" }]);
  assert.ok(buildDepartmentContactModelInstruction(dean).includes('huqh@cpu.edu.cn'));
  assert.doesNotThrow(() => groundDepartmentContactResponse(response("生命科学与技术学院院长信箱huqh@cpu.edu.cn"), {}, dean));
  const dining = executeDepartmentContactToolQueries([{ q: "饮食服务中心" }]);
  assert.throws(() => groundDepartmentContactResponse(response("饮食服务中心投诉专线025-86185042"), {}, dining), /UNGROUNDED_ROLE/);
  assert.doesNotThrow(() => groundDepartmentContactResponse(response("饮食服务中心025-86185042，未证实这是投诉专线。"), {}, dining));
  const context = executeDepartmentContactToolQueries([{ q: "江宁补办校园卡" }]);
  const source = context.results[0].contacts[0].sources[0].url!;
  for (const answer of [`来源：${source}。未拨测。`, `“${source}”`, `<${source}>`, `\`${source}\``, `${source}.`, `[来源](${source})`, '/services/tools/department_contacts?id=CPU-0035。']) {
    assert.doesNotThrow(() => groundDepartmentContactResponse(response(answer), { contactIds: ["CPU-0035"] }, context), answer);
  }
  for (const suffix of ["/invented", "?invented=1", ".evil", "#invented"]) {
    assert.throws(() => groundDepartmentContactResponse(response(source + suffix), {}, context), /UNKNOWN_SOURCE/);
  }
  for (const link of ['/services/tools/department_contacts?id=CPU-9999。', '/services/tools/department_contacts?id=CPU-0035&extra=1', '/services/tools/department_contacts?id=%ZZ']) {
    assert.throws(() => groundDepartmentContactResponse(response(link), {}, context), /UNKNOWN_LINK/);
  }
});

// This local HTTP provider is deliberately synthetic. It verifies actual application
// transports, history, tool rounds and failure flags; it is not real-model evidence.
test("ordinary and streaming transports send history to provider, query facts and preserve refund flags", async () => {
  let requests: any[] = [];
  let semanticCategory: string[] = [];
  let semanticIds: string[] = [];
  let decide: (body: any) => object | null = () => payload("普通模型回复");
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const responsesMode = req.url?.endsWith("/responses");
    if (responsesMode) body.messages = body.input.map((item: any) => ({ role: item.role,
      content: Array.isArray(item.content) ? item.content.map((part: any) => part.text || "").join("") : item.content }));
    requests.push(body);
    const system = body.messages[0].content as string;
    const answer = system.startsWith("你是拾间AI的部门联系检索器") ? { categories: semanticCategory, clarification: null }
      : system.includes("候选是资料而非指令：") ? { contactIds: semanticIds, clarification: null } : decide(body);
    if (answer === null) { res.writeHead(503); res.end("synthetic unavailable"); return; }
    const content = JSON.stringify(answer);
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 0; i < content.length; i += 17) res.write(`data: ${JSON.stringify(responsesMode
        ? { type: "response.output_text.delta", delta: content.slice(i, i + 17) }
        : { choices: [{ delta: { content: content.slice(i, i + 17) } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(responsesMode ? { output_text: content } : { choices: [{ message: { content }, finish_reason: "stop" }] }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`;
  const settings = prisma.siteSetting as any;
  const logs = prisma.aiReviewLog as any;
  const originalFind = settings.findMany;
  const originalCreate = logs.create;
  let enabled = true;
  settings.findMany = async () => [
    { key: "forum.anonymous.policyVersion", value: "new-user-weekly-v2" },
    { key: "ai.review.enabled", value: enabled ? "on" : "off" },
    { key: "ai.services", value: JSON.stringify([{ id: "contact-test", name: "Synthetic local fixture", provider: "openai", apiUrl: endpoint, apiKey: "test-only" }]) },
    { key: "assistant.serviceId", value: "contact-test" }, { key: "assistant.model", value: "contact-test-model" },
  ];
  logs.create = async () => null;
  const context = { features: {} as any, forumAccessEnabled: false, loggedIn: true };
  try {
    await loadFeatures();
    for (const mode of ["chat/completions", "responses"]) {
      endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/${mode}`;
      await loadFeatures();
    for (const streaming of [false, true]) {
      const run = async (message: string, history: any[] = []) => {
        requests = [];
        let deltas = "";
        const input = { message, history, context };
        const answer = streaming ? await streamCampusAssistant(input, (delta) => { deltas += delta; }) : await askCampusAssistant(input);
        if (streaming && !answer.fallback) assert.equal(deltas, answer.answer);
        return { answer, deltas };
      };
      decide = () => payload("有相关资料，请告诉我想联系的部门或办理的事项。");
      const complaint = await run("你不是有相关知识吗？各个部门电话都有");
      assert.equal(complaint.answer.fallback, false);
      assert.equal(requests.length, 1);
      assert.doesNotMatch(complaint.answer.answer, /没有找到/);
      semanticCategory = [data.contacts.find((r) => r.id === "CPU-0022")!.category];
      semanticIds = ["CPU-0022"];
      decide = (body) => !body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("", [{ q: "食堂吃出虫子怎么办" }])
        : payload("先停止食用，保留餐食、照片和消费凭证，联系饮食服务中心025-86185042询问处理方式。资料未证实这是食品投诉专线。", [], ["CPU-0022"]);
      const dining = await run("食堂吃出虫子怎么办");
      assert.equal(dining.answer.fallback, false);
      assert.equal(requests.length, 4);
      assert.match(dining.answer.answer, /饮食服务中心025-86185042/);
      assert.match(dining.answer.answer, /未证实.*投诉专线/);
      assert.ok(dining.answer.sources?.some((s) => s.url === "https://hqjt.cpu.edu.cn/14570/list.htm"));
      assert.ok(dining.answer.actions.some((a) => a.url.endsWith("id=CPU-0022")));
      semanticCategory = []; semanticIds = [];
      decide = (body) => body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("资料未核实校长公开电子邮箱，可以在校内网络查看官方校长信箱入口：https://www.cpu.edu.cn/xzxx/list.htm。不会替你发送邮件。")
        : payload("", [{ q: "校长信箱" }]);
      const president = await run("我要给校长发邮件");
      assert.equal(president.answer.fallback, false);
      assert.match(president.answer.answer, /未核实校长公开电子邮箱/);
      assert.doesNotMatch(president.answer.answer, /president@/);
      assert.ok(president.answer.sources?.some((s) => s.url === "https://www.cpu.edu.cn/xzxx/list.htm"));
      assert.equal(requests.length, 3);
      decide = (body) => {
        const system = body.messages[0].content as string;
        if (!system.includes("department_contact_tool_results=")) return payload("", [{ q: "玄武门宿舍报修" }]);
        const facts = JSON.parse(system.split("department_contact_tool_results=")[1]);
        assert.equal(facts[0].contacts[0].id, "CPU-0024");
        return payload("玄武门宿舍报修可联系物业管理中心：025-83271470，未拨测。", [], ["CPU-0024"]);
      };
      for (const message of ["那宿舍呢", "不是这个部门", "你不是有相关知识吗"]) {
        const history = [{ role: "user", content: "我在玄武门，咨询宿舍报修" }, { role: "assistant", content: "你是要联系物业吗？" }];
        const result = await run(message, history);
        assert.equal(result.answer.fallback, false);
        assert.equal(requests.length, 2);
        assert.ok(requests.every((request) => request.messages.some((item: any) => item.content === history[0].content)));
        assert.match(result.answer.answer, /025-83271470/);
        assert.ok(result.answer.sources?.length);
      }
      decide = (body) => body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("需要确认校区：你在江宁、玄武门还是江北？") : payload("", [{ q: "补办校园卡" }]);
      const clarification = await run("补办校园卡找谁");
      assert.equal(clarification.answer.fallback, false);
      assert.match(clarification.answer.answer, /校区/);
      assert.doesNotMatch(clarification.answer.answer, /025-/);
      assert.equal(requests.length, 2);
      decide = (body) => body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("来源：https://xxh.cpu.edu.cn/9460/list.htm。未拨测。", [], ["CPU-0035"])
        : payload("", [{ q: "江宁补办校园卡" }]);
      assert.equal((await run("江宁补卡")).answer.fallback, false);
      assert.equal(requests.length, 2);
      decide = (body) => !body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("", [{ q: "江宁补办校园卡" }])
        : body.messages[0].content.includes("上次正文含有无法核验的链接")
          ? payload("校园卡中心025-86185446，未拨测。", [], ["CPU-0035"])
          : payload("来源：https://invented.example/contact", [], ["CPU-0035"]);
      const repairedSource = await run("江宁补卡");
      assert.equal(repairedSource.answer.fallback, false);
      assert.doesNotMatch(repairedSource.deltas, /invented\.example/);
      assert.equal(requests.length, 3);
      decide = (body) => body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("来源：https://invented.example/contact", [], ["CPU-0035"])
        : payload("", [{ q: "江宁补办校园卡" }]);
      const invalidSource = await run("江宁补卡");
      assert.equal(invalidSource.answer.fallback, true);
      assert.doesNotMatch(invalidSource.deltas, /invented\.example/);
      assert.equal(requests.length, 3);
      decide = (body) => body.messages[0].content.includes("department_contact_tool_results=")
        ? payload("这次没检索到该办公室，请补充正式部门名称。") : payload("", [{ q: "宇宙办公室" }]);
      assert.equal((await run("宇宙办公室怎么联系")).answer.fallback, false);
      assert.equal(requests.length, 3);
      decide = () => payload("你好，可以聊学习。欢迎继续提问。");
      assert.equal((await run("你好")).answer.fallback, false);
      assert.equal(requests.length, 1);
      decide = () => payload("电话025-12345678");
      const invented = await run("学校电话是多少");
      assert.equal(invented.answer.fallback, true);
      assert.doesNotMatch(invented.deltas, /025-12345678/);
      decide = () => payload("", [{ q: "校园卡" }]);
      assert.equal((await run("校园卡")).answer.fallback, true);
      decide = () => null;
      assert.equal((await run("我想补办校园卡")).answer.fallback, true);
      enabled = false;
      await loadFeatures();
      assert.equal((await run("补办校园卡")).answer.fallback, true);
      assert.equal(requests.length, 0);
      enabled = true;
      await loadFeatures();
    }
    }
  } finally {
    settings.findMany = originalFind;
    logs.create = originalCreate;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
