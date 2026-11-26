import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAcademicGrades } from "../src/shared/jwxtGradeStats";
import { computeSharedFreeSlots } from "../src/services/personalAgent/scheduleTools";
import {
  createPersonalAgentStore,
  defaultPersonalAgentPermissions,
  hasPersonalAgentConsent,
  PERSONAL_AGENT_CONSENT_VERSION,
  personalAgentActive,
  personalAgentConsentSchema,
  personalAgentPermissionsPatchSchema,
  type PersonalAgentRecordRow,
  type PersonalAgentStorageAdapter,
} from "../src/services/personalAgent/store";
import { buildPersonalAgentSystemPrompt, coerceToolArgs, countDroppedProposals, finishedStepLabel, parseAgentModelOutput, sanitizePersonalAgentProposals, resolveToolName, siteSourcesFromToolResults, stripEmbeddedJsonFromAnswer, shouldDelegateToCampusAssistant, splitRequestedToolCalls, streamCampusPersonalAgent } from "../src/services/personalAgent/engine";
import { JwxtReauthRequiredError, type PersonalAgentStepEvent, type PersonalAgentToolContext } from "../src/services/personalAgent/types";
import { getFeatures } from "../src/services/siteSettings";

function createMemoryStorage(): PersonalAgentStorageAdapter {
  const table = new Map<string, PersonalAgentRecordRow>();
  const keyOf = (userId: number, collection: string, id: string) => `${userId}:${collection}:${id}`;
  return {
    async findRecord(userId, collection, id) {
      return table.get(keyOf(userId, collection, id)) ?? null;
    },
    async listLiveRecords(userId, collection) {
      const prefix = `${userId}:${collection}:`;
      const out: PersonalAgentRecordRow[] = [];
      for (const [k, row] of table.entries()) {
        if (k.startsWith(prefix) && !row.deletedAt) out.push(row);
      }
      return out;
    },
    async upsertRecord(userId, collection, id, data, at) {
      table.set(keyOf(userId, collection, id), { id, data, clientUpdatedAt: at, deletedAt: null });
    },
    async deleteRecord(userId, collection, id, at) {
      const k = keyOf(userId, collection, id);
      const existing = table.get(k);
      if (!existing || existing.deletedAt) return false;
      table.set(k, { id, data: "", clientUpdatedAt: at, deletedAt: at });
      return true;
    },
    async clearCollection(userId, collection, at) {
      const prefix = `${userId}:${collection}:`;
      let count = 0;
      for (const [k, row] of table.entries()) {
        if (k.startsWith(prefix) && !row.deletedAt) {
          table.set(k, { id: row.id, data: "", clientUpdatedAt: at, deletedAt: at });
          count += 1;
        }
      }
      return count;
    },
  };
}

