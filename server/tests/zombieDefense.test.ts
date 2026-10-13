import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  earnedZombieDefenseAchievementCodes,
  maxZombieDefenseScoreThroughWave,
  minimumDurationForZombieWaves,
  validateZombieDefenseResult,
  ZOMBIE_DEFENSE_ACHIEVEMENTS,
  ZOMBIE_DEFENSE_FIRST_WAVE_MS,
  ZOMBIE_DEFENSE_MAX_SCORE,
  ZOMBIE_DEFENSE_MAX_WAVES,
  ZOMBIE_DEFENSE_WAVE_MS,
} from "../src/services/zombieDefensePolicy";
import {
  createZdState,
  zdCooldownRatio,
  zdGraft,
  zdGraftBlocker,
  zdGraftCost,
  zdHybridOf,
  zdMaxScoreThroughWave,
  zdNextUpgrade,
  zdPlace,
  zdPlaceBlocker,
  zdRemove,
  zdStep,
  zdUnitAt,
  zdUnitKinds,
  zdUnitMaxHp,
  zdUnitName,
  zdUnitPerks,
  zdUnitStats,
  zdUpgrade,
  zdUpgradeBlocker,
  zdUpgradeFor,
  zdWaveBudget,
  zdWaveHpScale,
  zdWaveStartSeconds,
  zdZombiePoints,
  ZD_HYBRIDS,
  ZD_RULES,
  ZD_TABLE_LEVEL,
  ZD_UNIT_ORDER,
  ZD_UNITS,
  ZD_UPGRADES,
  ZD_ZOMBIES,
  type ZdShot,
  type ZdState,
  type ZdUnitKind,
  type ZdZombieKind,
} from "../../web/src/views/services/games/zombieDefenseEngine";

const STEP = 1 / 30;

function advance(state: ZdState, seconds: number) {
  for (let elapsed = 0; elapsed < seconds && !state.over; elapsed += STEP) zdStep(state, STEP);
}

/** 一局没有自然刷怪的空场，用来单独检验某条规则。 */
function arena() {
  const state = createZdState(1);
  state.nextWaveAt = Number.POSITIVE_INFINITY;
  state.energy = 9999;
  return state;
}

function addZombie(state: ZdState, kind: ZdZombieKind, lane: number, y: number) {
  const hp = ZD_ZOMBIES[kind].hp;
  const zombie = { id: state.nextId++, kind, lane, y, hp, maxHp: hp, slow: 0, biting: false, hurt: 0 };
  state.zombies.push(zombie);
  return zombie;
}

test("五路七格的药圃和八种药材", () => {
  assert.equal(ZD_RULES.lanes, 5);
  assert.equal(ZD_RULES.rows, 7);
  assert.deepEqual([...ZD_UNIT_ORDER], ["mortar", "capsule", "mint", "cabinet", "fizz", "ampoule", "burner", "drip"]);
  for (const kind of ZD_UNIT_ORDER) {
    assert.equal(ZD_UNITS[kind].kind, kind);
    assert.ok(ZD_UNITS[kind].cost > 0 && ZD_UNITS[kind].hp > 0 && ZD_UNITS[kind].cooldown > 0, kind);
  }
  // 开局的药力够种下第一株研钵和第一名射手。
  assert.ok(ZD_RULES.startEnergy >= ZD_UNITS.mortar.cost + ZD_UNITS.capsule.cost);
});

test("种植要有空格、药力和冷却，铲子可以腾出格子", () => {
  const state = createZdState(7);
  assert.equal(zdPlaceBlocker(state, "capsule", 5, 0), "这里不能种");
  assert.equal(zdPlaceBlocker(state, "fizz", 0, 0), "还在冷却");
  assert.equal(zdPlace(state, "capsule", 2, 6), true);
  assert.equal(state.energy, ZD_RULES.startEnergy - ZD_UNITS.capsule.cost);
  assert.equal(zdCooldownRatio(state, "capsule"), 1);
  assert.equal(zdPlaceBlocker(state, "mortar", 2, 6), "这一格已经有药材");
  assert.equal(zdPlaceBlocker(state, "capsule", 1, 6), "还在冷却");
  assert.equal(zdPlace(state, "mortar", 1, 6), true);
  assert.equal(zdPlaceBlocker(state, "cabinet", 0, 6), "药力不够");
  assert.equal(zdPlace(state, "cabinet", 0, 6), false);
  assert.equal(zdRemove(state, 2, 6), true);
  assert.equal(zdUnitAt(state, 2, 6), null);
  assert.equal(zdRemove(state, 2, 6), false);
});

test("药力会自己涨，研钵磨出更多", () => {
  const idle = createZdState(3);
  idle.nextWaveAt = Number.POSITIVE_INFINITY;
  advance(idle, ZD_RULES.passiveSeconds * 2 + 0.2);
  assert.equal(idle.energy, ZD_RULES.startEnergy + ZD_RULES.passiveEnergy * 2);

  const farm = arena();
  zdPlace(farm, "mortar", 0, 6);
  const before = farm.energy;
  advance(farm, ZD_UNITS.mortar.interval * 2.7);
  const passive = Math.floor((ZD_UNITS.mortar.interval * 2.7) / ZD_RULES.passiveSeconds) * ZD_RULES.passiveEnergy;
  assert.equal(farm.energy - before - passive, ZD_RULES.passiveEnergy * 3);
});

test("射手只打自己前方的僵尸，击退后按僵尸种类计分", () => {
  const state = arena();
  zdPlace(state, "capsule", 2, 5);
  const ahead = addZombie(state, "walker", 2, 1);
  // 已经走到射手身后的僵尸，射手够不着。
  const behind = addZombie(state, "walker", 2, 6);
  const otherLane = addZombie(state, "walker", 3, 1);
  advance(state, 3);
  assert.ok(ahead.hp < ahead.maxHp);
  assert.equal(behind.hp, behind.maxHp);
  assert.equal(otherLane.hp, otherLane.maxHp);
  state.zombies = state.zombies.filter((zombie) => zombie === ahead);
  advance(state, 14);
  assert.equal(state.zombies.length, 0);
  assert.equal(state.kills, 1);
  assert.equal(state.score, zdZombiePoints("walker"));
  assert.deepEqual(
    (["walker", "runner", "beaker", "giant"] as ZdZombieKind[]).map(zdZombiePoints),
    [10, 15, 25, 60],
  );
});

test("没有目标时射手不开火", () => {
  const state = arena();
  zdPlace(state, "capsule", 0, 6);
  zdPlace(state, "mint", 1, 6);
  advance(state, 5);
  assert.equal(state.shots.length, 0);
});

test("薄荷射手让僵尸减速", () => {
  const plain = arena();
  const slowed = arena();
  const free = addZombie(plain, "beaker", 0, 0);
  const chilled = addZombie(slowed, "beaker", 0, 0);
  zdPlace(slowed, "mint", 0, 6);
  advance(plain, 6);
  advance(slowed, 6);
  assert.ok(chilled.slow > 0);
  assert.ok(chilled.y < free.y - 0.3, `${chilled.y} < ${free.y}`);
});

test("药柜挡住僵尸并被慢慢啃掉，僵尸不会穿过去", () => {
  const state = arena();
  zdPlace(state, "cabinet", 0, 3);
  const zombie = addZombie(state, "walker", 0, 2);
  advance(state, 8);
  const cabinet = zdUnitAt(state, 0, 3)!;
  assert.equal(zombie.biting, true);
  assert.ok(zombie.y < 3);
  assert.ok(cabinet.hp < cabinet.maxHp);
  advance(state, ZD_UNITS.cabinet.hp / ZD_ZOMBIES.walker.bite + 2);
  assert.equal(zdUnitAt(state, 0, 3), null);
  assert.ok(zombie.y > 3);
});

