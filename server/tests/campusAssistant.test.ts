import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPartialJsonStringValue,
  listCampusAssistantActions,
  listCampusAssistantKnowledge,
  normalizeAssistantResponse,
  searchCampusAssistantActions,
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
