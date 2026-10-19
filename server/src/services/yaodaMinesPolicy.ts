export const YAODA_MINES_MAX_ATTEMPT_MS = 40 * 60 * 1000;
// 下面几个数和页面的引擎（yaodaMinesEngine.ts）是同一组，测试会核对两边一致。
/** 前八关的场地：列数、行数、雷数、过关加几秒。第八关以后场地不变，过关加的时间逐关减少。 */
export const YAODA_MINES_LEVELS: ReadonlyArray<readonly [columns: number, rows: number, mines: number, bonusSeconds: number]> = [
  [8, 8, 8, 15],
  [8, 10, 11, 18],
  [9, 11, 14, 22],
  [9, 12, 17, 25],
  [10, 13, 21, 29],
  [10, 14, 25, 32],
  [10, 15, 29, 36],
  [10, 16, 33, 38],
];
export const YAODA_MINES_START_SECONDS = 60;
export const YAODA_MINES_BONUS_DECAY = 6;
export const YAODA_MINES_BONUS_FLOOR = 3;
/** 翻开一格 1 分；清完一关，这一关每颗雷再给 10 分。 */
export const YAODA_MINES_CELL_SCORE = 1;
export const YAODA_MINES_MINE_SCORE = 10;
/** 过关后停一下再上下一关，这段时间算在对局时长里，倒计时不走。 */
export const YAODA_MINES_CLEAR_PAUSE_MS = 1_600;
/** 一关最快也得点一下。 */
export const YAODA_MINES_MIN_BOARD_MS = 300;
export const YAODA_MINES_MAX_BOARDS = Math.floor(YAODA_MINES_MAX_ATTEMPT_MS / (YAODA_MINES_CLEAR_PAUSE_MS + YAODA_MINES_MIN_BOARD_MS));

export type YaodaMinesAchievementMetric = "games" | "bestScore" | "totalScore" | "bestBoards" | "totalBoards";

export interface YaodaMinesAchievementDefinition {
  code: string;
  title: string;
  description: string;
  icon: string;
  metric: YaodaMinesAchievementMetric;
  target: number;
}

export interface YaodaMinesAchievementStats {
  games: number;
  bestScore: number;
  totalScore: number;
  bestBoards: number;
  totalBoards: number;
}

export const YAODA_MINES_ACHIEVEMENTS: readonly YaodaMinesAchievementDefinition[] = [
  { code: "first_game", title: "初来乍到", description: "完成第一局云端对局", icon: "🌱", metric: "games", target: 1 },
  { code: "boards_2", title: "首战告捷", description: "单局清完 2 关", icon: "🚩", metric: "bestBoards", target: 2 },
  { code: "boards_5", title: "步步为营", description: "单局清完 5 关", icon: "🧭", metric: "bestBoards", target: 5 },
  { code: "boards_8", title: "直抵考场", description: "单局清完 8 关", icon: "📝", metric: "bestBoards", target: 8 },
  { code: "boards_12", title: "一路扫穿", description: "单局清完 12 关", icon: "🧹", metric: "bestBoards", target: 12 },
  { code: "score_500", title: "小有斩获", description: "单局达到 500 分", icon: "💊", metric: "bestScore", target: 500 },
  { code: "score_1500", title: "眼明手快", description: "单局达到 1500 分", icon: "⏰", metric: "bestScore", target: 1500 },
  { code: "score_3000", title: "排雷专家", description: "单局达到 3000 分", icon: "🧪", metric: "bestScore", target: 3000 },
  { code: "score_6000", title: "雷区无双", description: "单局达到 6000 分", icon: "👑", metric: "bestScore", target: 6000 },
  { code: "games_5", title: "再来一局", description: "完成 5 局云端对局", icon: "🔁", metric: "games", target: 5 },
  { code: "games_20", title: "停不下来", description: "完成 20 局云端对局", icon: "🌙", metric: "games", target: 20 },
  { code: "games_50", title: "排雷常驻", description: "完成 50 局云端对局", icon: "💪", metric: "games", target: 50 },
  { code: "total_boards_50", title: "排雷老兵", description: "累计清完 50 关", icon: "🎖", metric: "totalBoards", target: 50 },
  { code: "total_score_30000", title: "三万分俱乐部", description: "累计获得 30000 分", icon: "📚", metric: "totalScore", target: 30000 },
] as const;

/** 第 level 关（从 1 起）：列数、行数、雷数和过关加的秒数。 */
export function yaodaMinesLevel(level: number) {
  const index = Math.max(1, Math.floor(level)) - 1;
  const last = YAODA_MINES_LEVELS[YAODA_MINES_LEVELS.length - 1];
  const [columns, rows, mines, bonus] = YAODA_MINES_LEVELS[Math.min(index, YAODA_MINES_LEVELS.length - 1)];
  const extra = Math.max(0, index - YAODA_MINES_LEVELS.length + 1);
  return {
    columns,
    rows,
    mines,
    bonusSeconds: extra ? Math.max(YAODA_MINES_BONUS_FLOOR, last[3] - extra * YAODA_MINES_BONUS_DECAY) : bonus,
  };
}

