import { request, type RequestOptions } from "./request";

export interface YaodaMinesRankingEntry {
  rank: number;
  userId: number;
  name: string;
  avatar?: string | null;
  bestScore: number;
  bestBoards: number;
  games: number;
  totalScore: number;
  totalBoards: number;
  achievementCount: number;
  updatedAt?: string | null;
}

export interface YaodaMinesAchievement {
  code: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt?: string | null;
}

export interface YaodaMinesLeaderboard {
  leaderboard: YaodaMinesRankingEntry[];
  me: YaodaMinesRankingEntry | null;
  totalPlayers: number;
  achievements: YaodaMinesAchievement[];
  newlyUnlocked: Array<{ code: string; title: string; icon: string }>;
}

export const yaodaMinesApi = {
  leaderboard: (options?: RequestOptions) => request.get<YaodaMinesLeaderboard>(
    "/tools/yaoda-mines/leaderboard",
    undefined,
    { cacheTtlMs: 15_000, suppressErrorMessage: true, ...options },
  ),
  startAttempt: (options?: RequestOptions) => request.post<{ id: number; startedAt: string }>(
    "/tools/yaoda-mines/attempts",
    {},
    options,
  ),
  abandonAttempt: (id: number, options?: RequestOptions) => request.post<{ abandoned: boolean }>(
    `/tools/yaoda-mines/attempts/${id}/abandon`,
    {},
    options,
  ),
  finishAttempt: (id: number, payload: { score: number; boards: number; cells: number; durationMs: number }, options?: RequestOptions) =>
    request.post<YaodaMinesLeaderboard>(`/tools/yaoda-mines/attempts/${id}/finish`, payload, options),
};
