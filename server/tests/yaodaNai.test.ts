import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  earnedYaodaNaiAchievementCodes,
  maxYaodaNaiScoreForDrops,
  minimumDurationForYaodaNaiDrops,
  minYaodaNaiDropsForLevel,
  minYaodaNaiScoreForLevel,
  validateYaodaNaiResult,
  YAODA_NAI_ACHIEVEMENTS,
  YAODA_NAI_DROP_COOLDOWN_MS,
  YAODA_NAI_MAX_DROPS,
  YAODA_NAI_MAX_LEVEL,
  YAODA_NAI_MAX_SCORE,
  YAODA_NAI_TOP_DROP_LEVEL,
} from "../src/services/yaodaNaiPolicy";
import {
  createNaiState,
  naiBodyRadius,
  naiCanDrop,
  naiClampAim,
  naiDrop,
  naiLevelRadius,
  naiMaxScoreForDrops,
  naiMergeScore,
  naiMinDropsForLevel,
  naiMinScoreForLevel,
  naiRank,
  naiStep,
  NAI_LEVELS,
  NAI_MAX_LEVEL,
  NAI_RULES,
  type NaiBody,
  type NaiState,
} from "../../web/src/views/services/games/yaodaNaiEngine";

const FRAME = 1 / 60;

function advance(state: NaiState, seconds: number) {
  for (let elapsed = 0; elapsed < seconds && !state.over; elapsed += FRAME) naiStep(state, FRAME);
}

/** 直接往罐子里放一只静止的球，用来单独检验某条规则。 */
function put(state: NaiState, level: number, x: number, y: number): NaiBody {
  const body: NaiBody = { id: state.nextId++, level, x, y, vx: 0, vy: 0, angle: 0, spin: 0, age: 1, born: false, landed: false, above: 0 };
  state.bodies.push(body);
  return body;
}

