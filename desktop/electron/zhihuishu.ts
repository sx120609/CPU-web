import { app } from "electron";
import { ZhihuishuBackgroundPower } from "./zhihuishu-background";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The shared runner is bundled by esbuild, including its validation dependency.
const { ZhihuishuRunner, ZhsRunnerError, answerPolicySchema } = require("../zhihuishu-runner.cjs");
const backgroundPower = new ZhihuishuBackgroundPower();
let runner: InstanceType<typeof ZhihuishuRunner> | undefined;
export const zhihuishuPage = () => path.join(app.getAppPath(), "dist", "zhihuishu", "index.html");
export const isZhihuishuFrame = (url: string) => url.split("#")[0] === pathToFileURL(zhihuishuPage()).href;

export function isAuthorizedZhihuishuRequest(event: Electron.IpcMainInvokeEvent, kind: string | undefined) {
  return kind === "workbench" && event.senderFrame === event.sender.mainFrame && !!event.senderFrame && isZhihuishuFrame(event.senderFrame.url);
}

function getRunner() {
  if (!runner) {
    const executable = process.platform === "win32" ? "cpu-zhs-worker.exe" : "cpu-zhs-worker";
    const worker = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "zhihuishu-runtime", "cpu-zhs-worker", executable);
    runner = new ZhihuishuRunner({ enabled: true, python: worker, worker, packaged: true, maxSessions: 1, onRunningChange: backgroundPower.setRunning });
  }
  return runner!;
}

export function zhihuishuRequest(action: unknown, input: unknown) {
  try {
    const worker = getRunner();
    const settings = () => ({ ...worker.getAnswerPolicy(), canAdmin: true, historyScope: "desktop-local-profile" });
    let value: unknown;
    switch (action) {
      case "session": value = worker.snapshot(1); break;
      case "login": value = worker.login(1); break;
      case "disconnect": value = worker.stop(1); break;
      case "refresh": value = worker.refresh(1); break;
      case "settings": value = settings(); break;
      case "saveSettings": worker.setAnswerPolicy(answerPolicySchema.parse(input)); value = settings(); break;
      case "start": {
        const data = input as { keys?: unknown; speed?: unknown } | null;
        if (!data || !Array.isArray(data.keys) || data.keys.some(key => typeof key !== "string" || key.length > 500) || typeof data.speed !== "number") {
          throw new ZhsRunnerError(400, "课程或速度参数无效");
        }
        value = worker.start(1, data.keys, data.speed);
        break;
      }
      default: throw new ZhsRunnerError(400, "不支持此操作");
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof ZhsRunnerError ? (error as Error).message : "操作失败，请检查设置或重新连接" };
  }
}

export function shutdownZhihuishu() {
  try { runner?.shutdown(); } finally { backgroundPower.setRunning(false); }
}
