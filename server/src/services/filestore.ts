import type { Request, RequestHandler, Response } from "express";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { config } from "../config";
import { prisma } from "../prisma";
import { hasToolManagerPermission } from "./serviceTools";
import { verifyToken } from "../utils/jwt";

const MOUNT_PATH = "/filestore";
const TEXT_RESPONSE_RE = /^(text\/|application\/json\b|application\/javascript\b|text\/javascript\b)/i;
const TRUSTED_PROXY_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

let filestoreProcess: ChildProcess | null = null;
let startupPromise: Promise<void> | null = null;

function filestoreRoot() {
  const candidates = [
    path.resolve(process.cwd(), "filestore"),
    path.resolve(process.cwd(), "server", "filestore"),
    path.resolve(__dirname, "../../filestore"),
  ];
  const root = candidates.find((candidate) => existsSync(path.join(candidate, "app.py")));
  if (!root) throw new Error("未找到 server/filestore/app.py");
  return root;
}

function pythonCommand() {
  if (config.filestorePython) return { command: config.filestorePython, args: [] as string[] };
  if (process.platform === "win32") return { command: "python", args: [] as string[] };
  return { command: "python3", args: [] as string[] };
}

function requestStatus(targetPath: string, headers: Record<string, string> = {}) {
  return new Promise<number>((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: config.filestorePort,
      path: targetPath,
      method: "GET",
      headers,
      timeout: 800,
    }, (resp) => {
      resp.resume();
      resolve(resp.statusCode ?? 0);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}

async function healthCheck() {
  const status = await requestStatus("/api/health");
  return status >= 200 && status < 500;
}

async function trustedProxyCheck() {
  const status = await requestStatus("/api/admin/me", { "X-CPU-Filestore-Admin": TRUSTED_PROXY_TOKEN });
  return status >= 200 && status < 300;
}

async function waitForHealth(timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck() && await trustedProxyCheck()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Filestore 未能在 ${timeoutMs}ms 内启动`);
}

async function ensureFilestoreStarted() {
  if (!config.filestoreEnabled) throw new Error("Filestore 已通过 FILESTORE_ENABLED=false 禁用");
  if (await healthCheck()) {
    if (await trustedProxyCheck()) return;
    throw new Error(`Filestore 端口 ${config.filestorePort} 正在运行旧实例，请重启 CPU-web 后端或停止旧的 python app.py 进程`);
  }
  if (startupPromise) return startupPromise;

  startupPromise = (async () => {
    const root = filestoreRoot();
    const python = pythonCommand();
    filestoreProcess = spawn(python.command, [...python.args, "app.py"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(config.filestorePort),
        FILESTORE_ADMIN_PASSWORD: process.env.FILESTORE_ADMIN_PASSWORD ?? config.filestoreAdminPassword,
        FILESTORE_TRUSTED_PROXY_TOKEN: TRUSTED_PROXY_TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    filestoreProcess.stdout?.on("data", (data) => {
      String(data).trim().split(/\r?\n/).filter(Boolean).forEach((line) => console.log(`[filestore] ${line}`));
    });
    filestoreProcess.stderr?.on("data", (data) => {
      String(data).trim().split(/\r?\n/).filter(Boolean).forEach((line) => console.warn(`[filestore] ${line}`));
    });
    filestoreProcess.on("exit", (code, signal) => {
      filestoreProcess = null;
      startupPromise = null;
      if (code !== 0 && signal !== "SIGTERM") console.warn(`Filestore 已退出: code=${code} signal=${signal ?? ""}`);
    });

    await waitForHealth();
  })();

  return startupPromise;
}

function upstreamPath(req: Request) {
  const original = req.originalUrl || req.url || "/";
  const withoutMount = original.replace(new RegExp(`^${MOUNT_PATH}(?=/|$)`), "") || "/";
  return withoutMount.startsWith("/") ? withoutMount : `/${withoutMount}`;
}

function isPublicFilestoreRequest(req: Request) {
  const target = upstreamPath(req).split("?")[0];
  if (req.method === "GET" && target === "/api/health") return true;
  if (req.method === "GET" && /^\/api\/public\/(tasks|status)\/[A-Za-z0-9_-]+$/.test(target)) return true;
  if (req.method === "POST" && /^\/api\/submit\/[A-Za-z0-9_-]+$/.test(target)) return true;
  return !target.startsWith("/api/");
}

async function platformUserFromRequest(req: Request) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, role: true, status: true },
    });
    if (!user || user.status === "banned") return null;
    return {
      ...payload,
      studentId: user.username,
      role: user.role,
    };
  } catch {
    return null;
  }
}

async function assertFilestoreAdmin(req: Request, res: Response) {
  if (isPublicFilestoreRequest(req)) return true;
  const user = await platformUserFromRequest(req);
  if (!user?.userId) {
    res.status(401).json({ error: "请先登录平台账号" });
    return false;
  }
  if (!(await hasToolManagerPermission("file_collect", user))) {
    res.status(403).json({ error: "没有文件收集管理权限" });
    return false;
  }
  return true;
}

function rewriteText(body: string) {
  return body
    .replace(/((?:href|src)=["'])\/(styles\.css|admin\.js|submit\.js|status\.js)(["'])/g, `$1${MOUNT_PATH}/$2$3`)
    .replace(/(["'`])\/api\//g, `$1${MOUNT_PATH}/api/`)
    .replace(/(["'`])\/submit\//g, `$1${MOUNT_PATH}/submit/`)
    .replace(/(["'`])\/status\//g, `$1${MOUNT_PATH}/status/`)
    .replace(/\$\{base\}\/status\//g, `\${base}${MOUNT_PATH}/status/`)
    .replace(/\$\{base\}\/submit\//g, `\${base}${MOUNT_PATH}/submit/`);
}

function rewriteHeaderValue(name: string, value: number | string | string[]): string | string[] {
  if (Array.isArray(value)) return value.map((item) => String(rewriteHeaderValue(name, item)));
  const text = String(value);
  if (name.toLowerCase() === "set-cookie") return text.replace(/;\s*Path=\//i, `; Path=${MOUNT_PATH}`);
  if (name.toLowerCase() === "location" && text.startsWith("/")) return `${MOUNT_PATH}${text}`;
  return text;
}

function writeHeaders(res: Response, upstream: http.IncomingMessage, rewrittenBody?: Buffer) {
  res.status(upstream.statusCode ?? 502);
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined) continue;
    if (name.toLowerCase() === "connection") continue;
    if (rewrittenBody && name.toLowerCase() === "content-length") continue;
    res.setHeader(name, rewriteHeaderValue(name, value));
  }
  if (rewrittenBody) res.setHeader("content-length", String(rewrittenBody.byteLength));
}

function proxyToFilestore(req: Request, res: Response) {
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${config.filestorePort}`,
    "x-cpu-filestore-admin": TRUSTED_PROXY_TOKEN,
  };
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: config.filestorePort,
    path: upstreamPath(req),
    method: req.method,
    headers,
  }, (upstreamRes) => {
    const contentType = String(upstreamRes.headers["content-type"] ?? "");
    const shouldRewrite = TEXT_RESPONSE_RE.test(contentType);
    if (!shouldRewrite) {
      writeHeaders(res, upstreamRes);
      upstreamRes.pipe(res);
      return;
    }

    const chunks: Buffer[] = [];
    upstreamRes.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    upstreamRes.on("end", () => {
      const source = Buffer.concat(chunks).toString("utf8");
      const body = Buffer.from(rewriteText(source), "utf8");
      writeHeaders(res, upstreamRes, body);
      res.end(body);
    });
  });

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).send(`Filestore 代理失败：${error.message}`);
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

export const filestoreProxy: RequestHandler = async (req, res) => {
  try {
    await ensureFilestoreStarted();
    if (!(await assertFilestoreAdmin(req, res))) return;
    proxyToFilestore(req, res);
  } catch (error) {
    res.status(503).send(error instanceof Error ? error.message : "Filestore 暂不可用");
  }
};
