// 清扫药大雷的规则：一关一块雷区，翻开所有不是雷的格子就过关，踩到一颗雷或者时间用完，这一局就结束。
// 每块雷区都在第一次点下去以后才埋雷，并且保证只靠推理就能扫完，用不着猜。
// 只有数据和规则，不碰画布和页面；同一个种子、同样的操作会得到同样的一局，服务端的校验和测试都靠它。

export interface MinesLevelSpec {
  columns: number;
  rows: number;
  mines: number;
  /** 清完这一关给倒计时加多少秒。 */
  bonusSeconds: number;
}

/**
 * 前八关一关比一关大、雷一关比一关密；第八关以后场地不再变，过关加的时间一关比一关少，
 * 少到再快的手也补不回来，所以每一局都会结束。
 */
const LEVELS: readonly MinesLevelSpec[] = [
  { columns: 8, rows: 8, mines: 8, bonusSeconds: 15 },
  { columns: 8, rows: 10, mines: 11, bonusSeconds: 18 },
  { columns: 9, rows: 11, mines: 14, bonusSeconds: 22 },
  { columns: 9, rows: 12, mines: 17, bonusSeconds: 25 },
  { columns: 10, rows: 13, mines: 21, bonusSeconds: 29 },
  { columns: 10, rows: 14, mines: 25, bonusSeconds: 32 },
  { columns: 10, rows: 15, mines: 29, bonusSeconds: 36 },
  { columns: 10, rows: 16, mines: 33, bonusSeconds: 38 },
];

export const MINES_RULES = {
  /** 开局倒计时。 */
  startSeconds: 60,
  /** 第八关以后每关少加这么多秒，最少加 bonusFloor 秒。 */
  bonusDecay: 6,
  bonusFloor: 3,
  /** 翻开一格安全的格子得几分。 */
  cellScore: 1,
  /** 清完一关，这一关每颗雷再给几分。 */
  mineScore: 10,
  /** 过关后停一会儿再上下一关（秒）；这段时间倒计时不走。 */
  clearPause: 1.6,
  /** 一块雷区最多重埋多少次来找一盘不用猜的。 */
  generateAttempts: 600,
  maxColumns: 10,
  maxRows: 16,
} as const;

/** 雷的花样：画面和踩雷时的那句话用，不影响规则。 */
export const MINE_KINDS = [
  { name: "早八闹钟", line: "闹钟响了三遍，你还是没醒" },
  { name: "挂科试卷", line: "59 分，就差那一分" },
  { name: "随堂点名", line: "全班一百人，偏偏点到你" },
  { name: "实验报告", line: "报告还差三千字，明早就交" },
  { name: "冒泡烧瓶", line: "烧瓶在你手里冒了泡" },
  { name: "胶囊雷", line: "这颗药大雷，被你一脚踩响" },
] as const;

/** 关卡在哪儿：只是给每一关起个名字。 */
export const MINES_PLACES = ["军训操场", "教学楼", "图书馆", "食堂", "实验楼", "药植园", "宿舍楼", "期末考场"] as const;

export const CELL_HIDDEN = 0;
export const CELL_OPEN = 1;
export const CELL_FLAG = 2;

export type MinesCause = "mine" | "time";
export type MinesPhase = "play" | "clear" | "over";

export interface MinesBoard {
  level: number;
  columns: number;
  rows: number;
  mines: number;
  /** 每格是不是雷（1 是）。第一次点下去以前全是 0。 */
  mine: Uint8Array;
  /** 雷的花样，见 MINE_KINDS。 */
  kind: Uint8Array;
  /** 周围八格里有几颗雷。 */
  count: Uint8Array;
  /** CELL_HIDDEN / CELL_OPEN / CELL_FLAG。 */
  view: Uint8Array;
  /** 雷埋好了没有。 */
  ready: boolean;
  /** 翻开了几格。 */
  opened: number;
  flags: number;
}

export type MinesEvent =
  | { type: "open"; x: number; y: number; cells: number; score: number }
  | { type: "flag"; x: number; y: number; on: boolean }
  | { type: "boom"; x: number; y: number; kind: number }
  | { type: "clear"; level: number; score: number; seconds: number }
  | { type: "next"; level: number }
  | { type: "timeout" };

