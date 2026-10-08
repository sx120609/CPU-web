import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistantMessages,
  listCampusAssistantActions,
  searchCampusAssistantActions,
} from "../src/services/campusAssistant";

const allFeatures = new Proxy({}, { get: () => true }) as Parameters<typeof listCampusAssistantActions>[0]["features"];
const context = { features: allFeatures, forumAccessEnabled: true, loggedIn: false };
const actions = listCampusAssistantActions(context);

// Mirrors askCampusAssistant: the current message's matches are prioritized.
function systemPromptFor(message: string, history: Parameters<typeof buildAssistantMessages>[1]) {
  const prioritized = searchCampusAssistantActions(message, context, 3);
  return String(buildAssistantMessages(message, history, actions, false, "deepseek-chat", prioritized)[0].content);
}

test("追问没有关键词时仍保留上一问相关的入口和知识", () => {
  assert.equal(systemPromptFor("那补考呢", []).includes('"id":"jwxt"'), false);
  assert.equal(systemPromptFor("那补考呢", [
    { role: "user", content: "怎么查成绩" },
    { role: "assistant", content: "在教务数据页面查看。" },
  ]).includes('"id":"jwxt"'), true);
});

test("换了新话题时当前问题的入口排在上一问之前", () => {
  const prompt = systemPromptFor("宿舍电费怎么查", [
    { role: "user", content: "怎么查成绩" },
    { role: "assistant", content: "在教务数据页面查看。" },
  ]);
  const electric = prompt.indexOf('"id":"dorm-electric"');
  const grades = prompt.indexOf('"id":"jwxt"');
  assert.ok(electric >= 0);
  assert.ok(grades < 0 || electric < grades);
});
