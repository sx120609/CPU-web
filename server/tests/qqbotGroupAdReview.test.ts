import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  detectQqCampusOrganizationRecruitmentBypassReason,
  detectHarmlessQqGroupAdBypassReason,
  detectQqGroupAdHardBlockReason,
  detectQqUnofficialNoticeDiversionReason,
  isQqGroupQrDecision,
  isQqBotAssistantIntent,
  isQqBotAssistantMetaMessage,
  prepareQqGroupAdImagePayloads,
  resolveQqGroupWhitelistReviewPlan,
  resolveQqGroupQrOnlyReviewAction,
  resolveQqGroupAdModelCandidates,
  resolveQqGroupAdReviewAction,
  shouldForwardQqBotAssistantIntent,
} from "../src/services/qqbotGroupAdReview";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const VALID_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

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

test("allows non-commercial campus club recruitment with a QQ group number", () => {
  const content = "中国药科大学兵击协会招新，欢迎同学报名加入，QQ群：3498138727";
  assert.equal(detectQqCampusOrganizationRecruitmentBypassReason(content), "命中校园社团/学生组织招新豁免");
  assert.equal(detectQqGroupAdHardBlockReason(content), null);
});

test("allows a club recruitment poster phrase without treating the QQ number as an ad", () => {
  const content = "欧洲古典剑术社团招新，报名加入 QQ 群 3498138727";
  assert.equal(detectQqGroupAdHardBlockReason(content), null);
});

test("hard-blocks a fake official notice that repeatedly diverts to an unverified QQ group", () => {
  const content = [
    "@全体成员 都看下，最后一次通知，别错过了学校重要消息！",
    "大家今天晚上12点之前务必加上，更好的了解大学、入党入团、社团招新等",
    "QQ群：786468953",
    "QQ群：786468953",
    "QQ群：786468953",
  ].join("\n");
  assert.equal(
    detectQqUnofficialNoticeDiversionReason(content),
    "疑似冒充学校/官方通知并引导加入未核验 QQ 群",
  );
  assert.equal(
    detectQqGroupAdHardBlockReason(content),
    "疑似冒充学校/官方通知并引导加入未核验 QQ 群",
  );
});

test("does not treat an ordinary school club recruitment as a fake official notice", () => {
  const content = "中国药科大学兵击协会招新，欢迎同学报名加入，QQ群：3498138727";
  assert.equal(detectQqUnofficialNoticeDiversionReason(content), null);
  assert.equal(detectQqGroupAdHardBlockReason(content), null);
});

test("hard-blocks an unnumbered freshman notice group diversion", () => {
  const content = "还未进群新生通知群注意！！请大家务必重视尽快进群，尤其26届新生，大一新生，开学通知入学须知之后都会发布，领取开学资料";
  assert.equal(
    detectQqUnofficialNoticeDiversionReason(content),
    "疑似冒充学校/官方通知并引导加入未核验 QQ 群",
  );
  assert.equal(
    detectQqGroupAdHardBlockReason(content),
    "疑似冒充学校/官方通知并引导加入未核验 QQ 群",
  );
});

test("hard-blocks a group dissolution notice that diverts members to a replacement group", () => {
  const content = [
    "此群作废，即将解散！！",
    "此群作废，即将解散！！",
    "接校方通知！老师建的26新生官方群，新生开学通知，录取通知，通知书邮寄，转换专业，社团报到，及各项通知安排等将在新群公布。",
    "所有人转移到老师刚建的新群:315719148",
    "所有人转移到老师刚建的新群:315719148",
  ].join("\n");
  assert.equal(
    detectQqUnofficialNoticeDiversionReason(content),
    "疑似冒充学校/官方通知并引导加入未核验 QQ 群",
  );
  assert.equal(
    detectQqGroupAdHardBlockReason(content),
    "疑似冒充学校/官方通知并引导加入未核验 QQ 群",
  );
});

test("does not exempt commercial recruitment that uses a club-like word", () => {
  const content = "商业培训社团招募代理，收费 399 元，QQ群：3498138727";
  assert.equal(detectQqCampusOrganizationRecruitmentBypassReason(content), null);
  assert.match(detectQqGroupAdHardBlockReason(content) || "", /QQ群号|加群|导流/);
  assert.equal(
    detectQqCampusOrganizationRecruitmentBypassReason("某公司社团招聘，加入QQ群：3498138727"),
    null,
  );
});

test("hard-blocks part-time tutoring diversion even when mixed with hobby groups", () => {
  const content = [
    "明日方舟群：1055678308",
    "GalGame群：1076856924",
    "动漫社群：1074546866",
    "兼职家教群：31027253611",
  ].join("\n");
  assert.equal(detectQqGroupAdHardBlockReason(content), "包含兼职/家教等商业招募并附群号导流");
});

