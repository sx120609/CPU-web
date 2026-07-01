/**
 * JWT 安全存储：用 Electron safeStorage（系统钥匙串/DPAPI 加密）后落盘
 * 避免明文 token 存在 localStorage 里被任意网页脚本读取
 */
import { safeStorage } from "electron";
import { app } from "electron";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const TOKEN_FILE = join(app.getPath("userData"), "coursebot-token.dat");

export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // 兜底：加密不可用时退化为 base64（弱保护），生产环境应提示用户
    writeFileSync(TOKEN_FILE, Buffer.from(token, "utf8").toString("base64"));
    return;
  }
  const buf = safeStorage.encryptString(token);
  writeFileSync(TOKEN_FILE, buf);
}

export function loadToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const buf = readFileSync(TOKEN_FILE);
    if (!safeStorage.isEncryptionAvailable()) {
      return Buffer.from(buf.toString("utf8"), "base64").toString("utf8");
    }
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function clearToken(): void {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}
