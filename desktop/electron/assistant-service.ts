import { app } from "electron";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AliyunAssistantProvider, AssistantUpdates, ASSISTANT_KINDS, type AssistantKind, type Component, type AssistantStatus } from "./assistant-updates";
const execute = promisify(execFile);
let updates: AssistantUpdates | undefined;
const listeners = new Set<(kind: AssistantKind, state: AssistantStatus) => void>();
export const workerExecutable = () => path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "zhihuishu-runtime", "cpu-zhs-worker", process.platform === "win32" ? "cpu-zhs-worker.exe" : "cpu-zhs-worker");
export function assistantUpdates() {
  if (!updates) {
    const root = path.join(app.getAppPath(), "dist/assistants");
    const metadata = JSON.parse(readFileSync(path.join(root, "builtin.json"), "utf8"));
    const builtins = Object.fromEntries(ASSISTANT_KINDS.map(kind => [kind, { root: path.join(root, kind), version: metadata[kind].version, sha256: metadata[kind].sha256, source: "builtin" }])) as Record<AssistantKind, Component>;
    updates = new AssistantUpdates({
      cache: path.join(app.getPath("userData"), "assistant-components"), builtins, clientVersion: app.getVersion(), provider: new AliyunAssistantProvider(),
      onState: (kind, state) => { for (const listener of listeners) listener(kind, state); },
      validate: async (kind, directory) => {
        if (kind === "zhihuishu") {
          const result = await execute(workerExecutable(), ["--component-dir", path.join(directory, "worker"), "--check-component"], { timeout: 15000, windowsHide: true, maxBuffer: 8192, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, LANG: "en_US.UTF-8" } });
          if (JSON.parse(result.stdout).type !== "component-ready") throw new Error("组件启动检查失败");
        } else {
          const name = { chaoxing: "monkey.js", multiplatform: "multiplatform.js", weban: "weban.js" }[kind];
          const source = await readFile(path.join(directory, name), "utf8");
          const builtin = await readFile(path.join(root, kind, name), "utf8");
          const permissions = (text: string) => JSON.stringify([...text.matchAll(/^\s*\/\/\s*@(name|match|require|resource|connect)\s+(.+?)\s*$/gm)].map(m => [m[1], m[2]]));
          if (permissions(source) !== permissions(builtin)) throw new Error("组件权限变化需要客户端更新");
          // Parse without running the downloaded script in the main process.
          new Function(source);
        }
      },
    });
  }
  return updates;
}
export function onAssistantState(listener: (kind: AssistantKind, state: AssistantStatus) => void) { listeners.add(listener); }