test("analyzeAcademicGrades computes transcript GPA, required vs elective split, makeup 1.0, pending exclusion, and retake simulation", () => {
  const analysis = analyzeAcademicGrades([
    // 必修满绩点 95 -> GPA 4.5, 4 学分
    { semester: "2025-2026-1", courseCode: "C01", courseName: "有机化学", score: "95", credits: 4, courseAttr: "专业必修" },
    // 同课初修挂科 + 补考通过 -> 折叠为补考记录，绩点固定 1.0，3 学分
    { semester: "2025-2026-1", courseCode: "C02", courseName: "高等数学", score: "52", credits: 3, courseAttr: "通识必修", examType: "正常考试" },
    { semester: "2025-2026-1", courseCode: "C02", courseName: "高等数学", score: "78", credits: 3, courseAttr: "通识必修", examType: "补考一" },
    // 选修等级制 优秀 -> 4.5，2 学分
    { semester: "2025-2026-2", courseCode: "C03", courseName: "医药导论", score: "优秀", credits: 2, courseAttr: "通识选修" },
    // 期末未出分折算项 -> 不计入绩点也不算挂科
    { semester: "2025-2026-2", courseCode: "C04", courseName: "药理学", score: "28", usual: "93", final: "", finalWeight: "70%", credits: 4, courseAttr: "专业必修" },
    // 至今未通过的挂科
    { semester: "2025-2026-2", courseCode: "C05", courseName: "物理化学", score: "49", credits: 3, courseAttr: "专业必修", examType: "正常考试" },
  ]);

  assert.equal(analysis.countedCourseCount, 3);
  assert.equal(analysis.earnedCredits, 9);
  // 总学分绩 = 4*4.5 + 3*1.0 + 2*4.5 = 18 + 3 + 9 = 30; 30 / 9 = 3.3333
  assert.equal(analysis.overallGpa, 3.3333);
  // 必修：有机(4*4.5=18) + 高数补考(3*1.0=3) => 21 / 7 = 3.0
  assert.equal(analysis.requiredCredits, 7);
  assert.equal(analysis.requiredGpa, 3);
  // 选修：医药导论(2*4.5=9) => 4.5
  assert.equal(analysis.electiveCredits, 2);
  assert.equal(analysis.electiveGpa, 4.5);
  assert.equal(analysis.pendingFinal.length, 1);
  assert.equal(analysis.pendingFinal[0].courseName, "药理学");
  assert.equal(analysis.failedUnresolved.length, 1);
  assert.equal(analysis.failedUnresolved[0].courseName, "物理化学");
  // 拖分课模拟：高数 3 学分从 1.0 刷到 90 分(4.0)，总绩点增加 (3 * 3) / 9 = +1.0 -> 4.3333
  assert.equal(analysis.dragCourses.length, 1);
  assert.equal(analysis.dragCourses[0].courseName, "高等数学");
  assert.equal(analysis.dragCourses[0].gpaIf90, 4.3333);
  assert.equal(analysis.dragCourses[0].deltaIf90, 1);
});

test("computeSharedFreeSlots intersects multi-member dorm/couple schedules accurately by teaching week", () => {
  const summaryWeek3 = computeSharedFreeSlots([
    {
      name: "我",
      isMe: true,
      cells: [
        { day: 1, bigSlot: 1, courses: [{ name: "药剂学", weeks: "1-16周", weekList: [1, 2, 3, 4], location: "A101" }] },
        { day: 1, bigSlot: 5, courses: [{ name: "双周选修", weeks: "2-16双周", weekList: [2, 4, 6], location: "B202" }] },
      ],
    },
    {
      name: "室友小张",
      isMe: false,
      cells: [
        { day: 1, bigSlot: 2, courses: [{ name: "生物化学", weeks: "1-16周", weekList: [1, 2, 3, 4], location: "C303" }] },
      ],
    },
  ], 3);

  const monday = summaryWeek3.allFreeByDay.find((d) => d.day === 1)!;
  // 第3周（单周）：周一第1大节我有课，第2大节室友有课，第5大节我的双周课不上 -> 空闲应为 3, 4, 5
  assert.deepEqual(monday.freeBigSlots.map((s) => s.bigSlot), [3, 4, 5]);

  const summaryWeek4 = computeSharedFreeSlots([
    {
      name: "我",
      isMe: true,
      cells: [
        { day: 1, bigSlot: 5, courses: [{ name: "双周选修", weeks: "2-16双周", weekList: [2, 4, 6], location: "B202" }] },
      ],
    },
    {
      name: "室友小张",
      isMe: false,
      cells: [],
    },
  ], 4);
  const mondayW4 = summaryWeek4.allFreeByDay.find((d) => d.day === 1)!;
  assert.deepEqual(mondayW4.freeBigSlots.map((s) => s.bigSlot), [1, 2, 3, 4]);
});

