import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  earnedYaodaMinesAchievementCodes,
  maximumDurationForYaodaMinesBoards,
  minimumDurationForYaodaMinesBoards,
  validateYaodaMinesResult,
  yaodaMinesCellRange,
  yaodaMinesLevel,
  yaodaMinesScoreFor,
  YAODA_MINES_ACHIEVEMENTS,
  YAODA_MINES_BONUS_DECAY,
  YAODA_MINES_BONUS_FLOOR,
  YAODA_MINES_CELL_SCORE,
  YAODA_MINES_CLEAR_PAUSE_MS,
  YAODA_MINES_LEVELS,
  YAODA_MINES_MAX_BOARDS,
  YAODA_MINES_MAX_CELLS,
  YAODA_MINES_MAX_SCORE,
  YAODA_MINES_MINE_SCORE,
  YAODA_MINES_START_SECONDS,
} from "../src/services/yaodaMinesPolicy";
import {
  CELL_FLAG,
  CELL_HIDDEN,
  CELL_OPEN,
  createMinesState,
  MINE_KINDS,
  minesCellRange,
  minesClicksNeeded,
  minesFlag,
  minesLevel,
  minesNeighbors,
  minesOpen,
  minesRank,
  minesSafeCells,
  minesScoreFor,
  minesSolvable,
  minesStep,
  minesTotalSeconds,
  MINES_RULES,
  type MinesState,
} from "../../web/src/views/services/games/yaodaMinesEngine";

/** 跳到第 level 关的空场地（雷还没埋）。 */
function atLevel(seed: number, level: number) {
  const state = createMinesState(seed);
  while (state.board.level < level) {
    state.phase = "clear";
    state.pause = 0.001;
    minesStep(state, 0.001);
  }
  state.boards = level - 1;
  state.time = 0;
  state.events.length = 0;
  return state;
}

function cellXY(state: MinesState, index: number) {
  return { x: index % state.board.columns, y: Math.floor(index / state.board.columns) };
}

/**
 * 只看玩家看得见的东西（翻开的数字、自己插的旗）找下一步：能确定安全的格子就翻，能确定是雷的就插旗。
 * 和人一样只用单个数字、两个数字相比、剩余雷数这三条。找不到时返回 null。
 */
function nextMove(state: MinesState): { kind: "open" | "flag"; index: number } | null {
  const board = state.board;
  const size = board.columns * board.rows;
  const view = board.view;
  const constraints: Array<{ cell: number; list: number[]; left: number }> = [];
  for (let cell = 0; cell < size; cell += 1) {
    if (view[cell] !== CELL_OPEN || board.count[cell] === 0) continue;
    const list: number[] = [];
    let flags = 0;
    for (const next of minesNeighbors(board, cell)) {
      if (view[next] === CELL_HIDDEN) list.push(next);
      else if (view[next] === CELL_FLAG) flags += 1;
    }
    if (!list.length) continue;
    const left = board.count[cell] - flags;
    if (left === 0) return { kind: "open", index: list[0] };
    if (left === list.length) return { kind: "flag", index: list[0] };
    constraints.push({ cell, list, left });
  }
  for (const first of constraints) {
    for (const second of constraints) {
      if (first === second) continue;
      const onlySecond = second.list.filter((cell) => !first.list.includes(cell));
      if (!onlySecond.length) continue;
      const onlyFirst = first.list.filter((cell) => !second.list.includes(cell));
      if (second.left - first.left === onlySecond.length) return { kind: "flag", index: onlySecond[0] };
      if (!onlyFirst.length && second.left === first.left) return { kind: "open", index: onlySecond[0] };
    }
  }
  const hidden: number[] = [];
  for (let cell = 0; cell < size; cell += 1) if (view[cell] === CELL_HIDDEN) hidden.push(cell);
  const remaining = board.mines - board.flags;
  if (hidden.length && remaining === 0) return { kind: "open", index: hidden[0] };
  if (hidden.length && remaining === hidden.length) return { kind: "flag", index: hidden[0] };
  return null;
}

