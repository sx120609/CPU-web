import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// 校园网学号密码。与 OAuth 会话分开存，也不与非敏感设置混在一个文件里
// —— 原版把学号密码、SMTP 授权码、代理密码全明文塞进安装目录的 config.yaml。
export type CampusCredential = { studentId: string; password: string };

const credentialPath = (): string => path.join(app.getPath("userData"), "campus-net.bin");

export const readCampusCredential = async (): Promise<CampusCredential | null> => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const payload = await readFile(credentialPath());
    const credential = JSON.parse(safeStorage.decryptString(payload)) as CampusCredential;
    return credential.studentId && credential.password ? credential : null;
  } catch {
    return null;
  }
};

export const writeCampusCredential = async (credential: CampusCredential): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法提供安全存储服务");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(credentialPath(), safeStorage.encryptString(JSON.stringify(credential)), { mode: 0o600 });
};

export const clearCampusCredential = async (): Promise<void> => {
  await rm(credentialPath(), { force: true });
};
