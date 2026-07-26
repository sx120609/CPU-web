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
  aiBalance?: number;
  dailyQuota?: number;
  usedToday?: number;
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
