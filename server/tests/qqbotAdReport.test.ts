import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqBotBindingGuideUrl,
  classifyQqBotAdReportAvailability,
  normalizeQqBotAdReportMuteSeconds,
} from "../src/routes/qqbotAdReport";

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
