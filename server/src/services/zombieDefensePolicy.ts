// 升级不封顶以后一局能打很久：游戏内时长（暂停不计）上限四小时。
export const ZOMBIE_DEFENSE_MAX_ATTEMPT_MS = 240 * 60 * 1000;
// 从开局到交成绩的真实时间还包括暂停、切后台和锁屏，只拦明显放弃了的对局。
// 防作弊靠的是游戏内时长不能超过真实时间、波次不能早于时间表，与这个上限无关。
export const ZOMBIE_DEFENSE_ATTEMPT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// 波次按固定时间表开始：第 1 波在开局 10 秒，之后每 20 秒一波。页面的引擎用同一组数，测试会核对两边一致。
export const ZOMBIE_DEFENSE_FIRST_WAVE_MS = 10_000;
export const ZOMBIE_DEFENSE_WAVE_MS = 20_000;
export const ZOMBIE_DEFENSE_MAX_WAVES = Math.floor((ZOMBIE_DEFENSE_MAX_ATTEMPT_MS - ZOMBIE_DEFENSE_FIRST_WAVE_MS) / ZOMBIE_DEFENSE_WAVE_MS) + 1;

const BUDGET_BASE = 1;
const BUDGET_LINEAR = 1;
const BUDGET_QUADRATIC = 0.3;
const BIG_WAVE_EVERY = 5;
const BIG_WAVE_FACTOR = 1.4;
const POINTS_PER_BUDGET = 10;

export type ZombieDefenseAchievementMetric = "games" | "bestScore" | "totalScore" | "bestWaves" | "totalWaves";

export interface ZombieDefenseAchievementDefinition {
  code: string;
  title: string;
  description: string;
  icon: string;
  metric: ZombieDefenseAchievementMetric;
  target: number;
}

export interface ZombieDefenseAchievementStats {
  games: number;
  bestScore: number;
  totalScore: number;
  bestWaves: number;
  totalWaves: number;
}

export const ZOMBIE_DEFENSE_ACHIEVEMENTS: readonly ZombieDefenseAchievementDefinition[] = [
  { code: "first_game", title: "开门迎战", description: "完成第一局云端对局", icon: "🌱", metric: "games", target: 1 },
  { code: "waves_3", title: "站稳脚跟", description: "单局坚守到第 3 波", icon: "🌿", metric: "bestWaves", target: 3 },
  { code: "waves_6", title: "固若金汤", description: "单局坚守到第 6 波", icon: "🛡️", metric: "bestWaves", target: 6 },
  { code: "waves_9", title: "一夫当关", description: "单局坚守到第 9 波", icon: "⚔️", metric: "bestWaves", target: 9 },
  { code: "waves_12", title: "药圃守护神", description: "单局坚守到第 12 波", icon: "🏆", metric: "bestWaves", target: 12 },
  { code: "score_300", title: "初战告捷", description: "单局达到 300 分", icon: "💊", metric: "bestScore", target: 300 },
  { code: "score_1000", title: "所向披靡", description: "单局达到 1000 分", icon: "🔥", metric: "bestScore", target: 1000 },
  { code: "score_2000", title: "尸潮终结者", description: "单局达到 2000 分", icon: "👑", metric: "bestScore", target: 2000 },
  { code: "games_5", title: "再战一局", description: "完成 5 局云端对局", icon: "🔁", metric: "games", target: 5 },
  { code: "games_20", title: "夜夜守圃", description: "完成 20 局云端对局", icon: "🌙", metric: "games", target: 20 },
  { code: "games_50", title: "身经百战", description: "完成 50 局云端对局", icon: "💪", metric: "games", target: 50 },
  { code: "total_waves_30", title: "久经沙场", description: "累计坚守 30 波", icon: "🧪", metric: "totalWaves", target: 30 },
  { code: "total_waves_150", title: "百波不倒", description: "累计坚守 150 波", icon: "🏯", metric: "totalWaves", target: 150 },
  { code: "total_score_10000", title: "万分园丁", description: "累计获得 10000 分", icon: "📚", metric: "totalScore", target: 10000 },
] as const;

function waveBudget(wave: number) {
  const base = BUDGET_BASE + BUDGET_LINEAR * wave + BUDGET_QUADRATIC * wave * wave;
  return wave > 0 && wave % BIG_WAVE_EVERY === 0 ? base * BIG_WAVE_FACTOR : base;
}

/** 打到第 waves 波为止最多能拿到的分数：每只僵尸的分数等于它占用的波次预算乘以 10。 */
export function maxZombieDefenseScoreThroughWave(waves: number) {
  let budget = 0;
  for (let wave = 1; wave <= waves; wave += 1) budget += waveBudget(wave);
  return Math.floor(budget * POINTS_PER_BUDGET);
}

export const ZOMBIE_DEFENSE_MAX_SCORE = maxZombieDefenseScoreThroughWave(ZOMBIE_DEFENSE_MAX_WAVES);

