import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  earnedGreedyNailongAchievementCodes,
  GREEDY_NAILONG_ACHIEVEMENTS,
  GREEDY_NAILONG_FEAST_EVERY,
  GREEDY_NAILONG_FEAST_GROW,
  GREEDY_NAILONG_FEAST_SCORE_MAX,
  GREEDY_NAILONG_MAX_FOODS,
  GREEDY_NAILONG_MAX_LENGTH,
  GREEDY_NAILONG_MAX_SCORE,
  GREEDY_NAILONG_MIN_STEP_MS,
  GREEDY_NAILONG_PILL_EVERY,
  GREEDY_NAILONG_PILL_SCORE,
  GREEDY_NAILONG_SNACK_SCORE,
  GREEDY_NAILONG_START_LENGTH,
  maxGreedyNailongLengthForFoods,
  maxGreedyNailongScoreForFoods,
  minGreedyNailongScoreForFoods,
  minimumDurationForGreedyNailongFoods,
  validateGreedyNailongResult,
} from "../src/services/greedyNailongPolicy";
import {
  createNlState,
  nlFeastScore,
  nlMaxLengthForFoods,
  nlMaxScoreForFoods,
  nlRank,
  nlStep,
  nlStepSeconds,
  nlTurn,
  nlVector,
  NL_RULES,
  NL_SNACK_LOOKS,
  type NlDirection,
  type NlItemKind,
  type NlState,
} from "../../web/src/views/services/games/greedyNailongEngine";

/** 正好走一格。有转向等着的时候这一格走得快，要的时间也短。 */
function tick(state: NlState) {
  const interval = nlStepSeconds(state.foods);
  const rate = state.queue.length ? Math.max(1, interval / NL_RULES.stepMin) : 1;
  nlStep(state, Math.max(0, interval - state.stepTimer) / rate + 1e-9);
}

function walk(state: NlState, steps: number) {
  for (let step = 0; step < steps && !state.over; step += 1) tick(state);
}

/** 把场上的东西换成指定的一样，放在指定的格子里。 */
function serve(state: NlState, kind: NlItemKind, x: number, y: number, left = 0) {
  state.items = state.items.filter((item) => item.kind !== kind);
  state.items.push({ kind, x, y, look: 0, left: left || (kind === "feast" ? NL_RULES.feastSeconds : kind === "pill" ? NL_RULES.pillSeconds : 0) });
}

/** 一条摆好的奶龙：头在 (x, y)，身子朝 direction 的反方向排开。 */
function arrange(length: number, direction: NlDirection = "up", x = 6, y = 4): NlState {
  const state = createNlState(7);
  const vector = nlVector(direction);
  state.direction = direction;
  state.snake = Array.from({ length }, (_, index) => ({ x: x - vector.x * index, y: y - vector.y * index }));
  state.maxLength = length;
  state.items = [];
  serve(state, "snack", 0, NL_RULES.rows - 1);
  return state;
}

const OPPOSITE: Record<NlDirection, NlDirection> = { up: "down", down: "up", left: "right", right: "left" };
const DIRECTIONS: NlDirection[] = ["up", "right", "down", "left"];

/** 一个会看路的脚本玩家：朝吃的走，不往墙上、身上撞，也不钻比自己身子还小的死胡同。 */
function steer(state: NlState, look: boolean) {
  const head = state.snake[0];
  const end = state.growth > 0 ? state.snake.length : state.snake.length - 1;
  const walls = new Set<number>();
  for (let index = 0; index < end; index += 1) walls.add(state.snake[index].y * NL_RULES.columns + state.snake[index].x);
  const free = (x: number, y: number) => x >= 0 && x < NL_RULES.columns && y >= 0 && y < NL_RULES.rows && !walls.has(y * NL_RULES.columns + x);
  const room = (x: number, y: number) => {
    const seen = new Set<number>([y * NL_RULES.columns + x]);
    const queue = [[x, y]];
    while (queue.length) {
      const [cx, cy] = queue.pop()!;
      for (const direction of DIRECTIONS) {
        const vector = nlVector(direction);
        const key = (cy + vector.y) * NL_RULES.columns + cx + vector.x;
        if (!free(cx + vector.x, cy + vector.y) || seen.has(key)) continue;
        seen.add(key);
        queue.push([cx + vector.x, cy + vector.y]);
      }
    }
    return seen.size;
  };
  const target = state.items.find((item) => item.kind === "feast") ?? state.items.find((item) => item.kind === "snack")!;
  const options = DIRECTIONS
    .filter((direction) => direction !== OPPOSITE[state.direction])
    .map((direction) => ({ direction, x: head.x + nlVector(direction).x, y: head.y + nlVector(direction).y }))
    .filter((option) => free(option.x, option.y))
    .map((option) => ({
      ...option,
      value: -(Math.abs(target.x - option.x) + Math.abs(target.y - option.y)) - (look && room(option.x, option.y) < state.snake.length ? 1000 : 0),
    }))
    .sort((a, b) => b.value - a.value);
  state.queue.length = 0;
  if (options.length && options[0].direction !== state.direction) nlTurn(state, options[0].direction);
}

