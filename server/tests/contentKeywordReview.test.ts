import assert from "node:assert/strict";
import test from "node:test";
import { applyKeywordReview, reviewContentKeywords } from "../src/services/contentKeywordReview";
import { reviewReplyContent, reviewTopicContent } from "../src/services/topicAiReview";

test("incident samples and separator/encoding evasions cannot publish without review", () => {
  for (const content of [
    "麻豆传媒", "三片高清", "习扁担", "销售摇头丸", "出售毒品",
    "销售摇@头@丸", "售卖 摇 头 丸", "售卖 摇， @头 丸",
    "麻\u200b豆☆传\u2060媒", "麻 豆 傳 媒", "習扁擔", "銷售搖頭丸",
    "麻<b>豆</b>传媒", "麻&#35910;传&#x5a92;", "麻豆&nbsp;传媒",
    "[课程资料](https://example.test/" + encodeURIComponent("麻豆传媒") + ")",
    '<a href="https://example.test/麻&#35910;传媒">课程资料</a>',
    "出售雷管", "色情电影", "摇头丸现货出售", "色情電影", "換妻俱樂部", "販賣搖頭丸",
  ]) {
    const result = reviewContentKeywords({ content });
    assert.equal(result?.status, "manual_requested", content);
    assert.equal(result?.model, "local-keyword-filter-v1", content);
  }
});

test("normal pharmacy, course and contact text is left to ordinary automatic review", () => {
  for (const content of [
    "求研究生中特和马哲，价格面议", "麻醉药和精神药品的药理学课程",
    "硝酸甘油用于治疗心绞痛", "摇头丸的危害与禁毒教育",
    "药理学课程研究海洛因成瘾机制", "大麻素受体的生理作用",
    "微信 abc_123", "我买了三片高清保护膜", "本片讨论了色情产业的社会问题",
  ]) {
    assert.equal(reviewContentKeywords({ content }), null, content);
  }
});

test("titles and nested public metadata cannot bypass the filter", () => {
  assert.ok(reviewContentKeywords({ title: "麻豆传媒", content: "课程资料" }));
  assert.ok(reviewContentKeywords({ content: "课程资料", metadata: { links: ["销售摇头丸"] } }));
  assert.equal(reviewContentKeywords({ title: "出售教材", content: "药理学：摇头丸的危害" }), null);
});

test("service review screens before AI availability and self-contact shortcuts", async () => {
  assert.equal((await reviewTopicContent({ title: "课程资料", content: "麻豆传媒" })).status, "manual_requested");
  assert.equal((await reviewReplyContent({ boardType: "market", content: "vx:abc123[麻豆传媒](https://example.test)" })).status, "manual_requested");
  // A prohibited parent must not condemn an otherwise harmless reply.
  assert.equal((await reviewReplyContent({ boardType: "market", content: "微信 abc_123", parentContent: "麻豆传媒" })).status, "auto_passed");
});

test("keyword and AI disagreements go to a person, definite AI blocks remain automatic", () => {
  const keyword = reviewContentKeywords({ content: "麻豆传媒" });
  const passed = { status: "auto_passed", riskLevel: "low", riskScore: 5, reason: "仅提到名称", detail: '{"modelDecision":"auto_pass"}', model: "test" } as const;
  const conflict = applyKeywordReview(keyword, passed);
  assert.equal(conflict.status, "manual_requested");
  assert.equal(JSON.parse(conflict.detail).matchedTerm, "麻豆传媒");
  assert.equal(JSON.parse(conflict.detail).aiReview.reason, "仅提到名称");
  assert.equal(applyKeywordReview(null, passed).status, "auto_passed");
  assert.equal(applyKeywordReview(keyword, { ...passed, status: "blocked_ai", detail: '{"modelDecision":"block"}' }).status, "blocked_ai");
  assert.equal(applyKeywordReview(keyword, { ...passed, status: "blocked_ai", detail: '{"modelDecision":"manual_review"}' }).status, "manual_requested");
  const outage = applyKeywordReview(keyword, { ...passed, status: "blocked_ai", detail: '{"unavailable":true}' });
  assert.equal(JSON.parse(outage.detail).unavailable, true);
});
