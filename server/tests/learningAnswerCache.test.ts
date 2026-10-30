import assert from "node:assert/strict";
import test from "node:test";
import {
  decideLearningAnswerAppeal,
  detectLearningQuestionType,
  isLearningAnswerAppealBody,
  learningAnswerAppealBodySchema,
  learningAnswerCacheKey,
  normalizeLearningAnswer,
} from "../src/services/learningAnswerCache";
import { learningAssistantAiBodySchema, learningAssistantAiResponse } from "../src/services/learningAssistantAi";

const prompt = (type: string, question = "细胞的能量工厂是？", options = "A.线粒体 B.核糖体 C.高尔基体") =>
  `你是一位专业的学习辅导老师。只返回 JSON。\n\n这是一道${type}。答案字段只填写正确选项字母。\n\n题目：${question}\n选项：${options}`;

const body = (text: string, extra: Record<string, unknown> = {}) => learningAssistantAiBodySchema.parse({
  model: "deepseek-reasoner",
  reasoningEffort: "low",
  input: [{ role: "user", content: [{ type: "input_text", text }] }],
  ...extra,
});

test("only objective questions are cached; essays still go to the model every time", () => {
  assert.equal(detectLearningQuestionType(prompt("单选题")), "single");
  assert.equal(detectLearningQuestionType(prompt("多选题")), "multiple");
  assert.equal(detectLearningQuestionType(prompt("判断题")), "judgement");
  assert.equal(detectLearningQuestionType(prompt("填空题")), "blank");
  assert.equal(detectLearningQuestionType(prompt("简答题")), null);
  assert.equal(detectLearningQuestionType(prompt("论述题")), null);
  // 多平台助手的提示词只缓存，不受理申诉
  assert.equal(detectLearningQuestionType("题型：单选题；答案填写正确选项的完整文本"), null);
  assert.equal(detectLearningQuestionType("题型：单选题；答案填写正确选项的完整文本", { allowMultiplatform: true }), "single");

  assert.ok(learningAnswerCacheKey(body(prompt("单选题"))));
  assert.equal(learningAnswerCacheKey(body(prompt("简答题"))), null);
});

test("the cache key changes with the question, the options and the answer depth", () => {
  const key = learningAnswerCacheKey(body(prompt("单选题")));
  assert.equal(learningAnswerCacheKey(body(prompt("单选题"))), key);
  assert.notEqual(learningAnswerCacheKey(body(prompt("单选题", "细胞的蛋白质工厂是？"))), key);
  assert.notEqual(learningAnswerCacheKey(body(prompt("单选题", undefined, "A.核糖体 B.线粒体 C.高尔基体"))), key);
  assert.notEqual(learningAnswerCacheKey(body(prompt("单选题"), { reasoningEffort: "high" })), key);
});

test("a request carrying a screenshot of the current page is never cached", () => {
  const withScreenshot = learningAssistantAiBodySchema.parse({
    model: "deepseek-reasoner",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt("单选题") },
        { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "high" },
      ],
    }],
  });
  assert.equal(learningAnswerCacheKey(withScreenshot), null);
});

test("answers compare the way the assistant reads them", () => {
  assert.equal(normalizeLearningAnswer("single", "B"), "B");
  assert.equal(normalizeLearningAnswer("single", "b. 核糖体"), "B");
  assert.equal(normalizeLearningAnswer("multiple", "CA"), "AC");
  assert.equal(normalizeLearningAnswer("multiple", "a c"), "A");
  assert.equal(normalizeLearningAnswer("judgement", "对"), "正确");
  assert.equal(normalizeLearningAnswer("judgement", "×"), "错误");
  assert.equal(normalizeLearningAnswer("judgement", "不正确"), "错误");
  assert.equal(normalizeLearningAnswer("judgement", "不知道"), "");
  assert.equal(normalizeLearningAnswer("blank", " 线粒体 | ATP "), "线粒体|atp");
  assert.equal(normalizeLearningAnswer("blank", "线粒体||"), "");
});

test("an appeal is the answer conversation plus a follow-up that starts with the appeal marker", () => {
  // 桌面端把字符串内容改写成 input_text 数组，并补上 stream: false
  const raw = {
    model: "deepseek-reasoner",
    reasoningEffort: "low",
    stream: false,
    input: [
      { role: "user", content: [{ type: "input_text", text: prompt("单选题") }] },
      { role: "assistant", content: [{ type: "output_text", text: "C. 高尔基体" }] },
      { role: "user", content: [{ type: "input_text", text: "【答案申诉】A" }] },
    ],
  };
  assert.equal(isLearningAnswerAppealBody(raw), true);
  assert.doesNotThrow(() => learningAnswerAppealBodySchema.parse(raw));
  assert.equal(isLearningAnswerAppealBody({ ...raw, input: raw.input.slice(0, 1) }), false);
  assert.equal(isLearningAnswerAppealBody({ ...raw, input: [raw.input[0], raw.input[1], { role: "user", content: "再想想" }] }), false);
  // 普通答题入口仍只接受一条用户消息
  assert.throws(() => learningAssistantAiBodySchema.parse(raw));
});

test("three rounds decide the appeal by majority", () => {
  const round = (normalized: string) => ({ answer: normalized, normalized, outputText: JSON.stringify({ answer: normalized, explanation: "" }) });
  assert.deepEqual(
    [decideLearningAnswerAppeal("C", "A", [round("A"), round("A"), round("C")]).verdict, decideLearningAnswerAppeal("C", "A", [round("A"), round("A")]).refundPoints],
    ["claim-correct", 10],
  );
  const bothWrong = decideLearningAnswerAppeal("C", "A", [round("B"), round("B"), round("A")]);
  assert.equal(bothWrong.verdict, "both-wrong");
  assert.equal(bothWrong.refundPoints, 1);
  assert.equal(bothWrong.majority?.normalized, "B");
  const upheld = decideLearningAnswerAppeal("C", "A", [round("C"), round("A"), round("C")]);
  assert.equal(upheld.verdict, "original-correct");
  assert.equal(upheld.refundPoints, 0);
  const split = decideLearningAnswerAppeal("C", "A", [round("A"), round("B"), round("C")]);
  assert.equal(split.verdict, "inconclusive");
  assert.equal(split.refundPoints, 0);
  // 认不出答案的轮次不计票
  assert.equal(decideLearningAnswerAppeal("C", "A", [round(""), round(""), round("A")]).verdict, "inconclusive");
});

test("the assistant learns whether an answer came from the cache and can be appealed", () => {
  const output = JSON.stringify({ answer: "A", explanation: "线粒体是有氧呼吸的主要场所。" });
  assert.deepEqual(learningAssistantAiResponse(output, { cached: true, appealable: true }).learning_answer, {
    answer: "A",
    explanation: "线粒体是有氧呼吸的主要场所。",
    cached: true,
    appealable: true,
  });
  assert.deepEqual(learningAssistantAiResponse(output).learning_answer, { answer: "A", explanation: "线粒体是有氧呼吸的主要场所。" });
});