/** 脚本玩家：每秒做 rate 个动作（翻一格或插一面旗），只按推理走；一局玩到结束。 */
function play(seed: number, rate: number) {
  const state = createMinesState(seed);
  let guesses = 0;
  for (let action = 0; action < 200_000 && state.phase !== "over"; action += 1) {
    if (state.phase === "clear") {
      minesStep(state, state.pause + 1e-6);
      continue;
    }
    minesStep(state, 1 / rate);
    if (state.phase !== "play") continue;
    const board = state.board;
    if (!board.ready) {
      minesOpen(state, Math.floor(board.columns / 2), Math.floor(board.rows / 2));
      continue;
    }
    const move = nextMove(state);
    if (!move) {
      guesses += 1;
      const index = board.view.findIndex((view) => view === CELL_HIDDEN);
      const { x, y } = cellXY(state, index);
      minesOpen(state, x, y);
      continue;
    }
    const { x, y } = cellXY(state, move.index);
    if (move.kind === "open") minesOpen(state, x, y);
    else minesFlag(state, x, y);
  }
  return { state, guesses };
}

test("第一下点哪都安全，还会翻开一片；雷数和场地按关卡来", () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const level = 1 + (seed % 9);
    const state = atLevel(seed * 31, level);
    const spec = minesLevel(level);
    const x = seed % spec.columns;
    const y = (seed * 7) % spec.rows;
    assert.equal(minesOpen(state, x, y), true);
    assert.equal(state.phase, "play", `关卡 ${level} 种子 ${seed}`);
    const board = state.board;
    assert.equal(board.mine.reduce((sum, value) => sum + value, 0), spec.mines);
    assert.equal(board.mine[y * spec.columns + x], 0);
    assert.equal(board.count[y * spec.columns + x], 0, "点下去的那一格周围没有雷");
    for (const next of minesNeighbors(board, y * spec.columns + x)) assert.equal(board.mine[next], 0);
    assert.ok(board.opened >= 1 + minesNeighbors(board, y * spec.columns + x).length, "至少翻开那一格和它周围的格子");
    assert.equal(state.cells, board.opened);
    assert.equal(state.score, board.opened * MINES_RULES.cellScore);
    for (let cell = 0; cell < board.mine.length; cell += 1) {
      if (board.mine[cell]) assert.ok(board.kind[cell] < MINE_KINDS.length);
    }
  }
});

test("埋出来的每一盘都只靠推理就能扫完，用不着猜", () => {
  for (let level = 1; level <= 9; level += 1) {
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = atLevel(seed * 977 + level, level);
      const spec = minesLevel(level);
      const x = (seed * 3) % spec.columns;
      const y = (seed * 5) % spec.rows;
      minesOpen(state, x, y);
      assert.equal(minesSolvable(state.board, y * spec.columns + x), true, `关卡 ${level} 种子 ${seed}`);
    }
  }
  // 推理不能替人猜：一个经典的二选一残局判为扫不完。
  const columns = 3;
  const rows = 2;
  const mine = Uint8Array.from([0, 0, 0, 1, 0, 0]);
  const count = new Uint8Array(6);
  for (let cell = 0; cell < 6; cell += 1) for (const next of minesNeighbors({ columns, rows }, cell)) count[cell] += mine[next];
  assert.equal(minesSolvable({ columns, rows, mines: 1, mine, count }, 2), false);
});