function maxOverlap(state: NaiState) {
  let worst = 0;
  for (let i = 0; i < state.bodies.length; i += 1) {
    for (let j = i + 1; j < state.bodies.length; j += 1) {
      const a = state.bodies[i];
      const b = state.bodies[j];
      worst = Math.max(worst, naiBodyRadius(a) + naiBodyRadius(b) - Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return worst;
}

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** 随手乱扔的一局：每 pace 秒在随机位置投一只，直到结束。 */
function playRandom(seed: number, pace = 1.1, limitSeconds = 20 * 60) {
  const state = createNaiState(seed);
  const next = random(seed + 77);
  let dropAt = 0.3;
  while (!state.over && state.time < limitSeconds) {
    if (state.time >= dropAt && naiCanDrop(state)) {
      naiDrop(state, next() * NAI_RULES.width);
      dropAt = state.time + pace;
    }
    naiStep(state, FRAME);
    state.events.length = 0;
  }
  return state;
}

test("十个等级一级比一级大，最大的一只占不满罐子的宽度", () => {
  assert.equal(NAI_LEVELS.length, 10);
  assert.equal(NAI_MAX_LEVEL, 10);
  assert.equal(new Set(NAI_LEVELS.map((level) => level.name)).size, 10);
  for (let level = 2; level <= NAI_MAX_LEVEL; level += 1) assert.ok(naiLevelRadius(level) > naiLevelRadius(level - 1), String(level));
  assert.ok(naiLevelRadius(NAI_MAX_LEVEL) * 2 < NAI_RULES.width * 0.7);
  assert.equal(NAI_LEVELS[NAI_MAX_LEVEL - 1].name, "药大奶");
  // 手里最大的球举在警戒线上方，不会一出现就压线。
  assert.ok(NAI_RULES.dropY + naiLevelRadius(NAI_RULES.spawnWeights.length) < 0);
});

test("投下来的只会是前四级，小的多、大的少", () => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let seed = 1; seed <= 40; seed += 1) {
    const state = createNaiState(seed * 9973);
    for (let index = 0; index < 100; index += 1) {
      counts[state.current] += 1;
      state.cooldown = 0;
      naiDrop(state, 200);
      state.bodies.length = 0;
    }
  }
  assert.equal(counts[0] + counts[5], 0);
  assert.ok(counts[1] > counts[2] && counts[2] > counts[3] && counts[3] > counts[4], counts.join(","));
  assert.ok(Math.abs(counts[1] / 4000 - NAI_RULES.spawnWeights[0]) < 0.04, counts.join(","));
  assert.ok(Math.abs(counts[4] / 4000 - NAI_RULES.spawnWeights[3]) < 0.03, counts.join(","));
});

test("投放有冷却，位置不会超出罐壁，投完换成下一只", () => {
  const state = createNaiState(5);
  const first = state.current;
  const upcoming = state.next;
  assert.equal(naiDrop(state, -500), true);
  assert.equal(state.drops, 1);
  assert.equal(state.bodies[0].level, first);
  assert.equal(state.bodies[0].x, naiLevelRadius(first));
  assert.equal(state.bodies[0].y, NAI_RULES.dropY);
  assert.equal(state.current, upcoming);
  assert.equal(state.maxLevel, first);
  assert.deepEqual(state.events, [{ type: "drop" }]);
  // 冷却里投不出去。
  assert.equal(naiCanDrop(state), false);
  assert.equal(naiDrop(state, 200), false);
  assert.equal(state.drops, 1);
  advance(state, NAI_RULES.dropCooldown + 0.05);
  assert.equal(naiDrop(state, 99999), true);
  assert.equal(state.bodies[1].x, NAI_RULES.width - naiLevelRadius(upcoming));
  assert.equal(naiClampAim(4, 0), naiLevelRadius(4));
});

test("两只一样的撞在一起合成高一级的一只，并按等级计分", () => {
  const state = createNaiState(1);
  const radius = naiLevelRadius(3);
  put(state, 3, 150, NAI_RULES.height - radius);
  put(state, 3, 150 + radius * 2 - 0.2, NAI_RULES.height - radius);
  naiStep(state, FRAME);
  assert.equal(state.bodies.length, 1);
  const merged = state.bodies[0];
  assert.equal(merged.level, 4);
  assert.ok(Math.abs(merged.x - (150 + radius)) < 2);
  assert.equal(state.score, naiMergeScore(4));
  assert.equal(naiMergeScore(4), 8);
  assert.equal(state.maxLevel, 4);
  assert.equal(state.merges, 1);
  assert.ok(state.events.some((event) => event.type === "merge" && event.level === 4));
  // 刚合成的球从小长到正常大小。
  assert.ok(naiBodyRadius(merged) < naiLevelRadius(4));
  advance(state, 0.5);
  assert.equal(naiBodyRadius(state.bodies[0]), naiLevelRadius(4));
});

test("合成会连锁：新合成的球碰到同级的继续合成", () => {
  const state = createNaiState(1);
  const one = naiLevelRadius(1);
  const floor = NAI_RULES.height;
  put(state, 1, 120, floor - one);
  put(state, 1, 120 + one * 2 - 0.2, floor - one);
  // 上面悬着一只二级和一只三级，依次落到新合成的球上。
  put(state, 2, 120 + one, floor - 120);
  put(state, 3, 120 + one, floor - 280);
  advance(state, 3);
  assert.equal(state.bodies.length, 1);
  assert.equal(state.bodies[0].level, 4);
  assert.equal(state.score, naiMergeScore(2) + naiMergeScore(3) + naiMergeScore(4));
});

test("不同等级的球不会合成，落稳以后互不重叠、都在罐子里", () => {
  const unique = createNaiState(1);
  for (const [index, level] of [7, 5, 6, 3, 4, 2, 1].entries()) put(unique, level, 70 + (index % 3) * 130, 330 - Math.floor(index / 3) * 160);
  advance(unique, 6);
  assert.equal(unique.bodies.length, 7);
  assert.equal(unique.score, 0);
  assert.ok(maxOverlap(unique) < 1, String(maxOverlap(unique)));
  for (const body of unique.bodies) {
    const radius = naiBodyRadius(body);
    assert.ok(body.x >= radius - 0.01 && body.x <= NAI_RULES.width - radius + 0.01, "x " + body.x);
    assert.ok(body.y <= NAI_RULES.height - radius + 0.01, "y " + body.y);
    assert.ok(Math.hypot(body.vx, body.vy) < 30, "还在动 " + Math.hypot(body.vx, body.vy));
  }
  // 一大摞挤在一起（里面有同级的，会边落边合成）：数值不会发散。
  const pile = createNaiState(1);
  const levels = [5, 3, 6, 2, 4, 1, 7, 2, 5, 1, 3, 6];
  for (const [index, level] of levels.entries()) put(pile, level, 60 + (index % 4) * 95, 380 - Math.floor(index / 4) * 150);
  advance(pile, 6);
  assert.ok(pile.bodies.length > 0 && pile.bodies.length < levels.length);
  assert.ok(pile.bodies.every((body) => Number.isFinite(body.x + body.y + body.vx + body.vy + body.angle)));
  assert.ok(maxOverlap(pile) < 1.5, String(maxOverlap(pile)));
});

test("两只药大奶相撞一起消失并加分", () => {
  const state = createNaiState(1);
  const radius = naiLevelRadius(NAI_MAX_LEVEL);
  put(state, NAI_MAX_LEVEL, radius, NAI_RULES.height - radius);
  put(state, NAI_MAX_LEVEL, radius * 3 - 0.2, NAI_RULES.height - radius);
  naiStep(state, FRAME);
  assert.equal(state.bodies.length, 0);
  assert.equal(state.score, NAI_RULES.clearBonus);
  assert.ok(state.events.some((event) => event.type === "clear"));
});

test("落稳的球越过警戒线一秒半就结束；从线上方落下去的球不算", () => {
  // 只是路过警戒线：一只球投下去落到罐底，不会判负。
  const passing = createNaiState(3);
  naiDrop(passing, 200);
  advance(passing, 4);
  assert.equal(passing.over, false);
  assert.equal(passing.danger, 0);

  // 一摞不同等级的大球堆到线上方：过线的那只落稳以后开始计时。
  const tower = createNaiState(3);
  put(tower, 10, 200, NAI_RULES.height - naiLevelRadius(10));
  put(tower, 9, 200, NAI_RULES.height - naiLevelRadius(10) * 2 - naiLevelRadius(9));
  const top = put(tower, 8, 200, NAI_RULES.height - naiLevelRadius(10) * 2 - naiLevelRadius(9) * 2 - naiLevelRadius(8));
  assert.ok(top.y - naiLevelRadius(8) < 0);
  advance(tower, NAI_RULES.overSeconds * 0.6);
  assert.equal(tower.over, false);
  assert.ok(tower.danger > 0.3 && tower.danger < 1, String(tower.danger));
  advance(tower, NAI_RULES.overSeconds);
  assert.equal(tower.over, true);
  assert.ok(tower.events.some((event) => event.type === "over"));
  // 结束以后不再推进，也不能再投。
  const frozen = { time: tower.time, score: tower.score };
  naiStep(tower, 1);
  assert.equal(naiDrop(tower, 100), false);
  assert.deepEqual({ time: tower.time, score: tower.score }, frozen);
});

test("同一个种子、同样的投放得到同一局", () => {
  const first = playRandom(20261012);
  const second = playRandom(20261012);
  assert.equal(first.over, true);
  assert.deepEqual(
    { score: second.score, drops: second.drops, level: second.maxLevel, time: second.time },
    { score: first.score, drops: first.drops, level: first.maxLevel, time: first.time },
  );
  const other = playRandom(4242);
  assert.notDeepEqual([other.score, other.drops], [first.score, first.drops]);
});

test("随手乱扔的每一局都会结束，成绩都在服务端认可的范围内", () => {
  for (let seed = 1; seed <= 8; seed += 1) {
    const state = playRandom(seed * 131);
    assert.equal(state.over, true, "没有结束 " + seed);
    assert.ok(state.drops >= 30 && state.drops <= 600, "投放数 " + state.drops);
    assert.ok(state.score <= naiMaxScoreForDrops(state.drops));
    assert.ok(state.score >= naiMinScoreForLevel(state.maxLevel));
    assert.ok(state.drops >= naiMinDropsForLevel(state.maxLevel));
    const durationMs = Math.round(state.time * 1000);
    assert.equal(validateYaodaNaiResult({
      score: state.score,
      drops: state.drops,
      level: state.maxLevel,
      durationMs,
      serverElapsedMs: durationMs + 800,
    }), null, JSON.stringify([state.score, state.drops, state.maxLevel, durationMs]));
  }
});

test("最快的投法也在校验范围内：每过一个冷却投一只", () => {
  const state = createNaiState(99);
  const next = random(5);
  while (!state.over && state.time < 600) {
    if (naiCanDrop(state)) naiDrop(state, next() * NAI_RULES.width);
    naiStep(state, FRAME);
    state.events.length = 0;
  }
  assert.equal(state.over, true);
  const durationMs = Math.round(state.time * 1000);
  assert.ok(durationMs >= minimumDurationForYaodaNaiDrops(state.drops) - 50, `${durationMs} ${state.drops}`);
  assert.equal(validateYaodaNaiResult({ score: state.score, drops: state.drops, level: state.maxLevel, durationMs, serverElapsedMs: durationMs + 300 }), null);
});

test("服务端的冷却、等级数和分数上下限与页面引擎一致", () => {
  assert.equal(YAODA_NAI_DROP_COOLDOWN_MS, NAI_RULES.dropCooldown * 1000);
  assert.equal(YAODA_NAI_MAX_LEVEL, NAI_MAX_LEVEL);
  assert.equal(YAODA_NAI_TOP_DROP_LEVEL, NAI_RULES.spawnWeights.length);
  assert.equal(Math.round(NAI_RULES.spawnWeights.reduce((sum, weight) => sum + weight, 0) * 1000), 1000);
  for (const drops of [0, 1, 2, 17, 300, YAODA_NAI_MAX_DROPS]) assert.equal(maxYaodaNaiScoreForDrops(drops), naiMaxScoreForDrops(drops));
  for (let level = 0; level <= NAI_MAX_LEVEL; level += 1) {
    assert.equal(minYaodaNaiScoreForLevel(level), naiMinScoreForLevel(level), "分数 " + level);
    assert.equal(minYaodaNaiDropsForLevel(level), naiMinDropsForLevel(level), "投放 " + level);
  }
  // 上限的由来：全投第四级，一路合到第十级再成对消掉。
  const units = 2 ** (YAODA_NAI_TOP_DROP_LEVEL - 1);
  let perUnit = NAI_RULES.clearBonus / 2 ** NAI_MAX_LEVEL;
  for (let level = YAODA_NAI_TOP_DROP_LEVEL + 1; level <= NAI_MAX_LEVEL; level += 1) perUnit += naiMergeScore(level) / 2 ** (level - 1);
  assert.equal(maxYaodaNaiScoreForDrops(1), units * perUnit);
  assert.equal(minYaodaNaiScoreForLevel(5), naiMergeScore(5));
  assert.equal(minYaodaNaiScoreForLevel(6), naiMergeScore(6) + 2 * naiMergeScore(5));
  assert.equal(minYaodaNaiDropsForLevel(10), 64);
  assert.equal(YAODA_NAI_MAX_SCORE, maxYaodaNaiScoreForDrops(YAODA_NAI_MAX_DROPS));
  assert.equal(naiRank(0), "萌新奶");
  assert.equal(naiRank(99999), "药大奶本奶");
});

test("正常对局成绩通过服务端校验", () => {
  assert.equal(validateYaodaNaiResult({ score: 0, drops: 0, level: 0, durationMs: 3_000, serverElapsedMs: 3_500 }), null);
  assert.equal(validateYaodaNaiResult({ score: 0, drops: 1, level: 3, durationMs: 2_000, serverElapsedMs: 2_500 }), null);
  assert.equal(validateYaodaNaiResult({ score: 1_052, drops: 118, level: 8, durationMs: 71_000, serverElapsedMs: 73_000 }), null);
  assert.equal(validateYaodaNaiResult({ score: 3_900, drops: 260, level: 10, durationMs: 400_000, serverElapsedMs: 402_000 }), null);
  assert.equal(validateYaodaNaiResult({
    score: maxYaodaNaiScoreForDrops(128),
    drops: 128,
    level: 10,
    durationMs: minimumDurationForYaodaNaiDrops(128),
    serverElapsedMs: minimumDurationForYaodaNaiDrops(128),
  }), null);
});

test("对不上投放数或等级的分数、伪造的时长会被拒绝", () => {
  assert.match(validateYaodaNaiResult({ score: 5_000, drops: 40, level: 9, durationMs: 80_000, serverElapsedMs: 81_000 }) || "", /分数与投放数不匹配/);
  assert.match(validateYaodaNaiResult({ score: 10, drops: 0, level: 0, durationMs: 9_000, serverElapsedMs: 9_500 }) || "", /分数与投放数不匹配/);
  assert.match(validateYaodaNaiResult({ score: 500, drops: 20, level: 10, durationMs: 60_000, serverElapsedMs: 61_000 }) || "", /等级与投放数不匹配/);
  assert.match(validateYaodaNaiResult({ score: 0, drops: 5, level: 0, durationMs: 9_000, serverElapsedMs: 9_500 }) || "", /等级与投放数不匹配/);
  assert.match(validateYaodaNaiResult({ score: 0, drops: 0, level: 2, durationMs: 9_000, serverElapsedMs: 9_500 }) || "", /等级与投放数不匹配/);
  assert.match(validateYaodaNaiResult({ score: 100, drops: 200, level: 9, durationMs: 300_000, serverElapsedMs: 301_000 }) || "", /分数与等级不匹配/);
  assert.match(validateYaodaNaiResult({ score: 1_000, drops: 200, level: 8, durationMs: 20_000, serverElapsedMs: 120_000 }) || "", /时长不匹配/);
  assert.match(validateYaodaNaiResult({ score: 1_000, drops: 200, level: 8, durationMs: 120_000, serverElapsedMs: 30_000 }) || "", /时长不匹配/);
  assert.match(validateYaodaNaiResult({ score: 100, drops: 30, level: 6, durationMs: 90_000, serverElapsedMs: 60_000 }) || "", /客户端/);
  assert.match(validateYaodaNaiResult({ score: YAODA_NAI_MAX_SCORE + 1, drops: YAODA_NAI_MAX_DROPS, level: 10, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateYaodaNaiResult({ score: 0, drops: YAODA_NAI_MAX_DROPS + 1, level: 4, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateYaodaNaiResult({ score: 0, drops: 10, level: 11, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateYaodaNaiResult({ score: 0, drops: 1, level: 1, durationMs: 12_000, serverElapsedMs: 46 * 60 * 1000 }) || "", /过期/);
});

test("云端成就覆盖局数、单局分数、合成等级与累计", () => {
  const codes = earnedYaodaNaiAchievementCodes({ games: 20, bestScore: 1_600, totalScore: 12_000, bestLevel: 8, totalDrops: 900 });
  for (const code of ["first_game", "level_5", "level_7", "level_8", "score_500", "score_1500", "games_20", "total_drops_500"]) assert.ok(codes.includes(code), code);
  for (const code of ["level_9", "level_10", "score_3000", "games_50", "total_score_20000"]) assert.ok(!codes.includes(code), code);
  assert.deepEqual(earnedYaodaNaiAchievementCodes({ games: 0, bestScore: 0, totalScore: 0, bestLevel: 0, totalDrops: 0 }), []);
  assert.equal(YAODA_NAI_ACHIEVEMENTS.length, 14);
  assert.equal(new Set(YAODA_NAI_ACHIEVEMENTS.map((item) => item.code)).size, 14);
  for (const item of YAODA_NAI_ACHIEVEMENTS) {
    if (item.metric === "bestLevel") {
      assert.ok(item.target <= YAODA_NAI_MAX_LEVEL);
      // 成就说明里写的等级名和引擎里的一致。
      assert.ok(item.description.includes(NAI_LEVELS[item.target - 1].name), item.description);
    }
    if (item.metric === "bestScore") assert.ok(item.target <= YAODA_NAI_MAX_SCORE);
  }
});

test("云端对局接口挂在小游戏自己的路径下，账号注销时一并清理，游戏页受小游戏隐藏规则约束", () => {
  const routes = readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  const deletion = readFileSync(new URL("../src/services/accountDeletion.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  const games = readFileSync(new URL("../../web/src/data/miniGames.ts", import.meta.url), "utf8");
  assert.match(routes, /mount\("\/tools\/yaoda-nai", yaodaNaiRouter\);[\s\S]*mount\("\/tools", toolsRouter\);/u);
  assert.match(deletion, /\["yaodaNaiAttempt", "userId"\], \["yaodaNaiAchievement", "userId"\]/u);
  const route = router.split("\n").find((line) => line.includes('name: "service-yaoda-nai"')) || "";
  // 已发布的原生壳只对 /services/tools/yaoda-can-fly 这个前缀隐藏自己的顶栏和底栏。
  assert.match(route, /path: "services\/tools\/yaoda-can-fly\/yaoda-nai"/u);
  assert.match(route, /nativeChrome: "page"/u);
  assert.match(route, /miniGame: true/u);
  assert.match(games, /routeName: "service-yaoda-nai"[\s\S]*leaderboardPath: "\/tools\/yaoda-nai\/leaderboard"/u);
});