test("泡腾片炸开周围一圈，够不着的僵尸不受影响", () => {
  const state = arena();
  state.cooldowns.fizz = 0;
  const near = addZombie(state, "walker", 1, 2.6);
  const side = addZombie(state, "runner", 2, 3.4);
  const farLane = addZombie(state, "walker", 4, 3);
  const farRow = addZombie(state, "walker", 2, 0.2);
  for (const zombie of state.zombies) zombie.slow = 99;
  zdPlace(state, "fizz", 2, 3);
  advance(state, ZD_UNITS.fizz.interval + 0.1);
  assert.equal(zdUnitAt(state, 2, 3), null);
  assert.ok(!state.zombies.includes(near) && !state.zombies.includes(side));
  assert.equal(farLane.hp, farLane.maxHp);
  assert.equal(farRow.hp, farRow.maxHp);
  assert.equal(state.score, zdZombiePoints("walker") + zdZombiePoints("runner"));
});

test("点已种下的药材可以升级，三级以上没有封顶，泡腾片不能升", () => {
  const state = arena();
  assert.equal(zdUpgradeBlocker(state, 0, 0), "这一格没有药材");
  zdPlace(state, "capsule", 0, 6);
  const unit = zdUnitAt(state, 0, 6)!;
  assert.equal(unit.level, 1);
  assert.deepEqual(zdNextUpgrade(unit), ZD_UPGRADES.capsule[0]);
  state.energy = ZD_UPGRADES.capsule[0].cost - 1;
  assert.equal(zdUpgradeBlocker(state, 0, 6), "药力不够");
  assert.equal(zdUpgrade(state, 0, 6), false);
  state.energy = 1000;
  assert.equal(zdUpgrade(state, 0, 6), true);
  assert.equal(unit.level, 2);
  assert.equal(state.energy, 1000 - ZD_UPGRADES.capsule[0].cost);
  assert.equal(unit.maxHp, zdUnitStats("capsule", 2).hp);
  // 升级不占种植冷却，可以连着升。
  assert.equal(zdUpgrade(state, 0, 6), true);
  assert.equal(unit.level, ZD_TABLE_LEVEL);
  // 三级以上没有封顶：每升一级，伤害、血量和花费都按比例涨。
  const fourth = zdNextUpgrade(unit)!;
  assert.equal(fourth.cost, Math.round((ZD_UPGRADES.capsule[1].cost * ZD_RULES.levelCost) / 5) * 5);
  assert.deepEqual(fourth, zdUpgradeFor("capsule", 3));
  state.energy = 1e9;
  for (let level = 4; level <= 12; level += 1) {
    const next = zdNextUpgrade(unit)!;
    const before = zdUnitStats("capsule", unit.level);
    assert.equal(zdUpgrade(state, 0, 6), true);
    const after = zdUnitStats("capsule", unit.level);
    assert.equal(unit.level, level);
    assert.ok(after.damage > before.damage && after.hp > before.hp, String(level));
    assert.equal(unit.maxHp, after.hp);
    assert.ok(zdNextUpgrade(unit)!.cost > next.cost, String(level));
  }
  assert.equal(zdUnitStats("capsule", 12).shots, 3);
  // 花费涨得比数值快：越往上越不划算。
  assert.ok(ZD_RULES.levelCost > ZD_RULES.levelPower && ZD_RULES.levelPower > 1);
  assert.ok(zdUnitStats("mortar", 8).energy > zdUnitStats("mortar", 3).energy * 4);
  assert.ok(zdUnitStats("cabinet", 6).thorns > zdUnitStats("cabinet", 3).thorns);
  assert.ok(state.events.includes("upgrade"));

  state.cooldowns.fizz = 0;
  zdPlace(state, "fizz", 1, 6);
  assert.equal(zdUpgradeBlocker(state, 1, 6), "泡腾片不能升级");
  assert.equal(zdUpgradeFor("fizz", 1), null);
  for (const kind of ZD_UNIT_ORDER) {
    assert.equal(ZD_UPGRADES[kind].length, kind === "fizz" ? 0 : ZD_TABLE_LEVEL - 1, kind);
    for (const upgrade of ZD_UPGRADES[kind]) assert.ok(upgrade.cost > 0 && upgrade.summary.length > 0, kind);
  }
});

test("升级后的胶囊射手连发，击退同一只僵尸明显更快", () => {
  const killTime = (level: number) => {
    const state = arena();
    zdPlace(state, "capsule", 0, 6);
    for (let index = 1; index < level; index += 1) zdUpgrade(state, 0, 6);
    addZombie(state, "walker", 0, 0);
    const start = state.time;
    while (state.zombies.length && !state.over) zdStep(state, STEP);
    assert.equal(state.over, false);
    return state.time - start;
  };
  const [one, two, three] = [1, 2, 3].map(killTime);
  assert.ok(two < one * 0.6, `${two} < ${one}`);
  assert.ok(three < one * 0.4, `${three} < ${one}`);
  assert.deepEqual([1, 2, 3].map((level) => zdUnitStats("capsule", level).shots), [1, 2, 3]);
});

test("研钵升级增产，药柜升级加厚、修好，三级会扎伤啃它的僵尸", () => {
  const farm = arena();
  zdPlace(farm, "mortar", 0, 6);
  zdUpgrade(farm, 0, 6);
  zdUpgrade(farm, 0, 6);
  const before = farm.energy;
  advance(farm, ZD_UNITS.mortar.interval * 0.6);
  assert.equal(farm.energy - before, zdUnitStats("mortar", 3).energy);
  assert.ok(zdUnitStats("mortar", 3).energy > zdUnitStats("mortar", 2).energy && zdUnitStats("mortar", 2).energy > ZD_RULES.passiveEnergy);

  const wall = arena();
  zdPlace(wall, "cabinet", 0, 3);
  const zombie = addZombie(wall, "giant", 0, 2.6);
  advance(wall, 3);
  const cabinet = zdUnitAt(wall, 0, 3)!;
  assert.ok(cabinet.hp < cabinet.maxHp);
  const untouched = zombie.hp;
  assert.equal(untouched, zombie.maxHp);
  zdUpgrade(wall, 0, 3);
  assert.equal(cabinet.hp, zdUnitStats("cabinet", 2).hp);
  zdUpgrade(wall, 0, 3);
  assert.equal(cabinet.maxHp, zdUnitStats("cabinet", 3).hp);
  advance(wall, 2);
  assert.ok(zombie.hp < untouched, "三级药柜反伤");
});

test("三级薄荷射手命中时波及旁边的僵尸", () => {
  const state = arena();
  zdPlace(state, "mint", 2, 6);
  zdUpgrade(state, 2, 6);
  zdUpgrade(state, 2, 6);
  const target = addZombie(state, "beaker", 2, 3);
  const neighbour = addZombie(state, "beaker", 3, 3.2);
  const far = addZombie(state, "beaker", 4, 3);
  for (const zombie of state.zombies) zombie.slow = 0;
  advance(state, 2.5);
  assert.ok(target.hp < target.maxHp && target.slow > 0);
  assert.ok(neighbour.hp < neighbour.maxHp && neighbour.slow > 0);
  assert.equal(far.hp, far.maxHp);
  assert.equal(far.slow, 0);
});

