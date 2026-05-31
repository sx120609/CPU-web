import type { Request, RequestHandler, Response } from "express";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { config } from "../config";

const MOUNT_PATH = "/filestore";
const TEXT_RESPONSE_RE = /^(text\/|application\/json\b|application\/javascript\b|text\/javascript\b)/i;

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

function healthCheck() {
  return new Promise<boolean>((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: config.filestorePort,
      path: "/api/health",
      method: "GET",
      timeout: 800,
    }, (resp) => {
      resp.resume();
      resolve(Boolean(resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 500));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function waitForHealth(timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Filestore 未能在 ${timeoutMs}ms 内启动`);
}

async function ensureFilestoreStarted() {
  if (!config.filestoreEnabled) throw new Error("Filestore 已通过 FILESTORE_ENABLED=false 禁用");
  if (await healthCheck()) return;
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
  const headers = { ...req.headers, host: `127.0.0.1:${config.filestorePort}` };
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
    proxyToFilestore(req, res);
  } catch (error) {
    res.status(503).send(error instanceof Error ? error.message : "Filestore 暂不可用");
  }
};
