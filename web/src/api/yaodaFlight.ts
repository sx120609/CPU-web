import { request, type RequestOptions } from "./request";

export interface YaodaFlightRankingEntry {
  rank: number;
  userId: number;
  name: string;
  avatar?: string | null;
  bestScore: number;
  games: number;
  totalScore: number;
  achievementCount: number;
  updatedAt?: string | null;
}

export interface YaodaFlightAchievement {
  code: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt?: string | null;
}

export interface YaodaFlightLeaderboard {
  leaderboard: YaodaFlightRankingEntry[];
  me: YaodaFlightRankingEntry | null;
  totalPlayers: number;
  achievements: YaodaFlightAchievement[];
  newlyUnlocked: Array<{ code: string; title: string; icon: string }>;
}

export interface YaodaFlightRecoveryResult extends YaodaFlightLeaderboard {
  recoveredCount: number;
}

export const yaodaFlightApi = {
  leaderboard: (options?: RequestOptions) => request.get<YaodaFlightLeaderboard>(
    "/tools/yaoda-can-fly/leaderboard",
    undefined,
    { cacheTtlMs: 15_000, suppressErrorMessage: true, ...options },
  ),
  recoverHistory: (payload: { release: "20260904-v3" | "20260904-v4" | "20260905-v5"; history: Array<{ score: number; playedAt: string }> }, options?: RequestOptions) =>
    request.post<YaodaFlightRecoveryResult>("/tools/yaoda-can-fly/recover-history", payload, options),
  startAttempt: (options?: RequestOptions) => request.post<{ id: number; startedAt: string }>(
    "/tools/yaoda-can-fly/attempts",
    {},
    options,
  ),
  abandonAttempt: (id: number, options?: RequestOptions) => request.post<{ abandoned: boolean }>(
    `/tools/yaoda-can-fly/attempts/${id}/abandon`,
    {},
    options,
  ),
  finishAttempt: (id: number, payload: { score: number; durationMs: number }, options?: RequestOptions) =>
    request.post<YaodaFlightLeaderboard>(`/tools/yaoda-can-fly/attempts/${id}/finish`, payload, options),
};