export interface MinesState {
  random: number;
  /** 这一局过了多久（秒），过关停顿也算。 */
  time: number;
  /** 倒计时还剩多少秒。 */
  timeLeft: number;
  phase: MinesPhase;
  /** 过关停顿还剩多久。 */
  pause: number;
  board: MinesBoard;
  /** 清完了几关。 */
  boards: number;
  /** 一共翻开了几格（各关加起来）。 */
  cells: number;
  score: number;
  cause: MinesCause | null;
  /** 踩到的那颗雷。 */
  hit: { x: number; y: number; kind: number } | null;
  events: MinesEvent[];
}

function nextRandom(state: { random: number }) {
  // mulberry32
  state.random = (state.random + 0x6d2b79f5) >>> 0;
  let value = state.random;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

/** 第 level 关（从 1 起）的场地和过关加时。 */
export function minesLevel(level: number): MinesLevelSpec {
  const index = Math.max(1, Math.floor(level)) - 1;
  if (index < LEVELS.length) return LEVELS[index];
  const last = LEVELS[LEVELS.length - 1];
  const extra = index - LEVELS.length + 1;
  return { ...last, bonusSeconds: Math.max(MINES_RULES.bonusFloor, last.bonusSeconds - extra * MINES_RULES.bonusDecay) };
}

/** 第 level 关里不是雷的格子数。 */
export function minesSafeCells(level: number) {
  const spec = minesLevel(level);
  return spec.columns * spec.rows - spec.mines;
}

/** 清完前 boards 关一共能拿的过关分。 */
export function minesClearScore(boards: number) {
  let total = 0;
  for (let level = 1; level <= boards; level += 1) total += minesLevel(level).mines * MINES_RULES.mineScore;
  return total;
}

/** 清完 boards 关、一共翻开 cells 格时的分数：分数完全由这两个数决定。 */
export function minesScoreFor(boards: number, cells: number) {
  return cells * MINES_RULES.cellScore + minesClearScore(boards);
}

/** 清完 boards 关时，一共翻开的格子数在什么范围里：前面几关全翻开，正在扫的那一关翻开了 0 到全部减一格。 */
export function minesCellRange(boards: number) {
  let cleared = 0;
  for (let level = 1; level <= boards; level += 1) cleared += minesSafeCells(level);
  return { min: cleared, max: cleared + minesSafeCells(boards + 1) - 1 };
}

/** 清完 boards 关时倒计时最多一共有多少秒（开局的加上每关加的）。 */
export function minesTotalSeconds(boards: number) {
  let total = MINES_RULES.startSeconds;
  for (let level = 1; level <= boards; level += 1) total += minesLevel(level).bonusSeconds;
  return total;
}

export function minesRank(score: number) {
  if (score >= 7000) return "药大排雷王";
  if (score >= 4500) return "扫雷大师";
  if (score >= 2500) return "排雷专家";
  if (score >= 1200) return "熟练工兵";
  if (score >= 400) return "排雷学徒";
  return "扫雷新兵";
}

function emptyBoard(level: number): MinesBoard {
  const spec = minesLevel(level);
  const size = spec.columns * spec.rows;
  return {
    level,
    columns: spec.columns,
    rows: spec.rows,
    mines: spec.mines,
    mine: new Uint8Array(size),
    kind: new Uint8Array(size),
    count: new Uint8Array(size),
    view: new Uint8Array(size),
    ready: false,
    opened: 0,
    flags: 0,
  };
}

export function createMinesState(seed: number): MinesState {
  return {
    random: seed >>> 0,
    time: 0,
    timeLeft: MINES_RULES.startSeconds,
    phase: "play",
    pause: 0,
    board: emptyBoard(1),
    boards: 0,
    cells: 0,
    score: 0,
    cause: null,
    hit: null,
    events: [],
  };
}

const neighborCache = new Map<string, number[][]>();

/** 每一格周围八格的下标，按场地大小存一份。 */
function neighborTable(columns: number, rows: number) {
  const key = columns + "x" + rows;
  let table = neighborCache.get(key);
  if (!table) {
    table = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const list: number[] = [];
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < columns && ny >= 0 && ny < rows) list.push(ny * columns + nx);
          }
        }
        table.push(list);
      }
    }
    neighborCache.set(key, table);
  }
  return table;
}

