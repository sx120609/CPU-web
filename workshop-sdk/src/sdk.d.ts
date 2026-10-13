export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface GameConfig {
  orientation: "portrait" | "landscape" | "any";
  controls: ("pointer" | "keyboard" | "touch")[];
  aspectRatio?: number;
}
export interface Environment {
  name: string;
  type: "game" | "tool" | "extension";
  version: string;
  theme: "light" | "dark";
  locale: "zh-CN";
  storageAvailable: boolean;
  /** True when a submitted score will be recorded: published work, signed-in player. */
  leaderboardAvailable?: boolean;
  slot: "page" | "splash" | "dialog";
  viewport: { width: number; height: number };
  capabilities: string[];
  motionSupported: boolean;
  game?: GameConfig;
}
export interface SiteInfo {
  name: string;
  locale: "zh-CN";
}
/** Public catalog fields only; no author, account or review metadata. */
export interface PublicWork {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: "game" | "tool" | "extension";
  version: string;
}
export interface PublicWorkCatalog {
  items: PublicWork[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
export interface ListWorksParams {
  q?: string;
  type?: "game" | "tool" | "extension";
  page?: number;
  pageSize?: number;
}
export interface ToastParams {
  message: string;
  type?: "info" | "success" | "warning";
}
export interface CapabilityResult {
  enabled: boolean;
  reason?: string;
}
export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  /** ISO time the player reached this score. */
  achievedAt: string;
  /** The current player's own row. */
  me: boolean;
}
export interface Leaderboard {
  entries: LeaderboardEntry[];
  /** The current player's best score and rank, or null when none is recorded. */
  me: { rank: number; score: number } | null;
  /** Number of players on the board. */
  total: number;
}
/**
 * `recorded` is false in a private preview ("preview") and for visitors who are
 * not signed in ("login"); the game should carry on without a ranking.
 */
export type ScoreResult =
  | { recorded: true; improved: boolean; best: number; rank: number }
  | { recorded: false; reason: "preview" | "login" };
export interface WorkshopEvents {
  pause: { reason?: string };
  resume: { reason?: string };
  show: Record<string, never>;
  hide: Record<string, never>;
  shake: Record<string, never>;
  themechange: { theme: "light" | "dark" };
  resize: { width: number; height: number };
}
export interface WorkshopSDK {
  ready: Promise<{ appId: string }>;
  getEnvironment(): Promise<Environment>;
  getSiteInfo(): Promise<SiteInfo>;
  listWorks(params?: ListWorksParams): Promise<PublicWorkCatalog>;
  showToast(params: ToastParams): Promise<unknown>;
  confirm(params: {
    title: string;
    message: string;
  }): Promise<{ confirmed: boolean }>;
  openPage(target: "workshop" | "games" | "tools"): Promise<unknown>;
  requestFullscreen(): Promise<CapabilityResult>;
  close(): Promise<unknown>;
  requestShake(): Promise<CapabilityResult>;
  /** Needs `leaderboard`. A whole number from 0 to 999999999; higher is better. Only the best is kept. */
  submitScore(score: number): Promise<ScoreResult>;
  /** Needs `leaderboard`. Up to 50 entries (default 20), best first. */
  getLeaderboard(params?: { limit?: number }): Promise<Leaderboard>;
  getSave(): Promise<JSONValue>;
  setSave(value: JSONValue): Promise<unknown>;
  removeSave(): Promise<unknown>;
  /** Serializes mutations within this SDK instance; not a server transaction. */
  updateSave(
    update: (value: JSONValue) => JSONValue | Promise<JSONValue>,
  ): Promise<JSONValue>;
  on<E extends keyof WorkshopEvents>(
    event: E,
    listener: (data: WorkshopEvents[E]) => void,
  ): () => void;
  destroy(): void;
}
export function createWorkshopSDK(options?: {
  timeout?: number;
  interactionTimeout?: number;
}): WorkshopSDK;
export function createLocalPreviewSDK(options: {
  appId: string;
  name?: string;
  type?: "game" | "tool" | "extension";
  version?: string;
  game?: GameConfig;
}): WorkshopSDK;