test("personalAgentStore manages permissions, deduplicates memories, blocks restricted topics, and clears cleanly", async () => {
  const store = createPersonalAgentStore(createMemoryStorage());
  const defaults = await store.getPermissions(42);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.academic, false);
  assert.equal(defaults.messages, false);
  assert.equal(defaults.schedule, true);

  const updated = await store.savePermissions(42, { academic: true });
  assert.equal(updated.academic, true);
  assert.equal((await store.getPermissions(42)).academic, true);

  const m1 = await store.upsertMemory(42, { category: "campus", content: "江宁校区 E组团" });
  assert.ok(m1);
  // 语义相同文本更新分类而不产生重复条目
  const m2 = await store.upsertMemory(42, { category: "preference", content: "江宁校区  E组团！" });
  assert.equal(m2?.id, m1!.id);
  assert.equal((await store.listMemories(42)).length, 1);

  // 受限政治历史词汇禁止写入记忆
  const blocked = await store.upsertMemory(42, { category: "note", content: "测试 8964 敏感内容" });
  assert.equal(blocked, null);

  assert.equal(await store.clearMemories(42), 1);
  assert.equal((await store.listMemories(42)).length, 0);
});

test("个人模式要同意当前版本的说明才生效，同意记录只能经 recordConsent 写入", async () => {
  const store = createPersonalAgentStore(createMemoryStorage());
  const fresh = await store.getPermissions(7);
  assert.equal(fresh.enabled, true);
  assert.equal(hasPersonalAgentConsent(fresh), false);
  assert.equal(personalAgentActive(fresh), false);

  // 改授权的接口不能顺手写同意记录
  assert.equal(personalAgentPermissionsPatchSchema.safeParse({ consentVersion: PERSONAL_AGENT_CONSENT_VERSION }).success, false);
  const sneaky = await store.savePermissions(7, { schedule: false, consentVersion: PERSONAL_AGENT_CONSENT_VERSION } as any);
  assert.equal(sneaky.schedule, false);
  assert.equal(hasPersonalAgentConsent(sneaky), false);

  // 同意时提交的版本必须是当前版本
  assert.equal(personalAgentConsentSchema.safeParse({ version: "2020-01-01" }).success, false);
  const body = personalAgentConsentSchema.parse({ version: PERSONAL_AGENT_CONSENT_VERSION, collab: false, academic: true });
  const { version: _v, ...choices } = body;
  const now = new Date("2026-11-26T12:00:00Z");
  const consented = await store.recordConsent(7, choices, now);
  assert.equal(consented.enabled, true);
  assert.equal(consented.collab, false);
  assert.equal(consented.academic, true);
  assert.equal(consented.schedule, false); // 之前自己关掉的保持关闭
  assert.equal(consented.consentAt, now.getTime());
  assert.equal(personalAgentActive(await store.getPermissions(7)), true);

  // 之后改授权不影响同意记录；关掉个人模式后不再生效
  const off = await store.savePermissions(7, { enabled: false });
  assert.equal(hasPersonalAgentConsent(off), true);
  assert.equal(personalAgentActive(off), false);
});

