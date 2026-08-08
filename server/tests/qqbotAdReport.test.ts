import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqBotBindingGuideUrl,
  classifyQqBotAdReportAvailability,
  normalizeQqBotAdReportAction,
  normalizeQqBotAdReportMuteSeconds,
} from "../src/routes/qqbotAdReport";
import {
  describeQqGroupWhitelistPolicy,
  renderQqGroupAdFilterPrivateNotice,
  shouldBypassQqGroupAdFilterForWhitelist,
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

test("whitelisted plain text never reaches an advertising block", () => {
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: true,
      hasGroupCard: false,
      isQrCodeReview: false,
      blockQrCode: true,
      blockGroupCard: true,
    }),
    true,
  );
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: false,
      hasGroupCard: false,
      isQrCodeReview: false,
      blockQrCode: false,
      blockGroupCard: false,
    }),
    false,
  );
});

test("whitelist QR restrictions apply only when enabled for that group", () => {
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: true,
      hasGroupCard: false,
      isQrCodeReview: true,
      blockQrCode: true,
      blockGroupCard: false,
    }),
    false,
  );
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: true,
      hasGroupCard: false,
      isQrCodeReview: true,
      blockQrCode: false,
      blockGroupCard: false,
    }),
    true,
  );
});

test("whitelist group-card restrictions apply only when enabled for that group", () => {
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: true,
      hasGroupCard: true,
      isQrCodeReview: false,
      blockQrCode: false,
      blockGroupCard: true,
    }),
    false,
  );
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: true,
      hasGroupCard: true,
      isQrCodeReview: false,
      blockQrCode: false,
      blockGroupCard: false,
    }),
    true,
  );
});

test("a QR code inside a group card still follows the QR restriction", () => {
  assert.equal(
    shouldBypassQqGroupAdFilterForWhitelist({
      whitelisted: true,
      hasGroupCard: true,
      isQrCodeReview: true,
      blockQrCode: true,
      blockGroupCard: false,
    }),
    false,
  );
});
