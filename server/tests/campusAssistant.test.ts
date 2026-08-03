import assert from "node:assert/strict";
import test from "node:test";
import {
  askCampusAssistant,
  buildAssistantMessages,
  buildSystemPrompt,
  extractPartialJsonStringValue,
  filterUnavailableDataSuggestions,
  guardCampusAssistantResponse,
  isCampusAssistantConversationRestricted,
  isCampusAssistantModelIdentityQuestion,
  isCampusAssistantPublicTopicRestricted,
  listCampusAssistantActions,
  listCampusAssistantKnowledge,
  listCampusAssistantKnowledgeEntries,
  normalizeAssistantResponse,
  sanitizeCampusAssistantStoredMessages,
  searchCampusAssistantActions,
  streamCampusAssistant,
} from "../src/services/campusAssistant";
import {
  campusAssistantDateKey,
  nextCampusAssistantResetAt,
  resetCampusAssistantDailyUsage,
  resolveCampusAssistantDailyQuota,
  resolveCampusAssistantQuotaLevel,
} from "../src/services/campusAssistantQuota";
import {
  DEFAULT_ASSISTANT_DAILY_QUOTAS,
  DEFAULT_CAMPUS_ASSISTANT_MODEL,
  getSiteConfig,
  loadFeatures,
  normalizeLearningAssistantAccessMode,
} from "../src/services/siteSettings";
import { prisma } from "../src/prisma";
import {
  ensureCanReadBoardType,
  ensureForumAccessEnabled,
  resolveForumAccess,
} from "../src/services/forumAccess";
import {
  buildAiPromptCacheKey,
  readAiJsonTextStream,
  sendAiUpstreamRequest,
} from "../src/services/aiJsonApi";
import { calculateSponsorAssistantPoints } from "../src/services/campusAssistantPoints";
import { buildOAuthAiRequestBody, OAUTH_AI_INSTRUCTIONS } from "../src/routes/oauth";
import { readDesktopUserScriptRelease } from "../src/services/desktopUserScript";
import {
  learningAssistantAiResponse,
  parseLearningAssistantAnswer,
} from "../src/services/learningAssistantAi";
import { mergeAssistantHistorySessions } from "../../web/src/utils/assistantHistorySync";
import { normalizeAdjacentStrongDelimiters } from "../../web/src/utils/markdownNormalize";

const enabledFeatures = {
  forum: true,
  market: true,
  coursereview: true,
  electric: true,
  sponsor: true,
};

const context = {
  features: enabledFeatures,
  forumAccessEnabled: true,
  loggedIn: false,
};

test("拾间AI相邻中文粗体标记不会原样泄露到界面", () => {
  assert.equal(
    normalizeAdjacentStrongDelimiters("**需要重点关注：**木材学 30 分"),
    "<strong>需要重点关注：</strong>木材学 30 分",
  );
  assert.equal(
    normalizeAdjacentStrongDelimiters("**需要重点关注： **Python语言基础"),
    "<strong>需要重点关注：</strong>Python语言基础",
  );
  assert.equal(
    normalizeAdjacentStrongDelimiters("这里是 **正常粗体** 文本"),
    "这里是 **正常粗体** 文本",
  );
});

test("没有真实考试数据时移除考试、考场和座位类追问建议", () => {
  const response = filterUnavailableDataSuggestions({
    answer: "今天有两门课。",
    actions: [],
    suggestions: ["那明天呢？", "查看我的考试安排", "考场在哪里？", "座位号是多少？"],
    fallback: false,
  });
  assert.deepEqual(response.suggestions, ["那明天呢？"]);
});

test("拾间AI请求不携带任何本人教务或站点数据", () => {
  const messages = buildAssistantMessages(
    "怎么查看本学期 GPA？",
    [
      { role: "user", content: "我的成绩在哪里看？" },
      { role: "assistant", content: "请进入教务数据页面自行查看。" },
    ],
    [],
    true,
    "assistant-test-model",
  );
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /无法读取或代查用户的课表、成绩、GPA/u);
  assert.doesNotMatch(serialized, /academicData|siteData|jwxt\.grades|sourceEndpoint/u);
});

