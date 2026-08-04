import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LearningPlatformId } from "./config";

// 学习通账号密码的加密存储，与校园网凭据（campus-net/credential-store.ts）同一套
// 约定：safeStorage 加密、独立文件、默认不存在。密码唯一的去处是学习通登录页的
// 输入框（learning-preload 自动填充），应用外壳只能拿到打码后的账号。
// 只有「记住学习通账号密码」开关（preferences.ts 的 rememberChaoxing）打开时才会写盘。

export type ChaoxingCredential = { account: string; password: string };
export type LearningCredential = ChaoxingCredential;

const credentialPath = (): string => path.join(app.getPath("userData"), "chaoxing-login.bin");

export const readChaoxingCredential = async (): Promise<ChaoxingCredential | null> => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const payload = await readFile(credentialPath());
    const credential = JSON.parse(safeStorage.decryptString(payload)) as ChaoxingCredential;
    return credential.account && credential.password ? credential : null;
  } catch {
    return null;
  }
};

export const writeChaoxingCredential = async (credential: ChaoxingCredential): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法提供安全存储服务");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(credentialPath(), safeStorage.encryptString(JSON.stringify(credential)), { mode: 0o600 });
};

export const clearChaoxingCredential = async (): Promise<void> => {
  await rm(credentialPath(), { force: true });
};

const learningCredentialPath = (platformId: LearningPlatformId): string =>
  platformId === "chaoxing"
    ? credentialPath()
    : path.join(app.getPath("userData"), `learning-login-${platformId}.bin`);

/**
 * 每个平台独立加密、独立文件。超星沿用旧文件名，因此已有用户升级后无需重新登录。
 * 凭据只会由主进程下发给创建它的平台标签，外壳页只能看到打码后的账号。
 */
export const readLearningCredential = async (platformId: LearningPlatformId): Promise<LearningCredential | null> => {
  if (platformId === "chaoxing") return readChaoxingCredential();
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const payload = await readFile(learningCredentialPath(platformId));
    const credential = JSON.parse(safeStorage.decryptString(payload)) as LearningCredential;
    return credential.account && credential.password ? credential : null;
  } catch {
    return null;
  }
};

export const writeLearningCredential = async (
  platformId: LearningPlatformId,
  credential: LearningCredential,
): Promise<void> => {
  if (platformId === "chaoxing") return writeChaoxingCredential(credential);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法提供安全存储服务");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(
    learningCredentialPath(platformId),
    safeStorage.encryptString(JSON.stringify(credential)),
    { mode: 0o600 },
  );
};

export const clearLearningCredential = async (platformId: LearningPlatformId): Promise<void> => {
  if (platformId === "chaoxing") return clearChaoxingCredential();
  await rm(learningCredentialPath(platformId), { force: true });
};

// 工具页显示用。手机号是 11 位，展示成 138****5678；更短的账号只留首尾。
export const maskChaoxingAccount = (account: string): string => {
  if (account.length <= 3) return "***";
  if (account.length <= 7) return `${account.slice(0, 1)}***${account.slice(-1)}`;
  return `${account.slice(0, 3)}****${account.slice(-4)}`;
};

export const maskLearningAccount = maskChaoxingAccount;
