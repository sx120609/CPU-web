import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export class JsonStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed.version !== 1 || typeof parsed.domains !== "object") {
        throw new Error("Unsupported CDN certificate state file");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, domains: {} };
      throw error;
    }
  }

  async save(state) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.filePath);
  }

  async acquireLock() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let handle;
    try {
      handle = await open(this.lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Another CDN certificate run holds ${this.lockPath}; inspect it before removing a stale lock`);
      }
      throw error;
    } finally {
      await handle?.close();
    }
    return async () => rm(this.lockPath, { force: true });
  }
}