export function minesNeighbors(board: Pick<MinesBoard, "columns" | "rows">, index: number) {
  return neighborTable(board.columns, board.rows)[index];
}

/**
 * 只靠推理能不能从 start 这一格开始把整块雷区扫完。推理用的是人常用的三条：
 * 一个数字周围剩下的雷和没翻的格子一样多（全是雷）或者已经够了（全安全）；
 * 两个相邻数字比一比，多出来的格子里雷的个数正好等于多出来的格子数；
 * 最后按剩下的总雷数收尾。
 */
export function minesSolvable(board: Pick<MinesBoard, "columns" | "rows" | "mines" | "mine" | "count">, start: number) {
  const { columns, rows, mines, mine, count } = board;
  const size = columns * rows;
  const neighbors = neighborTable(columns, rows);
  // 0 没翻，1 翻开了，2 认定是雷
  const known = new Uint8Array(size);
  let opened = 0;
  let marked = 0;
  const safeTotal = size - mines;
  const stack: number[] = [];
  const open = (index: number) => {
    stack.push(index);
    while (stack.length) {
      const cell = stack.pop()!;
      if (known[cell] !== 0) continue;
      // 推理出的安全格不可能是雷；万一是，说明推理写错了，当作扫不完。
      if (mine[cell]) return false;
      known[cell] = 1;
      opened += 1;
      if (count[cell] === 0) for (const next of neighbors[cell]) if (known[next] === 0) stack.push(next);
    }
    return true;
  };
  const markMine = (index: number) => {
    if (known[index] !== 0) return;
    known[index] = 2;
    marked += 1;
  };
  if (!open(start)) return false;
  const unknownOf = (cell: number) => {
    const list: number[] = [];
    let flagged = 0;
    for (const next of neighbors[cell]) {
      if (known[next] === 0) list.push(next);
      else if (known[next] === 2) flagged += 1;
    }
    return { list, left: count[cell] - flagged };
  };
  while (opened < safeTotal) {
    let progress = false;
    // 第一条：单个数字
    for (let cell = 0; cell < size; cell += 1) {
      if (known[cell] !== 1 || count[cell] === 0) continue;
      const { list, left } = unknownOf(cell);
      if (!list.length) continue;
      if (left === 0) {
        for (const next of list) if (!open(next)) return false;
        progress = true;
      } else if (left === list.length) {
        for (const next of list) markMine(next);
        progress = true;
      }
    }
    if (progress) continue;
    // 第二条：两个数字比一比
    const constraints: Array<{ cell: number; list: number[]; left: number }> = [];
    for (let cell = 0; cell < size; cell += 1) {
      if (known[cell] !== 1 || count[cell] === 0) continue;
      const { list, left } = unknownOf(cell);
      if (list.length) constraints.push({ cell, list, left });
    }
    for (let a = 0; a < constraints.length && !progress; a += 1) {
      const first = constraints[a];
      const ax = first.cell % columns;
      const ay = Math.floor(first.cell / columns);
      for (let b = 0; b < constraints.length; b += 1) {
        if (a === b) continue;
        const second = constraints[b];
        const bx = second.cell % columns;
        const by = Math.floor(second.cell / columns);
        if (Math.abs(ax - bx) > 2 || Math.abs(ay - by) > 2) continue;
        const onlySecond = second.list.filter((cell) => !first.list.includes(cell));
        if (!onlySecond.length) continue;
        const onlyFirst = first.list.filter((cell) => !second.list.includes(cell));
        // second 比 first 多出来的雷正好塞满它独有的格子：这些格子全是雷，first 独有的格子全安全。
        if (second.left - first.left === onlySecond.length) {
          for (const cell of onlySecond) markMine(cell);
          for (const cell of onlyFirst) if (!open(cell)) return false;
          progress = true;
          break;
        }
        // first 的格子全在 second 里，两边雷一样多：second 多出来的格子全安全。
        if (!onlyFirst.length && second.left === first.left) {
          for (const cell of onlySecond) if (!open(cell)) return false;
          progress = true;
          break;
        }
      }
    }
    if (progress) continue;
    // 第三条：按总雷数收尾
    const remaining = mines - marked;
    let hidden = 0;
    for (let cell = 0; cell < size; cell += 1) if (known[cell] === 0) hidden += 1;
    if (remaining === 0 || remaining === hidden) {
      for (let cell = 0; cell < size; cell += 1) {
        if (known[cell] !== 0) continue;
        if (remaining === 0) {
          if (!open(cell)) return false;
        } else markMine(cell);
      }
      continue;
    }
    return false;
  }
  return true;
}