test("只要一只僵尸走出药圃，对局立即结束，之后不再推进", () => {
  const state = arena();
  addZombie(state, "walker", 3, ZD_RULES.rows - 0.05);
  advance(state, 1);
  assert.equal(state.over, true);
  assert.ok(state.events.includes("lost"));
  const time = state.time;
  zdStep(state, 1);
  assert.equal(state.time, time);
  assert.equal(zdPlace(state, "capsule", 0, 0), false);
});

test("波次按固定时间表开始，同一个种子得到同一局", () => {
  assert.equal(zdWaveStartSeconds(1), ZD_RULES.firstWaveAt);
  assert.equal(zdWaveStartSeconds(4), ZD_RULES.firstWaveAt + 3 * ZD_RULES.waveSeconds);
  const first = createZdState(20261012);
  const second = createZdState(20261012);
  const other = createZdState(99);
  for (const state of [first, second, other]) {
    state.energy = 99999;
    for (let lane = 0; lane < ZD_RULES.lanes; lane += 1) {
      for (const kind of ZD_UNIT_ORDER) state.cooldowns[kind] = 0;
      zdPlace(state, "cabinet", lane, 6);
    }
    advance(state, zdWaveStartSeconds(3) + 1);
  }
  assert.equal(first.wave, 3);
  const lineup = (state: ZdState) => state.zombies.map((zombie) => `${zombie.kind}${zombie.lane}`).join(",");
  assert.equal(lineup(first), lineup(second));
  assert.notEqual(lineup(first), lineup(other));
});

test("每波的僵尸不超过预算，血量逐波上涨，每五波来一大波", () => {
  for (let wave = 1; wave < 30; wave += 1) {
    if ((wave + 1) % ZD_RULES.bigWaveEvery !== 0 && wave % ZD_RULES.bigWaveEvery !== 0) {
      assert.ok(zdWaveBudget(wave + 1) > zdWaveBudget(wave), `第 ${wave + 1} 波`);
    }
    assert.ok(zdWaveHpScale(wave + 1) > zdWaveHpScale(wave));
  }
  assert.ok(zdWaveBudget(5) > zdWaveBudget(6));
  assert.equal(zdWaveHpScale(1), 1);
  // 后期血量按比例连涨，涨幅比前期大得多。
  assert.ok(zdWaveHpScale(20) / zdWaveHpScale(19) > zdWaveHpScale(8) / zdWaveHpScale(7) + 0.05);

  const state = createZdState(5);
  const seen = new Map<number, number>();
  const record = (wave: number, kind: ZdZombieKind) => {
    seen.set(wave, (seen.get(wave) ?? 0) + ZD_ZOMBIES[kind].cost);
    assert.ok(ZD_ZOMBIES[kind].fromWave <= wave, `${kind} 出现在第 ${wave} 波`);
  };
  while (state.wave < 12) {
    zdStep(state, STEP);
    // 每一步都把排队和刚进场的僵尸清走并记账；刚进场的一定属于当前这一波。
    for (const spawn of state.spawns) record(spawn.wave, spawn.kind);
    for (const zombie of state.zombies) record(state.wave, zombie.kind);
    state.spawns = [];
    state.zombies = [];
  }
  for (const [wave, cost] of seen) {
    assert.ok(cost <= zdWaveBudget(wave) + 1e-9, `第 ${wave} 波`);
    assert.ok(cost > zdWaveBudget(wave) - 1, `第 ${wave} 波没有留空`);
  }
});

test("什么都不种撑不过一分钟，摆满射手且药力无限、全部升到三级也终究守不住", () => {
  const idle = createZdState(11);
  advance(idle, 120);
  assert.equal(idle.over, true);
  assert.ok(idle.time > 40 && idle.time < 65, String(idle.time));
  assert.equal(idle.score, 0);

  const full = createZdState(11);
  while (!full.over && full.time < 20 * 60) {
    full.energy = 99999;
    for (const kind of ZD_UNIT_ORDER) full.cooldowns[kind] = 0;
    for (let lane = 0; lane < ZD_RULES.lanes; lane += 1) {
      for (let row = 0; row < ZD_RULES.rows; row += 1) zdPlace(full, row === 0 ? "cabinet" : row === 3 ? "mint" : "capsule", lane, row);
    }
    zdStep(full, STEP);
    full.events.length = 0;
  }
  assert.equal(full.over, true);
  assert.ok(full.wave >= 15 && full.wave <= 32, String(full.wave));

  // 同样的作弊条件再把每一株都升到三级：撑得更久，但仍然会输。
  const maxed = createZdState(11);
  while (!maxed.over && maxed.time < 30 * 60) {
    maxed.energy = 999999;
    for (const kind of ZD_UNIT_ORDER) maxed.cooldowns[kind] = 0;
    for (let lane = 0; lane < ZD_RULES.lanes; lane += 1) {
      for (let row = 0; row < ZD_RULES.rows; row += 1) {
        zdPlace(maxed, row === 0 ? "cabinet" : row === 3 ? "mint" : "capsule", lane, row);
        const unit = zdUnitAt(maxed, lane, row);
        while (unit && unit.level < ZD_TABLE_LEVEL && zdUpgrade(maxed, lane, row));
      }
    }
    zdStep(maxed, STEP);
    maxed.events.length = 0;
  }
  assert.equal(maxed.over, true);
  assert.ok(maxed.wave > full.wave && maxed.wave <= 60, String(maxed.wave));
});

test("服务端的波次时间表和分数上限与页面引擎一致", () => {
  assert.equal(ZOMBIE_DEFENSE_FIRST_WAVE_MS, ZD_RULES.firstWaveAt * 1000);
  assert.equal(ZOMBIE_DEFENSE_WAVE_MS, ZD_RULES.waveSeconds * 1000);
  for (let wave = 0; wave <= 60; wave += 1) {
    assert.equal(maxZombieDefenseScoreThroughWave(wave), zdMaxScoreThroughWave(wave), `第 ${wave} 波`);
    if (wave > 0) assert.equal(minimumDurationForZombieWaves(wave), zdWaveStartSeconds(wave) * 1000);
  }
  assert.equal(ZOMBIE_DEFENSE_MAX_WAVES, 360);
  assert.equal(ZOMBIE_DEFENSE_MAX_SCORE, maxZombieDefenseScoreThroughWave(360));

  // 一整局打下来，分数始终不超过当时波次的上限。
  const state = createZdState(42);
  while (!state.over && state.time < 10 * 60) {
    state.energy = 99999;
    for (const kind of ZD_UNIT_ORDER) state.cooldowns[kind] = 0;
    for (let lane = 0; lane < ZD_RULES.lanes; lane += 1) {
      for (let row = 1; row < ZD_RULES.rows; row += 1) zdPlace(state, "capsule", lane, row);
    }
    zdStep(state, STEP);
    assert.ok(state.score <= zdMaxScoreThroughWave(state.wave));
    assert.ok(state.time >= zdWaveStartSeconds(state.wave) || state.wave === 0);
  }
  assert.ok(state.score > 500);
});

test("正常对局成绩通过服务端校验", () => {
  assert.equal(validateZombieDefenseResult({ score: 0, waves: 2, durationMs: 52_000, serverElapsedMs: 53_000 }), null);
  assert.equal(validateZombieDefenseResult({ score: 0, waves: 0, durationMs: 4_000, serverElapsedMs: 4_500 }), null);
  assert.equal(validateZombieDefenseResult({ score: 1_500, waves: 11, durationMs: 215_000, serverElapsedMs: 240_000 }), null);
  assert.equal(validateZombieDefenseResult({
    score: maxZombieDefenseScoreThroughWave(9),
    waves: 9,
    durationMs: minimumDurationForZombieWaves(9),
    serverElapsedMs: minimumDurationForZombieWaves(9),
  }), null);
});

