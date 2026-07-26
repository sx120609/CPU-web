import { app } from "electron";
import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { redactUrl } from "./protocol";

// 日志一律先脱敏再落地。原版把含明文密码的完整登录 URL 直接写进文件并显示在界面上，
// 而"不写明文"这道防线还挂在一个用户可开的开关上。这里无条件生效。

export type LogEntry = { at: number; level: "info" | "warn" | "error"; message: string };

const MAX_ENTRIES = 500;
const RETENTION_DAYS = 14;

const buffer: LogEntry[] = [];
let listener: ((entry: LogEntry) => void) | undefined;

const logDir = (): string => path.join(app.getPath("userData"), "logs");

const dayStamp = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const persist = async (entry: LogEntry): Promise<void> => {
  try {
    const directory = logDir();
    await mkdir(directory, { recursive: true });
    const stamp = new Date(entry.at);
    const line = `${stamp.toISOString()} [${entry.level}] ${entry.message}\n`;
    await appendFile(path.join(directory, `campus-net-${dayStamp(stamp)}.log`), line, "utf8");
  } catch {
    // 写日志失败绝不能再记一条日志，那会递归
  }
};

export const campusLog = (level: LogEntry["level"], message: string): void => {
  const entry: LogEntry = { at: Date.now(), level, message: redactUrl(message) };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  listener?.(entry);
  void persist(entry);
};

export const readCampusLogs = (limit = 200): LogEntry[] => buffer.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES)));

export const onCampusLog = (callback: (entry: LogEntry) => void): void => {
  listener = callback;
};

// 原版按月一个文件写在安装目录里，永久累积、从不清理。
export const pruneCampusLogs = async (): Promise<void> => {
  try {
    const directory = logDir();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    for (const name of await readdir(directory)) {
      if (!name.startsWith("campus-net-") || !name.endsWith(".log")) continue;
      const file = path.join(directory, name);
      const info = await stat(file);
      if (info.mtimeMs < cutoff) await rm(file, { force: true });
    }
  } catch {
    // 目录还不存在等情况直接跳过
  }
};