function countMines(board: MinesBoard) {
  const neighbors = neighborTable(board.columns, board.rows);
  for (let cell = 0; cell < board.mine.length; cell += 1) {
    let total = 0;
    for (const next of neighbors[cell]) total += board.mine[next];
    board.count[cell] = total;
  }
}

/** 埋雷：点下去的那一格和它周围八格不放雷，并且只要找得到，就埋一盘只靠推理就能扫完的。 */
function layMines(state: MinesState, board: MinesBoard, start: number) {
  const size = board.columns * board.rows;
  const neighbors = neighborTable(board.columns, board.rows);
  const banned = new Set([start, ...neighbors[start]]);
  const pool: number[] = [];
  for (let cell = 0; cell < size; cell += 1) if (!banned.has(cell)) pool.push(cell);
  for (let attempt = 0; attempt < MINES_RULES.generateAttempts; attempt += 1) {
    board.mine.fill(0);
    for (let pick = 0; pick < board.mines; pick += 1) {
      const swap = pick + Math.floor(nextRandom(state) * (pool.length - pick));
      [pool[pick], pool[swap]] = [pool[swap], pool[pick]];
      board.mine[pool[pick]] = 1;
    }
    countMines(board);
    if (minesSolvable(board, start)) break;
  }
  for (let cell = 0; cell < size; cell += 1) board.kind[cell] = board.mine[cell] ? Math.floor(nextRandom(state) * MINE_KINDS.length) : 0;
  board.ready = true;
}

function inside(board: MinesBoard, x: number, y: number) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < board.columns && y >= 0 && y < board.rows;
}

/** 翻开一格（周围没雷就连着往外翻），返回翻开了几格；踩到雷返回 -1。 */
function reveal(state: MinesState, start: number) {
  const board = state.board;
  if (board.view[start] !== CELL_HIDDEN) return 0;
  if (board.mine[start]) return -1;
  const neighbors = neighborTable(board.columns, board.rows);
  const stack = [start];
  let total = 0;
  while (stack.length) {
    const cell = stack.pop()!;
    if (board.view[cell] !== CELL_HIDDEN || board.mine[cell]) continue;
    board.view[cell] = CELL_OPEN;
    total += 1;
    if (board.count[cell] === 0) for (const next of neighbors[cell]) if (board.view[next] === CELL_HIDDEN) stack.push(next);
  }
  return total;
}

function explode(state: MinesState, cell: number) {
  const board = state.board;
  const x = cell % board.columns;
  const y = Math.floor(cell / board.columns);
  state.phase = "over";
  state.cause = "mine";
  state.hit = { x, y, kind: board.kind[cell] };
  state.events.push({ type: "boom", x, y, kind: board.kind[cell] });
}

function credit(state: MinesState, x: number, y: number, cells: number) {
  if (cells <= 0) return;
  const score = cells * MINES_RULES.cellScore;
  state.board.opened += cells;
  state.cells += cells;
  state.score += score;
  state.events.push({ type: "open", x, y, cells, score });
  if (state.board.opened >= state.board.columns * state.board.rows - state.board.mines) clearBoard(state);
}

function clearBoard(state: MinesState) {
  const board = state.board;
  // 没插旗的雷自动插上，过关画面一目了然。
  for (let cell = 0; cell < board.mine.length; cell += 1) {
    if (board.mine[cell] && board.view[cell] !== CELL_FLAG) {
      board.view[cell] = CELL_FLAG;
      board.flags += 1;
    }
  }
  const spec = minesLevel(board.level);
  const score = board.mines * MINES_RULES.mineScore;
  state.boards += 1;
  state.score += score;
  state.timeLeft += spec.bonusSeconds;
  state.phase = "clear";
  state.pause = MINES_RULES.clearPause;
  state.events.push({ type: "clear", level: board.level, score, seconds: spec.bonusSeconds });
}