test("删除标记会阻止旧本地或云端快照复活会话", () => {
  const merged = mergeAssistantHistorySessions(
    [
      { id: "keep-local", updatedAt: 30 },
      { id: "deleted", updatedAt: 40 },
    ],
    [
      { id: "keep-cloud", updatedAt: 20 },
      { id: "deleted", updatedAt: 50 },
    ],
    ["deleted"],
    20,
  );
  assert.deepEqual(merged.map((item) => item.id), ["keep-local", "keep-cloud"]);
});

test("云端学习通助手脚本提供可校验的版本与正文", async () => {
  const release = await readDesktopUserScriptRelease();
  assert.equal(release.name, "药大拾间·学习通助手");
  assert.equal(release.version, "2.2.8");
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
  assert.equal(release.size, Buffer.byteLength(release.source, "utf8"));
  assert.match(release.source, /cpu-learning-personal-center-guide-v3/);
  assert.match(release.source, /章节、作业或考试/);
  assert.match(release.source, /AI 答题额度已用完/);
  assert.match(release.source, /助手已停止继续请求/);
  assert.match(release.source, /cpu-learning-assistant-panel/);
  assert.match(release.source, /data-action="toggle-runtime"/);
  assert.match(release.source, /章节测验答完自动提交/);
  assert.match(release.source, /cpu-learning-assistant-position-v1/);
  assert.match(release.source, /解题思路/);
  assert.match(release.source, /data\.learning_answer/);
  assert.doesNotMatch(release.source, /cpu-la-footer/);
  assert.doesNotMatch(release.source, /切记填写完要刷新页面才会生效/);
  assert.doesNotMatch(release.source, /题库秘钥配置请点击这个按钮|label:\s*"公告"|label:\s*"运行框"/);
  assert.doesNotMatch(release.source, /Auto Ask/);
});

test("学习通答题 AI 返回独立的答案与公开解题思路字段", () => {
  assert.deepEqual(
    parseLearningAssistantAnswer("答案：C\n解题思路：由盖斯定律相减可得反应热。"),
    { answer: "C", explanation: "由盖斯定律相减可得反应热。" },
  );
  assert.deepEqual(
    parseLearningAssistantAnswer("**答案：** C\n**解题思路：** 比较四个选项的定义。"),
    { answer: "C", explanation: "比较四个选项的定义。" },
  );
  assert.deepEqual(
    learningAssistantAiResponse("答案：正确\n解题思路：题干符合定义。 ").learning_answer,
    { answer: "正确", explanation: "题干符合定义。" },
  );
});

test("电费问题能稳定匹配宿舍电费直达入口", () => {
  const results = searchCampusAssistantActions("现在怎么查宿舍电费？", context);
  assert.equal(results[0]?.id, "dorm-electric");
  assert.equal(results[0]?.url, "/services?open=electric");
  assert.equal(results[0]?.requireLogin, true);
});

test("药苑之声能匹配到广播系统入口", () => {
  const results = searchCampusAssistantActions("药苑之声在哪里", context);
  assert.equal(results[0]?.id, "voicehub");
  assert.equal(results[0]?.url, "/services/tools/voicehub");
});

test("关闭电费功能后不再向用户暴露电费入口", () => {
  const results = searchCampusAssistantActions("查电费", {
    ...context,
    features: { ...enabledFeatures, electric: false },
  });
  assert.equal(results.some((item) => item.id === "dorm-electric"), false);
});

test("AI 只能返回服务端白名单中的动作", () => {
  const available = listCampusAssistantActions(context);
  const response = normalizeAssistantResponse({
    answer: "可以打开药苑之声。",
    actionIds: ["voicehub", "https://evil.example", "admin-secret"],
    suggestions: ["怎么点歌？"],
  }, available);
  assert.deepEqual(response.actions.map((item) => item.id), ["voicehub"]);
  assert.equal(response.actions[0]?.url, "/services/tools/voicehub");
});

test("明确匹配到站内入口时不混入 AI 猜测的无关入口", () => {
  const available = listCampusAssistantActions(context);
  const deterministic = searchCampusAssistantActions("怎么查宿舍电费？", context, 3);
  const response = normalizeAssistantResponse({
    answer: "可以查询宿舍电费。",
    actionIds: ["profile", "home"],
  }, available, deterministic);
  assert.deepEqual(response.actions.map((item) => item.id), ["dorm-electric"]);
});

