import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  detectHarmlessQqGroupAdBypassReason,
  detectQqGroupAdHardBlockReason,
  prepareQqGroupAdImagePayloads,
  resolveQqGroupQrOnlyReviewAction,
  resolveQqGroupAdModelCandidates,
  resolveQqGroupAdReviewAction,
} from "../src/services/qqbotGroupAdReview";

test("routes image reviews to visual models and filters Spark/Codex candidates", () => {
  const config = {
    qqGroupAdReviewModel: "gpt-5.3-codex-spark",
    qqGroupAdReviewFallbackModels: "gpt-5.3-codex, gpt-4.1-mini",
    imageReviewModel: "gpt-4o-mini",
    imageReviewFallbackModels: "gpt-4.1",
  };

  assert.deepEqual(resolveQqGroupAdModelCandidates(config, true), ["gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"]);
  assert.deepEqual(resolveQqGroupAdModelCandidates(config, false), [
    "gpt-5.3-codex-spark",
    "gpt-5.3-codex",
    "gpt-4.1-mini",
  ]);
});

test("hard-blocks explicit QQ group number diversion", () => {
  assert.equal(
    detectQqGroupAdHardBlockReason("新生资料免费领取，欢迎加QQ群：3498138727"),
    "包含 QQ 群号并带有群号导流",
  );
});

test("does not hard-block a normal message that only mentions QQ groups", () => {
  assert.equal(detectQqGroupAdHardBlockReason("班级 QQ 群今晚通知上课地点"), null);
});

test("honors an explicit model block just below the configured threshold", () => {
  assert.equal(
    resolveQqGroupAdReviewAction({
      riskScore: 84,
      threshold: 85,
      modelDecision: "block",
    }),
    "block",
  );
});

test("QR-only review ignores the advertising threshold and requires an explicit QR block", () => {
  assert.equal(resolveQqGroupQrOnlyReviewAction({ riskScore: 100, modelDecision: "block" }), "block");
  assert.equal(resolveQqGroupQrOnlyReviewAction({ riskScore: 79, modelDecision: "block" }), "allow");
  assert.equal(resolveQqGroupQrOnlyReviewAction({ riskScore: 100, modelDecision: "auto_pass" }), "allow");
});

test("allows long KFC Thursday meme copy that imitates an advertisement", () => {
  const content = [
    "🎉KFC疯狂星期四｜V我50专业团队",
    "专注炸鸡、汉堡、蛋挞、薯条、可乐、鸡翅、鸡块、香辣鸡腿堡疯狂辅导。",
    "承接：疯狂星期四代吃、代点、代馋、代排队、代发朋友圈、代喊“V我50”",
    "微信号：V我50即可",
    "👍服务范围包括：选餐、凑券、下单、加辣、加冰、吃到满意、饭后回血、精神续命、周四快乐指导，包满足！",
    "有需要的请联络、惠存。今天不V，明天后悔；现在V我50，立刻开启肯德基人生新篇章！",
  ].join("\n");

  assert.match(detectHarmlessQqGroupAdBypassReason(content) || "", /疯狂星期四/);
});

test("does not bypass a KFC meme that contains a real diversion link", () => {
  assert.equal(
    detectHarmlessQqGroupAdBypassReason("疯狂星期四 V我50，详情见 https://example.com/order"),
    null,
  );
});

test("keeps original image bytes when preparing a visual review payload", async () => {
  const original = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const source = `data:image/png;base64,${original.toString("base64")}`;
  const prepared = await prepareQqGroupAdImagePayloads([source]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.sourceUrl, source);
  assert.equal(prepared[0]?.dataUrl, source);
  assert.deepEqual(
    Buffer.from(String(prepared[0]?.dataUrl).split(",")[1] || "", "base64"),
    original,
  );
});

test("reads a private uploads image locally instead of sending its relative URL upstream", async () => {
  const relativePath = `qqbot-ad-review-test/${process.pid}.png`;
  const absolutePath = path.resolve(process.cwd(), "uploads", relativePath);
  const original = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, original);

  try {
    const prepared = await prepareQqGroupAdImagePayloads([`/uploads/${relativePath}`]);
    assert.equal(prepared.length, 1);
    assert.match(String(prepared[0]?.dataUrl), /^data:image\/png;base64,/);
    assert.deepEqual(
      Buffer.from(String(prepared[0]?.dataUrl).split(",")[1] || "", "base64"),
      original,
    );
  } finally {
    await rm(path.resolve(process.cwd(), "uploads", "qqbot-ad-review-test"), { recursive: true, force: true });
  }
});