test("插旗、拔旗、点数字连开；插错旗连开会炸", () => {
  const state = atLevel(42, 3);
  minesOpen(state, 4, 5);
  const board = state.board;
  assert.equal(minesFlag(state, 4, 5), false, "翻开的格子不能插旗");
  // 找一个数字，把它周围的雷都插上旗，再点它
  const target = Array.from(board.count).findIndex((count, cell) => board.view[cell] === CELL_OPEN && count > 0
    && minesNeighbors(board, cell).some((next) => board.view[next] === CELL_HIDDEN && !board.mine[next]));
  assert.ok(target >= 0);
  const around = minesNeighbors(board, target);
  for (const next of around) {
    if (board.mine[next] && board.view[next] === CELL_HIDDEN) {
      const { x, y } = cellXY(state, next);
      assert.equal(minesFlag(state, x, y), true);
    }
  }
  const before = state.cells;
  const { x, y } = cellXY(state, target);
  assert.equal(minesOpen(state, x, y), true);
  assert.ok(state.cells > before);
  for (const next of around) if (!board.mine[next]) assert.equal(board.view[next], CELL_OPEN);
  // 插着旗的格子点不开；拔旗以后能点开
  const flagged = board.view.findIndex((view) => view === CELL_FLAG);
  const flagXY = cellXY(state, flagged);
  assert.equal(minesOpen(state, flagXY.x, flagXY.y), false);
  assert.equal(minesFlag(state, flagXY.x, flagXY.y), true);
  assert.equal(board.view[flagged], CELL_HIDDEN);

  // 旗插在不是雷的格子上，连开就会翻到真正的雷
  const wrong = atLevel(7, 4);
  minesOpen(wrong, 4, 6);
  const wb = wrong.board;
  const number = Array.from(wb.count).findIndex((count, cell) => wb.view[cell] === CELL_OPEN && count === 1
    && minesNeighbors(wb, cell).filter((next) => wb.view[next] === CELL_HIDDEN).length >= 2);
  assert.ok(number >= 0);
  const decoy = minesNeighbors(wb, number).find((next) => wb.view[next] === CELL_HIDDEN && !wb.mine[next]);
  assert.ok(decoy !== undefined);
  const decoyXY = cellXY(wrong, decoy);
  minesFlag(wrong, decoyXY.x, decoyXY.y);
  const numberXY = cellXY(wrong, number);
  assert.equal(minesOpen(wrong, numberXY.x, numberXY.y), true);
  assert.equal(wrong.phase, "over");
  assert.equal(wrong.cause, "mine");
  assert.equal(wb.mine[wrong.hit!.y * wb.columns + wrong.hit!.x], 1);
  assert.ok(wrong.events.some((event) => event.type === "boom"));
  assert.equal(minesOpen(wrong, 0, 0), false, "结束以后不能再点");
});

test("扫完一关加分加时，停一下换下一关；倒计时用完就结束", () => {
  const clear = atLevel(11, 1);
  minesOpen(clear, 3, 3);
  while (clear.phase === "play") {
    const move = nextMove(clear);
    assert.ok(move, "第一关不用猜");
    const { x, y } = cellXY(clear, move.index);
    if (move.kind === "open") minesOpen(clear, x, y);
    else minesFlag(clear, x, y);
  }
  assert.equal(clear.phase, "clear");
  assert.equal(clear.boards, 1);
  assert.equal(clear.score, minesScoreFor(1, minesSafeCells(1)));
  assert.equal(clear.timeLeft, MINES_RULES.startSeconds + minesLevel(1).bonusSeconds);
  assert.equal(clear.board.flags, clear.board.mines, "过关时雷全插上旗");
  const timeLeft = clear.timeLeft;
  minesStep(clear, MINES_RULES.clearPause / 2);
  assert.equal(clear.timeLeft, timeLeft, "停顿时倒计时不走");
  assert.equal(minesOpen(clear, 0, 0), false, "停顿时不能点");
  minesStep(clear, MINES_RULES.clearPause / 2 + 0.25);
  assert.equal(clear.phase, "play");
  assert.equal(clear.board.level, 2);
  assert.equal(clear.board.ready, false);
  assert.ok(Math.abs(clear.timeLeft - (timeLeft - 0.25)) < 1e-9, "停顿外的那一截算进倒计时");

  const slow = createMinesState(3);
  minesStep(slow, MINES_RULES.startSeconds - 1);
  assert.equal(slow.phase, "play");
  minesStep(slow, 5);
  assert.equal(slow.phase, "over");
  assert.equal(slow.cause, "time");
  assert.equal(slow.timeLeft, 0);
  assert.equal(slow.time, MINES_RULES.startSeconds, "对局时长不超过倒计时");
});

