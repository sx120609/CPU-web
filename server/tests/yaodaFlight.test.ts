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
import {
  flightDifficulty,
  flightPipeGeometry,
  flightSpeed,
} from "../../web/src/views/services/yaodaFlightDifficulty";

test("药大人能飞采用缓和后的递进难度曲线", () => {
  assert.deepEqual(flightDifficulty(0), { speed: 116, gapSize: 210, spacing: 242, gravity: 930 });
  assert.deepEqual(flightDifficulty(6), { speed: 138, gapSize: 182, spacing: 216, gravity: 1035 });
  assert.deepEqual(flightDifficulty(7), { speed: 150, gapSize: 168, spacing: 210, gravity: 1060 });
  assert.deepEqual(flightDifficulty(15), { speed: 164, gapSize: 154, spacing: 198, gravity: 1120 });

  const stages = Array.from({ length: 31 }, (_, score) => flightDifficulty(score));
  for (let index = 1; index < stages.length; index += 1) {
    assert.ok(stages[index].speed >= stages[index - 1].speed);
    assert.ok(stages[index].gapSize <= stages[index - 1].gapSize);
    assert.ok(stages[index].spacing <= stages[index - 1].spacing);
    assert.ok(stages[index].gravity >= stages[index - 1].gravity);
  }
});

test("飞行速度平滑波动且不会回到旧版极限速度", () => {
  const speeds = Array.from({ length: 241 }, (_, index) => flightSpeed(30, index / 10));
  assert.ok(new Set(speeds.map((speed) => speed.toFixed(2))).size > 100);
  assert.ok(Math.max(...speeds) < 172);
  assert.ok(Math.min(...speeds) > 158);
});

test("每根管道的开口和间距会变化且保留安全下限", () => {
  const geometries = Array.from({ length: 32 }, (_, index) => flightPipeGeometry(30, index));
  assert.ok(new Set(geometries.map((item) => item.gapSize)).size > 3);
  assert.ok(new Set(geometries.map((item) => item.spacing)).size > 3);
  assert.ok(geometries.every((item) => item.gapSize >= 150));
  assert.ok(geometries.every((item) => item.spacing >= 194));
  assert.ok(geometries.every((item) => item.gapSize > 150 || item.spacing >= 204));
});

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