function play(seed: number, look: boolean) {
  const state = createNlState(seed);
  let steps = 0;
  while (!state.over && steps < 200_000) {
    steer(state, look);
    tick(state);
    state.events.length = 0;
    steps += 1;
  }
  return state;
}

test("开局：三节长，头朝上停在场地中间，场上有一份零食", () => {
  const state = createNlState(42);
  assert.equal(state.snake.length, NL_RULES.startLength);
  assert.equal(state.direction, "up");
  const head = state.snake[0];
  assert.equal(head.x, Math.floor(NL_RULES.columns / 2));
  for (const [index, cell] of state.snake.entries()) assert.deepEqual(cell, { x: head.x, y: head.y + index });
  assert.equal(state.items.length, 1);
  const snack = state.items[0];
  assert.equal(snack.kind, "snack");
  assert.ok(snack.look >= 0 && snack.look < NL_SNACK_LOOKS);
  assert.ok(!state.snake.some((cell) => cell.x === snack.x && cell.y === snack.y));
  assert.equal(state.score, 0);
  assert.equal(state.over, false);
});

test("一步一格往前走；转向下一步生效，不能掉头，提前按的转向最多记三个，按反了以后按的为准", () => {
  const state = arrange(3, "up", 6, 8);
  tick(state);
  assert.deepEqual(state.snake[0], { x: 6, y: 7 });
  assert.equal(state.snake.length, 3);
  assert.deepEqual(state.tailGhost, { x: 6, y: 10 });
  // 掉头和同方向都不算
  assert.equal(nlTurn(state, "down"), false);
  assert.equal(nlTurn(state, "up"), false);
  assert.equal(nlTurn(state, "left"), true);
  // 刚按了左、还没拐又按右：以后按的为准
  assert.equal(nlTurn(state, "right"), true);
  assert.deepEqual(state.queue, ["right"]);
  assert.equal(nlTurn(state, "left"), true);
  assert.deepEqual(state.queue, ["left"]);
  // 排在后面的以前一个为准：左之后可以接下，再接右
  assert.equal(nlTurn(state, "down"), true);
  assert.equal(nlTurn(state, "right"), true);
  assert.equal(nlTurn(state, "up"), false, "已经记满三个");
  assert.deepEqual(state.queue, ["left", "down", "right"]);
  // 记满了也还能改最后一个
  assert.equal(nlTurn(state, "left"), true);
  assert.deepEqual(state.queue, ["left", "down", "left"]);
  tick(state);
  assert.deepEqual(state.snake[0], { x: 5, y: 7 });
  tick(state);
  assert.deepEqual(state.snake[0], { x: 5, y: 8 });
  assert.equal(state.direction, "down");
  tick(state);
  assert.deepEqual(state.snake[0], { x: 4, y: 8 });
  assert.equal(state.direction, "left");
  assert.deepEqual(state.queue, []);
});

test("有转向等着时，脚下这一格按最快的速度走完；没有转向时照常", () => {
  const steady = arrange(3, "up", 6, 10);
  tick(steady);
  const start = steady.time;
  tick(steady);
  assert.ok(Math.abs(steady.time - start - NL_RULES.stepStart) < 1e-4, "不转向时一格走满 " + (steady.time - start));

  const eager = arrange(3, "up", 6, 10);
  tick(eager);
  nlTurn(eager, "left");
  // 刚迈出这一步就按了转向：这一格只用最快的间隔就走完，然后拐弯
  nlStep(eager, NL_RULES.stepMin - 0.005);
  assert.deepEqual(eager.snake[0], { x: 6, y: 9 }, "还没到最快的间隔，不会提前走");
  nlStep(eager, 0.006);
  assert.deepEqual(eager.snake[0], { x: 5, y: 9 });
  assert.equal(eager.direction, "left");
  assert.ok(eager.stepTimer < 0.01);

  // 这一格已经走了一大半再按：剩下的一小段立刻走完，补间不会跳
  const late = arrange(3, "up", 6, 10);
  tick(late);
  nlStep(late, NL_RULES.stepStart * 0.75);
  const before = late.stepTimer;
  nlTurn(late, "right");
  nlStep(late, 0.01);
  assert.ok(late.stepTimer > before, "接着往前走，不是瞬移");
  nlStep(late, NL_RULES.stepStart * 0.25 * (NL_RULES.stepMin / NL_RULES.stepStart));
  assert.deepEqual(late.snake[0], { x: 7, y: 9 });
});

