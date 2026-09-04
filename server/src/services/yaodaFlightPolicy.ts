export const YAODA_FLIGHT_MAX_SCORE = 200;
export const YAODA_FLIGHT_MAX_ATTEMPT_MS = 45 * 60 * 1000;
export const YAODA_FLIGHT_BUGGY_START_LIMIT_PER_10_MIN = 12;
export const YAODA_FLIGHT_RECOVERY_STARTED_AT_MS = Date.parse("2026-09-04T11:00:00.000Z");
export const YAODA_FLIGHT_RECOVERY_DEADLINE_MS = Date.parse("2026-09-18T16:00:00.000Z");

export type YaodaFlightAchievementMetric = "games" | "bestScore" | "totalScore" | "exactScore";

export interface YaodaFlightAchievementDefinition {
  code: string;
  title: string;
  description: string;
  icon: string;
  metric: YaodaFlightAchievementMetric;
  target: number;
}

export interface YaodaFlightAchievementStats {
  games: number;
  bestScore: number;
  totalScore: number;
  currentScore?: number;
}

export const YAODA_FLIGHT_ACHIEVEMENTS: readonly YaodaFlightAchievementDefinition[] = [
  { code: "first_flight", title: "起飞许可", description: "完成第一局云端飞行", icon: "🛫", metric: "games", target: 1 },
  { code: "first_gate", title: "初次穿越", description: "单局穿过 1 组装置", icon: "💊", metric: "bestScore", target: 1 },
  { code: "score_5", title: "五关斩药", description: "单局达到 5 分", icon: "🌿", metric: "bestScore", target: 5 },
  { code: "score_10", title: "一飞冲天", description: "单局达到 10 分", icon: "🚀", metric: "bestScore", target: 10 },
  { code: "score_20", title: "实验室王牌", description: "单局达到 20 分", icon: "⚗️", metric: "bestScore", target: 20 },
  { code: "score_30", title: "药学传奇", description: "单局达到 30 分", icon: "🏆", metric: "bestScore", target: 30 },
  { code: "games_5", title: "再接再厉", description: "完成 5 局云端飞行", icon: "🪽", metric: "games", target: 5 },
  { code: "games_20", title: "熟能生巧", description: "完成 20 局云端飞行", icon: "🎯", metric: "games", target: 20 },
  { code: "games_50", title: "百炼成药", description: "完成 50 局云端飞行", icon: "🧪", metric: "games", target: 50 },
  { code: "total_50", title: "积少成多", description: "累计穿越 50 组装置", icon: "📚", metric: "totalScore", target: 50 },
  { code: "total_200", title: "济群之翼", description: "累计穿越 200 组装置", icon: "🌏", metric: "totalScore", target: 200 },
  { code: "total_500", title: "长空巡航", description: "累计穿越 500 组装置", icon: "☁️", metric: "totalScore", target: 500 },
  { code: "exact_8", title: "八味灵方", description: "单局恰好获得 8 分", icon: "🎱", metric: "exactScore", target: 8 },
  { code: "exact_16", title: "杏林十六", description: "单局恰好获得 16 分", icon: "✨", metric: "exactScore", target: 16 },
] as const;

export function minimumDurationForFlightScore(score: number) {
  if (score <= 0) return 0;
  return 2_800 + (score - 1) * 1_100;
}

export function isRecoverableYaodaFlightHistoryItem(input: {
  score: number;
  playedAtMs: number;
  nowMs: number;
  attemptStartedAtMs: number[];
}) {
  if (
    input.nowMs > YAODA_FLIGHT_RECOVERY_DEADLINE_MS
    || input.playedAtMs < YAODA_FLIGHT_RECOVERY_STARTED_AT_MS
    || input.playedAtMs > input.nowMs + 5 * 60 * 1000
  ) {
    return false;
  }
  const estimatedStartedAtMs = input.playedAtMs - minimumDurationForFlightScore(input.score);
  const recentWindowStartedAtMs = estimatedStartedAtMs - 10 * 60 * 1000;
  const recentAttempts = input.attemptStartedAtMs.filter((startedAtMs) => (
    startedAtMs >= recentWindowStartedAtMs && startedAtMs <= input.playedAtMs
  )).length;
  return recentAttempts >= YAODA_FLIGHT_BUGGY_START_LIMIT_PER_10_MIN;
}

export function validateYaodaFlightResult(input: {
  score: number;
  durationMs: number;
  serverElapsedMs: number;
}) {
  const { score, durationMs, serverElapsedMs } = input;
  if (!Number.isInteger(score) || score < 0 || score > YAODA_FLIGHT_MAX_SCORE) {
    return "分数超出可提交范围";
  }
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > YAODA_FLIGHT_MAX_ATTEMPT_MS) {
    return "飞行时长无效";
  }
  if (serverElapsedMs < 0 || serverElapsedMs > YAODA_FLIGHT_MAX_ATTEMPT_MS) {
    return "本局已过期，请重新开始";
  }
  const minimumDuration = minimumDurationForFlightScore(score);
  if (durationMs + 1_200 < minimumDuration || serverElapsedMs + 1_500 < minimumDuration) {
    return "分数与飞行时长不匹配";
  }
  if (durationMs > serverElapsedMs + 5_000) {
    return "客户端飞行时长异常";
  }
  return null;
}

export function publicFlightName(nickname: string | null | undefined) {
  const normalized = String(nickname || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 24);
  return normalized || "药大同学";
}

export function yaodaFlightAchievementProgress(
  achievement: YaodaFlightAchievementDefinition,
  stats: YaodaFlightAchievementStats,
) {
  if (achievement.metric === "exactScore") {
    return stats.currentScore === achievement.target ? achievement.target : 0;
  }
  return Math.min(achievement.target, Math.max(0, stats[achievement.metric]));
}

export function earnedYaodaFlightAchievementCodes(stats: YaodaFlightAchievementStats) {
  return YAODA_FLIGHT_ACHIEVEMENTS
    .filter((achievement) => yaodaFlightAchievementProgress(achievement, stats) >= achievement.target)
    .map((achievement) => achievement.code);
}
