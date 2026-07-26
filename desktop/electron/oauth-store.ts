import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type OAuthSession = {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  scope: string;
  user?: OAuthUser;
};

export type OAuthUser = {
  sub?: string;
  user?: string;
  nickname?: string;
  name?: string;
  username?: string;
  level?: string;
  levelName?: string;
  /** = 今日剩余 + AI 点数。服务端叫 totalRemaining，不是单纯的日剩余 */
  aiBalance?: number;
  dailyQuota?: number;
  usedToday?: number;
  /** 只算日额度的剩余，不含点数 */
  dailyRemaining?: number;
  /** AI 点数：日额度用完后 1 点抵 1 次，不过期 */
  assistantPoints?: number;
  /** 信誉分 —— 等级由它决定，等级又决定每日免费次数 */
  reputation?: number;
  /** 距下一级还差多少分；已满级时没有这个值 */
  nextLevelNeed?: number;
  nextLevelName?: string;
  /** 信誉分的构成，用来告诉用户哪一项还有涨的空间 */
  agePoints?: number;
  postPoints?: number;
  replyPoints?: number;
  forumPoints?: number;
};

const sessionPath = (): string => path.join(app.getPath("userData"), "oauth.bin");

// 不判断有效期，供上层区分"从未登录"与"登录已过期"
export const peekOAuthSession = async (): Promise<OAuthSession | null> => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const payload = await readFile(sessionPath());
    const session = JSON.parse(safeStorage.decryptString(payload)) as OAuthSession;
    return session.accessToken && session.expiresAt ? session : null;
  } catch {
    return null;
  }
};

export const readOAuthSession = async (): Promise<OAuthSession | null> => {
  const session = await peekOAuthSession();
  return session && session.expiresAt > Date.now() ? session : null;
};

export const writeOAuthSession = async (session: OAuthSession): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法提供安全存储服务");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(sessionPath(), safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 });
};

export const clearOAuthSession = async (): Promise<void> => {
  await rm(sessionPath(), { force: true });
};