test("流式 JSON 只提取 answer 的完整可见前缀", () => {
  assert.equal(
    extractPartialJsonStringValue('{"answer":"宿舍电费可在站内查', "answer"),
    "宿舍电费可在站内查",
  );
  assert.equal(
    extractPartialJsonStringValue('{"answer":"第一行\\n第二行\\u4e2d\\u6587","actionIds":[]}', "answer"),
    "第一行\n第二行中文",
  );
  assert.equal(
    extractPartialJsonStringValue('{"answer":"表情\\ud83d', "answer"),
    "表情",
  );
  assert.equal(
    extractPartialJsonStringValue('{"answer":"表情\\ud83d\\ude0a","actionIds":[]}', "answer"),
    "表情😊",
  );
});

test("OpenAI 兼容 SSE 能按增量还原完整 JSON", async () => {
  const response = new Response([
    'data: {"choices":[{"delta":{"content":"{\\"answer\\":\\"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好\\",\\"actionIds\\":[]}"}}]}\n\n',
    "data: [DONE]\n\n",
  ].join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
  const deltas: string[] = [];
  const content = await readAiJsonTextStream(response, "chat_completions", (delta) => {
    deltas.push(delta);
  });
  assert.deepEqual(deltas, ['{"answer":"你', '好","actionIds":[]}']);
  assert.equal(content, '{"answer":"你好","actionIds":[]}');
});

test("课程成绩问法不会误命中个人中心入口", () => {
  const results = searchCampusAssistantActions("我的微生物多少分", context);
  assert.equal(results.some((item) => item.id === "profile"), false);
});

test("旧网络助手相关搜索统一引导到药大拾间桌面客户端", () => {
  const results = searchCampusAssistantActions("CPU 网络连接助手和校园网工具在哪里下载", context);
  assert.equal(results[0]?.id, "desktop-client");
  assert.equal(results[0]?.url, "/download");
  assert.match(results[0]?.description || "", /Android.*iOS.*Windows.*Apple Silicon/);
});

test("客户端下载搜索统一覆盖移动端与桌面端", () => {
  for (const query of ["下载客户端", "安卓客户端", "iOS 客户端", "添加到主屏幕"]) {
    const results = searchCampusAssistantActions(query, context);
    assert.equal(results[0]?.id, "desktop-client", query);
    assert.equal(results[0]?.url, "/download", query);
  }
});

test("AI prompt cache keys are stable within a feature and isolated across features", () => {
  const first = buildAiPromptCacheKey("oauth-chat", ["cpu-electron", "example-model"]);
  const second = buildAiPromptCacheKey("oauth-chat", ["cpu-electron", "example-model"]);
  const otherFeature = buildAiPromptCacheKey("course-bot-ai-answer", ["cpu-electron", "example-model"]);

  assert.equal(first, second);
  assert.notEqual(first, otherFeature);
  assert.match(first, /^cpu:oauth-chat:[a-f0-9]{24}$/);
});

test("学习通 AI 请求只携带题目上下文与独立合规边界", () => {
  const input = {
    model: "client-supplied-model",
    input: [{
      role: "user" as const,
      content: [{ type: "input_text" as const, text: "判断题：水的化学式是 H2O。" }],
    }],
  };
  const chatBody = buildOAuthAiRequestBody(
    input,
    "server-selected-model",
    "https://api.example.com/v1/chat/completions",
  ) as { model: string; messages: Array<{ role: string; content: unknown }> };
  const responsesBody = buildOAuthAiRequestBody(
    input,
    "server-selected-model",
    "https://api.example.com/v1/responses",
  ) as { model: string; instructions: string; input: unknown[] };
  const serialized = JSON.stringify({ chatBody, responsesBody });

  assert.equal(chatBody.model, "server-selected-model");
  assert.equal(chatBody.messages[0]?.role, "system");
  assert.equal(chatBody.messages[0]?.content, OAUTH_AI_INSTRUCTIONS);
  assert.equal(responsesBody.instructions, OAUTH_AI_INSTRUCTIONS);
  assert.match(OAUTH_AI_INSTRUCTIONS, /只依据本次请求中明确给出的题干、选项、图片和通用学科知识/);
  assert.match(OAUTH_AI_INSTRUCTIONS, /中华人民共和国现行法律法规/);
  assert.doesNotMatch(serialized, /knowledge=|玄武门校区|assistantPoints|DATABASE_URL|nickname/);
});

test("学习通助手访问策略默认临时开放且可由服务端恢复账号额度", () => {
  assert.equal(normalizeLearningAssistantAccessMode(undefined), "guest-unlimited");
  assert.equal(normalizeLearningAssistantAccessMode("guest-unlimited"), "guest-unlimited");
  assert.equal(normalizeLearningAssistantAccessMode("account-quota"), "account-quota");
  assert.equal(normalizeLearningAssistantAccessMode("unexpected-client-value"), "account-quota");
});

test("AI upstream requests apply explicit prompt cache key and 24-hour retention", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendAiUpstreamRequest({
      endpoint: "https://cache-test.example/v1/chat/completions",
      apiKey: "test-key",
      body: {
        model: "example-model",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
      promptCacheKey: "cpu:test:123",
      enablePromptCacheRetention: true,
    });

    assert.equal(result.response.ok, true);
    assert.equal(result.promptCacheKeyApplied, true);
    assert.equal(result.promptCacheRetentionApplied, true);
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0]?.prompt_cache_key, "cpu:test:123");
    assert.equal(requestBodies[0]?.prompt_cache_retention, "24h");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI upstream cache compatibility retries without unsupported retention", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    if (requestBodies.length === 1) {
      return new Response('{"error":"unsupported prompt_cache_retention"}', {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendAiUpstreamRequest({
      endpoint: "https://cache-retention-fallback.example/v1/chat/completions",
      apiKey: "test-key",
      body: {
        model: "example-model",
        messages: [{ role: "user", content: "hello" }],
      },
      promptCacheKey: "cpu:test:456",
      enablePromptCacheRetention: true,
    });

    assert.equal(result.response.ok, true);
    assert.equal(result.promptCacheKeyApplied, true);
    assert.equal(result.promptCacheRetentionApplied, false);
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0]?.prompt_cache_retention, "24h");
    assert.equal(requestBodies[1]?.prompt_cache_key, "cpu:test:456");
    assert.equal("prompt_cache_retention" in requestBodies[1]!, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("VoiceHub knowledge describes the real request form and rejects invented listener messages", () => {
  const knowledge = listCampusAssistantKnowledge(["voicehub"]);
  const combined = knowledge.join("\n");

  assert.match(combined, /输入歌曲名称搜索/);
  assert.match(combined, /没有“对收听者说的话”、留言或寄语字段/);
  assert.match(combined, /已经排期且排期日期已经过去/);
  assert.doesNotMatch(combined, /中国建设银行/);
});

test("assistant answers allow complete responses up to the new four-thousand-character guard", () => {
  const response = normalizeAssistantResponse(
    { answer: "答".repeat(5000), actionIds: [], suggestions: [] },
    [],
  );

  assert.equal(response.answer.length, 4000);
});

test("assistant quota includes Lv.0 and resets at China midnight", () => {
  assert.equal(resolveCampusAssistantDailyQuota(0), 5);
  assert.equal(resolveCampusAssistantDailyQuota(1), 10);
  assert.equal(resolveCampusAssistantDailyQuota(5), 80);
  assert.equal(resolveCampusAssistantQuotaLevel(0, 1), 0);
  assert.equal(resolveCampusAssistantQuotaLevel(1, 1), 1);
  assert.equal(campusAssistantDateKey(new Date("2026-07-25T15:59:59.000Z")), "2026-07-25");
  assert.equal(campusAssistantDateKey(new Date("2026-07-25T16:00:01.000Z")), "2026-07-26");
  assert.equal(
    nextCampusAssistantResetAt(new Date("2026-07-25T15:59:59.000Z")).toISOString(),
    "2026-07-25T16:00:00.000Z",
  );
});

test("assistant quota and model settings are restored from the database after a service reload", async () => {
  const siteSetting = prisma.siteSetting;
  const originalFindMany = siteSetting.findMany;
  const storedModel = "assistant-model-test";
  const storedQuotas = DEFAULT_ASSISTANT_DAILY_QUOTAS.map((item) => ({
    ...item,
    quota: item.quota + 7,
  }));
  let requestedKeys: string[] = [];

  try {
    siteSetting.findMany = (async (args: {
      where?: { key?: { in?: string[] } };
    }) => {
      requestedKeys = args.where?.key?.in ?? [];
      return [
        {
          key: "assistant.model",
          value: storedModel,
        },
        {
          key: "assistant.dailyQuotas",
          value: JSON.stringify(storedQuotas),
        },
      ];
    }) as typeof siteSetting.findMany;

    await loadFeatures();

    assert.equal(requestedKeys.includes("assistant.model"), true);
    assert.equal(requestedKeys.includes("assistant.dailyQuotas"), true);
    assert.equal(getSiteConfig().assistantModel, storedModel);
    assert.deepEqual(getSiteConfig().assistantDailyQuotas, storedQuotas);
  } finally {
    siteSetting.findMany = (async () => [
      {
        key: "assistant.model",
        value: DEFAULT_CAMPUS_ASSISTANT_MODEL,
      },
      {
        key: "assistant.dailyQuotas",
        value: JSON.stringify(DEFAULT_ASSISTANT_DAILY_QUOTAS),
      },
    ]) as typeof siteSetting.findMany;
    await loadFeatures();
    siteSetting.findMany = originalFindMany;
  }
});

test("campus assistant knowledge covers every active action and carries freshness metadata", () => {
  const actions = listCampusAssistantActions(context);
  const entries = listCampusAssistantKnowledgeEntries(actions.map((item) => item.id));
  const combined = entries.map((item) => item.fact).join("\n");

  assert.ok(entries.length >= 30);
  assert.equal(entries.every((item) => Boolean(item.id && item.source && item.sourceRef && item.verifiedAt)), true);
  assert.equal(new Set(entries.map((item) => item.id)).size, entries.length);
  for (const action of actions) {
    assert.ok(
      listCampusAssistantKnowledge([action.id]).length > 0,
      `missing knowledge for action ${action.id}`,
    );
  }
  assert.match(combined, /2026-2027 学年校历/);
  assert.match(combined, /玄武门校区位于南京市鼓楼区童家巷 24 号/);
  assert.match(combined, /旧的“CPU 网络连接助手”已停止作为独立产品宣传/);
  assert.match(combined, /有原生客户端的平台应优先推荐客户端/);
  assert.match(combined, /桌面设备不推荐 PWA/);
  assert.doesNotMatch(combined, /先在中国建设银行 APP/);
});

test("sponsor points use the configured per-yuan ratio and round down", () => {
  assert.equal(calculateSponsorAssistantPoints(500, 3), 15);
  assert.equal(calculateSponsorAssistantPoints(199, 2), 3);
  assert.equal(calculateSponsorAssistantPoints(9999, 0), 0);
});

test("resetting assistant quota clears only today's used counts", async () => {
  const dailyUsage = prisma.campusAssistantDailyUsage;
  const originalUpdateMany = dailyUsage.updateMany;
  let updateArgs: unknown;

  try {
    dailyUsage.updateMany = (async (args: unknown) => {
      updateArgs = args;
      return { count: 4 };
    }) as typeof dailyUsage.updateMany;

    const result = await resetCampusAssistantDailyUsage(new Date("2026-07-25T16:00:01.000Z"));

    assert.deepEqual(updateArgs, {
      where: {
        dateKey: "2026-07-26",
        used: { gt: 0 },
      },
      data: { used: 0 },
    });
    assert.deepEqual(result, {
      dateKey: "2026-07-26",
      resetUsers: 4,
    });
  } finally {
    dailyUsage.updateMany = originalUpdateMany;
  }
});

test("forum access is open to guests and no longer requires manual activation", async () => {
  assert.equal(await resolveForumAccess(null, null), true);
  await ensureCanReadBoardType("normal", null, null);
  await ensureForumAccessEnabled(1, "user");
});

test("拾间AI可以获知并如实告知当前实际调用的模型名称", () => {
  const prompt = buildSystemPrompt([], false, "example-model-2026");

  assert.match(prompt, /你使用的具体模型是“example-model-2026”/);
  assert.match(prompt, /只有用户主动询问你是什么模型或具体模型名称时/);
  assert.match(prompt, /我是 example-model-2026/);
  assert.match(prompt, /其他情况下绝不主动提及模型/);
  assert.match(prompt, /不要说“当前处理本次对话的模型名称是”/);
});

test("拾间AI优先推荐可用的原生客户端，不用网页版弱化客户端", () => {
  const prompt = buildSystemPrompt([], false, "example-model-2026");

  assert.match(prompt, /有原生客户端的平台必须优先推荐对应客户端/);
  assert.match(prompt, /不能以“无需安装客户端”/);
  assert.match(prompt, /只有没有原生客户端的平台才把网页版或添加到主屏幕作为替代方案/);
});

test("只有用户主动询问身份时才识别为模型名称问题", () => {
  assert.equal(isCampusAssistantModelIdentityQuestion("你是什么模型？"), true);
  assert.equal(isCampusAssistantModelIdentityQuestion("你现在具体使用的模型名称是什么？"), true);
  assert.equal(isCampusAssistantModelIdentityQuestion("Which model are you using?"), true);
  assert.equal(isCampusAssistantModelIdentityQuestion("解释一下药代动力学中的房室模型"), false);
  assert.equal(isCampusAssistantModelIdentityQuestion("帮我查课表"), false);
});

test("拾间AI在服务端前置拦截不适合国内公开平台展开的敏感话题", () => {
  assert.equal(isCampusAssistantPublicTopicRestricted("六四是什么？"), true);
  assert.equal(isCampusAssistantPublicTopicRestricted("怎么查六级成绩？"), false);
  assert.equal(isCampusAssistantPublicTopicRestricted("四六级考试什么时候报名？"), false);
});

test("敏感话题的上下文追问不会绕过前置拦截", () => {
  assert.equal(isCampusAssistantPublicTopicRestricted("继续详细说说", [
    { role: "user", content: "请介绍六四事件" },
    { role: "assistant", content: "这个话题不适合在本站展开。" },
  ]), true);
});

test("敏感话题检查使用当前消息之前的历史", () => {
  const messages = [
    { role: "user" as const, content: "请介绍六四事件" },
    { role: "assistant" as const, content: "这个话题不适合在本站展开。" },
    { role: "user" as const, content: "继续" },
  ];

  assert.equal(isCampusAssistantConversationRestricted(messages), true);
});

test("敏感问法在调用模型前直接返回安全答复，流式接口也不会泄露增量", async () => {
  const direct = await askCampusAssistant({
    message: "六四是什么？",
    history: [],
    context,
  });
  const deltas: string[] = [];
  const streamed = await streamCampusAssistant({
    message: "请介绍六四事件",
    history: [],
    context,
  }, (delta) => {
    deltas.push(delta);
  });

  assert.match(direct.answer, /不适合在本站展开/);
  assert.match(streamed.answer, /不适合在本站展开/);
  assert.deepEqual(deltas, []);
  assert.deepEqual(direct.actions, []);
});

test("模型输出兜底不会把受限内容交给前端", () => {
  const guarded = guardCampusAssistantResponse({
    answer: "这里是一段关于六四事件的说明。",
    actions: [],
    suggestions: ["继续了解"],
    fallback: false,
  });

  assert.match(guarded.answer, /不适合在本站展开/);
  assert.doesNotMatch(guarded.answer, /事件的说明/);
});

test("云端历史会话不会继续展示已经保存的受限问答", () => {
  const messages = sanitizeCampusAssistantStoredMessages([
    { id: 1, role: "user", content: "六四是什么？" },
    { id: 2, role: "assistant", content: "这里是一段关于六四事件的说明。", actions: [{ id: "home" }] },
    { id: 3, role: "user", content: "继续详细说说" },
    { id: 4, role: "assistant", content: "继续展开说明。", suggestions: ["继续了解"] },
    { id: 5, role: "user", content: "怎么查课表？" },
  ]) as Array<Record<string, unknown>>;

  assert.equal(messages[0]?.content, "该问题不适合在本站展开。");
  assert.match(String(messages[1]?.content), /不适合在本站展开/);
  assert.deepEqual(messages[1]?.actions, []);
  assert.equal(messages[2]?.content, "该问题不适合在本站展开。");
  assert.match(String(messages[3]?.content), /不适合在本站展开/);
  assert.equal(messages[4]?.content, "怎么查课表？");
});