test("吃零食：加分、长一节，马上补一份新的；吃得越多走得越快，但有个最快的限度", () => {
  const state = arrange(3, "up", 6, 8);
  serve(state, "snack", 6, 7);
  tick(state);
  assert.equal(state.score, NL_RULES.snackScore);
  assert.equal(state.foods, 1);
  assert.equal(state.snacks, 1);
  assert.equal(state.snake.length, 3, "长出来要等下一步");
  assert.ok(state.events.some((event) => event.type === "eat" && event.kind === "snack" && event.score === NL_RULES.snackScore));
  const snacks = state.items.filter((item) => item.kind === "snack");
  assert.equal(snacks.length, 1);
  assert.ok(!state.snake.some((cell) => cell.x === snacks[0].x && cell.y === snacks[0].y));
  serve(state, "snack", 0, 0);
  tick(state);
  assert.equal(state.snake.length, 4);
  assert.equal(state.tailGhost, null);
  assert.equal(state.maxLength, 4);

  assert.equal(nlStepSeconds(0), NL_RULES.stepStart);
  for (let foods = 1; foods < 300; foods += 1) assert.ok(nlStepSeconds(foods) < nlStepSeconds(foods - 1));
  assert.ok(nlStepSeconds(10_000) >= NL_RULES.stepMin);
  assert.ok(nlStepSeconds(10_000) - NL_RULES.stepMin < 1e-6);
});

test("火锅：每吃够六份零食上一锅，越早吃分越高，吃了长两节，过时不候", () => {
  const state = arrange(3, "right", 2, 2);
  for (let snack = 1; snack <= NL_RULES.feastEvery; snack += 1) {
    serve(state, "snack", state.snake[0].x + 1, 2);
    assert.equal(state.items.some((item) => item.kind === "feast"), false);
    tick(state);
  }
  const feast = state.items.find((item) => item.kind === "feast");
  assert.ok(feast);
  assert.equal(feast.left, NL_RULES.feastSeconds);
  assert.ok(state.events.some((event) => event.type === "spawn" && event.kind === "feast"));

  assert.equal(nlFeastScore(NL_RULES.feastSeconds), NL_RULES.feastScoreMax);
  assert.equal(nlFeastScore(0), NL_RULES.feastScoreMin);
  assert.ok(nlFeastScore(3) > nlFeastScore(2));

  const eater = arrange(5, "right", 5, 9);
  serve(eater, "feast", 6, 9, 3.5);
  tick(eater);
  const left = 3.5 - nlStepSeconds(0) + eater.stepTimer;
  assert.ok(Math.abs(eater.score - nlFeastScore(left)) <= 1, String(eater.score));
  assert.equal(eater.foods, 1);
  assert.equal(eater.snacks, 0);
  walk(eater, 2);
  assert.equal(eater.snake.length, 5 + NL_RULES.feastGrow);

  const late = arrange(3, "up", 6, 14);
  serve(late, "feast", 0, 0, 0.3);
  walk(late, 3);
  assert.equal(late.items.some((item) => item.kind === "feast"), false);
  assert.ok(late.events.some((event) => event.type === "expire" && event.kind === "feast"));
  assert.equal(late.score, 0);
});

