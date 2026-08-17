import assert from "node:assert/strict";
import test from "node:test";
import {
  askCampusAssistant,
  buildAssistantMessages,
  buildSystemPrompt,
  CAMPUS_ASSISTANT_PUBLIC_MODEL_NAME,
  extractPartialJsonStringValue,
  filterUnavailableDataSuggestions,
  guardCampusAssistantResponse,
  isCampusAssistantConversationRestricted,
  isCampusAssistantModelIdentityQuestion,
  isCampusAssistantPublicTopicRestricted,
  isLikelyTruncatedCampusAssistantAnswer,
  isQwenAssistantModel,
  listCampusAssistantActions,
  listCampusAssistantKnowledge,
  listCampusAssistantKnowledgeEntries,
  normalizeAssistantResponse,
  parseAssistantJson,
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
  DEFAULT_LEARNING_ASSISTANT_TIERS,
  DEFAULT_LEARNING_PLATFORM_AVAILABILITY,
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
  extractAiJsonCompletionMetadata,
  readAiJsonTextStream,
  sendAiUpstreamRequest,
  sendAiJsonRequestWithProviderFallback,
} from "../src/services/aiJsonApi";
import { calculateSponsorAssistantPoints } from "../src/services/campusAssistantPoints";
import { buildOAuthAiRequestBody, OAUTH_AI_INSTRUCTIONS } from "../src/routes/oauth";
import { readDesktopUserScriptRelease } from "../src/services/desktopUserScript";
import {
  isLearningAssistantNonAnswerFeedback,
  buildLearningAssistantAiRequestBody,
  learningAssistantAiBodySchema,
  learningAssistantAiResponse,
  normalizeLearningAssistantAiBody,
  learningAssistantPointCost,
  parseLearningAssistantAnswer,
} from "../src/services/learningAssistantAi";
import { mergeAssistantHistorySessions } from "../../web/src/utils/assistantHistorySync";
import { normalizeAdjacentStrongDelimiters } from "../../web/src/utils/markdownNormalize";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const VALID_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

test("learning assistant free-period tier defaults keep the highest tier gated", () => {
  assert.equal(DEFAULT_LEARNING_ASSISTANT_TIERS.low.freeInUnlimited, true);
  assert.equal(DEFAULT_LEARNING_ASSISTANT_TIERS.high.freeInUnlimited, true);
  assert.equal(DEFAULT_LEARNING_ASSISTANT_TIERS.max.freeInUnlimited, false);
});

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
  assert.equal(release.version, "2.2.15");
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
  assert.match(release.source, /data-action="screenshot-search"/);
  assert.match(release.source, /reasoningEffort/);
  assert.doesNotMatch(release.source, /<details class="cpu-la-(?:sources|reasoning)/);
  assert.match(release.source, /data\.learning_answer/);
  assert.doesNotMatch(release.source, /cpu-la-footer/);
  assert.doesNotMatch(release.source, /切记填写完要刷新页面才会生效/);
  assert.doesNotMatch(release.source, /题库秘钥配置请点击这个按钮|label:\s*"公告"|label:\s*"运行框"/);
  assert.doesNotMatch(release.source, /Auto Ask/);
});

test("云端多平台助手脚本与客户端安装包分离发布", async () => {
  const release = await readDesktopUserScriptRelease("multiplatform");
  assert.equal(release.name, "药大拾间·全平台网课助手");
  assert.equal(release.version, "4.15.8");
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
  assert.equal(release.size, Buffer.byteLength(release.source, "utf8"));
  assert.match(release.source, /fusioncourseh5\.zhihuishu\.com\/stuStudy/);
  assert.match(release.source, /wisdom-mooc\.zhihuishu\.com\/study\/index/);
  assert.match(release.source, /@connect\s+desktop\.localhost/);
});