test("streamCampusPersonalAgent enforces disabled scope gate and attaches one-click permission.enable proposal", async () => {
  const store = createPersonalAgentStore(createMemoryStorage());
  const steps: PersonalAgentStepEvent[] = [];
  const deltas: string[] = [];

  const ctx: PersonalAgentToolContext = {
    userId: 7,
    username: "20240001",
    nickname: "小药",
    studentSso: true,
    role: "user",
    schoolId: "cpu",
    forumAccessEnabled: true,
    permissions: defaultPersonalAgentPermissions(), // academic 默认 false
    jwxtToken: "fake-token",
    retriedAfterRecover: false,
    blockedScopes: new Set(),
    needsManualJwxtReauth: false,
    now: new Date("2026-11-26T04:00:00Z"),
  };

  let callCount = 0;
  const response = await streamCampusPersonalAgent({
    message: "帮我算一下现在的总绩点",
    history: [],
    assistantContext: {
      features: getFeatures(),
      forumAccessEnabled: true,
      loggedIn: true,
      schoolId: "cpu",
    },
    toolContext: ctx,
    store,
    onStep: (step) => { steps.push(step); },
    onAnswerDelta: (d) => { deltas.push(d); },
    modelRunner: async ({ round, onRawDelta }) => {
      callCount += 1;
      if (round === 0) {
        const json = JSON.stringify({
          toolCalls: [{ tool: "academic_grades_analysis", args: {} }],
          answer: "",
          proposals: [],
          memoryOps: [],
          actionIds: [],
          suggestions: [],
        });
        await onRawDelta(json);
        return { content: json };
      }
      const finalJson = JSON.stringify({
        toolCalls: [],
        answer: "你尚未开启「成绩与学业档案」授权，点下方卡片开启后我就马上帮你核算绩点。",
        proposals: [
          {
            type: "agenda.create",
            item: {
              kind: "event",
              title: "核对期末复习计划",
              date: "2026-11-27",
              start: "19:00",
              end: "20:30",
              location: "图书馆",
              note: "",
              remind: 15,
              repeat: "none",
            },
          },
        ],
        memoryOps: [{ op: "upsert", category: "goal", content: "关注总绩点核算" }],
        actionIds: [],
        suggestions: ["怎么算必修绩点？"],
      });
      for (const chunk of [finalJson.slice(0, 35), finalJson.slice(35, 90), finalJson.slice(90)]) {
        await onRawDelta(chunk);
      }
      return { content: finalJson };
    },
  });

  assert.equal(callCount, 2);
  assert.equal(response.fallback, false);
  assert.equal(deltas.join(""), response.answer);
  assert.ok(steps.some((s) => s.tool === "academic_grades_analysis" && s.status === "blocked"));
  assert.ok(response.proposals.some((p) => p.type === "permission.enable" && p.scope === "academic"));
  assert.ok(response.proposals.some((p) => p.type === "agenda.create" && p.item.title === "核对期末复习计划"));
  assert.equal(response.memoryChanges.length, 1);
  assert.equal((await store.listMemories(7))[0]?.content, "关注总绩点核算");
});

test("streamCampusPersonalAgent throws JwxtReauthRequiredError on first missing SSO token and falls back to manual card after retry", async () => {
  const store = createPersonalAgentStore(createMemoryStorage());
  const perms = { ...defaultPersonalAgentPermissions(), academic: true };

  const makeCtx = (retriedAfterRecover: boolean): PersonalAgentToolContext => ({
    userId: 9,
    username: "20240009",
    nickname: "阿药",
    studentSso: true,
    role: "user",
    schoolId: "cpu",
    forumAccessEnabled: true,
    permissions: perms,
    jwxtToken: null,
    retriedAfterRecover,
    blockedScopes: new Set(),
    needsManualJwxtReauth: false,
    now: new Date("2026-11-26T04:00:00Z"),
  });

  await assert.rejects(
    () => streamCampusPersonalAgent({
      message: "查考试安排",
      history: [],
      assistantContext: { features: getFeatures(), forumAccessEnabled: true, loggedIn: true, schoolId: "cpu" },
      toolContext: makeCtx(false),
      store,
      modelRunner: async () => ({
        content: JSON.stringify({
          toolCalls: [{ tool: "academic_exams_and_midterm", args: {} }],
          answer: "",
          proposals: [],
          memoryOps: [],
          actionIds: [],
          suggestions: [],
        }),
      }),
    }),
    (err: unknown) => err instanceof JwxtReauthRequiredError,
  );

  const afterRetry = await streamCampusPersonalAgent({
    message: "查考试安排",
    history: [],
    assistantContext: { features: getFeatures(), forumAccessEnabled: true, loggedIn: true, schoolId: "cpu" },
    toolContext: makeCtx(true),
    store,
    modelRunner: async ({ round }) => ({
      content: round === 0
        ? JSON.stringify({
          toolCalls: [{ tool: "academic_exams_and_midterm", args: {} }],
          answer: "",
          proposals: [],
          memoryOps: [],
          actionIds: [],
          suggestions: [],
        })
        : JSON.stringify({
          toolCalls: [],
          answer: "教务登录已过期，请点击下方卡片恢复授权。",
          proposals: [],
          memoryOps: [],
          actionIds: [],
          suggestions: [],
        }),
    }),
  });

  assert.equal(afterRetry.fallback, false);
  assert.ok(afterRetry.proposals.some((p) => p.type === "jwxt.reauth"));
});