test("消食片：身子够长才会出，吃了瘦三节，最短留开局那么长", () => {
  // 身子短的时候吃够十份也不出消食片
  const short = arrange(3, "right", 0, 0);
  short.snacks = NL_RULES.pillEvery - 1;
  serve(short, "snack", 1, 0);
  tick(short);
  assert.equal(short.snacks, NL_RULES.pillEvery);
  assert.equal(short.items.some((item) => item.kind === "pill"), false);

  const long = arrange(NL_RULES.pillFromLength, "down", 3, 13);
  long.snacks = NL_RULES.pillEvery - 1;
  serve(long, "snack", 3, 14);
  tick(long);
  assert.ok(long.items.some((item) => item.kind === "pill"));

  const state = arrange(10, "right", 10, 6);
  serve(state, "pill", 11, 6);
  tick(state);
  assert.equal(state.snake.length, 10 - NL_RULES.pillShrink);
  assert.equal(state.score, NL_RULES.pillScore);
  assert.equal(state.maxLength, 10, "最长记录不会跟着变短");
  assert.deepEqual(state.snake[0], { x: 11, y: 6 });

  const tiny = arrange(4, "right", 5, 6);
  serve(tiny, "pill", 6, 6);
  tick(tiny);
  assert.equal(tiny.snake.length, NL_RULES.startLength);

  // 还欠着没长出来的先抵掉：八节、欠两节，吃了消食片一共是 8 + 2 - 3 = 7 节
  const growing = arrange(8, "right", 5, 6);
  growing.growth = 2;
  serve(growing, "pill", 6, 6);
  tick(growing);
  assert.equal(growing.growth, 0);
  assert.equal(growing.snake.length, 8 + 2 - NL_RULES.pillShrink);
});

test("撞墙、咬到自己都会结束；尾巴这一步会让开的那一格可以走", () => {
  const wall = arrange(3, "up", 6, 1);
  walk(wall, 5);
  assert.equal(wall.over, true);
  assert.equal(wall.cause, "wall");
  assert.deepEqual(wall.snake[0], { x: 6, y: 0 }, "头停在最后一格里");
  assert.ok(wall.events.some((event) => event.type === "die" && event.cause === "wall"));
  const time = wall.time;
  nlStep(wall, 1);
  assert.equal(wall.time, time, "结束以后不再推进");
  assert.equal(nlTurn(wall, "left"), false);

  // 五节长，原地绕一个 2×2 的圈会咬到自己
  const self = arrange(5, "up", 6, 6);
  for (const direction of ["left", "down", "right"] as const) {
    nlTurn(self, direction);
    tick(self);
  }
  assert.equal(self.over, true);
  assert.equal(self.cause, "self");

  // 四节长绕同样的圈：头进的是尾巴刚让开的格子，没事
  const chase = arrange(4, "up", 6, 6);
  for (const direction of ["left", "down", "right", "up", "left", "down"] as const) {
    nlTurn(chase, direction);
    tick(chase);
  }
  assert.equal(chase.over, false);
  // 正在长的时候尾巴不动，那一格就不能走了
  const stuck = arrange(4, "up", 6, 6);
  stuck.growth = 1;
  nlTurn(stuck, "left");
  tick(stuck);
  nlTurn(stuck, "down");
  tick(stuck);
  nlTurn(stuck, "right");
  tick(stuck);
  assert.equal(stuck.over, true);
  assert.equal(stuck.cause, "self");
});

test("同一个种子、同样的操作得到同一局", () => {
  const first = play(2026, true);
  const second = play(2026, true);
  assert.deepEqual(
    [first.score, first.foods, first.maxLength, first.time, first.cause, first.snake],
    [second.score, second.foods, second.maxLength, second.time, second.cause, second.snake],
  );
  assert.notDeepEqual(createNlState(1).items, createNlState(2).items);
});

