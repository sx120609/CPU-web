import assert from "node:assert/strict";
import test from "node:test";
import { escapeControlCharactersInJsonStrings, parseAssistantJson } from "../src/services/campusAssistant";

test("拾间AI 接受字符串里直接换行的 JSON 回复", () => {
  const raw = "{\"answer\":\"第一段\n\n第二段\t结尾\",\"actionIds\":[],\n\"suggestions\":[\"再问\"]}";
  assert.deepEqual(parseAssistantJson(raw), {
    answer: "第一段\n\n第二段\t结尾",
    actionIds: [],
    suggestions: ["再问"],
  });
  assert.equal(
    escapeControlCharactersInJsonStrings("{\"a\":\"x\\\"\ny\"}\n"),
    "{\"a\":\"x\\\"\\ny\"}\n",
  );
});

test("拾间AI 对没有 JSON 模式的模型接受完整的纯文字回答，并在失败时带上原始回复", () => {
  assert.deepEqual(
    parseAssistantJson("鸭粪的气味和牛粪、鸡粪一样难闻。", { allowPlainText: true }),
    { answer: "鸭粪的气味和牛粪、鸡粪一样难闻。", actionIds: [], suggestions: [] },
  );
  assert.throws(
    () => parseAssistantJson("这不是 JSON"),
    (error: Error & { rawContent?: string }) => error.message === "拾间AI返回格式异常" && error.rawContent === "这不是 JSON",
  );
});