/**
 * 点了一下 (x, y)：没翻的格子就翻开（这一关的第一下顺便埋雷）；
 * 翻开的数字周围插够了旗，就把其余的邻格一起翻开。返回这一下有没有起作用。
 */
export function minesOpen(state: MinesState, x: number, y: number) {
  const board = state.board;
  if (state.phase !== "play" || !inside(board, x, y)) return false;
  const cell = y * board.columns + x;
  if (!board.ready) layMines(state, board, cell);
  const view = board.view[cell];
  if (view === CELL_FLAG) return false;
  if (view === CELL_HIDDEN) {
    const cells = reveal(state, cell);
    if (cells < 0) {
      explode(state, cell);
      return true;
    }
    credit(state, x, y, cells);
    return cells > 0;
  }
  // 点在已经翻开的数字上
  const neighbors = neighborTable(board.columns, board.rows);
  let flags = 0;
  let hidden = 0;
  for (const next of neighbors[cell]) {
    if (board.view[next] === CELL_FLAG) flags += 1;
    else if (board.view[next] === CELL_HIDDEN) hidden += 1;
  }
  if (!board.count[cell] || flags !== board.count[cell] || !hidden) return false;
  // 旗插错了的话，先炸的是那颗没插旗的雷。
  for (const next of neighbors[cell]) {
    if (board.view[next] === CELL_HIDDEN && board.mine[next]) {
      explode(state, next);
      return true;
    }
  }
  let cells = 0;
  for (const next of neighbors[cell]) cells += Math.max(0, reveal(state, next));
  credit(state, x, y, cells);
  return cells > 0;
}

/** 在没翻开的格子上插旗或拔旗。雷还没埋的时候不能插。 */
export function minesFlag(state: MinesState, x: number, y: number) {
  const board = state.board;
  if (state.phase !== "play" || !board.ready || !inside(board, x, y)) return false;
  const cell = y * board.columns + x;
  if (board.view[cell] === CELL_OPEN) return false;
  const on = board.view[cell] === CELL_HIDDEN;
  board.view[cell] = on ? CELL_FLAG : CELL_HIDDEN;
  board.flags += on ? 1 : -1;
  state.events.push({ type: "flag", x, y, on });
  return true;
}

/** 时间往前走 delta 秒：倒计时只在扫雷时走，过关停顿时不走。 */
export function minesStep(state: MinesState, delta: number) {
  if (state.phase === "over" || !(delta > 0)) return;
  let left = delta;
  if (state.phase === "clear") {
    // 停顿用不完这一帧的话，余下的时间算到下一关头上，对局时长和倒计时都不多算。
    const used = Math.min(left, state.pause);
    state.pause -= used;
    state.time += used;
    left -= used;
    if (state.pause > 1e-9) return;
    state.pause = 0;
    state.phase = "play";
    state.board = emptyBoard(state.board.level + 1);
    state.events.push({ type: "next", level: state.board.level });
  }
  if (!(left > 0)) return;
  if (left < state.timeLeft) {
    state.time += left;
    state.timeLeft -= left;
    return;
  }
  state.time += state.timeLeft;
  state.timeLeft = 0;
  state.phase = "over";
  state.cause = "time";
  state.events.push({ type: "timeout" });
}

/** 3BV：不插旗、一格一格点，最少要点几下才能扫完。用来估这一关要多久。 */
export function minesClicksNeeded(board: Pick<MinesBoard, "columns" | "rows" | "mine" | "count">) {
  const size = board.columns * board.rows;
  const neighbors = neighborTable(board.columns, board.rows);
  const seen = new Uint8Array(size);
  let clicks = 0;
  for (let cell = 0; cell < size; cell += 1) {
    if (seen[cell] || board.mine[cell] || board.count[cell] !== 0) continue;
    clicks += 1;
    const stack = [cell];
    while (stack.length) {
      const next = stack.pop()!;
      if (seen[next]) continue;
      seen[next] = 1;
      if (board.count[next] === 0) for (const around of neighbors[next]) if (!seen[around] && !board.mine[around]) stack.push(around);
    }
  }
  for (let cell = 0; cell < size; cell += 1) if (!seen[cell] && !board.mine[cell]) clicks += 1;
  return clicks;
}