test("对不上波次的分数、伪造的时长会被拒绝", () => {
  assert.match(validateZombieDefenseResult({ score: 900, waves: 4, durationMs: 80_000, serverElapsedMs: 81_000 }) || "", /分数与波次不匹配/);
  assert.match(validateZombieDefenseResult({ score: 10, waves: 0, durationMs: 9_000, serverElapsedMs: 9_500 }) || "", /分数与波次不匹配/);
  assert.match(validateZombieDefenseResult({ score: 1_500, waves: 11, durationMs: 60_000, serverElapsedMs: 61_000 }) || "", /时长不匹配/);
  assert.match(validateZombieDefenseResult({ score: 100, waves: 5, durationMs: 200_000, serverElapsedMs: 30_000 }) || "", /时长不匹配/);
  assert.match(validateZombieDefenseResult({ score: 100, waves: 3, durationMs: 90_000, serverElapsedMs: 60_000 }) || "", /客户端/);
  assert.match(validateZombieDefenseResult({ score: ZOMBIE_DEFENSE_MAX_SCORE + 1, waves: ZOMBIE_DEFENSE_MAX_WAVES, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateZombieDefenseResult({ score: 0, waves: ZOMBIE_DEFENSE_MAX_WAVES + 1, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateZombieDefenseResult({ score: 0, waves: 1, durationMs: 12_000, serverElapsedMs: 121 * 60 * 1000 }) || "", /过期/);
});

test("云端成就覆盖局数、单局分数、单局波次与累计", () => {
  const codes = earnedZombieDefenseAchievementCodes({ games: 20, bestScore: 1_200, totalScore: 9_000, bestWaves: 9, totalWaves: 40 });
  for (const code of ["first_game", "waves_9", "score_1000", "games_20", "total_waves_30"]) assert.ok(codes.includes(code), code);
  for (const code of ["waves_12", "score_2000", "games_50", "total_waves_150", "total_score_10000"]) assert.ok(!codes.includes(code), code);
  assert.deepEqual(earnedZombieDefenseAchievementCodes({ games: 0, bestScore: 0, totalScore: 0, bestWaves: 0, totalWaves: 0 }), []);
  assert.equal(ZOMBIE_DEFENSE_ACHIEVEMENTS.length, 14);
  assert.equal(new Set(ZOMBIE_DEFENSE_ACHIEVEMENTS.map((item) => item.code)).size, 14);
  // 每一档成就都在分数和波次的可提交范围内。
  for (const item of ZOMBIE_DEFENSE_ACHIEVEMENTS) {
    if (item.metric === "bestWaves") assert.ok(item.target <= ZOMBIE_DEFENSE_MAX_WAVES);
    if (item.metric === "bestScore") assert.ok(item.target <= maxZombieDefenseScoreThroughWave(12));
  }
});

test("杂交：把一种药材种到另一种上，一格里有两种本事，价钱按那株的等级算", () => {
  const state = arena();
  assert.equal(zdGraftBlocker(state, "mint", 0, 6), "这一格没有药材");
  zdPlace(state, "capsule", 0, 6);
  const unit = zdUnitAt(state, 0, 6)!;
  assert.deepEqual(unit.grafts, []);
  assert.equal(zdUnitName(unit), "胶囊射手");
  assert.match(zdGraftBlocker(state, "capsule", 0, 6) || "", /同一种/);
  // 那株是 1 级：只付这种药材的价钱，并占用它的种植冷却。
  assert.equal(zdGraftCost("mint", 1), ZD_UNITS.mint.cost);
  state.energy = ZD_UNITS.mint.cost - 1;
  assert.match(zdGraftBlocker(state, "mint", 0, 6) || "", /药力不够/);
  assert.equal(zdGraft(state, "mint", 0, 6), false);
  state.energy = 1000;
  assert.equal(zdGraft(state, "mint", 0, 6), true);
  assert.equal(state.energy, 1000 - ZD_UNITS.mint.cost);
  assert.equal(state.cooldowns.mint, ZD_UNITS.mint.cooldown);
  assert.deepEqual(unit.grafts, ["mint"]);
  assert.equal(zdUnitName(unit), "双生射手");
  assert.ok(state.events.includes("graft"));
  // 血量：两种里高的，加上低的一半。
  assert.equal(unit.maxHp, zdUnitMaxHp(unit, 1));
  assert.equal(unit.maxHp, Math.round(90 + 90 * ZD_RULES.hybridHpShare));
  assert.equal(unit.hp, unit.maxHp);
  // 同一种不能再来第二份；别的药材还可以接着杂交。
  state.cooldowns.mint = 0;
  assert.match(zdGraftBlocker(state, "mint", 0, 6) || "", /已经有这种药材/);
  state.cooldowns.cabinet = 0;
  assert.equal(zdGraftBlocker(state, "cabinet", 0, 6), null);

  // 两种子弹都打出去。
  addZombie(state, "giant", 0, 1);
  const kinds = new Set<string>();
  for (let step = 0; step < 45; step += 1) {
    zdStep(state, STEP);
    for (const shot of state.shots) kinds.add(shot.kind);
  }
  assert.ok(kinds.has("capsule") && kinds.has("mint"), [...kinds].join(","));

  // 那株已经升过级：杂交要补上升到同一级的升级费。
  const leveled = arena();
  zdPlace(leveled, "capsule", 1, 6);
  zdUpgrade(leveled, 1, 6);
  zdUpgrade(leveled, 1, 6);
  const before = leveled.energy;
  assert.equal(zdGraftCost("cabinet", 3), ZD_UNITS.cabinet.cost + ZD_UPGRADES.cabinet[0].cost + ZD_UPGRADES.cabinet[1].cost);
  assert.equal(zdGraft(leveled, "cabinet", 1, 6), true);
  assert.equal(before - leveled.energy, zdGraftCost("cabinet", 3));
  const tough = zdUnitAt(leveled, 1, 6)!;
  assert.equal(tough.level, 3);
  assert.equal(tough.maxHp, Math.round(zdUnitStats("cabinet", 3).hp + zdUnitStats("capsule", 3).hp * ZD_RULES.hybridHpShare));
  assert.equal(zdUnitName(tough), "铁柜射手");
  assert.equal(zdNextUpgrade(tough)!.cost, zdUpgradeFor("capsule", 3)!.cost + zdUpgradeFor("cabinet", 3)!.cost);

  // 二十八种组合都有名字和专属效果，种的先后不影响结果。
  const names = new Set<string>();
  for (const [index, first] of ZD_UNIT_ORDER.entries()) {
    for (const second of ZD_UNIT_ORDER.slice(index + 1)) {
      const hybrid = ZD_HYBRIDS[first + "+" + second];
      assert.ok(hybrid && hybrid.name && hybrid.perk, first + "+" + second);
      assert.equal(zdHybridOf(first, second), hybrid);
      assert.equal(zdHybridOf(second, first), hybrid);
      assert.equal(zdUnitName({ kind: first, grafts: [second] }), hybrid.name);
      assert.equal(zdUnitName({ kind: second, grafts: [first] }), hybrid.name);
      names.add(hybrid.name);
    }
    assert.equal(zdHybridOf(first, first), null);
  }
  assert.equal(Object.keys(ZD_HYBRIDS).length, 28);
  assert.equal(names.size, 28);
});

test("杂交药材两种本事一起升级，花费相加；杂交上研钵会产药力，杂交上药柜会反伤", () => {
  const state = arena();
  zdPlace(state, "capsule", 0, 6);
  zdGraft(state, "mortar", 0, 6);
  const unit = zdUnitAt(state, 0, 6)!;
  const next = zdNextUpgrade(unit)!;
  assert.equal(next.cost, ZD_UPGRADES.capsule[0].cost + ZD_UPGRADES.mortar[0].cost);
  assert.ok(next.summary.includes(ZD_UPGRADES.capsule[0].summary) && next.summary.includes(ZD_UPGRADES.mortar[0].summary));
  const energy = state.energy;
  assert.equal(zdUpgrade(state, 0, 6), true);
  assert.equal(energy - state.energy, next.cost);
  assert.equal(unit.level, 2);
  assert.equal(unit.maxHp, zdUnitMaxHp(unit, 2));
  // 没有僵尸也照样磨药力，磨出的是 2 级研钵的量。
  const before = state.energy;
  advance(state, ZD_UNITS.mortar.interval * 0.6);
  assert.equal(state.energy - before, zdUnitStats("mortar", 2).energy);
  assert.equal(state.shots.length, 0);

  // 泡腾片一起升不了级，只算另一半的升级费。
  const mixed = arena();
  zdPlace(mixed, "mint", 2, 6);
  mixed.cooldowns.fizz = 0;
  zdGraft(mixed, "fizz", 2, 6);
  assert.deepEqual(zdNextUpgrade(zdUnitAt(mixed, 2, 6)!), ZD_UPGRADES.mint[0]);
  assert.equal(zdGraftCost("fizz", 3), ZD_UNITS.fizz.cost);

  // 射手杂交上三级药柜：啃它的僵尸会受伤。
  const wall = arena();
  zdPlace(wall, "mint", 0, 3);
  zdGraft(wall, "cabinet", 0, 3);
  zdUpgrade(wall, 0, 3);
  zdUpgrade(wall, 0, 3);
  wall.shots.length = 0;
  const zombie = addZombie(wall, "giant", 0, 3.2);
  zdUnitAt(wall, 0, 3)!.timer = 999;
  advance(wall, 1);
  assert.ok(zombie.biting);
  assert.ok(zombie.hp < zombie.maxHp, "三级药柜的反伤跟着杂交过来");
});

test("杂交了泡腾片的药材被啃掉时炸开，铲掉不炸；泡腾片本身不能被杂交", () => {
  const state = arena();
  zdPlace(state, "cabinet", 2, 3);
  state.cooldowns.fizz = 0;
  assert.equal(zdGraft(state, "fizz", 2, 3), true);
  const wall = zdUnitAt(state, 2, 3)!;
  assert.equal(zdUnitName(wall), "泡腾药柜");
  // 种上去以后不会自己炸。
  advance(state, 3);
  assert.equal(zdUnitAt(state, 2, 3), wall);
  const biter = addZombie(state, "walker", 2, 3.1);
  const neighbour = addZombie(state, "walker", 3, 3.4);
  const far = addZombie(state, "walker", 0, 3.2);
  wall.hp = 1;
  advance(state, 0.2);
  assert.equal(zdUnitAt(state, 2, 3), null);
  assert.ok(state.effects.some((effect) => effect.kind === "boom"));
  assert.ok(!state.zombies.includes(biter) && !state.zombies.includes(neighbour), "炸到了相邻三路");
  assert.ok(state.zombies.includes(far));
  assert.equal(far.hp, far.maxHp);

  const shovel = arena();
  zdPlace(shovel, "capsule", 1, 5);
  shovel.cooldowns.fizz = 0;
  zdGraft(shovel, "fizz", 1, 5);
  const bystander = addZombie(shovel, "walker", 1, 4.6);
  zdRemove(shovel, 1, 5);
  advance(shovel, 0.2);
  assert.equal(bystander.hp, bystander.maxHp);
  assert.ok(!shovel.effects.some((effect) => effect.kind === "boom"));

  const bomb = arena();
  bomb.cooldowns.fizz = 0;
  zdPlace(bomb, "fizz", 0, 0);
  assert.match(zdGraftBlocker(bomb, "capsule", 0, 0) || "", /不能杂交/);
});

test("僵尸先啃靠上的那一格，不会隔着它去啃后面的", () => {
  const state = arena();
  // 先种下面那格，再种上面那格：和种的先后无关。
  zdPlace(state, "cabinet", 0, 4);
  state.cooldowns.cabinet = 0;
  zdPlace(state, "cabinet", 0, 3);
  addZombie(state, "walker", 0, 3.7);
  advance(state, 1);
  const upper = zdUnitAt(state, 0, 3)!;
  const lower = zdUnitAt(state, 0, 4)!;
  assert.ok(upper.hp < upper.maxHp);
  assert.equal(lower.hp, lower.maxHp);
});

test("安瓿炮一发打穿整路，酒精灯只烧够得着的，输液架给周围回血", () => {
  const lane = arena();
  zdPlace(lane, "ampoule", 2, 6);
  const near = addZombie(lane, "beaker", 2, 4);
  const far = addZombie(lane, "beaker", 2, 1);
  const other = addZombie(lane, "beaker", 3, 3);
  advance(lane, 1.2);
  const damage = zdUnitStats("ampoule", 1).damage;
  assert.equal(near.hp, near.maxHp - damage);
  assert.equal(far.hp, far.maxHp - damage);
  assert.equal(other.hp, other.maxHp);
  assert.equal(lane.shots.length, 0);
  assert.ok(lane.events.includes("beam"));

  const fire = arena();
  zdPlace(fire, "burner", 1, 5);
  const close = addZombie(fire, "giant", 1, 4.4);
  const closeToo = addZombie(fire, "giant", 1, 3.8);
  const outOfReach = addZombie(fire, "giant", 1, 2.5);
  for (const zombie of fire.zombies) zombie.slow = 999;
  advance(fire, 1);
  const burnt = zdUnitStats("burner", 1).burn;
  assert.ok(Math.abs(close.maxHp - close.hp - burnt) < burnt * 0.1, String(close.maxHp - close.hp));
  assert.ok(closeToo.hp < closeToo.maxHp);
  assert.equal(outOfReach.hp, outOfReach.maxHp);

  const ward = arena();
  zdPlace(ward, "drip", 2, 3);
  zdPlace(ward, "cabinet", 2, 2);
  zdPlace(ward, "capsule", 3, 4);
  ward.cooldowns.capsule = 0;
  zdPlace(ward, "capsule", 0, 3);
  const drip = zdUnitAt(ward, 2, 3)!;
  const wall = zdUnitAt(ward, 2, 2)!;
  const corner = zdUnitAt(ward, 3, 4)!;
  const distant = zdUnitAt(ward, 0, 3)!;
  for (const unit of [drip, wall, corner, distant]) unit.hp = 10;
  advance(ward, 1);
  const healed = zdUnitStats("drip", 1).heal;
  assert.ok(Math.abs(wall.hp - 10 - healed) < healed * 0.1, String(wall.hp));
  assert.ok(corner.hp > 10);
  assert.equal(distant.hp, 10);
  assert.equal(drip.hp, 10, "单独的输液架不给自己回血");
});

test("泡腾片至少炸掉四成血，后期的大僵尸也照样疼", () => {
  const state = arena();
  const small = addZombie(state, "walker", 2, 3);
  const boss = addZombie(state, "mentor", 2, 3.4);
  boss.hp = boss.maxHp = 200_000;
  for (const zombie of state.zombies) zombie.slow = 999;
  state.cooldowns.fizz = 0;
  zdPlace(state, "fizz", 2, 4);
  advance(state, 1);
  assert.ok(!state.zombies.includes(small));
  assert.equal(boss.hp, boss.maxHp * (1 - ZD_RULES.fizzShare));
});

test("后期的两种僵尸到了波次才出场，一只占很多预算；小僵尸到很后期就不再出场", () => {
  assert.ok(ZD_ZOMBIES.thesis.fromWave > ZD_ZOMBIES.giant.fromWave && ZD_ZOMBIES.mentor.fromWave > ZD_ZOMBIES.thesis.fromWave);
  assert.ok(ZD_ZOMBIES.mentor.cost > ZD_ZOMBIES.thesis.cost && ZD_ZOMBIES.thesis.cost > ZD_ZOMBIES.giant.cost);
  const state = createZdState(5);
  const seen = new Map<string, number>();
  const last = new Map<string, number>();
  while (state.wave < 60) {
    // 只看刷怪表：把场上清空，免得对局结束。
    state.zombies.length = 0;
    zdStep(state, 0.5);
    for (const spawn of state.spawns) {
      if (!seen.has(spawn.kind)) seen.set(spawn.kind, spawn.wave);
      last.set(spawn.kind, Math.max(last.get(spawn.kind) ?? 0, spawn.wave));
    }
  }
  for (const kind of ["walker", "runner", "beaker"] as const) {
    assert.ok((last.get(kind) ?? 0) <= ZD_ZOMBIES[kind].untilWave!, kind + " " + last.get(kind));
  }
  assert.equal(ZD_ZOMBIES.giant.untilWave, undefined);
  assert.equal(last.get("mentor"), 60);
  assert.ok((seen.get("thesis") ?? 0) >= ZD_ZOMBIES.thesis.fromWave, String(seen.get("thesis")));
  assert.ok((seen.get("mentor") ?? 0) >= ZD_ZOMBIES.mentor.fromWave, String(seen.get("mentor")));
  assert.equal(zdZombiePoints("mentor"), ZD_ZOMBIES.mentor.cost * ZD_RULES.pointsPerBudget);
});

test("杂交品种各有专属效果：点燃、寒气、穿甲、炸开", () => {
  const shotOf = (base: ZdUnitKind, graft: ZdUnitKind, level = 1) => {
    const state = arena();
    zdPlace(state, base, 0, 6);
    for (const kind of ZD_UNIT_ORDER) state.cooldowns[kind] = 0;
    assert.equal(zdGraft(state, graft, 0, 6), true);
    for (let index = 1; index < level; index += 1) zdUpgrade(state, 0, 6);
    addZombie(state, "mentor", 0, 0.5);
    const shots: ZdShot[] = [];
    for (let step = 0; step < 20 && !shots.length; step += 1) {
      zdStep(state, STEP);
      shots.push(...state.shots);
    }
    return { state, shot: shots.find((shot) => shot.kind === "capsule") ?? shots[0] };
  };
  // 火焰射手：胶囊被点燃，伤害翻倍。
  const flaming = shotOf("capsule", "burner").shot;
  assert.equal(flaming.tint, "fire");
  assert.equal(flaming.damage, zdUnitStats("capsule", 1).damage * ZD_RULES.igniteFactor);
  // 双生射手：胶囊也带减速。
  const chilled = shotOf("capsule", "mint").shot;
  assert.equal(chilled.tint, "frost");
  assert.equal(chilled.slowSeconds, zdUnitStats("mint", 1).slowSeconds);
  // 没杂交的胶囊什么都不带。
  const plain = arena();
  zdPlace(plain, "capsule", 0, 6);
  addZombie(plain, "mentor", 0, 0.5);
  advance(plain, 0.5);
  assert.deepEqual([plain.shots[0].tint, plain.shots[0].slowSeconds, plain.shots[0].pierce, plain.shots[0].splash, plain.shots[0].bounty], ["", 0, 0, 0, false]);

  // 穿甲射手：一颗胶囊打两只。
  const piercing = arena();
  zdPlace(piercing, "capsule", 1, 6);
  zdGraft(piercing, "ampoule", 1, 6);
  zdUnitAt(piercing, 1, 6)!.organs[0]!.timer = 999;
  const first = addZombie(piercing, "giant", 1, 4);
  const second = addZombie(piercing, "giant", 1, 3);
  const third = addZombie(piercing, "giant", 1, 2);
  for (const zombie of piercing.zombies) zombie.slow = 999;
  advance(piercing, 1);
  const hit = zdUnitStats("capsule", 1).damage;
  assert.equal(first.hp, first.maxHp - hit);
  assert.equal(second.hp, second.maxHp - hit);
  assert.equal(third.hp, third.maxHp);

  // 泡腾机枪：每轮最后一颗炸开一小圈，旁边一路的也挨到。
  const gun = arena();
  zdPlace(gun, "capsule", 2, 6);
  gun.cooldowns.fizz = 0;
  zdGraft(gun, "fizz", 2, 6);
  const target = addZombie(gun, "giant", 2, 4);
  const beside = addZombie(gun, "giant", 3, 4.2);
  const away = addZombie(gun, "giant", 4, 4);
  for (const zombie of gun.zombies) zombie.slow = 999;
  advance(gun, 1);
  assert.equal(target.hp, target.maxHp - hit);
  assert.equal(beside.hp, beside.maxHp - hit);
  assert.equal(away.hp, away.maxHp);

  // 喷火安瓿和冷冻安瓿：整路翻倍、整路减速。
  const beam = arena();
  zdPlace(beam, "ampoule", 0, 6);
  zdGraft(beam, "burner", 0, 6);
  zdPlace(beam, "ampoule", 4, 6);
  beam.cooldowns.ampoule = 0;
  zdPlace(beam, "ampoule", 4, 6);
  zdGraft(beam, "mint", 4, 6);
  const burning = addZombie(beam, "mentor", 0, 0.5);
  const frozen = addZombie(beam, "mentor", 4, 0.5);
  const tints = new Set<string>();
  for (let step = 0; step < 36; step += 1) {
    zdStep(beam, STEP);
    for (const effect of beam.effects) if (effect.kind === "beam") tints.add(effect.tint ?? "");
  }
  assert.equal(burning.hp, burning.maxHp - zdUnitStats("ampoule", 1).damage * ZD_RULES.igniteFactor);
  assert.ok(frozen.slow > 0);
  assert.deepEqual([...tints].sort(), ["fire", "frost"]);
});

test("杂交品种各有专属效果：掉药力、挨啃发狠、烧啃它的、自己回血、冻住、急救", () => {
  // 研钵射手：它击退的僵尸额外掉药力。
  const bounty = arena();
  zdPlace(bounty, "capsule", 0, 6);
  zdGraft(bounty, "mortar", 0, 6);
  zdUnitAt(bounty, 0, 6)!.organs[0]!.timer = 999;
  const prey = addZombie(bounty, "beaker", 0, 3);
  prey.hp = 5;
  bounty.passiveTimer = 999;
  const energy = bounty.energy;
  advance(bounty, 1.5);
  assert.equal(bounty.zombies.length, 0);
  assert.equal(bounty.energy - energy, Math.round(ZD_ZOMBIES.beaker.cost * ZD_RULES.bountyPerCost));

  // 铁柜射手：挨啃时射速快一倍。
  const volleys = (bitten: boolean) => {
    const state = arena();
    zdPlace(state, "capsule", 0, 5);
    zdGraft(state, "cabinet", 0, 5);
    const zombie = addZombie(state, "mentor", 0, bitten ? 5.2 : 1);
    zombie.slow = 999;
    let count = 0;
    for (let step = 0; step < 30 * 12; step += 1) {
      zdStep(state, STEP);
      count += state.events.filter((event) => event === "shoot").length;
      state.events.length = 0;
      zdUnitAt(state, 0, 5)!.hp = zdUnitAt(state, 0, 5)!.maxHp;
    }
    return count;
  };
  const calm = volleys(false);
  const angry = volleys(true);
  assert.ok(angry >= calm * 1.8 && angry <= calm * 2.2, `${angry} / ${calm}`);

  // 火焰药柜烧啃它的僵尸；寒冰药柜让啃它的僵尸一直减速。
  const walls = arena();
  zdPlace(walls, "cabinet", 0, 3);
  zdGraft(walls, "burner", 0, 3);
  walls.cooldowns.cabinet = 0;
  zdPlace(walls, "cabinet", 4, 3);
  zdGraft(walls, "mint", 4, 3);
  zdUnitAt(walls, 4, 3)!.organs[0]!.timer = 999;
  const scorched = addZombie(walls, "mentor", 0, 3.2);
  const chilled = addZombie(walls, "mentor", 4, 3.2);
  advance(walls, 1);
  const perSecond = zdUnitStats("burner", 1).burn * (1 + ZD_RULES.fireWallFactor);
  assert.ok(Math.abs(scorched.maxHp - scorched.hp - perSecond) < perSecond * 0.12, String(scorched.maxHp - scorched.hp));
  assert.ok(chilled.slow > 0);

  // 自愈药柜：自己回血，而且快三倍；单独的药柜不会回血。
  const regen = arena();
  zdPlace(regen, "cabinet", 2, 3);
  zdGraft(regen, "drip", 2, 3);
  const self = zdUnitAt(regen, 2, 3)!;
  self.hp = 100;
  advance(regen, 1);
  const expected = zdUnitStats("drip", 1).heal * ZD_RULES.wallRegenFactor;
  assert.ok(Math.abs(self.hp - 100 - expected) < expected * 0.1, String(self.hp));

  // 冰爆薄荷：被啃掉时炸开并冻住周围的僵尸。急救泡腾：炸开并把周围药材回满。
  const blast = arena();
  zdPlace(blast, "mint", 1, 3);
  blast.cooldowns.fizz = 0;
  zdGraft(blast, "fizz", 1, 3);
  zdPlace(blast, "drip", 3, 3);
  blast.cooldowns.fizz = 0;
  zdGraft(blast, "fizz", 3, 3);
  zdPlace(blast, "cabinet", 4, 3);
  const patient = zdUnitAt(blast, 4, 3)!;
  patient.hp = 50;
  zdUnitAt(blast, 3, 3)!.timer = 999;
  const tough = addZombie(blast, "mentor", 1, 3.1);
  const eater = addZombie(blast, "mentor", 3, 3.1);
  tough.hp = tough.maxHp = 500_000;
  eater.hp = eater.maxHp = 500_000;
  zdUnitAt(blast, 1, 3)!.hp = 1;
  zdUnitAt(blast, 3, 3)!.hp = 1;
  advance(blast, 0.2);
  assert.equal(zdUnitAt(blast, 1, 3), null);
  assert.equal(zdUnitAt(blast, 3, 3), null);
  assert.ok(tough.slow > ZD_RULES.frostBlastSeconds - 1);
  assert.equal(patient.hp, patient.maxHp);
});

test("种满升到三级以后不再补种：杂交过的药圃守得更久，但也终究守不住；升到十级也一样", () => {
  const hold = (graftFor: (row: number) => ZdUnitKind | null, level = ZD_TABLE_LEVEL) => {
    const state = createZdState(11);
    state.energy = 1e12;
    for (let lane = 0; lane < ZD_RULES.lanes; lane += 1) {
      for (let row = 0; row < ZD_RULES.rows; row += 1) {
        for (const kind of ZD_UNIT_ORDER) state.cooldowns[kind] = 0;
        zdPlace(state, row === 0 ? "cabinet" : row === 3 ? "mint" : "capsule", lane, row);
        const graft = graftFor(row);
        for (const kind of ZD_UNIT_ORDER) state.cooldowns[kind] = 0;
        if (graft) assert.equal(zdGraft(state, graft, lane, row), true);
        while (zdUnitAt(state, lane, row)!.level < level && zdUpgrade(state, lane, row));
      }
    }
    state.energy = 0;
    let peak = 0;
    while (!state.over && state.time < 60 * 60) {
      zdStep(state, STEP);
      state.events.length = 0;
      peak = Math.max(peak, state.zombies.length);
    }
    assert.equal(state.over, true);
    return { wave: state.wave, score: state.score, peak };
  };
  const plain = hold(() => null);
  const hybrid = hold((row) => (row === 0 || row === 3 ? "capsule" : "mint"));
  const veteran = hold((row) => (row === 0 || row === 3 ? "capsule" : "mint"), 10);
  assert.ok(plain.wave >= 15 && plain.wave <= 24, String(plain.wave));
  assert.ok(hybrid.wave > plain.wave && hybrid.wave <= 36, `${hybrid.wave} > ${plain.wave}`);
  // 等级没有封顶，但僵尸的血量每波按比例涨：十级的药圃多撑十几波，还是会输。
  assert.ok(veteran.wave > hybrid.wave + 8 && veteran.wave <= 70, `${veteran.wave} > ${hybrid.wave}`);
  assert.ok(veteran.score <= zdMaxScoreThroughWave(veteran.wave));
  // 后期场上同时有几十上百只僵尸，这是画面要扛住的量。
  assert.ok(hybrid.peak > 40 && veteran.peak > hybrid.peak, `${hybrid.peak} ${veteran.peak}`);
});

test("杂交不限种数：一格里叠三四种药材，凑得出的每一对组合效果都生效", () => {
  const state = arena();
  zdPlace(state, "capsule", 2, 6);
  for (const kind of ["mint", "burner", "ampoule"] as const) {
    state.cooldowns[kind] = 0;
    assert.equal(zdGraftBlocker(state, kind, 2, 6), null, kind);
    assert.equal(zdGraft(state, kind, 2, 6), true, kind);
  }
  const unit = zdUnitAt(state, 2, 6)!;
  assert.deepEqual(unit.grafts, ["mint", "burner", "ampoule"]);
  assert.deepEqual(zdUnitKinds(unit), ["capsule", "mint", "burner", "ampoule"]);
  assert.equal(zdUnitName(unit), "四重杂交");
  assert.equal(zdUnitName({ kind: "cabinet", grafts: ["mint", "drip"] }), "三重杂交");
  // 同一种只能有一份。
  state.cooldowns.mint = 0;
  assert.match(zdGraftBlocker(state, "mint", 2, 6) || "", /已经有这种药材/);
  state.cooldowns.capsule = 0;
  assert.match(zdGraftBlocker(state, "capsule", 2, 6) || "", /已经有这种药材/);
  // 六对组合里说法不同的效果都列出来。
  const perks = zdUnitPerks(unit);
  for (const perk of ["胶囊也带减速", "胶囊被点燃，伤害翻倍", "胶囊打穿一只僵尸，再打下一只", "薄荷被点燃，伤害翻倍", "安瓿让整路僵尸减速", "安瓿被点燃，伤害翻倍"]) {
    assert.ok(perks.includes(perk), perk);
  }
  assert.equal(new Set(perks).size, perks.length);
  // 血量：最高的那种，加上其余每种的一半。
  const hps = zdUnitKinds(unit).map((kind) => zdUnitStats(kind, 1).hp).sort((a, b) => b - a);
  assert.equal(unit.maxHp, Math.round(hps[0] + (hps[1] + hps[2] + hps[3]) * ZD_RULES.hybridHpShare));
  // 升级：四种一起升，花费相加。
  const next = zdNextUpgrade(unit)!;
  assert.equal(next.cost, ZD_UPGRADES.capsule[0].cost + ZD_UPGRADES.mint[0].cost + ZD_UPGRADES.burner[0].cost + ZD_UPGRADES.ampoule[0].cost);

  // 一颗胶囊同时带着三样：点燃翻倍、减速、穿甲；薄荷和安瓿也照样打。
  const first = addZombie(state, "mentor", 2, 3);
  const second = addZombie(state, "mentor", 2, 2);
  for (const zombie of state.zombies) zombie.slow = 0;
  const kinds = new Set<string>();
  let capsule: ZdShot | undefined;
  for (let step = 0; step < 40; step += 1) {
    zdStep(state, STEP);
    for (const shot of state.shots) {
      kinds.add(shot.kind);
      if (shot.kind === "capsule") capsule ??= { ...shot };
    }
  }
  assert.ok(kinds.has("capsule") && kinds.has("mint"));
  assert.ok(state.events.includes("beam"));
  assert.ok(capsule);
  assert.equal(capsule.tint, "fire");
  assert.equal(capsule.damage, zdUnitStats("capsule", 1).damage * ZD_RULES.igniteFactor);
  assert.equal(capsule.slowSeconds, zdUnitStats("mint", 1).slowSeconds);
  assert.equal(capsule.pierce, 1);
  assert.ok(first.slow > 0 && second.slow > 0);
  assert.ok(second.hp < second.maxHp);

  // 泡腾片也能和别的一起叠：被啃掉时炸开，带薄荷的还会冻住。
  const stack = arena();
  zdPlace(stack, "cabinet", 1, 3);
  for (const kind of ["mint", "drip", "fizz"] as const) {
    stack.cooldowns[kind] = 0;
    assert.equal(zdGraft(stack, kind, 1, 3), true, kind);
  }
  zdUnitAt(stack, 1, 3)!.organs[0]!.timer = 999;
  const eater = addZombie(stack, "mentor", 1, 3.1);
  eater.hp = eater.maxHp = 400_000;
  zdUnitAt(stack, 1, 3)!.hp = 0.5;
  advance(stack, 0.2);
  assert.equal(zdUnitAt(stack, 1, 3), null);
  assert.ok(eater.hp <= eater.maxHp * (1 - ZD_RULES.fizzShare));
  assert.ok(eater.slow > ZD_RULES.frostBlastSeconds - 1);
});

test("范围伤害：酒精灯连左右两路一起烧，二级薄荷就开始波及旁边", () => {
  const fire = arena();
  zdPlace(fire, "burner", 2, 5);
  const ahead = addZombie(fire, "mentor", 2, 3.2);
  const left = addZombie(fire, "mentor", 1, 4);
  const right = addZombie(fire, "mentor", 3, 4.6);
  const twoAway = addZombie(fire, "mentor", 0, 4);
  const tooFar = addZombie(fire, "mentor", 3, 5 - ZD_RULES.burnReach - 0.3);
  for (const zombie of fire.zombies) zombie.slow = 999;
  advance(fire, 1);
  const burn = zdUnitStats("burner", 1).burn;
  for (const zombie of [ahead, left, right]) assert.ok(Math.abs(zombie.maxHp - zombie.hp - burn) < burn * 0.1, String(zombie.maxHp - zombie.hp));
  assert.equal(twoAway.hp, twoAway.maxHp);
  assert.equal(tooFar.hp, tooFar.maxHp);

  assert.deepEqual([1, 2, 3].map((level) => zdUnitStats("mint", level).splash), [0, 0.4, 0.6]);
  const mint = arena();
  zdPlace(mint, "mint", 2, 6);
  zdUpgrade(mint, 2, 6);
  const target = addZombie(mint, "mentor", 2, 3);
  const beside = addZombie(mint, "mentor", 3, 3.2);
  for (const zombie of mint.zombies) zombie.slow = 0;
  advance(mint, 1.2);
  assert.ok(target.hp < target.maxHp);
  assert.equal(beside.maxHp - beside.hp, zdUnitStats("mint", 2).damage * 0.4);
  assert.ok(beside.slow > 0);
  // 安瓿炮：每发的伤害和间隔都比单发的胶囊高一截。
  assert.ok(zdUnitStats("ampoule", 1).damage / ZD_UNITS.ampoule.interval > (zdUnitStats("capsule", 1).damage / ZD_UNITS.capsule.interval) * 3);
});

test("云端对局接口挂在小游戏自己的路径下，账号注销时一并清理，游戏页受小游戏隐藏规则约束", () => {
  const routes = readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  const deletion = readFileSync(new URL("../src/services/accountDeletion.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  assert.match(routes, /mount\("\/tools\/zombie-defense", zombieDefenseRouter\);[\s\S]*mount\("\/tools", toolsRouter\);/u);
  assert.match(deletion, /\["zombieDefenseAttempt", "userId"\], \["zombieDefenseAchievement", "userId"\]/u);
  const route = router.split("\n").find((line) => line.includes('name: "service-zombie-defense"')) || "";
  assert.match(route, /path: "services\/tools\/yaoda-can-fly\/zombie-defense"/u);
  assert.match(route, /nativeChrome: "page"/u);
  assert.match(route, /miniGame: true/u);
});

test("画面风格：默认新版，设置里可以切到经典（手绘的药材、僵尸和药圃），选择记在本机", () => {
  const page = readFileSync(new URL("../../web/src/views/services/games/YaodaVsZombies.vue", import.meta.url), "utf8");
  const scene = readFileSync(new URL("../../web/src/views/services/games/zombieDefenseScene.ts", import.meta.url), "utf8");
  const classic = readFileSync(new URL("../../web/src/views/services/games/zombieDefenseClassicArt.ts", import.meta.url), "utf8");
  // 没选过的人看到的是新版；只有存的是 classic 才用经典。
  assert.match(scene, /let artStyle: ZdArtStyle = "new";/u);
  assert.match(page, /localStorage\.getItem\(STORAGE_PREFIX \+ ":style"\) === "classic" \? "classic" : "new"/u);
  assert.match(page, /writeStorage\(STORAGE_PREFIX \+ ":style", artStyle\.value\)/u);
  assert.match(page, /<b>画面风格<\/b>/u);
  // 经典风格换掉的三样东西，画面里都有对应的分支。
  for (const name of ["drawClassicBoard", "drawClassicUnit", "drawClassicZombie"]) {
    assert.match(classic, new RegExp(`export function ${name}\\(`, "u"), name);
    assert.ok(scene.split(name).length > 2, name + " 没有被画面用到");
  }
  // 八种药材和六种僵尸在经典风格里都有画法。
  for (const kind of ZD_UNIT_ORDER) assert.ok(kind === "capsule" || classic.includes(`kind === "${kind}"`), kind);
  for (const kind of Object.keys(ZD_ZOMBIES)) assert.match(classic, new RegExp(`\\b${kind}: \\{ scale:`, "u"), kind);
});
