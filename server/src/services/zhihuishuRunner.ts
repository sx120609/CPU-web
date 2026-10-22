import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export type ZhsState = "offline" | "starting" | "qr" | "loading" | "ready" | "running" | "completed" | "stopped" | "error";
const courseSchema = z.object({ key: z.string().max(500), id: z.string().max(400), kind: z.enum(["shared", "hike"]), name: z.string().max(300) });
export type ZhsCourse = z.infer<typeof courseSchema>;
export const speedSchema = z.number().refine(value => [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(value), "请选择 0.5 至 2 倍速");
export const answerPolicySchema = z.object({ autoAnswer: z.boolean(), autoSubmit: z.boolean() }).strict();
export type AnswerPolicy = z.infer<typeof answerPolicySchema>;
export interface ZhsSnapshot {
  speed: number;
  activity: { message: string; updatedAt: string } | null;
  enabled: boolean; state: ZhsState; loggedIn: boolean; message: string;
  qr: string | null; courses: ZhsCourse[]; warnings: string[];
  current: { courseKey: string; title: string; percent: number | null } | null;
  completed: number; total: number; logs: { id: string; at: string; message: string; kind: "info" | "skipped" | "uninspected" }[];
}
const workerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("qr"), image: z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/) }),
  z.object({ type: z.literal("courses"), courses: z.array(courseSchema).max(500), warnings: z.array(z.string().max(300)).max(5) }),
  z.object({ type: z.literal("progress"), courseKey: z.string().max(500), title: z.string().max(300), percent: z.number().min(0).max(100).nullable() }),
  z.object({ type: z.literal("courseDone"), completed: z.number().int().min(0).max(20) }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("activity"), message: z.string().max(300) }),
  z.object({ type: z.literal("notice"), kind: z.enum(["skipped", "uninspected"]), message: z.string().max(600) }),
  z.object({ type: z.literal("error"), message: z.string().max(300) }),
]);
type Entry = { view: ZhsSnapshot; child: ChildProcessWithoutNullStreams | null; dir: string; timer?: NodeJS.Timeout; killTimer?: NodeJS.Timeout; lastLogin: number; busy: boolean };
export class ZhsRunnerError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export class ZhihuishuRunner {
  private entries = new Map<number, Entry>();
  private answerPolicy: AnswerPolicy = { autoAnswer: true, autoSubmit: true };
  private running = false;
  private updateRunning() {
    const running = [...this.entries.values()].some(e => e.view.state === "running");
    if (running !== this.running) {
      this.running = running;
      this.options.onRunningChange?.(running);
    }
  }
  getAnswerPolicy() { return { ...this.answerPolicy }; }
  setAnswerPolicy(policy: AnswerPolicy) {
    const parsed = answerPolicySchema.parse(policy);
    if (parsed.autoSubmit && !parsed.autoAnswer) throw new ZhsRunnerError(400, "请先启用自动作答，再启用自动提交");
    if (JSON.stringify(parsed) !== JSON.stringify(this.answerPolicy)) {
      // Running workers have a policy snapshot: terminate them before changing it.
      for (const e of this.entries.values()) if (e.view.state === "running") this.finish(e, "stopped", "管理员修改了作答设置，本次任务已停止，请重新扫码");
      this.answerPolicy = parsed;
    }
    return this.getAnswerPolicy();
  }
  constructor(private options: { enabled: boolean; python: string; worker: string; packaged?: boolean; maxSessions?: number; loginTimeoutMs?: number; taskTimeoutMs?: number; onRunningChange?: (running: boolean) => void }) {}