test("同一个种子、同样的操作得到同一局", () => {
  const first = play(2026, 2);
  const second = play(2026, 2);
  assert.deepEqual(
    [first.state.score, first.state.boards, first.state.cells, first.state.time, first.state.cause],
    [second.state.score, second.state.boards, second.state.cells, second.state.time, second.state.cause],
  );
  const a = atLevel(1, 1);
  const b = atLevel(2, 1);
  minesOpen(a, 4, 4);
  minesOpen(b, 4, 4);
  assert.notDeepEqual(a.board.mine, b.board.mine);
});

test("脚本玩家不用猜，每一局都会结束，成绩都在服务端认可的范围内", () => {
  const boardsAt = new Map<number, number[]>();
  for (const rate of [1, 1.5, 3, 6]) {
    const boards: number[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      const { state, guesses } = play(seed * 131 + rate * 7, rate);
      assert.equal(guesses, 0, `每秒 ${rate} 下，种子 ${seed}`);
      assert.equal(state.phase, "over");
      assert.equal(state.cause, "time", "只按推理走不会踩雷");
      assert.equal(state.score, minesScoreFor(state.boards, state.cells));
      const range = minesCellRange(state.boards);
      assert.ok(state.cells >= range.min && state.cells <= range.max);
      const durationMs = Math.round(state.time * 1000);
      assert.equal(validateYaodaMinesResult({
        score: state.score,
        boards: state.boards,
        cells: state.cells,
        durationMs,
        serverElapsedMs: durationMs + 900,
      }), null, JSON.stringify([rate, state.score, state.boards, state.cells, durationMs]));
      boards.push(state.boards);
    }
    boardsAt.set(rate, boards.sort((a, b) => a - b));
  }
  const median = (rate: number) => boardsAt.get(rate)![6];
  // 每秒一下的慢手过两三关；每秒三下能过十关以上；每秒六下的“机器手”也停在三十关以内。
  assert.ok(median(1) >= 1 && median(1) <= 5, String(boardsAt.get(1)));
  assert.ok(median(3) >= 8, String(boardsAt.get(3)));
  assert.ok(Math.max(...boardsAt.get(6)!) < 40, String(boardsAt.get(6)));
});

test("服务端的关卡表、分值和上限与页面引擎一致", () => {
  assert.equal(YAODA_MINES_START_SECONDS, MINES_RULES.startSeconds);
  assert.equal(YAODA_MINES_BONUS_DECAY, MINES_RULES.bonusDecay);
  assert.equal(YAODA_MINES_BONUS_FLOOR, MINES_RULES.bonusFloor);
  assert.equal(YAODA_MINES_CELL_SCORE, MINES_RULES.cellScore);
  assert.equal(YAODA_MINES_MINE_SCORE, MINES_RULES.mineScore);
  assert.equal(YAODA_MINES_CLEAR_PAUSE_MS, MINES_RULES.clearPause * 1000);
  for (let level = 1; level <= 60; level += 1) {
    assert.deepEqual(yaodaMinesLevel(level), { ...minesLevel(level) }, `关卡 ${level}`);
    assert.ok(minesLevel(level).columns <= MINES_RULES.maxColumns && minesLevel(level).rows <= MINES_RULES.maxRows);
  }
  for (const boards of [0, 1, 2, 7, 8, 9, 30]) {
    assert.deepEqual(yaodaMinesCellRange(boards), minesCellRange(boards));
    assert.equal(yaodaMinesScoreFor(boards, minesCellRange(boards).max), minesScoreFor(boards, minesCellRange(boards).max));
    assert.equal(maximumDurationForYaodaMinesBoards(boards), minesTotalSeconds(boards) * 1000 + boards * YAODA_MINES_CLEAR_PAUSE_MS);
  }
  assert.equal(YAODA_MINES_LEVELS.length, 8);
  assert.equal(minesLevel(9).bonusSeconds, minesLevel(8).bonusSeconds - MINES_RULES.bonusDecay);
  assert.equal(minesLevel(200).bonusSeconds, MINES_RULES.bonusFloor);
  assert.equal(YAODA_MINES_MAX_CELLS, yaodaMinesCellRange(YAODA_MINES_MAX_BOARDS).max);
  assert.equal(YAODA_MINES_MAX_SCORE, yaodaMinesScoreFor(YAODA_MINES_MAX_BOARDS, YAODA_MINES_MAX_CELLS));
  assert.ok(Number.isSafeInteger(YAODA_MINES_MAX_SCORE) && YAODA_MINES_MAX_SCORE < 2 ** 31);
  assert.equal(minesRank(0), "扫雷新兵");
  assert.equal(minesRank(99_999), "药大排雷王");
  // 3BV：一整块空地点一下，不靠空地的数字格一格一下。
  const columns = 4;
  const rows = 1;
  const mine = Uint8Array.from([0, 0, 1, 0]);
  const count = Uint8Array.from([0, 1, 0, 1]);
  assert.equal(minesClicksNeeded({ columns, rows, mine, count }), 2);
});