test("脚本玩家的每一局都会结束，成绩都在服务端认可的范围内", () => {
  const careful: number[] = [];
  const careless: number[] = [];
  for (let seed = 1; seed <= 24; seed += 1) {
    for (const look of [false, true]) {
      const state = play(seed * 97, look);
      assert.equal(state.over, true, "种子 " + seed);
      (look ? careful : careless).push(state.score);
      assert.ok(state.score <= nlMaxScoreForFoods(state.foods), `${state.score} ${state.foods}`);
      assert.ok(state.score >= state.foods * NL_RULES.snackScore);
      assert.ok(state.maxLength <= nlMaxLengthForFoods(state.foods));
      const durationMs = Math.round(state.time * 1000);
      assert.equal(validateGreedyNailongResult({
        score: state.score,
        foods: state.foods,
        length: state.maxLength,
        durationMs,
        serverElapsedMs: durationMs + 800,
      }), null, JSON.stringify([state.score, state.foods, state.maxLength, durationMs]));
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  // 只会朝吃的走的几百分就把自己绕死，会看路的能到一千分上下。
  assert.ok(median(careless) >= 150 && median(careless) <= 700, String(median(careless)));
  assert.ok(median(careful) > median(careless) * 1.5, `${median(careful)} ${median(careless)}`);
  assert.ok(Math.max(...careful) < 4000);
});

test("服务端的格子数、分值和上限与页面引擎一致", () => {
  assert.equal(GREEDY_NAILONG_MIN_STEP_MS, NL_RULES.stepMin * 1000);
  assert.equal(GREEDY_NAILONG_START_LENGTH, NL_RULES.startLength);
  assert.equal(GREEDY_NAILONG_MAX_LENGTH, NL_RULES.columns * NL_RULES.rows);
  assert.equal(GREEDY_NAILONG_SNACK_SCORE, NL_RULES.snackScore);
  assert.equal(GREEDY_NAILONG_FEAST_EVERY, NL_RULES.feastEvery);
  assert.equal(GREEDY_NAILONG_FEAST_SCORE_MAX, NL_RULES.feastScoreMax);
  assert.equal(GREEDY_NAILONG_FEAST_GROW, NL_RULES.feastGrow);
  assert.equal(GREEDY_NAILONG_PILL_EVERY, NL_RULES.pillEvery);
  assert.equal(GREEDY_NAILONG_PILL_SCORE, NL_RULES.pillScore);
  for (const foods of [0, 1, 6, 7, 8, 11, 77, 500, GREEDY_NAILONG_MAX_FOODS]) {
    assert.equal(maxGreedyNailongScoreForFoods(foods), nlMaxScoreForFoods(foods));
    assert.equal(maxGreedyNailongLengthForFoods(foods), nlMaxLengthForFoods(foods));
  }
  // 上限的由来：七样东西里最多六份零食加一锅满分的火锅。
  assert.equal(maxGreedyNailongScoreForFoods(7), 6 * NL_RULES.snackScore + NL_RULES.feastScoreMax + (NL_RULES.pillScore - NL_RULES.snackScore));
  assert.equal(minGreedyNailongScoreForFoods(9), 9 * NL_RULES.snackScore);
  assert.ok(NL_RULES.pillScore >= NL_RULES.snackScore && NL_RULES.feastScoreMin >= NL_RULES.snackScore, "最不值钱的是零食");
  assert.equal(maxGreedyNailongLengthForFoods(1_000), NL_RULES.columns * NL_RULES.rows);
  assert.equal(GREEDY_NAILONG_MAX_SCORE, maxGreedyNailongScoreForFoods(GREEDY_NAILONG_MAX_FOODS));
  assert.equal(nlRank(0), "小馋龙");
  assert.equal(nlRank(99_999), "贪吃奶龙本龙");
});

test("正常对局成绩通过服务端校验", () => {
  assert.equal(validateGreedyNailongResult({ score: 0, foods: 0, length: 3, durationMs: 2_000, serverElapsedMs: 2_500 }), null);
  assert.equal(validateGreedyNailongResult({ score: 10, foods: 1, length: 4, durationMs: 3_000, serverElapsedMs: 3_500 }), null);
  assert.equal(validateGreedyNailongResult({ score: 383, foods: 27, length: 29, durationMs: 50_000, serverElapsedMs: 51_000 }), null);
  assert.equal(validateGreedyNailongResult({ score: 1_025, foods: 72, length: 66, durationMs: 154_000, serverElapsedMs: 156_000 }), null);
  assert.equal(validateGreedyNailongResult({
    score: maxGreedyNailongScoreForFoods(70),
    foods: 70,
    length: maxGreedyNailongLengthForFoods(70),
    durationMs: minimumDurationForGreedyNailongFoods(70),
    serverElapsedMs: minimumDurationForGreedyNailongFoods(70),
  }), null);
});

test("对不上进食数的分数和长度、伪造的时长会被拒绝", () => {
  assert.match(validateGreedyNailongResult({ score: 5_000, foods: 40, length: 30, durationMs: 80_000, serverElapsedMs: 81_000 }) || "", /分数与进食数不匹配/);
  assert.match(validateGreedyNailongResult({ score: 10, foods: 0, length: 3, durationMs: 9_000, serverElapsedMs: 9_500 }) || "", /分数与进食数不匹配/);
  assert.match(validateGreedyNailongResult({ score: 90, foods: 10, length: 12, durationMs: 30_000, serverElapsedMs: 31_000 }) || "", /分数与进食数不匹配/);
  assert.match(validateGreedyNailongResult({ score: 100, foods: 10, length: 40, durationMs: 30_000, serverElapsedMs: 31_000 }) || "", /长度与进食数不匹配/);
  assert.match(validateGreedyNailongResult({ score: 0, foods: 0, length: 4, durationMs: 9_000, serverElapsedMs: 9_500 }) || "", /长度与进食数不匹配/);
  assert.match(validateGreedyNailongResult({ score: 3_000, foods: 300, length: 100, durationMs: 5_000, serverElapsedMs: 120_000 }) || "", /时长不匹配/);
  assert.match(validateGreedyNailongResult({ score: 3_000, foods: 300, length: 100, durationMs: 120_000, serverElapsedMs: 5_000 }) || "", /时长不匹配/);
  assert.match(validateGreedyNailongResult({ score: 100, foods: 10, length: 12, durationMs: 90_000, serverElapsedMs: 60_000 }) || "", /客户端/);
  assert.match(validateGreedyNailongResult({ score: GREEDY_NAILONG_MAX_SCORE + 1, foods: GREEDY_NAILONG_MAX_FOODS, length: 50, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateGreedyNailongResult({ score: 0, foods: GREEDY_NAILONG_MAX_FOODS + 1, length: 50, durationMs: 300_000, serverElapsedMs: 300_000 }) || "", /范围/);
  assert.match(validateGreedyNailongResult({ score: 0, foods: 0, length: 2, durationMs: 3_000, serverElapsedMs: 3_000 }) || "", /范围/);
  assert.match(validateGreedyNailongResult({ score: 100, foods: 10, length: GREEDY_NAILONG_MAX_LENGTH + 1, durationMs: 30_000, serverElapsedMs: 30_000 }) || "", /范围/);
  assert.match(validateGreedyNailongResult({ score: 10, foods: 1, length: 4, durationMs: 12_000, serverElapsedMs: 41 * 60 * 1000 }) || "", /过期/);
});

test("云端成就覆盖局数、单局分数、身长与累计", () => {
  const codes = earnedGreedyNailongAchievementCodes({ games: 20, bestScore: 950, totalScore: 12_000, bestLength: 36, totalFoods: 900 });
  for (const code of ["first_game", "length_10", "length_20", "length_35", "score_200", "score_500", "score_900", "games_20", "total_foods_500"]) assert.ok(codes.includes(code), code);
  for (const code of ["length_50", "score_1400", "games_50", "total_score_20000"]) assert.ok(!codes.includes(code), code);
  assert.deepEqual(earnedGreedyNailongAchievementCodes({ games: 0, bestScore: 0, totalScore: 0, bestLength: 0, totalFoods: 0 }), []);
  assert.equal(GREEDY_NAILONG_ACHIEVEMENTS.length, 14);
  assert.equal(new Set(GREEDY_NAILONG_ACHIEVEMENTS.map((item) => item.code)).size, 14);
  for (const item of GREEDY_NAILONG_ACHIEVEMENTS) {
    if (item.metric === "bestLength") assert.ok(item.target > GREEDY_NAILONG_START_LENGTH && item.target <= GREEDY_NAILONG_MAX_LENGTH);
    if (item.metric === "bestScore") assert.ok(item.target <= GREEDY_NAILONG_MAX_SCORE);
    // 说明里写的数字就是目标。
    if (item.metric !== "games" || item.target > 1) assert.ok(item.description.includes(String(item.target)), item.description);
  }
});

test("云端对局接口挂在小游戏自己的路径下，账号注销时一并清理，游戏页受小游戏隐藏规则约束并且全屏", () => {
  const routes = readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  const deletion = readFileSync(new URL("../src/services/accountDeletion.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  const games = readFileSync(new URL("../../web/src/data/miniGames.ts", import.meta.url), "utf8");
  assert.match(routes, /mount\("\/tools\/greedy-nailong", greedyNailongRouter\);[\s\S]*mount\("\/tools", toolsRouter\);/u);
  assert.match(deletion, /\["greedyNailongAttempt", "userId"\], \["greedyNailongAchievement", "userId"\]/u);
  const route = router.split("\n").find((line) => line.includes('name: "service-greedy-nailong"')) || "";
  // 已发布的原生壳只对 /services/tools/yaoda-can-fly 这个前缀隐藏自己的顶栏和底栏；鸿蒙壳看的是 immersive。
  assert.match(route, /path: "services\/tools\/yaoda-can-fly\/greedy-nailong"/u);
  assert.match(route, /nativeChrome: "page"/u);
  assert.match(route, /miniGame: true/u);
  assert.match(route, /immersive: true/u);
  assert.match(games, /routeName: "service-greedy-nailong"[\s\S]*leaderboardPath: "\/tools\/greedy-nailong\/leaderboard"/u);
});