function baseToolContext(overrides: Partial<PersonalAgentToolContext> = {}): PersonalAgentToolContext {
  return {
    userId: 11,
    username: "20240011",
    nickname: "小拾",
    studentSso: true,
    role: "user",
    schoolId: "cpu",
    forumAccessEnabled: true,
    permissions: defaultPersonalAgentPermissions(),
    jwxtToken: "fake-token",
    retriedAfterRecover: false,
    blockedScopes: new Set(),
    needsManualJwxtReauth: false,
    now: new Date("2026-11-26T04:00:00Z"),
    ...overrides,
  };
}

test("shouldDelegateToCampusAssistant sends web lookups and model questions to the general assistant, keeps personal ones", () => {
  assert.equal(shouldDelegateToCampusAssistant("你是什么模型？", "before-knowledge"), true);
  assert.equal(shouldDelegateToCampusAssistant("帮我联网查一下明天南京天气", "before-knowledge"), true);
  assert.equal(shouldDelegateToCampusAssistant("联网看看我的课表有没有冲突", "before-knowledge"), false);
  assert.equal(shouldDelegateToCampusAssistant("帮我算一下现在的总绩点", "before-knowledge"), false);
  assert.equal(shouldDelegateToCampusAssistant("南京有几所药科类大学？", "after-knowledge"), true);
  assert.equal(shouldDelegateToCampusAssistant("我借的书有几本快到期了？", "after-knowledge"), false);
  assert.equal(shouldDelegateToCampusAssistant("记住我在江宁校区", "after-knowledge"), false);
});

test("streamCampusPersonalAgent hands delegated questions to the general assistant without calling tools", async () => {
  const deltas: string[] = [];
  let modelCalls = 0;
  const response = await streamCampusPersonalAgent({
    message: "帮我联网查一下明天南京天气",
    history: [],
    assistantContext: { features: getFeatures(), forumAccessEnabled: true, loggedIn: true, schoolId: "cpu" },
    toolContext: baseToolContext(),
    store: createPersonalAgentStore(createMemoryStorage()),
    onAnswerDelta: (d) => { deltas.push(d); },
    modelRunner: async () => {
      modelCalls += 1;
      return { content: "{}" };
    },
    generalAssistant: async (_input, onDelta) => {
      await onDelta("明天南京多云。");
      return {
        answer: "明天南京多云。",
        actions: [],
        suggestions: [],
        fallback: false,
        sources: [{ title: "天气网", url: "https://example.com/weather" }],
      };
    },
  });
  assert.equal(modelCalls, 0);
  assert.equal(deltas.join(""), "明天南京多云。");
  assert.equal(response.sources?.[0]?.url, "https://example.com/weather");
  assert.deepEqual(response.proposals, []);
  assert.deepEqual(response.steps, []);
});