test("keeps the group QR-code switch independent from campus recruitment", () => {
  assert.equal(detectQqGroupAdHardBlockReason("校园社团招新，扫码进群"), null);
  assert.match(
    detectQqGroupAdHardBlockReason("校园社团招新，扫码进群", true) || "",
    /二维码|扫码/,
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
  assert.equal(resolveQqGroupQrOnlyReviewAction({ riskScore: 70, modelDecision: "block" }), "block");
  assert.equal(resolveQqGroupQrOnlyReviewAction({ riskScore: 100, modelDecision: "auto_pass" }), "allow");
});

test("明确二维码硬规则不受普通广告阈值影响", () => {
  assert.equal(isQqGroupQrDecision("二维码", "官方通知图片"), true);
  assert.equal(isQqGroupQrDecision("商业推广", "没有二维码"), false);
  assert.equal(
    resolveQqGroupAdReviewAction({
      riskScore: 70,
      threshold: 85,
      modelDecision: "block",
      policyHardBlock: true,
    }),
    "block",
  );
  assert.equal(
    resolveQqGroupAdReviewAction({
      riskScore: 70,
      threshold: 85,
      modelDecision: "block",
    }),
    "allow",
  );
});

test("白名单只在开启对应硬限制时进入二维码或群卡片检测", () => {
  assert.equal(resolveQqGroupWhitelistReviewPlan({
    whitelisted: true,
    hasGroupCard: false,
    hasReviewableMedia: true,
    blockQrCode: false,
    blockGroupCard: false,
  }), "bypass");
  assert.equal(resolveQqGroupWhitelistReviewPlan({
    whitelisted: true,
    hasGroupCard: false,
    hasReviewableMedia: true,
    blockQrCode: true,
    blockGroupCard: false,
  }), "qr-only");
  assert.equal(resolveQqGroupWhitelistReviewPlan({
    whitelisted: true,
    hasGroupCard: false,
    hasReviewableMedia: false,
    hasQrTextSignal: true,
    blockQrCode: true,
    blockGroupCard: false,
  }), "qr-only");
  assert.equal(resolveQqGroupWhitelistReviewPlan({
    whitelisted: true,
    hasGroupCard: true,
    hasReviewableMedia: false,
    blockQrCode: false,
    blockGroupCard: true,
  }), "block-group-card");
});

test("主动回答意图只接受明确的语义分类结果", () => {
  assert.equal(isQqBotAssistantIntent("reply"), true);
  assert.equal(isQqBotAssistantIntent(true), true);
  assert.equal(isQqBotAssistantIntent("none"), false);
  assert.equal(isQqBotAssistantIntent("问号"), false);
});

test("群聊主动回答会屏蔽催促机器人回应的社交闲聊", () => {
  assert.equal(isQqBotAssistantMetaMessage("为什么不理我？"), true);
  assert.equal(isQqBotAssistantMetaMessage("怎么还不回复？"), true);
  assert.equal(isQqBotAssistantMetaMessage("在吗？"), true);
  assert.equal(isQqBotAssistantMetaMessage("教务处没反应怎么办？"), false);
  assert.equal(isQqBotAssistantMetaMessage("怎么刷课？"), false);
  assert.equal(shouldForwardQqBotAssistantIntent("为什么不理我？", "reply"), false);
  assert.equal(shouldForwardQqBotAssistantIntent("怎么刷课？", "reply"), true);
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
  const original = VALID_PNG;
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
  const original = VALID_PNG;
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

test("drops an HTML/error payload even when it is labeled image/png", async () => {
  const source = `data:image/png;base64,${Buffer.from("<html>gateway error</html>").toString("base64")}`;
  const prepared = await prepareQqGroupAdImagePayloads([source]);
  assert.deepEqual(prepared, []);
});

test("does not trust a .png filename when the local bytes are not an image", async () => {
  const relativePath = `qqbot-ad-review-test/${process.pid}-invalid.png`;
  const absolutePath = path.resolve(process.cwd(), "uploads", relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from("<!doctype html><title>expired image url</title>"));

  try {
    const prepared = await prepareQqGroupAdImagePayloads([`/uploads/${relativePath}`]);
    assert.deepEqual(prepared, []);
  } finally {
    await rm(path.resolve(process.cwd(), "uploads", "qqbot-ad-review-test"), { recursive: true, force: true });
  }
});

test("transcodes GIF stickers to PNG before sending them to Ollama", async () => {
  const source = `data:image/gif;base64,${VALID_GIF.toString("base64")}`;
  const prepared = await prepareQqGroupAdImagePayloads([source]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]?.sourceMimeType, "image/gif");
  assert.equal(prepared[0]?.mimeType, "image/png");
  assert.equal(prepared[0]?.transcoded, true);
  assert.match(String(prepared[0]?.dataUrl), /^data:image\/png;base64,/);
});