  snapshot(userId: number): ZhsSnapshot {
    return structuredClone(this.entries.get(userId)?.view ?? this.blank());
  }
  private blank(): ZhsSnapshot {
    return { speed: 1, activity: null, enabled: this.options.enabled, state: "offline", loggedIn: false, message: this.options.enabled ? "连接智慧树后选择课程" : "在线助手尚未启用，请联系站点管理员", qr: null, courses: [], warnings: [], current: null, completed: 0, total: 0, logs: [] };
  }
  private log(e: Entry, message: string, kind: "info" | "skipped" | "uninspected" = "info") {
    e.view.logs.push({ id: randomUUID(), at: new Date().toISOString(), message, kind });
    e.view.logs = e.view.logs.slice(-500);
  }
  private deadline(e: Entry, ms: number, message: string) {
    clearTimeout(e.timer);
    e.timer = setTimeout(() => this.finish(e, "stopped", message), ms);
    e.timer.unref();
  }
  private send(e: Entry, command: unknown) {
    if (!e.child || !e.child.stdin.writable) throw new ZhsRunnerError(409, "会话已结束，请重新扫码");
    e.child.stdin.write(JSON.stringify(command) + "\n");
  }
  private finish(e: Entry, state: "stopped" | "error", message: string) {
    clearTimeout(e.timer);
    e.busy = false;
    e.view.state = state; e.view.message = message; e.view.loggedIn = false; e.view.qr = null;
    e.view.courses = [];
    this.updateRunning();
    this.log(e, message);
    if (e.child) {
      const child = e.child;
      child.kill("SIGTERM");
      clearTimeout(e.killTimer);
      e.killTimer = setTimeout(() => { if (e.child === child) child.kill("SIGKILL"); }, 2_000);
      e.killTimer.unref();
    }
    // Terminal snapshots expire too; polling never prolongs credential lifetime.
    e.timer = setTimeout(() => {
      for (const [id, entry] of this.entries) if (entry === e && !entry.child) this.entries.delete(id);
    }, 30 * 60_000);
    e.timer.unref();
  }
  login(userId: number): ZhsSnapshot {
    if (!this.options.enabled) throw new ZhsRunnerError(503, "在线助手尚未启用");
    if (!existsSync(this.options.worker)) throw new ZhsRunnerError(503, "执行组件未安装，请联系管理员");
    const previous = this.entries.get(userId);
    if (previous?.child) throw new ZhsRunnerError(409, "请先断开当前会话，再重新扫码");
    if (previous && Date.now() - previous.lastLogin < 10_000) throw new ZhsRunnerError(429, "请稍候再生成二维码");
    if ([...this.entries.values()].filter(e => e.child).length >= (this.options.maxSessions ?? 8)) throw new ZhsRunnerError(503, "当前连接人数已满，请稍后重试");
    if (this.entries.size >= 200 && !previous) throw new ZhsRunnerError(503, "当前服务繁忙，请稍后重试");
    if (previous) clearTimeout(previous.timer);
    const e: Entry = { view: this.blank(), child: null, dir: mkdtempSync(path.join(tmpdir(), "cpu-zhs-")), lastLogin: Date.now(), busy: true };
    this.entries.set(userId, e);
    e.view.state = "starting"; e.view.message = "正在连接智慧树";
    const child = spawn(this.options.python, this.options.packaged ? [] : ["-I", "-u", this.options.worker], {
      cwd: e.dir, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      // Do not leak the site's database, cloud storage or AI credentials to upstream code.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, LANG: "en_US.UTF-8", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });
    e.child = child;
    this.deadline(e, this.options.loginTimeoutMs ?? 180_000, "扫码超时，请重新连接");
    let byteCount = 0;
    child.stdout.on("data", chunk => {
      byteCount += chunk.length;
      if (byteCount > 8_000_000) this.finish(e, "error", "执行组件输出异常，会话已结束");
    });
    // Upstream diagnostics may contain Cookie/one-time codes: never persist or expose stderr.
    child.stderr.resume();
    child.stdin.on("error", () => this.finish(e, "error", "执行组件连接中断，请重新扫码"));
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      if (e.child !== child || ["stopped", "error"].includes(e.view.state)) return;
      try {
        const event = workerEvent.parse(JSON.parse(line));
        switch (event.type) {
          case "ready": this.send(e, { action: "login" }); break;
          case "qr": e.view.state = "qr"; e.view.qr = event.image; e.view.message = "请使用知到 App 扫码并确认登录"; break;
          case "courses":
            e.view.state = "ready"; e.view.loggedIn = true; e.view.qr = null;
            e.view.courses = event.courses; e.view.warnings = event.warnings; e.busy = false;
            e.view.message = "已连接，可以选择课程"; this.log(e, `已读取 ${event.courses.length} 门课程`);
            this.deadline(e, 30 * 60_000, "会话已过期，请重新扫码"); break;
          case "progress": e.view.current = { courseKey: event.courseKey, title: event.title, percent: event.percent }; break;
          case "activity": e.view.activity = { message: event.message, updatedAt: new Date().toISOString() }; break;
          case "notice": this.log(e, event.message, event.kind); break;
          case "courseDone": e.view.completed = event.completed; this.log(e, `已处理 ${event.completed} / ${e.view.total} 门课程`); break;
          case "done":
            e.view.state = "completed"; e.view.message = "任务已结束，请在智慧树核对学习记录"; e.busy = false;
            this.updateRunning();
            this.log(e, e.view.message); this.deadline(e, 30 * 60_000, "会话已过期，请重新扫码"); break;
          case "error": this.finish(e, "error", event.message); break;
        }
      } catch { this.finish(e, "error", "执行组件响应异常，请联系管理员"); }
    });
    child.on("error", () => this.finish(e, "error", "Python 执行环境不可用，请联系管理员"));
    child.on("close", () => {
      lines.close(); clearTimeout(e.killTimer); e.child = null;
      rmSync(e.dir, { recursive: true, force: true });
      if (!["stopped", "error"].includes(e.view.state)) this.finish(e, "error", "执行进程已退出，请重新连接");
    });
    return this.snapshot(userId);
  }
  refresh(userId: number) {
    const e = this.requireReady(userId);
    e.busy = true; e.view.state = "loading"; e.view.message = "正在刷新课程";
    this.deadline(e, 120_000, "读取课程超时，请重新连接");
    this.send(e, { action: "courses" }); return this.snapshot(userId);
  }
  start(userId: number, keys: string[], speed = 1) {
    const e = this.requireReady(userId);
    if (!speedSchema.safeParse(speed).success) throw new ZhsRunnerError(400, "请选择 0.5 至 2 倍速");
    if (!keys.length || keys.length > 20 || new Set(keys).size !== keys.length) throw new ZhsRunnerError(400, "请选择 1 至 20 门课程");
    const courses = keys.map(key => e.view.courses.find(c => c.key === key));
    if (courses.some(c => !c)) throw new ZhsRunnerError(400, "课程不属于当前会话，请刷新列表");
    e.busy = true; e.view.state = "running"; e.view.message = "任务运行中";
    e.view.completed = 0; e.view.total = courses.length; e.view.current = null;
    e.view.speed = speed;
    e.view.activity = { message: "正在启动课程任务", updatedAt: new Date().toISOString() };
    this.log(e, `开始处理 ${courses.length} 门课程，${speed} 倍速；自动作答${this.answerPolicy.autoAnswer ? "开启" : "关闭"}，自动提交${this.answerPolicy.autoSubmit ? "开启" : "关闭"}`);
    this.deadline(e, this.options.taskTimeoutMs ?? 2 * 60 * 60_000, "本次运行已达到两小时上限，请核对进度后重新连接");
    try {
      this.updateRunning();
      this.send(e, { action: "run", courses, speed, ...this.answerPolicy });
    } catch (error) {
      this.finish(e, "error", "启动任务失败，请重新连接");
      throw error;
    }
    return this.snapshot(userId);
  }
  stop(userId: number) {
    const e = this.entries.get(userId);
    if (e) this.finish(e, "stopped", "已停止并清除登录会话；继续使用需要重新扫码");
    return this.snapshot(userId);
  }
  private requireReady(userId: number) {
    const e = this.entries.get(userId);
    if (!e?.child || !e.view.loggedIn) throw new ZhsRunnerError(409, "请先扫码登录智慧树");
    if (e.busy) throw new ZhsRunnerError(409, "已有操作正在进行，请等待或停止");
    return e;
  }
  shutdown() { for (const e of this.entries.values()) { this.finish(e, "stopped", "服务正在重启，请稍后重新连接"); clearTimeout(e.timer); } }
}
let singleton: ZhihuishuRunner | undefined;
export function shutdownZhihuishuRunner() { singleton?.shutdown(); }
export function getZhihuishuRunner() {
  const compiled = path.resolve(__dirname, "../python/zhihuishu/worker.py");
  return singleton ??= new ZhihuishuRunner({
    enabled: process.env.ZHS_WEB_ENABLED === "true",
    python: process.env.ZHS_PYTHON || "python3",
    worker: existsSync(compiled) ? compiled : path.resolve(__dirname, "../../python/zhihuishu/worker.py"),
    maxSessions: Math.max(1, Math.min(32, Number(process.env.ZHS_MAX_SESSIONS) || 8)),
  });
}