test("正常对局成绩通过服务端校验", () => {
  assert.equal(validateYaodaMinesResult({ score: 0, boards: 0, cells: 0, durationMs: 60_000, serverElapsedMs: 61_000 }), null);
  assert.equal(validateYaodaMinesResult({ score: 30, boards: 0, cells: 30, durationMs: 20_000, serverElapsedMs: 21_000 }), null);
  const cells = minesSafeCells(1) + minesSafeCells(2) + minesSafeCells(3) + 40;
  assert.equal(validateYaodaMinesResult({
    score: yaodaMinesScoreFor(3, cells),
    boards: 3,
    cells,
    durationMs: 120_000,
    serverElapsedMs: 125_000,
  }), null);
  const boards = 12;
  assert.equal(validateYaodaMinesResult({
    score: yaodaMinesScoreFor(boards, yaodaMinesCellRange(boards).min),
    boards,
    cells: yaodaMinesCellRange(boards).min,
    durationMs: minimumDurationForYaodaMinesBoards(boards),
    serverElapsedMs: minimumDurationForYaodaMinesBoards(boards),
  }), null);
  assert.equal(validateYaodaMinesResult({
    score: yaodaMinesScoreFor(boards, yaodaMinesCellRange(boards).max),
    boards,
    cells: yaodaMinesCellRange(boards).max,
    durationMs: maximumDurationForYaodaMinesBoards(boards),
    serverElapsedMs: maximumDurationForYaodaMinesBoards(boards) + 30_000,
  }), null);
});

test("对不上关数的格子数和分数、超出倒计时的时长会被拒绝", () => {
  const cells = minesSafeCells(1) + 10;
  const good = { score: yaodaMinesScoreFor(1, cells), boards: 1, cells, durationMs: 40_000, serverElapsedMs: 41_000 };
  assert.equal(validateYaodaMinesResult(good), null);
  assert.match(validateYaodaMinesResult({ ...good, score: good.score + 1 }) || "", /分数与格子数不匹配/);
  assert.match(validateYaodaMinesResult({ ...good, score: good.score - 10 }) || "", /分数与格子数不匹配/);
  assert.match(validateYaodaMinesResult({ ...good, cells: minesSafeCells(1) - 1, score: yaodaMinesScoreFor(1, minesSafeCells(1) - 1) }) || "", /格子数与关数不匹配/);
  assert.match(validateYaodaMinesResult({ ...good, cells: minesSafeCells(1) + minesSafeCells(2), score: yaodaMinesScoreFor(1, minesSafeCells(1) + minesSafeCells(2)) }) || "", /格子数与关数不匹配/);
  assert.match(validateYaodaMinesResult({ score: 0, boards: 0, cells: 0, durationMs: 70_000, serverElapsedMs: 75_000 }) || "", /超出倒计时/);
  const many = 20;
  const manyCells = yaodaMinesCellRange(many).min;
  assert.match(validateYaodaMinesResult({ score: yaodaMinesScoreFor(many, manyCells), boards: many, cells: manyCells, durationMs: 10_000, serverElapsedMs: 300_000 }) || "", /时长不匹配/);
  assert.match(validateYaodaMinesResult({ score: yaodaMinesScoreFor(many, manyCells), boards: many, cells: manyCells, durationMs: 300_000, serverElapsedMs: 10_000 }) || "", /时长不匹配/);
  assert.match(validateYaodaMinesResult({ ...good, durationMs: 40_000, serverElapsedMs: 30_000 }) || "", /客户端/);
  assert.match(validateYaodaMinesResult({ ...good, score: YAODA_MINES_MAX_SCORE + 1 }) || "", /范围/);
  assert.match(validateYaodaMinesResult({ ...good, boards: YAODA_MINES_MAX_BOARDS + 1 }) || "", /范围/);
  assert.match(validateYaodaMinesResult({ ...good, cells: -1 }) || "", /范围/);
  assert.match(validateYaodaMinesResult({ ...good, serverElapsedMs: 41 * 60 * 1000 }) || "", /过期/);
});

