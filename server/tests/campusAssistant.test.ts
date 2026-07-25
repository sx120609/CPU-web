import assert from "node:assert/strict";
import test from "node:test";
import {
  askCampusAssistant,
  extractPartialJsonStringValue,
  guardCampusAssistantResponse,
  isCampusAssistantPublicTopicRestricted,
  listCampusAssistantActions,
  listCampusAssistantKnowledge,
  normalizeAssistantResponse,
  sanitizeCampusAssistantStoredMessages,
  searchCampusAssistantActions,
  streamCampusAssistant,
} from "../src/services/campusAssistant";
import { readAiJsonTextStream } from "../src/services/aiJsonApi";

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