/** 第 waves 波最早在对局开始后多久出现。 */
export function minimumDurationForZombieWaves(waves: number) {
  if (waves <= 0) return 0;
  return ZOMBIE_DEFENSE_FIRST_WAVE_MS + (waves - 1) * ZOMBIE_DEFENSE_WAVE_MS;
}

export function validateZombieDefenseResult(input: {
  score: number;
  waves: number;
  durationMs: number;
  serverElapsedMs: number;
}) {
  const { score, waves, durationMs, serverElapsedMs } = input;
  if (!Number.isInteger(score) || score < 0 || score > ZOMBIE_DEFENSE_MAX_SCORE) {
    return "分数超出可提交范围";
  }
  if (!Number.isInteger(waves) || waves < 0 || waves > ZOMBIE_DEFENSE_MAX_WAVES) {
    return "波次超出可提交范围";
  }
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > ZOMBIE_DEFENSE_MAX_ATTEMPT_MS) {
    return "对局时长无效";
  }
  if (serverElapsedMs < 0 || serverElapsedMs > ZOMBIE_DEFENSE_ATTEMPT_TTL_MS) {
    return "本局已过期，请重新开始";
  }
  if (score > maxZombieDefenseScoreThroughWave(waves)) {
    return "分数与波次不匹配";
  }
  const minimumDuration = minimumDurationForZombieWaves(waves);
  if (durationMs + 1_200 < minimumDuration || serverElapsedMs + 1_500 < minimumDuration) {
    return "波次与对局时长不匹配";
  }
  if (durationMs > serverElapsedMs + 5_000) {
    return "客户端对局时长异常";
  }
  return null;
}

export function zombieDefenseAchievementProgress(
  achievement: ZombieDefenseAchievementDefinition,
  stats: ZombieDefenseAchievementStats,
) {
  return Math.min(achievement.target, Math.max(0, stats[achievement.metric]));
}

export function earnedZombieDefenseAchievementCodes(stats: ZombieDefenseAchievementStats) {
  return ZOMBIE_DEFENSE_ACHIEVEMENTS
    .filter((achievement) => zombieDefenseAchievementProgress(achievement, stats) >= achievement.target)
    .map((achievement) => achievement.code);
}

// 本机记下的结束时间来自手机时钟，和服务器差几分钟也认。
export const ZOMBIE_DEFENSE_RECOVERY_CLOCK_SKEW_MS = 10 * 60 * 1000;

export interface ZombieDefenseRecoveryRecord {
  attemptId?: number;
  score: number;
  waves: number;
  playedAt: Date;
}

export interface ZombieDefenseRecoveryAttempt {
  id: number;
  status: string;
  score: number | null;
  waves: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

export type ZombieDefenseRecoveryMatch =
  | { kind: "synced"; attemptId: number }
  | { kind: "recoverable"; attempt: ZombieDefenseRecoveryAttempt; endedAt: Date }
  | null;

/**
 * 给一条本机战绩找它在服务器上的那一局。开局时间只认服务器记下的，结束时间取服务器
 * 能证明的最早时刻：被拒收的局用拒收那一刻，没交上来的局用本机结束时间（再晚也不超过
 * 被新一局顶掉的时刻）。已经计入的局原样返回 synced，不重复记分。
 */
export function matchZombieDefenseRecovery(
  record: ZombieDefenseRecoveryRecord,
  attempts: readonly ZombieDefenseRecoveryAttempt[],
  now: Date,
): ZombieDefenseRecoveryMatch {
  const playedAt = record.playedAt.getTime();
  if (!Number.isFinite(playedAt)) return null;
  const skew = ZOMBIE_DEFENSE_RECOVERY_CLOCK_SKEW_MS;
  const sameAttempt = (attempt: ZombieDefenseRecoveryAttempt) => record.attemptId === undefined || attempt.id === record.attemptId;
  const synced = attempts.find((attempt) => sameAttempt(attempt)
    && attempt.status === "completed"
    && attempt.score === record.score
    && attempt.waves === record.waves
    && (record.attemptId !== undefined || Math.abs((attempt.completedAt?.getTime() ?? 0) - playedAt) <= skew));
  if (synced) return { kind: "synced", attemptId: synced.id };
  let best: { attempt: ZombieDefenseRecoveryAttempt; endedAt: Date } | null = null;
  for (const attempt of attempts) {
    if (!sameAttempt(attempt) || attempt.startedAt.getTime() > playedAt + skew) continue;
    let endedAt: number;
    if (attempt.status === "rejected") {
      if (!attempt.completedAt || Math.abs(attempt.completedAt.getTime() - playedAt) > skew) continue;
      endedAt = attempt.completedAt.getTime();
    } else if (attempt.status === "active" || attempt.status === "abandoned") {
      const closedAt = attempt.completedAt?.getTime() ?? now.getTime();
      if (playedAt > closedAt + skew) continue;
      endedAt = Math.min(closedAt, playedAt + skew);
    } else {
      continue;
    }
    if (endedAt < attempt.startedAt.getTime()) continue;
    if (!best || attempt.startedAt > best.attempt.startedAt) best = { attempt, endedAt: new Date(endedAt) };
  }
  return best ? { kind: "recoverable", ...best } : null;
}