test("streamCampusPersonalAgent tells the model the real tool names when it invents one, and lets it retry", async () => {
  const prompts: string[] = [];
  const response = await streamCampusPersonalAgent({
    message: "我这周的日程有哪些？",
    history: [],
    assistantContext: { features: getFeatures(), forumAccessEnabled: true, loggedIn: true, schoolId: "cpu" },
    toolContext: baseToolContext(),
    store: createPersonalAgentStore(createMemoryStorage()),
    modelRunner: async ({ round, systemPrompt }) => {
      prompts.push(systemPrompt);
      if (round === 0) {
        return {
          content: JSON.stringify({ toolCalls: [{ tool: "no_such_tool", args: {} }], answer: "", proposals: [], memoryOps: [] }),
        };
      }
      return {
        content: JSON.stringify({ toolCalls: [], answer: "这周没有日程。", proposals: [], memoryOps: [], actionIds: [], suggestions: [] }),
      };
    },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /UNKNOWN_TOOL/u);
  assert.match(prompts[1], /schedule_my_timetable_and_agenda/u);
  assert.doesNotMatch(prompts[1], /本轮已到工具调用上限/u);
  assert.equal(response.answer, "这周没有日程。");
});

test("streamCampusPersonalAgent asks once more without tools when the model only repeats a finished tool call", async () => {
  const prompts: string[] = [];
  const call = { tool: "campus_department_contacts", args: { query: "教务处" } };
  const response = await streamCampusPersonalAgent({
    message: "教务处电话多少",
    history: [],
    assistantContext: { features: getFeatures(), forumAccessEnabled: true, loggedIn: true, schoolId: "cpu" },
    toolContext: baseToolContext(),
    store: createPersonalAgentStore(createMemoryStorage()),
    modelRunner: async ({ round, systemPrompt }) => {
      prompts.push(systemPrompt);
      if (round < 2) {
        return { content: JSON.stringify({ toolCalls: [call], answer: "", proposals: [], memoryOps: [] }) };
      }
      return {
        content: JSON.stringify({ toolCalls: [], answer: "教务处电话见上。", proposals: [], memoryOps: [], actionIds: [], suggestions: [] }),
      };
    },
  });
  assert.equal(prompts.length, 3);
  assert.match(prompts[2], /本轮已到工具调用上限/u);
  assert.equal(response.answer, "教务处电话见上。");
  assert.equal(response.steps.length, 1);
});

test("resolveToolName and splitRequestedToolCalls accept near-miss tool names and {name, arguments}", () => {
  assert.equal(resolveToolName("life_dorm_electric"), "life_dorm_electric");
  assert.equal(resolveToolName("dorm_electric"), "life_dorm_electric");
  assert.equal(resolveToolName("Dorm-Electric"), "life_dorm_electric");
  assert.equal(resolveToolName("no_such_tool"), null);
  const split = splitRequestedToolCalls({ toolCalls: [{ name: "dorm_electric", arguments: {} }, { tool: "weather" }] });
  assert.deepEqual(split.valid, [{ tool: "life_dorm_electric", args: {} }]);
  assert.deepEqual(split.unknown, ["weather"]);
});

test("questions about personal data without \"我\" stay in the agent and get a tool hint", async () => {
  assert.equal(shouldDelegateToCampusAssistant("这周还有哪些课和日程？", "after-knowledge", {}), false);
  assert.equal(shouldDelegateToCampusAssistant("宿舍电费还剩多少？", "after-knowledge", {}), false);
  const prompts: string[] = [];
  await streamCampusPersonalAgent({
    message: "宿舍电费还剩多少？",
    history: [],
    assistantContext: { features: getFeatures(), forumAccessEnabled: true, loggedIn: true, schoolId: "cpu" },
    toolContext: baseToolContext(),
    store: createPersonalAgentStore(createMemoryStorage()),
    modelRunner: async ({ systemPrompt }) => {
      prompts.push(systemPrompt);
      return { content: JSON.stringify({ toolCalls: [], answer: "好的。", proposals: [], memoryOps: [], actionIds: [], suggestions: [] }) };
    },
  });
  assert.match(prompts[0], /【提示】这个问题多半要先调用：[^\n]*life_dorm_electric/u);
});

test("buildPersonalAgentSystemPrompt keeps the per-user and per-turn parts after the fixed rules", () => {
  const ctx = baseToolContext();
  const prompt = buildPersonalAgentSystemPrompt({
    schoolContext: { schoolId: "cpu" },
    ctx,
    memories: [],
    catalog: [],
    knowledgeText: "",
    executedRounds: [],
    allowMoreTools: true,
  });
  const rulesEnd = prompt.indexOf("【当前用户】");
  assert.ok(rulesEnd > 0);
  assert.ok(prompt.indexOf("小拾") > rulesEnd);
  assert.ok(prompt.indexOf("【当前北京时间】") > rulesEnd);
  assert.ok(prompt.indexOf("【可用工具】") < rulesEnd);
});

test("coerceToolArgs accepts numbers and booleans written as strings, drops nulls and unknown keys", async () => {
  const { z } = await import("zod");
  const schema = z.object({
    days: z.number().int().min(1).max(14).optional(),
    includeMidterm: z.boolean().default(true),
    keyword: z.string().optional(),
  }).strict();
  const coerced = coerceToolArgs(schema, { days: "7", includeMidterm: "false", keyword: 2026, semester: null, extra: 1 });
  assert.deepEqual(coerced, { days: 7, includeMidterm: false, keyword: "2026" });
  assert.equal(schema.safeParse(coerced).success, true);
});

test("parseAgentModelOutput recovers the card when the model pastes JSON into the answer", () => {
  const card = '{"type":"agenda.create","item":{"kind":"event","title":"药物分析实验报告","date":"2026-11-27","start":"13:30","end":"15:10","remind":15,"repeat":"none"}}';
  // answer 里夹了没转义的 JSON，整段不是合法 JSON
  const raw = `{"toolCalls":[],"answer":"已经准备好一张日程卡片。\n\n\`\`\`json\n${card}\n\`\`\`","proposals":[${card}],"memoryOps":[],"actionIds":[],"suggestions":[]}`;
  const parsed = parseAgentModelOutput(raw, true) as Record<string, any>;
  assert.equal(parsed.proposals.length, 1);
  assert.equal(parsed.proposals[0].item.title, "药物分析实验报告");
  assert.doesNotMatch(parsed.answer, /```|\{/u);
  assert.match(parsed.answer, /已经准备好一张日程卡片/u);

  // 正文 + 代码块，没有 proposals 字段
  const prose = `已经准备好了，确认后生效。\n\n\`\`\`json\n${card}\n\`\`\``;
  const fromProse = parseAgentModelOutput(prose, true) as Record<string, any>;
  assert.equal(fromProse.proposals?.[0]?.type, "agenda.create");
  assert.equal(fromProse.answer, "已经准备好了，确认后生效。");

  assert.equal(stripEmbeddedJsonFromAnswer("好的。\n\n```json"), "好的。");
});

test("siteSourcesFromToolResults links posts the answer mentions", () => {
  const rounds = [{ results: [{ result: { ok: true, hot: [
    { id: 1, title: "三只肥鸭排排游", url: "/forum/topic/1" },
    { id: 2, title: "收空白实验报告册", url: "/forum/topic/2" },
    { id: 3, title: "外链", url: "https://example.com" },
  ] } }] }];
  const sources = siteSourcesFromToolResults(rounds, "热帖有 **三只肥鸭排排游**，还有人在问别的。");
  assert.deepEqual(sources, [{ title: "三只肥鸭排排游", url: "/forum/topic/1" }]);
});

test("finishedStepLabel and countDroppedProposals", () => {
  assert.equal(finishedStepLabel("正在读取个人课表、调休安排与日程待办并检测冲突…"), "读取个人课表、调休安排与日程待办并检测冲突");
  assert.equal(countDroppedProposals([{ type: "agenda.create" }, { type: "forum.post" }], []), 2);
  assert.equal(countDroppedProposals([{ type: "nope" }], []), 0);
});

test("a lost-item card without contact or time is kept so the user can fill it in", () => {
  const kept = sanitizePersonalAgentProposals([{
    type: "lostfound.post", kind: "lost", itemName: "黑色保温杯", description: "", campus: "江宁校区", location: "图书馆三楼", contact: "",
  }], baseToolContext());
  assert.equal(kept.filter((item) => item.type === "lostfound.post").length, 1);
});