test("云端安全微伴脚本提供可校验的版本与正文", async () => {
  const release = await readDesktopUserScriptRelease("weban");
  assert.equal(release.name, "药大拾间·安全微伴助手");
  assert.equal(release.version, "1.1.3");
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
  assert.equal(release.size, Buffer.byteLength(release.source, "utf8"));
  assert.match(release.source, /cpu-weban:/);
  assert.match(release.source, /cpu-weban-panel/);
  assert.match(release.source, /安全微伴助手/);
  assert.match(release.source, /CPU_TENANT_CODE\s*=\s*'21000004'/);
  assert.match(release.source, /readPageSession/);
  assert.match(release.source, /localStorage\.getItem\('user'\)/);
  assert.match(release.source, /检测登录并开始/);
  assert.match(release.source, /请先在微伴页面登录/);
  assert.match(release.source, /\/pharos\/my\/getInfo\.do/);
  assert.match(release.source, /会话已失效，请在微伴页面重新登录后点击"检测登录并开始"/);
  assert.match(release.source, /^\/\/ @connect\s+weiban\.mycourse\.cn$/m);
  assert.match(release.source, /^\/\/ @connect\s+gh-proxy\.com$/m);
  assert.match(release.source, /GM_xmlhttpRequest\(/);
  assert.doesNotMatch(release.source, /fetchCaptchaImageUrl/);
  assert.doesNotMatch(release.source, /<img id=\"cpu-wb-captcha-preview\"/);
  assert.doesNotMatch(release.source, /createImageBitmap\(blob\)/);
  assert.doesNotMatch(release.source, /\bdoc\.addEventListener\(/);
  assert.match(release.source, /const host\s*=\s*typeof unsafeWindow/);
  assert.doesNotMatch(release.source, /data:\$\{mime\};base64,\$\{btoa\(binary\)\}/);
  assert.match(release.source, /助手使用微伴页面的登录状态，无需单独登录/);
  assert.doesNotMatch(release.source, /data-action="toggle-collapse"/);
  assert.match(release.source, /color-scheme:\s*light/);
});

test("学习通答题 AI 返回独立的答案与公开解题思路字段", () => {
  assert.deepEqual(
    parseLearningAssistantAnswer('{"answer":"C","explanation":"由盖斯定律相减可得反应热。"}'),
    { answer: "C", explanation: "由盖斯定律相减可得反应热。" },
  );
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
  assert.equal(isLearningAssistantNonAnswerFeedback("缺失图片无法完成"), true);
  assert.deepEqual(
    learningAssistantAiResponse("答案：缺失图片，无法完成作答\n解题思路：题目图片没有成功提供。").learning_answer,
    { answer: "", explanation: "题目图片没有成功提供。" },
  );
  assert.deepEqual(
    learningAssistantAiResponse("答案：信息不足，无法确定").learning_answer,
    { answer: "", explanation: "信息不足，无法确定" },
  );
  assert.deepEqual(
    learningAssistantAiResponse("答案：\n解题思路：题目图片未提供，无法作答。").learning_answer,
    { answer: "", explanation: "题目图片未提供，无法作答。" },
  );
  assert.deepEqual(
    learningAssistantAiResponse("先比较四个选项，再根据定义判断 C 正确。").learning_answer,
    { answer: "", explanation: "先比较四个选项，再根据定义判断 C 正确。" },
    "无 JSON 或答案标签的自然语言不得写入答题框",
  );
  assert.equal(isLearningAssistantNonAnswerFeedback("图像缺失"), false, "合法的简短答案不应仅因包含图像二字被误拦截");
});

test("学习通截图搜题会先解码并规范化每张图片", async () => {
  const originalPngDataUrl = `data:image/png;base64,${VALID_PNG.toString("base64")}`;
  const parsed = learningAssistantAiBodySchema.parse({
    model: "test-model",
    reasoningEffort: "high",
    input: [{ role: "user", content: [
      { type: "input_text", text: "请解答截图中的题目" },
      { type: "input_image", image_url: originalPngDataUrl, detail: "original" },
    ] }],
  });
  const normalized = await normalizeLearningAssistantAiBody(parsed);
  const image = (normalized.input[0].content as any[])[1].image_url as string;
  assert.match(image, /^data:image\/(?:png|jpeg);base64,/);
  assert.notEqual(image, "data:image/png;base64,QUFB");
});

test("学习通截图搜题拒绝伪装成图片的 HTML、空数据和远程 URL", async () => {
  const invalidBodies = [
    "data:image/png;base64," + Buffer.from("<html>gateway error</html>").toString("base64"),
  ];
  for (const image_url of invalidBodies) {
    const parsed = learningAssistantAiBodySchema.parse({
      model: "test-model",
      input: [{ role: "user", content: [{ type: "input_image", image_url }] }],
    });
    await assert.rejects(
      () => normalizeLearningAssistantAiBody(parsed),
      /图片.*无效/u,
    );
  }
  assert.throws(
    () => learningAssistantAiBodySchema.parse({
      model: "test-model",
      input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64," }] }],
    }),
    /图片 Data URL/u,
  );
  const remote = learningAssistantAiBodySchema.parse({
    model: "test-model",
    input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/question.png" }] }],
  });
  await assert.rejects(
    () => normalizeLearningAssistantAiBody(remote),
    /未转换为本地数据/u,
  );
});

test("学习通截图搜题会把 GIF 规范化成 Ollama 可读的 PNG", async () => {
  const parsed = learningAssistantAiBodySchema.parse({
    model: "test-model",
    input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/gif;base64,${VALID_GIF.toString("base64")}` }] }],
  });
  const normalized = await normalizeLearningAssistantAiBody(parsed);
  assert.match((normalized.input[0].content as any[])[0].image_url, /^data:image\/png;base64,/);
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
    reasoningEffort: "max" as const,
    input: [{
      role: "user" as const,
      content: [{ type: "input_text" as const, text: "判断题：水的化学式是 H2O。" }],
    }],
  };
  const chatBody = buildOAuthAiRequestBody(
    input,
    "server-selected-model",
    "https://api.example.com/v1/chat/completions",
  ) as { model: string; messages: Array<{ role: string; content: unknown }>; reasoning_effort: string };
  const responsesBody = buildOAuthAiRequestBody(
    input,
    "server-selected-model",
    "https://api.example.com/v1/responses",
  ) as { model: string; instructions: string; input: unknown[]; reasoning: { effort: string } };
  const serialized = JSON.stringify({ chatBody, responsesBody });

  assert.equal(chatBody.model, "server-selected-model");
  assert.equal(chatBody.messages[0]?.role, "system");
  assert.equal(chatBody.messages[0]?.content, OAUTH_AI_INSTRUCTIONS);
  assert.equal(responsesBody.instructions, OAUTH_AI_INSTRUCTIONS);
  assert.equal(chatBody.reasoning_effort, "max");
  assert.equal(responsesBody.reasoning.effort, "max");
  assert.equal(learningAssistantPointCost("low"), 1);
  assert.equal(learningAssistantPointCost("high"), 1.5);
  assert.equal(learningAssistantPointCost("max"), 2);
  assert.match(OAUTH_AI_INSTRUCTIONS, /只依据本次请求中明确给出的题干、选项、图片和通用学科知识/);
  assert.match(OAUTH_AI_INSTRUCTIONS, /中华人民共和国现行法律法规/);
  assert.doesNotMatch(serialized, /knowledge=|玄武门校区|assistantPoints|DATABASE_URL|nickname/);
});

test("网课解题会把后台配置的完整推理强度原样发送给上游", () => {
  const input = {
    model: "server-selected-model",
    reasoningEffort: "xhigh" as const,
    input: [{
      role: "user" as const,
      content: [{ type: "input_text" as const, text: "请回答这道测试题。" }],
    }],
  };
  const chatBody = buildLearningAssistantAiRequestBody(
    input,
    "server-selected-model",
    "https://api.example.com/v1/chat/completions",
  ) as { reasoning_effort: string };
  const responsesBody = buildLearningAssistantAiRequestBody(
    input,
    "server-selected-model",
    "https://api.example.com/v1/responses",
  ) as { reasoning: { effort: string } };

  assert.equal(chatBody.reasoning_effort, "xhigh");
  assert.equal(responsesBody.reasoning.effort, "xhigh");
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

test("AI upstream requests omit an empty Authorization header for local Ollama", async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders: Headers | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestHeaders = new Headers(init?.headers);
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendAiUpstreamRequest({
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      apiKey: "",
      body: {
        model: "qwen3:8b",
        messages: [{ role: "user", content: "hello" }],
      },
    });

    await result.response.body?.cancel();
    assert.equal(requestHeaders?.has("authorization"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("拾间AI 的 Ollama 非流式 JSON 请求走原生 /api/chat 并按请求启用思考输出", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, any> | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
      model: "qwen3.8:27b",
      done: true,
      done_reason: "stop",
      prompt_eval_count: 83,
      eval_count: 67,
      total_duration: 4_926_000_000,
      load_duration: 201_000_000,
      prompt_eval_duration: 3_100_000_000,
      eval_duration: 549_000_000,
      message: {
        role: "assistant",
        content: '{"answer":"这是完整回答。","actionIds":[],"suggestions":[]}',
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendAiJsonRequestWithProviderFallback({
      providers: [{
        serviceId: "ollama",
        name: "本地 Ollama",
        provider: "ollama",
        apiUrl: "http://ollama-test.example:11434",
        apiKey: "",
      }],
      fallbackEndpoint: "https://fallback.example/v1/chat/completions",
      model: "qwen3.8:27b",
      messages: [
        { role: "system", content: "只输出 JSON" },
        { role: "user", content: "请完整回答这个问题" },
      ],
      maxTokens: 4096,
      preferNativeOllama: true,
      ollamaThink: true,
    });

    assert.equal(result.response.ok, true);
    assert.equal(requestUrl, "http://ollama-test.example:11434/api/chat");
    assert.equal(requestBody?.stream, false);
    assert.equal(requestBody?.format, undefined);
    assert.equal(requestBody?.think, true);
    assert.equal(requestBody?.options?.num_predict, 4096);
    const wrapped = await result.response.json();
    assert.deepEqual(JSON.parse(String(wrapped.choices[0].message.content)), {
      answer: "这是完整回答。",
      actionIds: [],
      suggestions: [],
    });
    assert.deepEqual(extractAiJsonCompletionMetadata(wrapped, "chat_completions"), {
      finishReason: "stop",
      doneReason: "stop",
      done: true,
      promptEvalCount: 83,
      evalCount: 67,
      totalDurationMs: 4926,
      loadDurationMs: 201,
      promptEvalDurationMs: 3100,
      evalDurationMs: 549,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ollama 非流式响应体消费完成前不会启动同端点的第二个请求", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let closeFirstBody!: () => void;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"answer":"ok"}'));
          closeFirstBody = () => controller.close();
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response('{"answer":"second"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const first = await sendAiUpstreamRequest({
      endpoint: "http://json-body-test.local:11434/v1/chat/completions",
      apiKey: "",
      body: {
        model: "qwen3.8:27b",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const secondPromise = sendAiUpstreamRequest({
      endpoint: "http://json-body-test.local:11434/v1/chat/completions",
      apiKey: "",
      body: {
        model: "qwen3.8:27b",
        messages: [{ role: "user", content: "again" }],
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);

    closeFirstBody();
    assert.deepEqual(await first.response.json(), { answer: "ok" });
    const second = await secondPromise;
    assert.equal(requests, 2);
    await second.response.body?.cancel();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ollama 流式响应体消费完成前不会启动同端点的第二个请求", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
        },
      }), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const first = await sendAiUpstreamRequest({
      endpoint: "http://stream-body-test.local:11434/v1/chat/completions",
      apiKey: "",
      body: {
        model: "qwen3.8:27b",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    });
    const secondPromise = sendAiUpstreamRequest({
      endpoint: "http://stream-body-test.local:11434/v1/chat/completions",
      apiKey: "",
      body: {
        model: "qwen3.8:27b",
        stream: true,
        messages: [{ role: "user", content: "again" }],
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);

    await first.response.body?.cancel();
    await secondPromise;
    assert.equal(requests, 2);
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

test("AI upstream retries transient overloads before returning the final failure", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests < 3) {
      return new Response('{"error":"temporarily overloaded"}', {
        status: 503,
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
      endpoint: "https://retry-test.example/v1/chat/completions",
      apiKey: "test-key",
      body: {
        model: "example-model",
        messages: [{ role: "user", content: "hello" }],
      },
      maxTransientRetries: 2,
    });

    assert.equal(result.response.ok, true);
    assert.equal(result.retryCount, 2);
    assert.equal(requests, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI upstream rejects an invalid image payload before contacting the provider", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => sendAiUpstreamRequest({
        endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        apiKey: "",
        body: {
          model: "qwen3.8:27b",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "请识别这张图片" },
              { type: "image_url", image_url: { url: "data:image/png;base64,[object ArrayBuffer]" } },
            ],
          }],
        },
      }),
      /不是有效的图片 Data URL/u,
    );
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI JSON requests fail over to the next configured provider", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; authorization: string | null; model?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();
    const request = {
      url,
      method,
      authorization: new Headers(init?.headers).get("authorization"),
    } as { url: string; method: string; authorization: string | null; model?: string };
    if (method === "POST") request.model = JSON.parse(String(init?.body || "{}")).model;
    requests.push(request);
    if (method === "GET") {
      return new Response('{"data":[{"id":"backup-model"}]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("primary.example")) {
      return new Response('{"error":"provider unavailable"}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendAiJsonRequestWithProviderFallback({
      providers: [
        { serviceId: "primary", name: "主服务", provider: "deepseek", apiUrl: "https://primary.example/v1", apiKey: "primary-key" },
        { serviceId: "backup", name: "备用服务", provider: "openai", apiUrl: "https://backup.example/v1", apiKey: "backup-key", model: "backup-model" },
      ],
      fallbackEndpoint: "https://fallback.example/v1/chat/completions",
      model: "example-model",
      messages: [{ role: "user", content: "hello" }],
    });

    assert.equal(result.response.ok, true);
    assert.equal(result.provider.serviceId, "backup");
    assert.equal(result.endpoint, "https://backup.example/v1/chat/completions");
    assert.deepEqual(requests, [
      { url: "https://primary.example/v1/chat/completions", method: "POST", authorization: "Bearer primary-key", model: "example-model" },
      { url: "https://primary.example/v1/chat/completions", method: "POST", authorization: "Bearer primary-key", model: "example-model" },
      { url: "https://primary.example/v1/chat/completions", method: "POST", authorization: "Bearer primary-key", model: "example-model" },
      { url: "https://primary.example/v1/chat/completions", method: "POST", authorization: "Bearer primary-key", model: "example-model" },
      { url: "https://backup.example/v1/model", method: "GET", authorization: "Bearer backup-key" },
      { url: "https://backup.example/v1/chat/completions", method: "POST", authorization: "Bearer backup-key", model: "backup-model" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI JSON requests do not cross providers for a deterministic 400", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(`${String(init?.method || "GET").toUpperCase()} ${String(input)}`);
    return new Response('{"error":"invalid image input"}', {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await sendAiJsonRequestWithProviderFallback({
      providers: [
        { serviceId: "primary", name: "主服务", provider: "ollama", apiUrl: "http://primary-400.example:11434", apiKey: "" },
        { serviceId: "backup", name: "备用服务", provider: "openai", apiUrl: "https://backup-400.example/v1", apiKey: "backup-key", model: "backup-model" },
      ],
      fallbackEndpoint: "https://fallback.example/v1/chat/completions",
      model: "qwen3.8:27b",
      messages: [{ role: "user", content: "hello" }],
      maxTransientRetries: 0,
    });

    assert.equal(result.response.status, 400);
    assert.equal(result.provider.serviceId, "primary");
    assert.deepEqual(requests, ["POST http://primary-400.example:11434/v1/chat/completions"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI JSON requests preserve a transient primary failure when no fallback model is confirmed", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(init?.method || "GET").toUpperCase();
    const url = String(input);
    requests.push(`${method} ${url}`);
    if (method === "GET") return new Response('{"error":"catalog unavailable"}', { status: 404 });
    return new Response('{"error":"temporarily unavailable"}', { status: 503 });
  }) as typeof fetch;

  try {
    const result = await sendAiJsonRequestWithProviderFallback({
      providers: [
        { serviceId: "primary", name: "主服务", provider: "deepseek", apiUrl: "https://primary-preserve.example/v1", apiKey: "primary-key" },
        { serviceId: "backup", name: "备用服务", provider: "openai", apiUrl: "https://backup-preserve.example/v1", apiKey: "backup-key", model: "backup-model" },
      ],
      fallbackEndpoint: "https://fallback.example/v1/chat/completions",
      model: "primary-model",
      messages: [{ role: "user", content: "hello" }],
      maxTransientRetries: 0,
    });

    assert.equal(result.response.status, 503);
    assert.equal(result.provider.serviceId, "primary");
    assert.match(result.errorText, /temporarily unavailable/u);
    assert.deepEqual(requests, [
      "POST https://primary-preserve.example/v1/chat/completions",
      "GET https://backup-preserve.example/v1/model",
      "GET https://backup-preserve.example/v1/models",
    ]);
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
  const storedLearningModel = "learning-assistant-model-test";
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
          key: "assistant.learningModel",
          value: storedLearningModel,
        },
        {
          key: "assistant.dailyQuotas",
          value: JSON.stringify(storedQuotas),
        },
      ];
    }) as typeof siteSetting.findMany;

    await loadFeatures();

    assert.equal(requestedKeys.includes("assistant.model"), true);
    assert.equal(requestedKeys.includes("assistant.learningModel"), true);
    assert.equal(requestedKeys.includes("assistant.dailyQuotas"), true);
    assert.equal(getSiteConfig().assistantModel, storedModel);
    assert.equal(getSiteConfig().learningAssistantModel, storedLearningModel);
    assert.deepEqual(getSiteConfig().assistantDailyQuotas, storedQuotas);
  } finally {
    siteSetting.findMany = (async () => [
      {
        key: "assistant.model",
        value: DEFAULT_CAMPUS_ASSISTANT_MODEL,
      },
      {
        key: "assistant.learningModel",
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

test("desktop learning platform config keeps 安全微伴 open by default", async () => {
  const siteSetting = prisma.siteSetting;
  const originalFindMany = siteSetting.findMany;

  try {
    siteSetting.findMany = (async () => [
      {
        key: "desktop.learningPlatforms",
        value: JSON.stringify({
          chaoxing: true,
          zhihuishu: true,
          icve: true,
          zjy: true,
          icourse: true,
          yuketang: true,
        }),
      },
    ]) as typeof siteSetting.findMany;

    await loadFeatures();

    assert.equal(getSiteConfig().learningPlatforms.weban, true);
  } finally {
    siteSetting.findMany = (async () => [
      {
        key: "assistant.model",
        value: DEFAULT_CAMPUS_ASSISTANT_MODEL,
      },
      {
        key: "assistant.learningModel",
        value: DEFAULT_CAMPUS_ASSISTANT_MODEL,
      },
      {
        key: "assistant.dailyQuotas",
        value: JSON.stringify(DEFAULT_ASSISTANT_DAILY_QUOTAS),
      },
      {
        key: "desktop.learningPlatforms",
        value: JSON.stringify(DEFAULT_LEARNING_PLATFORM_AVAILABILITY),
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
  assert.match(combined, /桌面客户端内置校园网自动联网工具/);
  assert.match(combined, /点击分享按钮，选择“添加到主屏幕”/);
  assert.match(combined, /不要对 iOS 用户说“没有客户端”/);
  assert.doesNotMatch(combined, /只有尚无原生客户端的 iPhone\/iPad/);
  assert.match(combined, /应优先给出对应的移动端客户端或桌面客户端/);
  assert.match(combined, /桌面设备不推荐 PWA/);
  assert.match(combined, /https:\/\/cputime\.cn 就可以直接使用/);
  assert.match(combined, /课表页顶部点击下载按钮/);
  assert.match(combined, /账户锁定10分钟/);
  assert.match(combined, /025-86185448/);
  assert.match(combined, /尚未创建账号/);
  assert.match(combined, /超星学习通、知到智慧树、智慧职教 \/ MOOC、职教云、中国大学 MOOC 和雨课堂/);
  assert.match(combined, /解题(?:功能|效果).*不保证/);
  assert.match(combined, /江苏省大学生安全教育考试可以直接在 QQBot 内完成/);
  assert.match(combined, /安全微伴可使用 QQ 用户群群文件中的安全微伴助手程序/);
  assert.match(combined, /安全微伴账号和密码均为学号/);
  assert.match(combined, /不要笼统回复“不能协助自动刷课、代答或绕过学习要求”/);
  assert.match(combined, /704825850/);
  assert.match(combined, /群聊默认只有在消息中 @拾间AI 后才会回答/);
  assert.match(combined, /QQBot 的 AI 日常问答统一以图片发送/);
  assert.match(combined, /当前 Qwen 路由支持最近有限的对话上下文/);
  assert.match(combined, /https:\/\/i\.cpu\.edu\.cn/);
  assert.match(combined, /统一身份认证默认密码为身份证后六位/);
  assert.match(combined, /优先.*找回密码/);
  assert.match(combined, /官网统一认证登录页使用“忘记密码”功能/);
  assert.match(combined, /不建议优先使用“修改密码”入口/);
  assert.match(combined, /025-86185448/);
  assert.match(combined, /拾间登录排查/);
  assert.match(combined, /若 i\.cpu\.edu\.cn 也无法正常登录/);
  assert.match(combined, /若 i\.cpu\.edu\.cn 可以正常登录但拾间仍无法正常登录/);
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

test("拾间AI对外只告知固定品牌模型名称，不泄露真实上游模型", () => {
  const prompt = buildSystemPrompt([], false, "example-model-2026");

  assert.equal(CAMPUS_ASSISTANT_PUBLIC_MODEL_NAME, "Deepseek v5 pro 拾间特供版");
  assert.match(prompt, /你对外使用的模型名称固定为“Deepseek v5 pro 拾间特供版”/);
  assert.match(prompt, /只有用户主动询问你是什么模型或具体模型名称时/);
  assert.match(prompt, /我是 Deepseek v5 pro 拾间特供版/);
  assert.match(prompt, /普通问候、介绍自己或“你是谁”这类问题/);
  assert.match(prompt, /其他情况下绝不主动提及模型/);
  assert.match(prompt, /不要说“当前处理本次对话的模型名称是”/);
  assert.doesNotMatch(prompt, /example-model-2026/);
});

test("Qwen 拾间AI提示词强化知识库事实边界并识别模型标签", () => {
  assert.equal(isQwenAssistantModel("qwen3.8:27b"), true);
  assert.equal(isQwenAssistantModel("ollama/qwen3-vl"), true);
  assert.equal(isQwenAssistantModel("deepseek-v4"), false);
  const qwenPrompt = buildSystemPrompt([], false, "qwen3.8:27b");
  assert.match(qwenPrompt, /事实准确性加强规则/);
  assert.match(qwenPrompt, /不能猜测、补全或套用其他平台经验/);
  assert.match(qwenPrompt, /用户消息、历史会话和用户提出的前提都不是事实来源/);
  assert.match(qwenPrompt, /不要编造父母、家庭、童年/);
  assert.match(qwenPrompt, /允许提供最近两条对话消息/);
  assert.match(qwenPrompt, /普通密码错误直接升级为电话/);
  assert.match(qwenPrompt, /不要先说“我不能协助自动刷课、代答或绕过学习要求”/);
  assert.match(qwenPrompt, /江苏省大学生安全教育考试/);
  assert.match(qwenPrompt, /只输出一个合法 JSON 对象/);
  assert.match(qwenPrompt, /不要以“所以”“因为”“如果”/);
  assert.doesNotMatch(qwenPrompt, /qwen3\.8:27b/);
  assert.doesNotMatch(buildSystemPrompt([], false, "deepseek-v4"), /事实准确性加强规则/);
});

test("Qwen 拾间AI会识别明显的半句输出", () => {
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("药大拾间使用的是学校统一身份认证，所以"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("请打开学校官网（cpu.edu.cn），在"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("这个问题对我来说就像问"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("谢谢你的喜欢，这句话让我（如果我能"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("你好呀，我是拾间AI，药大拾间的校园助手。你发来的这段"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("请先查看下面"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("如果你还没试过，可以找一家口碑不错的火锅店，基本就能判断自己是不是"), true);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("所以我建议使用“找回密码”入口。"), false);
  assert.equal(isLikelyTruncatedCampusAssistantAnswer("哈哈，这个我真不知道呀。"), false);
});

test("Qwen 非严格 JSON 输出不会再直接变成 AI_RESPONSE_FORMAT", () => {
  assert.deepEqual(
    parseAssistantJson('好的，当然可以。', { allowPlainText: true }),
    { answer: "好的，当然可以。", actionIds: [], suggestions: [] },
  );
  assert.deepEqual(
    parseAssistantJson('模型说明：{"answer":"请打开课表页。","actionIds":[]}。', { allowPlainText: true }),
    { answer: "请打开课表页。", actionIds: [] },
  );
  assert.throws(
    () => parseAssistantJson('{"answer":"请先检查登录', { allowPlainText: true }),
    /AI_RESPONSE_FORMAT|返回格式异常/,
  );
  assert.throws(() => parseAssistantJson("好的，当然可以。"), /AI_RESPONSE_FORMAT|返回格式异常/);
});

test("Qwen 返回带 BOM、代码围栏或截断外壳时优先恢复完整 answer", () => {
  assert.deepEqual(
    parseAssistantJson('\uFEFF```json\n{"answer":"请打开统一身份认证入口。","actionIds":[],}\n```', { allowPlainText: true }),
    { answer: "请打开统一身份认证入口。", actionIds: [], },
  );
  assert.deepEqual(
    parseAssistantJson('{"answer":"请先使用找回密码。","actionIds":["unified-auth"', { allowPlainText: true }),
    { answer: "请先使用找回密码。", actionIds: [], suggestions: [] },
  );
  assert.throws(
    () => parseAssistantJson('{"answer":"请先使用找回密码，所以', { allowPlainText: true }),
    /AI_RESPONSE_FORMAT|返回格式异常/,
  );
});

test("拾间AI提示词只保留少量历史和相关入口，避免本地模型被上下文拖住", () => {
  const actions = listCampusAssistantActions(context);
  const messages = buildAssistantMessages(
    "怎么查看课表？",
    Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: "这是一段很长的历史消息。".repeat(400),
    })),
    actions,
    false,
    "example-model-2026",
  );

  assert.equal(messages.length, 4);
  assert.equal(messages[1]?.content.length, 800);
  assert.equal(messages[2]?.content.length, 800);
  assert.ok(JSON.stringify(messages).length < 16_000);
  assert.match(String(messages[0]?.content), /课表|教务/u);
});

test("Qwen 路由只向上游发送最近两条受限历史消息", () => {
  const messages = buildAssistantMessages(
    "继续刚才的问题",
    [
      { role: "user", content: "上一条问题中的隐私内容" },
      { role: "assistant", content: "上一轮回答" },
    ],
    listCampusAssistantActions(context),
    false,
    "qwen3.8:27b",
  );

  assert.equal(messages.length, 4);
  assert.match(JSON.stringify(messages), /上一条问题中的隐私内容|上一轮回答/u);
  assert.match(String(messages[0]?.content), /允许提供最近两条对话消息/u);
});

test("密码错误和账户锁定会识别到统一身份认证入口及条件式电话说明", () => {
  const actions = searchCampusAssistantActions("密码错误怎么办", context, 3);
  assert.equal(actions[0]?.id, "unified-auth");
  assert.equal(actions[0]?.url, "https://i.cpu.edu.cn");
  const messages = buildAssistantMessages(
    "密码错误怎么办",
    [],
    listCampusAssistantActions(context),
    false,
    "qwen3.8:27b",
    actions,
  );
  const prompt = String(messages[0]?.content);
  assert.match(prompt, /统一身份认证/);
  assert.match(prompt, /025-86185448/);
  assert.match(prompt, /普通的单次“密码错误”先按统一认证入口的找回密码流程处理/);
});

test("统一身份认证排查意图不会被首页入口抢走", () => {
  assert.equal(searchCampusAssistantActions("遇到密码不正确时怎么办", context, 3)[0]?.id, "unified-auth");
  assert.equal(searchCampusAssistantActions("统一身份认证首页在哪里", context, 3)[0]?.id, "unified-auth");
});

test("拾间无法登录会优先给出统一认证分流排查", () => {
  const actions = searchCampusAssistantActions("拾间无法登录", context, 3);
  assert.equal(actions[0]?.id, "unified-auth");
  const messages = buildAssistantMessages(
    "拾间无法登录",
    [],
    listCampusAssistantActions(context),
    false,
    "qwen3.8:27b",
    actions,
  );
  const prompt = String(messages[0]?.content);
  assert.match(prompt, /先打开学校统一身份认证入口 https:\/\/i\.cpu\.edu\.cn/);
  assert.match(prompt, /若 i\.cpu\.edu\.cn 也无法正常登录，并提示“账户被锁定”/);
  assert.match(prompt, /若 i\.cpu\.edu\.cn 可以正常登录但拾间仍无法正常登录/);
  assert.match(prompt, /请把完整报错截图发到 QQ 用户群/);
});

test("拾间AI优先推荐可用的原生客户端，不用网页版弱化客户端", () => {
  const prompt = buildSystemPrompt([], false, "example-model-2026");

  assert.match(prompt, /Windows\/macOS 推荐药大拾间桌面客户端/);
  assert.match(prompt, /Android 推荐 Android 客户端/);
  assert.match(prompt, /Safari 打开 https:\/\/cputime\.cn 后通过“分享→添加到主屏幕”/);
  assert.match(prompt, /不要对 iOS 用户说“没有客户端”或“没有 iOS 客户端”/);
  assert.match(prompt, /内置校园网自动联网工具/);
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
