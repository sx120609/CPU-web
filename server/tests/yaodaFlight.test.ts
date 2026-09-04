import test from "node:test";
import assert from "node:assert/strict";
import {
  earnedYaodaFlightAchievementCodes,
  isRecoverableYaodaFlightHistoryItem,
  minimumDurationForFlightScore,
  publicFlightName,
  validateYaodaFlightResult,
  YAODA_FLIGHT_ACHIEVEMENTS,
  YAODA_FLIGHT_MAX_SCORE,
  YAODA_FLIGHT_RECOVERY_STARTED_AT_MS,
  YAODA_FLIGHT_START_LIMIT_PER_10_MIN,
} from "../src/services/yaodaFlightPolicy";

test("药大人能飞的最低用时随分数递增", () => {
  assert.equal(minimumDurationForFlightScore(0), 0);
  assert.equal(minimumDurationForFlightScore(1), 2_800);
  assert.equal(minimumDurationForFlightScore(10), 12_700);
  assert.equal(YAODA_FLIGHT_START_LIMIT_PER_10_MIN, 60);
});

test("正常飞行成绩通过服务端校验", () => {
  assert.equal(validateYaodaFlightResult({ score: 12, durationMs: 18_000, serverElapsedMs: 19_200 }), null);
  assert.equal(validateYaodaFlightResult({ score: 0, durationMs: 430, serverElapsedMs: 650 }), null);
});

test("历史补传只接收限流缺陷影响时段内的本机成绩", () => {
  const playedAtMs = YAODA_FLIGHT_RECOVERY_STARTED_AT_MS + 15 * 60 * 1000;
  const attemptStartedAtMs = Array.from({ length: 12 }, (_, index) => playedAtMs - (index + 1) * 30_000);
  assert.equal(isRecoverableYaodaFlightHistoryItem({
    score: 8,
    playedAtMs,
    nowMs: playedAtMs + 1_000,
    attemptStartedAtMs,
  }), true);
  assert.equal(isRecoverableYaodaFlightHistoryItem({
    score: 8,
    playedAtMs,
    nowMs: playedAtMs + 1_000,
    attemptStartedAtMs: attemptStartedAtMs.slice(0, 11),
  }), false);
  assert.equal(isRecoverableYaodaFlightHistoryItem({
    score: 8,
    playedAtMs: YAODA_FLIGHT_RECOVERY_STARTED_AT_MS - 1,
    nowMs: playedAtMs + 1_000,
    attemptStartedAtMs,
  }), false);
});

test("异常高分和伪造时长会被拒绝", () => {
  assert.match(validateYaodaFlightResult({ score: 30, durationMs: 2_000, serverElapsedMs: 2_100 }) || "", /不匹配/);
  assert.match(validateYaodaFlightResult({ score: YAODA_FLIGHT_MAX_SCORE + 1, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateYaodaFlightResult({ score: 1, durationMs: 20_000, serverElapsedMs: 2_000 }) || "", /客户端/);
});

test("排行榜只展示昵称并保留数字昵称，不回退到账号或学号", () => {
  assert.equal(publicFlightName("  药大\u0000同学  "), "药大同学");
  assert.equal(publicFlightName(""), "药大同学");
  assert.equal(publicFlightName("20261234567"), "20261234567");
  assert.equal(publicFlightName("一二三四五六七八九十一二三四五六七八九十一二三四五六"), "一二三四五六七八九十一二三四五六七八九十一二三四");
});

test("云端成就同时覆盖分数、局数、累计与特殊分数", () => {
  const codes = earnedYaodaFlightAchievementCodes({ games: 20, bestScore: 16, totalScore: 220, currentScore: 16 });
  assert.ok(codes.includes("first_flight"));
  assert.ok(codes.includes("score_10"));
  assert.ok(codes.includes("games_20"));
  assert.ok(codes.includes("total_200"));
  assert.ok(codes.includes("exact_16"));
  assert.ok(!codes.includes("score_20"));
  assert.ok(!codes.includes("exact_8"));
  assert.equal(YAODA_FLIGHT_ACHIEVEMENTS.length, 14);
});