function safeCells(level: number) {
  const spec = yaodaMinesLevel(level);
  return spec.columns * spec.rows - spec.mines;
}

/** 清完 boards 关时一共翻开的格子数：前面几关全翻开，正在扫的那一关翻开 0 到全部减一格。 */
export function yaodaMinesCellRange(boards: number) {
  const count = Math.max(0, Math.floor(boards));
  let cleared = 0;
  for (let level = 1; level <= count; level += 1) cleared += safeCells(level);
  return { min: cleared, max: cleared + safeCells(count + 1) - 1 };
}

/** 分数完全由清完的关数和翻开的格子数决定。 */
export function yaodaMinesScoreFor(boards: number, cells: number) {
  let total = Math.max(0, Math.floor(cells)) * YAODA_MINES_CELL_SCORE;
  for (let level = 1; level <= Math.max(0, Math.floor(boards)); level += 1) total += yaodaMinesLevel(level).mines * YAODA_MINES_MINE_SCORE;
  return total;
}

/** 清完 boards 关时，对局最长能有多久：开局的倒计时加上每关加的时间，再加上每次过关的停顿。 */
export function maximumDurationForYaodaMinesBoards(boards: number) {
  const count = Math.max(0, Math.floor(boards));
  let seconds = YAODA_MINES_START_SECONDS;
  for (let level = 1; level <= count; level += 1) seconds += yaodaMinesLevel(level).bonusSeconds;
  return seconds * 1000 + count * YAODA_MINES_CLEAR_PAUSE_MS;
}

/** 清完 boards 关最少要多久：每关至少点一下，再加上过关的停顿。 */
export function minimumDurationForYaodaMinesBoards(boards: number) {
  return Math.max(0, Math.floor(boards)) * (YAODA_MINES_CLEAR_PAUSE_MS + YAODA_MINES_MIN_BOARD_MS);
}

export const YAODA_MINES_MAX_CELLS = yaodaMinesCellRange(YAODA_MINES_MAX_BOARDS).max;
export const YAODA_MINES_MAX_SCORE = yaodaMinesScoreFor(YAODA_MINES_MAX_BOARDS, YAODA_MINES_MAX_CELLS);

export function validateYaodaMinesResult(input: {
  score: number;
  boards: number;
  cells: number;
  durationMs: number;
  serverElapsedMs: number;
}) {
  const { score, boards, cells, durationMs, serverElapsedMs } = input;
  if (!Number.isInteger(score) || score < 0 || score > YAODA_MINES_MAX_SCORE) {
    return "分数超出可提交范围";
  }
  if (!Number.isInteger(boards) || boards < 0 || boards > YAODA_MINES_MAX_BOARDS) {
    return "关数超出可提交范围";
  }
  if (!Number.isInteger(cells) || cells < 0 || cells > YAODA_MINES_MAX_CELLS) {
    return "格子数超出可提交范围";
  }
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > YAODA_MINES_MAX_ATTEMPT_MS) {
    return "对局时长无效";
  }
  if (serverElapsedMs < 0 || serverElapsedMs > YAODA_MINES_MAX_ATTEMPT_MS) {
    return "本局已过期，请重新开始";
  }
  const range = yaodaMinesCellRange(boards);
  if (cells < range.min || cells > range.max) {
    return "格子数与关数不匹配";
  }
  if (score !== yaodaMinesScoreFor(boards, cells)) {
    return "分数与格子数不匹配";
  }
  const minimumDuration = minimumDurationForYaodaMinesBoards(boards);
  if (durationMs + 1_200 < minimumDuration || serverElapsedMs + 1_500 < minimumDuration) {
    return "关数与对局时长不匹配";
  }
  if (durationMs > maximumDurationForYaodaMinesBoards(boards) + 2_000) {
    return "对局时长超出倒计时";
  }
  if (durationMs > serverElapsedMs + 5_000) {
    return "客户端对局时长异常";
  }
  return null;
}

export function yaodaMinesAchievementProgress(
  achievement: YaodaMinesAchievementDefinition,
  stats: YaodaMinesAchievementStats,
) {
  return Math.min(achievement.target, Math.max(0, stats[achievement.metric]));
}

export function earnedYaodaMinesAchievementCodes(stats: YaodaMinesAchievementStats) {
  return YAODA_MINES_ACHIEVEMENTS
    .filter((achievement) => yaodaMinesAchievementProgress(achievement, stats) >= achievement.target)
    .map((achievement) => achievement.code);
}