test("云端成就覆盖局数、单局分数、关数与累计", () => {
  const codes = earnedYaodaMinesAchievementCodes({ games: 20, bestScore: 3_200, totalScore: 18_000, bestBoards: 9, totalBoards: 60 });
  for (const code of ["first_game", "boards_2", "boards_5", "boards_8", "score_500", "score_1500", "score_3000", "games_5", "games_20", "total_boards_50"]) assert.ok(codes.includes(code), code);
  for (const code of ["boards_12", "score_6000", "games_50", "total_score_30000"]) assert.ok(!codes.includes(code), code);
  assert.deepEqual(earnedYaodaMinesAchievementCodes({ games: 0, bestScore: 0, totalScore: 0, bestBoards: 0, totalBoards: 0 }), []);
  assert.equal(YAODA_MINES_ACHIEVEMENTS.length, 14);
  assert.equal(new Set(YAODA_MINES_ACHIEVEMENTS.map((item) => item.code)).size, 14);
  for (const item of YAODA_MINES_ACHIEVEMENTS) {
    if (item.metric === "bestBoards") assert.ok(item.target <= YAODA_MINES_MAX_BOARDS);
    if (item.metric === "bestScore") assert.ok(item.target <= YAODA_MINES_MAX_SCORE);
    if (item.metric !== "games" || item.target > 1) assert.ok(item.description.includes(String(item.target)), item.description);
  }
});

test("云端对局接口挂在小游戏自己的路径下，账号注销时一并清理，游戏页受小游戏隐藏规则约束并且全屏", () => {
  const routes = readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  const deletion = readFileSync(new URL("../src/services/accountDeletion.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../../web/src/router/index.ts", import.meta.url), "utf8");
  const games = readFileSync(new URL("../../web/src/data/miniGames.ts", import.meta.url), "utf8");
  assert.match(routes, /mount\("\/tools\/yaoda-mines", yaodaMinesRouter\);[\s\S]*mount\("\/tools", toolsRouter\);/u);
  assert.match(deletion, /\["yaodaMinesAttempt", "userId"\], \["yaodaMinesAchievement", "userId"\]/u);
  const route = router.split("\n").find((line) => line.includes('name: "service-yaoda-mines"')) || "";
  // 已发布的原生壳只对 /services/tools/yaoda-can-fly 这个前缀隐藏自己的顶栏和底栏；鸿蒙壳看的是 immersive。
  assert.match(route, /path: "services\/tools\/yaoda-can-fly\/yaoda-mines"/u);
  assert.match(route, /nativeChrome: "page"/u);
  assert.match(route, /miniGame: true/u);
  assert.match(route, /immersive: true/u);
  assert.match(games, /routeName: "service-yaoda-mines"[\s\S]*leaderboardPath: "\/tools\/yaoda-mines\/leaderboard"/u);
});
