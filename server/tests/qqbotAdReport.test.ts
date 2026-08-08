import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqBotBindingGuideUrl,
  classifyQqBotAdReportAvailability,
  normalizeQqBotAdReportAction,
  normalizeQqBotAdReportMuteSeconds,
  renderQqBotAdReportActionPage,
} from "../src/routes/qqbotAdReport";
import {
  describeQqGroupWhitelistPolicy,
  extractQqGroupAdVerificationCode,
  renderQqGroupAdVerificationPrompt,
  renderQqGroupAdFilterPrivateNotice,
  resolveQqGroupWhitelistReviewPlan,
} from "../src/services/qqbot";

const now = Date.parse("2026-08-08T00:00:00.000Z");

test("keeps an open report actionable before expiry", () => {
  assert.equal(
    classifyQqBotAdReportAvailability("open", new Date(now + 60_000), now),
    "open",
  );
});

test("classifies an open report as expired after its deadline", () => {
  assert.equal(
    classifyQqBotAdReportAvailability("open", new Date(now - 1), now),
    "expired",
  );
});

test("keeps an already expired report expired on repeated visits", () => {
  assert.equal(
    classifyQqBotAdReportAvailability("expired", new Date(now + 60_000), now),
    "expired",
  );
});

test("distinguishes an actually handled report from an expired report", () => {
  assert.equal(
    classifyQqBotAdReportAvailability("handled", new Date(now + 60_000), now),
    "handled",
  );
});

test("uses a ten-minute default for report-page mute actions", () => {
  assert.equal(normalizeQqBotAdReportMuteSeconds(undefined), 10 * 60);
  assert.equal(normalizeQqBotAdReportMuteSeconds(""), 10 * 60);
});

test("accepts a custom mute duration and clamps unsafe values", () => {
  assert.equal(normalizeQqBotAdReportMuteSeconds(90), 90 * 60);
  assert.equal(normalizeQqBotAdReportMuteSeconds(0), 60);
  assert.equal(normalizeQqBotAdReportMuteSeconds(-10), 60);
  assert.equal(normalizeQqBotAdReportMuteSeconds(99_999), 30 * 24 * 60 * 60);
});

test("accepts clearing the strike counter as a report action", () => {
  assert.equal(normalizeQqBotAdReportAction("clear-hit-count"), "clear-hit-count");
  assert.equal(normalizeQqBotAdReportAction("add-whitelist"), "add-whitelist");
  assert.equal(normalizeQqBotAdReportAction("reset-all"), "");
});

test("sends unbound administrators to the QQ binding page and preserves the report link", () => {
  const reportPath = "/qqbot/ad-report/abcdefghijklmnopqrstuvwx";
  const target = new URL(buildQqBotBindingGuideUrl(reportPath), "https://cpu.lizmt.cn");
  assert.equal(target.pathname, "/messages");
  assert.equal(target.searchParams.get("tab"), "settings");
  assert.equal(target.searchParams.get("qqbot"), "bind");
  assert.equal(target.searchParams.get("returnTo"), reportPath);
});

test("does not preserve unrelated return paths in the QQ binding guide", () => {
  const target = new URL(buildQqBotBindingGuideUrl("//example.com/steal"), "https://cpu.lizmt.cn");
  assert.equal(target.searchParams.get("returnTo"), "/home");
});

test("explains whitelist hard restrictions without asking the user to apply again", () => {
  const notice = renderQqGroupAdFilterPrivateNotice({
    groupName: "测试群",
    review: { reason: "二维码", detail: "二维码", action: "block", riskScore: 100 } as any,
    whitelistRestriction: "二维码",
  });
  assert.match(notice, /白名单仍然有效/);
  assert.match(notice, /无需重复申请/);
  assert.doesNotMatch(notice, /完成验证/);
});

test("describes whitelist rules per group instead of implying a global whitelist", () => {
  const base = { enabled: true, adFilterEnabled: true } as const;
  assert.match(
    describeQqGroupWhitelistPolicy({
      ...base,
      adFilterWhitelistBlockQrCodeEnabled: false,
      adFilterWhitelistBlockGroupCardEnabled: false,
    }),
    /仅对当前群|本群独立生效/,
  );
  assert.match(
    describeQqGroupWhitelistPolicy({
      ...base,
      adFilterWhitelistBlockQrCodeEnabled: true,
      adFilterWhitelistBlockGroupCardEnabled: false,
    }),
    /仍拦截二维码/,
  );
});

test("verification answers accept spaces around the reversed word and digits", () => {
  assert.equal(
    extractQqGroupAdVerificationCode("验证码 大 药 97"),
    "大药97",
  );
  assert.equal(
    extractQqGroupAdVerificationCode("白名单验证：大药 97"),
    "大药97",
  );
  assert.match(renderQqGroupAdVerificationPrompt("药大", 97), /直接发送文字答案/);
  assert.match(renderQqGroupAdVerificationPrompt("药大", 97), /不要发手写图片/);
});

test("whitelisted messages bypass ordinary advertising regardless of media shape", () => {
  for (const scenario of [
    { hasGroupCard: false, hasReviewableMedia: false },
    { hasGroupCard: false, hasReviewableMedia: true },
  ]) {
    assert.equal(
      resolveQqGroupWhitelistReviewPlan({
      whitelisted: true,
        ...scenario,
      blockQrCode: false,
      blockGroupCard: false,
      }),
      "bypass",
    );
  }
});

test("whitelist QR restriction is the only media review path when enabled", () => {
  assert.equal(
    resolveQqGroupWhitelistReviewPlan({
      whitelisted: true,
      hasGroupCard: false,
      hasReviewableMedia: true,
      blockQrCode: true,
      blockGroupCard: false,
    }),
    "qr-only",
  );
  assert.equal(
    resolveQqGroupWhitelistReviewPlan({
      whitelisted: true,
      hasGroupCard: false,
      hasReviewableMedia: false,
      blockQrCode: false,
      blockGroupCard: false,
    }),
    "bypass",
  );
});

test("whitelist group-card restrictions remain an explicit independent rule", () => {
  assert.equal(
    resolveQqGroupWhitelistReviewPlan({
      whitelisted: true,
      hasGroupCard: true,
      hasReviewableMedia: false,
      blockQrCode: false,
      blockGroupCard: true,
    }),
    "block-group-card",
  );
  assert.equal(
    resolveQqGroupWhitelistReviewPlan({
      whitelisted: true,
      hasGroupCard: true,
      hasReviewableMedia: false,
      blockQrCode: false,
      blockGroupCard: false,
    }),
    "bypass",
  );
});

test("report page exposes whitelist action and separates action groups", () => {
  const html = renderQqBotAdReportActionPage(
    { groupName: "测试群", groupId: "1", offenderNickname: "用户", offenderQqId: "123456", hitCount: 2, reason: "招募" },
    { name: "测试群", allowMute: true, allowKick: true, allowKickAndBlock: true },
    "999999",
  );
  assert.match(html, /value="add-whitelist"/);
  assert.match(html, /加入 30 天白名单/);
  assert.match(html, /action-section/);
  assert.match(html, /群管理处置/);
});

test("a non-whitelisted message continues through the full advertising path", () => {
  assert.equal(
    resolveQqGroupWhitelistReviewPlan({
      whitelisted: false,
      hasGroupCard: false,
      hasReviewableMedia: true,
      blockQrCode: true,
      blockGroupCard: false,
    }),
    "full",
  );
});
