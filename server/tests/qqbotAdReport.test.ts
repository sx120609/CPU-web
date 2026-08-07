import assert from "node:assert/strict";
import test from "node:test";
import { classifyQqBotAdReportAvailability } from "../src/routes/qqbotAdReport";

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
