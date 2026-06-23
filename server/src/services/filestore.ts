import express, { type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rename, rm, unlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import QRCode from "qrcode";
import { config } from "../config";
import { prisma } from "../prisma";
import { hasToolContentManagePermission, hasToolManagerPermission } from "./serviceTools";
import { getSiteFilingNumber } from "./siteSettings";
import { verifyToken } from "../utils/jwt";
import { requestAiJson } from "./topicAiReview";
import {
  createRemoteMediaUploadSession,
  deleteMediaAsset,
  ensureMediaLocalPathFromUploadUrl,
  shouldUseRemoteMediaStorageForRelativePath,
} from "./mediaStorage";
import {
  getOneDriveChinaItemMetadata,
  resolveOneDriveChinaDirectDownloadUrl,
  resolveOneDriveChinaPreviewUrl,
} from "./oneDriveChina";
import { getMediaStorageRuntimeConfig } from "./storageConfig";
import { repairFileCollectTaskFilenames } from "./fileCollectFilenameRepair";
import {
  buildOfficeViewerUrl,
  canUseOfficeWebViewer,
  isOfficePreviewFile,
  joinPublicUrl,
  officeWebViewerLimitMessage,
  requestPublicOrigin,
  signFileCollectPreviewToken,
  verifyFileCollectPreviewToken,
} from "../utils/officePreview";
import { normalizeMulterOriginalNames, normalizeUploadOriginalName } from "../utils/uploadFilename";

const MOUNT_PATH = "/filestore";
const TEXT_RESPONSE_RE = /^(text\/|application\/json\b|application\/javascript\b|text\/javascript\b)/i;
const TRUSTED_PROXY_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const FILESTORE_SITE_TITLE_DEFAULT = "药大拾间文件收集";
const FILESTORE_SITE_TITLE_KEY = "filestore.siteTitle";
const FILESTORE_SITE_URL_KEY = "filestore.siteUrl";
const FILESTORE_TEMPLATE_VISIBILITY = "filestore-global";
const fileCollectTmpDir = path.resolve(process.cwd(), "uploads", "file-collect", "_tmp");

mkdirSync(fileCollectTmpDir, { recursive: true });

const filestoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, fileCollectTmpDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(normalizeUploadOriginalName(file.originalname))}`),
  }),
  limits: {
    files: 20,
    fileSize: 100 * 1024 * 1024,
    fieldSize: 1024 * 1024,
  },
});

let filestoreProcess: ChildProcess | null = null;
let startupPromise: Promise<void> | null = null;

type PlatformFilestoreUser = {
  userId: number;
  username: string;
  nickname: string;
  role: string;
  studentId: string;
  campus: string;
};

type FilestoreAccessUser = PlatformFilestoreUser & {
  isToolManager: boolean;
};

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
  if (req.method === "GET" && target === "/api/platform/site-config") return true;
  if (req.method === "GET" && target === "/api/qrcode") return true;
  if (req.method === "GET" && /^\/api\/public\/(tasks|status)\/[A-Za-z0-9_-]+$/.test(target)) return true;
  if (req.method === "GET" && /^\/api\/files\/\d+\/public-preview(?:\/[^/]+)?$/.test(target)) return true;
  if (req.method === "POST" && /^\/api\/submit\/[A-Za-z0-9_-]+$/.test(target)) return true;
  if (req.method === "POST" && /^\/api\/submit\/[A-Za-z0-9_-]+\/(prepare-remote|complete-remote)$/.test(target)) return true;
  return !target.startsWith("/api/");
}

async function platformUserFromRequest(req: Request) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, nickname: true, role: true, status: true },
    });
    if (!user || user.status === "banned") return null;
    return {
      ...payload,
      studentId: user.username,
      username: user.username,
      nickname: user.nickname || user.username,
      role: user.role,
    } satisfies PlatformFilestoreUser;
  } catch {
    return null;
  }
}

async function assertFilestoreAccess(req: Request, res: Response): Promise<FilestoreAccessUser | null | false> {
  if (isPublicFilestoreRequest(req)) return null;
  const user = await platformUserFromRequest(req);
  if (!user?.userId) {
    res.status(401).json({ error: "请先登录平台账号" });
    return false;
  }
  const isToolManager = await hasToolManagerPermission("file_collect", user);
  if (!isToolManager && !(await hasToolContentManagePermission("file_collect", user))) {
    res.status(403).json({ error: "没有文件收集管理权限" });
    return false;
  }
  return { ...user, isToolManager };
}

function encodeFilestoreHeaderValue(value?: string | null) {
  return encodeURIComponent(String(value ?? ""));
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

function queryStringValue(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

class FilestoreApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type FilestoreField = {
  id: string;
  key: string;
  label: string;
  required: boolean;
  pattern: string;
  placeholder: string;
};

type FilestoreRules = {
  allowedTypes: string[];
  maxSizeMb: number;
  maxCount: number;
};

function filestoreApiError(status: number, message: string) {
  return new FilestoreApiError(status, message);
}

function sendFilestoreApiError(res: Response, error: unknown) {
  const status = error instanceof FilestoreApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "请求失败";
  res.status(status).json({ error: message });
}

async function parseFilestoreJsonBody(req: Request, res: Response) {
  await new Promise<void>((resolve, reject) => {
    express.json({ limit: "10mb" })(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  return (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
}

async function parseFilestoreUpload(req: Request, res: Response) {
  return new Promise<Express.Multer.File[]>((resolve, reject) => {
    filestoreUpload.array("files", 20)(req, res, (err) => {
      if (err) reject(err);
      else resolve(normalizeMulterOriginalNames((req.files as Express.Multer.File[] | undefined) ?? []));
    });
  });
}

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]));
  } catch {
    return {};
  }
}

function normalizeSiteTitle(value: unknown) {
  const title = String(value ?? "").trim();
  if (!title || /^filestore(?:\s|$)/i.test(title)) return FILESTORE_SITE_TITLE_DEFAULT;
  return title.slice(0, 80);
}

function normalizeSiteUrl(value: unknown) {
  return String(value ?? "").trim().replace(/\/+$/, "").slice(0, 240);
}

function buildFilestorePublicUrl(base: string, mountedPath: string) {
  const normalizedBase = normalizeSiteUrl(base);
  if (!normalizedBase) return "";
  let targetPath = mountedPath.startsWith("/") ? mountedPath : `/${mountedPath}`;
  try {
    const url = new URL(normalizedBase);
    const basePath = url.pathname.replace(/\/+$/, "");
    if (basePath.endsWith(MOUNT_PATH) && targetPath.startsWith(`${MOUNT_PATH}/`)) {
      targetPath = targetPath.slice(MOUNT_PATH.length) || "/";
    }
  } catch {
    // Invalid configured URLs are ignored by joinPublicUrl below.
  }
  return joinPublicUrl(normalizedBase, targetPath);
}

function normalizeFieldKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeFilestoreFields(input: unknown): FilestoreField[] {
  if (!Array.isArray(input) || !input.length) throw filestoreApiError(400, "至少需要一个表单字段");
  const seen = new Set<string>();
  return input.map((item) => {
    const field = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const key = normalizeFieldKey(field.key ?? field.id);
    const label = String(field.label ?? "").trim().slice(0, 80);
    if (!key || !label) throw filestoreApiError(400, "字段 key 和名称不能为空");
    if (seen.has(key)) throw filestoreApiError(400, `字段 key 重复：${key}`);
    const pattern = String(field.pattern ?? "").trim().slice(0, 200);
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch {
        throw filestoreApiError(400, `字段“${label}”的正则规则不合法`);
      }
    }
    seen.add(key);
    return {
      id: key,
      key,
      label,
      required: field.required !== false,
      pattern,
      placeholder: String(field.placeholder ?? "").trim().slice(0, 120),
    };
  });
}

function storedFields(fields: FilestoreField[]) {
  return fields.map((field) => ({
    id: field.key,
    label: field.label,
    required: field.required,
    pattern: field.pattern,
    placeholder: field.placeholder,
  }));
}

function parseStoredFields(raw: string | null | undefined): FilestoreField[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return normalizeFilestoreFields(Array.isArray(parsed)
      ? parsed.map((item) => ({ ...item, key: item?.key ?? item?.id }))
      : []);
  } catch {
    return [];
  }
}

function normalizeAllowedTypes(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return [...new Set(list
    .map((item) => String(item ?? "").trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9]+$/.test(item))
    .slice(0, 30))];
}

function normalizeFilestoreRules(input: unknown): FilestoreRules {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const maxSizeMb = Number(source.maxSizeMb || 20);
  const maxCount = Number(source.maxCount || 1);
  if (!Number.isFinite(maxSizeMb) || maxSizeMb <= 0 || maxSizeMb > 100) {
    throw filestoreApiError(400, "单文件大小必须在 0 到 100 MB 之间");
  }
  if (!Number.isInteger(maxCount) || maxCount <= 0 || maxCount > 20) {
    throw filestoreApiError(400, "文件数量必须在 1 到 20 个之间");
  }
  return {
    allowedTypes: normalizeAllowedTypes(source.allowedTypes),
    maxSizeMb,
    maxCount,
  };
}

function parseStoredRules(raw: string | null | undefined): FilestoreRules {
  try {
    return normalizeFilestoreRules(JSON.parse(raw || "{}"));
  } catch {
    return { allowedTypes: [], maxSizeMb: 20, maxCount: 1 };
  }
}

function normalizeDeadline(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw filestoreApiError(400, "截止时间不合法");
  return date;
}

function isoDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeStatus(value: unknown) {
  const status = String(value ?? "open").trim();
  return status === "closed" ? "closed" : "open";
}

function normalizeFilestoreTaskPayload(input: Record<string, unknown>) {
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) throw filestoreApiError(400, "任务标题不能为空");
  const fields = normalizeFilestoreFields(input.fields);
  const fileRules = normalizeFilestoreRules(input.fileRules);
  return {
    title,
    description: String(input.description ?? "").trim().slice(0, 1000),
    deadline: normalizeDeadline(input.deadline),
    status: normalizeStatus(input.status),
    fields,
    fileRules,
    renameTemplate: String(input.renameTemplate ?? "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
    folderTemplate: String(input.folderTemplate ?? "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
    expectedEntries: String(input.expectedEntries ?? "").trim().slice(0, 20000),
  };
}

function normalizeTemplatePayload(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = String(source.name ?? "").trim().slice(0, 60);
  if (!name) throw filestoreApiError(400, "模板名称不能为空");
  const fields = normalizeFilestoreFields(source.fields);
  const fileRules = normalizeFilestoreRules(source.fileRules);
  return {
    id: source.id,
    name,
    description: String(source.description ?? "").trim().slice(0, 1000),
    fields,
    fileRules,
    renameTemplate: String(source.renameTemplate ?? "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
    folderTemplate: String(source.folderTemplate ?? "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
    expectedEntries: String(source.expectedEntries ?? "").trim().slice(0, 20000),
  };
}

function userIsSuperAdmin(user: FilestoreAccessUser | null | undefined) {
  return user?.role === "admin";
}

function userCanManageGlobalFilestore(user: FilestoreAccessUser | null | undefined) {
  return Boolean(user?.isToolManager);
}

function canAccessFilestoreTask(user: FilestoreAccessUser | null | undefined, row: { createdById: number | null }) {
  if (!user?.userId) return false;
  if (userIsSuperAdmin(user)) return true;
  return row.createdById === user.userId;
}

function filestoreCreatedBy(row: any) {
  if (!row.createdBy) return null;
  return {
    userId: row.createdBy.id,
    username: row.createdBy.username,
    displayName: row.createdBy.nickname || row.createdBy.username,
    role: row.createdBy.role,
  };
}

function normalizeFilestoreSubmission(row: any) {
  return {
    id: row.id,
    data: parseJsonObject(row.data),
    ip: row.ip || "",
    status: row.status || "submitted",
    createdAt: isoDate(row.createdAt),
    files: (row.files ?? []).map((file: any) => ({
      id: file.id,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: isoDate(file.createdAt),
    })),
  };
}

function submissionIdentity(data: Record<string, string>) {
  return String(data.student_id || data.name || "").trim();
}

function buildFilestoreStats(task: { expectedEntries: string }, submissions: Array<{ id: number; data: Record<string, string>; createdAt: string }>) {
  const expected = task.expectedEntries.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const expectedKeys = new Set(expected);
  const matched = new Set<string>();
  const unexpected: Array<{ id: number; name: string; identity: string; createdAt: string }> = [];
  for (const item of submissions) {
    const identity = submissionIdentity(item.data);
    if (expectedKeys.size && expectedKeys.has(identity)) {
      matched.add(identity);
    } else if (expectedKeys.size) {
      unexpected.push({
        id: item.id,
        name: item.data.name || "",
        identity,
        createdAt: item.createdAt,
      });
    }
  }
  return {
    submitted: submissions.length,
    inListSubmitted: expected.length ? matched.size : submissions.length,
    expected: expected.length,
    missing: expected.filter((item) => !matched.has(item)),
    unexpected,
  };
}

function normalizeFilestoreTask(row: any, options: { includeCreator?: boolean; includeSubmissions?: boolean } = {}) {
  const fields = parseStoredFields(row.fields);
  const submissions = options.includeSubmissions
    ? (row.submissions ?? []).map(normalizeFilestoreSubmission)
    : undefined;
  const task: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    token: row.slug,
    title: row.title,
    description: row.description || "",
    deadline: isoDate(row.deadline),
    fields,
    fileRules: parseStoredRules(row.fileRules),
    renameTemplate: row.renameTemplate || "{name}-{student_id}",
    folderTemplate: row.folderTemplate || "{name}-{student_id}",
    expectedEntries: row.expectedEntries || "",
    status: normalizeStatus(row.status),
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
    submitUrl: `${MOUNT_PATH}/submit/${row.slug}`,
  };
  if (options.includeCreator) task.createdBy = filestoreCreatedBy(row);
  if (submissions) {
    task.submissions = submissions;
    task.stats = buildFilestoreStats({ expectedEntries: String(task.expectedEntries || "") }, submissions);
  }
  return task;
}

function normalizeFilestoreTemplate(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    fields: parseStoredFields(row.fields),
    fileRules: parseStoredRules(row.fileRules),
    renameTemplate: row.renameTemplate || "{name}-{student_id}",
    folderTemplate: row.folderTemplate || "{name}-{student_id}",
    expectedEntries: row.expectedEntries || "",
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

async function getFilestoreSiteSetting(key: string, fallback = "") {
  const row = await prisma.siteSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? fallback;
}

async function setFilestoreSiteSetting(key: string, value: string) {
  await prisma.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function listFilestoreTemplates() {
  const rows = await prisma.fileCollectTemplate.findMany({
    where: { visibility: FILESTORE_TEMPLATE_VISIBILITY },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(normalizeFilestoreTemplate);
}

async function filestoreSettings() {
  const [siteUrl, siteTitle, taskTemplates] = await Promise.all([
    getFilestoreSiteSetting(FILESTORE_SITE_URL_KEY, ""),
    getFilestoreSiteSetting(FILESTORE_SITE_TITLE_KEY, FILESTORE_SITE_TITLE_DEFAULT),
    listFilestoreTemplates(),
  ]);
  return {
    siteUrl,
    siteTitle: normalizeSiteTitle(siteTitle),
    taskTemplates,
  };
}

async function saveFilestoreTemplates(input: unknown[]) {
  const templates = input.map(normalizeTemplatePayload);
  const numericIds = templates
    .map((template) => Number(template.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  await prisma.$transaction(async (tx) => {
    await tx.fileCollectTemplate.deleteMany({
      where: {
        visibility: FILESTORE_TEMPLATE_VISIBILITY,
        ...(numericIds.length ? { id: { notIn: numericIds } } : {}),
      },
    });
    for (const template of templates) {
      const id = Number(template.id);
      const data = {
        name: template.name,
        description: template.description || null,
        visibility: FILESTORE_TEMPLATE_VISIBILITY,
        fields: JSON.stringify(storedFields(template.fields)),
        fileRules: JSON.stringify(template.fileRules),
        renameTemplate: template.renameTemplate,
        folderTemplate: template.folderTemplate,
        expectedEntries: template.expectedEntries,
        createdById: null,
      };
      if (Number.isInteger(id) && id > 0) {
        const updated = await tx.fileCollectTemplate.updateMany({
          where: { id, visibility: FILESTORE_TEMPLATE_VISIBILITY },
          data,
        });
        if (updated.count) continue;
      }
      await tx.fileCollectTemplate.create({ data });
    }
  });
}

async function nextFilestoreToken() {
  for (let i = 0; i < 20; i += 1) {
    const token = `fs-${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const exists = await prisma.fileCollectTask.findUnique({ where: { slug: token }, select: { id: true } });
    if (!exists) return token;
  }
  return `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function taskInclude(includeSubmissions = false) {
  return {
    createdBy: { select: { id: true, username: true, nickname: true, role: true } },
    ...(includeSubmissions ? {
      submissions: {
        where: { status: "submitted" as const },
        orderBy: { createdAt: "desc" as const },
        include: { files: { orderBy: { id: "asc" as const } } },
      },
    } : {}),
  };
}

async function getFilestoreTaskForActor(id: number, user: FilestoreAccessUser | null, includeSubmissions = true) {
  const row = await prisma.fileCollectTask.findUnique({
    where: { id },
    include: taskInclude(includeSubmissions),
  });
  if (!row || !canAccessFilestoreTask(user, row)) return null;
  return row;
}

function safeStoredFilename(value: string) {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160);
  return cleaned || "file";
}

function renderTemplateBase(template: string, data: Record<string, string>, originalName = "", index = 1, total = 1) {
  const ext = path.extname(originalName || "");
  const stem = path.basename(originalName || "file", ext);
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeStoredFilename(value)])),
    original: safeStoredFilename(stem),
    index: total > 1 ? String(index) : "",
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return safeStoredFilename(rendered).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

function renderStoredName(template: string, data: Record<string, string>, originalName: string, index: number, total: number) {
  const ext = path.extname(originalName || "").toLowerCase();
  const base = renderTemplateBase(template, data, originalName, index, total);
  const withIndex = total > 1 && !template.includes("{index}") ? `${base}-${index}` : base;
  return `${withIndex}${ext}`;
}

async function unlinkFileCollectPath(relative: string) {
  await deleteMediaAsset(relative).catch(() => null);
}

async function refreshFileCollectStats(taskId: number) {
  const [submissionCount, fileCount] = await Promise.all([
    prisma.fileCollectSubmission.count({ where: { taskId, status: "submitted" } }),
    prisma.fileCollectFile.count({ where: { submission: { taskId, status: "submitted" } } }),
  ]);
  await prisma.fileCollectTask.update({
    where: { id: taskId },
    data: { submissionCount, fileCount },
  }).catch(() => null);
}

function normalizeSubmissionData(fields: FilestoreField[], input: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = String(input[field.key] ?? input[field.id] ?? "").trim();
    if (field.required && !value) throw filestoreApiError(400, `${field.label}不能为空`);
    if (value && field.pattern && !(new RegExp(field.pattern).test(value))) {
      throw filestoreApiError(400, `${field.label}格式不正确`);
    }
    result[field.key] = value.slice(0, 300);
  }
  return result;
}

type UploadFileForValidation = {
  originalname: string;
  size: number;
};

function validateUploadFiles(files: UploadFileForValidation[], rules: FilestoreRules) {
  if (!files.length) throw filestoreApiError(400, "至少需要上传一个文件");
  if (files.length > rules.maxCount) throw filestoreApiError(400, `最多只能上传 ${rules.maxCount} 个文件`);
  const allowed = new Set(rules.allowedTypes);
  const maxBytes = rules.maxSizeMb * 1024 * 1024;
  for (const file of files) {
    const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
    if (allowed.size && !allowed.has(ext)) throw filestoreApiError(400, `${file.originalname} 类型不允许`);
    if (file.size > maxBytes) throw filestoreApiError(400, `${file.originalname} 超过 ${rules.maxSizeMb} MB`);
  }
}

function normalizeDirectUploadFiles(input: unknown) {
  if (!Array.isArray(input)) throw filestoreApiError(400, "文件列表格式不正确");
  return input.slice(0, 50).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = normalizeUploadOriginalName(row.name ?? row.originalName).slice(0, 255);
    const size = Number(row.size);
    const type = String(row.type ?? row.mimeType ?? "").trim().slice(0, 120) || "application/octet-stream";
    if (!name) throw filestoreApiError(400, "文件名不能为空");
    if (!Number.isFinite(size) || size < 0 || size > Number.MAX_SAFE_INTEGER) {
      throw filestoreApiError(400, `${name} 大小不正确`);
    }
    return {
      originalname: name,
      size: Math.round(size),
      mimetype: type,
    };
  });
}

function parseNumericIdList(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap((item) => parseNumericIdList(item));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        return parseNumericIdList(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return trimmed.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
  }
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? [numberValue] : [];
}

function buildFileCollectRelativePath(taskId: number, physicalName: string) {
  return path.posix.join("file-collect", String(taskId), physicalName);
}

function shouldFilestoreFileUseRemote(size: number, minSizeBytes: number) {
  if (minSizeBytes <= 0) return true;
  return Number(size || 0) >= minSizeBytes;
}

async function filestoreRemoteUploadPolicy(taskId: number, files: Array<{ size: number }> = []) {
  const runtime = await getMediaStorageRuntimeConfig();
  const remoteReady = Boolean(
    (runtime.oneDriveChinaRefreshToken.trim() || runtime.legacyClientSecret.trim())
    && (runtime.oneDriveChinaDriveId.trim() || runtime.legacyDriveId.trim()),
  );
  const available = remoteReady
    && await shouldUseRemoteMediaStorageForRelativePath(buildFileCollectRelativePath(taskId, "__probe__"));
  const minSizeMb = Math.max(0, Number(runtime.filestoreRemoteMinSizeMb || 0));
  const minSizeBytes = Math.round(minSizeMb * 1024 * 1024);
  const triggered = !files.length || files.some((file) => shouldFilestoreFileUseRemote(Number(file.size || 0), minSizeBytes));
  return {
    available,
    shouldDirect: available && triggered,
    minSizeMb,
    minSizeBytes,
  };
}

async function resolveFileCollectRemoteAccess(file: { path: string; size: number }) {
  const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
  if (!meta || meta.kind !== "file") return "";
  return meta.downloadUrl || resolveOneDriveChinaDirectDownloadUrl(file.path).catch(() => "");
}

async function waitForFileCollectRemoteUpload(file: { path: string; size: number; storedName: string }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const meta = await getOneDriveChinaItemMetadata(file.path).catch(() => null);
    if (meta?.kind === "file") {
      if (meta.size !== null && Number(meta.size) !== Number(file.size)) {
        console.warn(`[filestore] direct upload size metadata differs for ${file.path}: expected=${file.size} remote=${meta.size}`);
      }
      return true;
    }
    await sleep(500 + attempt * 350);
  }
  return false;
}

async function rerenameFilestoreTaskFiles(taskId: number, renameTemplate: string) {
  const rows = await prisma.fileCollectSubmission.findMany({
    where: { taskId, status: "submitted" },
    include: { files: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const result = { renamed: 0, unchanged: 0, missing: 0 };
  for (const submission of rows) {
    const data = parseJsonObject(submission.data);
    const total = submission.files.length;
    for (let index = 0; index < submission.files.length; index += 1) {
      const file = submission.files[index];
      const storedName = renderStoredName(renameTemplate, data, file.originalName, index + 1, total);
      if (storedName === file.storedName) {
        result.unchanged += 1;
        continue;
      }
      await prisma.fileCollectFile.update({ where: { id: file.id }, data: { storedName } });
      result.renamed += 1;
    }
  }
  return result;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function filenameHeader(name: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function handleFilestoreUtilityRoute(req: Request, res: Response, user: FilestoreAccessUser | null) {
  const target = upstreamPath(req).split("?")[0];
  if (req.method === "GET" && target === "/api/qrcode") {
    const data = queryStringValue(req.query.data).trim();
    if (!data) {
      res.status(400).type("text/plain; charset=utf-8").send("二维码内容不能为空");
      return true;
    }
    if (data.length > 4096) {
      res.status(400).type("text/plain; charset=utf-8").send("二维码内容过长");
      return true;
    }
    const requestedSize = Number(queryStringValue(req.query.size));
    const width = Number.isFinite(requestedSize)
      ? Math.min(640, Math.max(120, Math.round(requestedSize)))
      : 260;
    const png = await QRCode.toBuffer(data, {
      type: "png",
      width,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#172033",
        light: "#ffffffff",
      },
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(png);
    return true;
  }
  if (req.method === "GET" && target === "/api/platform/site-config") {
    res.json({
      siteFilingNumber: getSiteFilingNumber(),
    });
    return true;
  }
  if (req.method === "GET" && target === "/api/admin/me") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    res.json({
      ok: true,
      role: user.role,
      isSuperAdmin: userIsSuperAdmin(user),
      isManager: userCanManageGlobalFilestore(user),
      user: {
        userId: user.userId,
        username: user.username,
        displayName: user.nickname || user.username,
      },
      settings: await filestoreSettings(),
    });
    return true;
  }
  if (req.method === "GET" && target === "/api/settings") {
    if (!userCanManageGlobalFilestore(user)) {
      res.status(403).json({ error: "仅文件收集管理器可操作全局配置" });
      return true;
    }
    res.json(await filestoreSettings());
    return true;
  }
  if (req.method === "POST" && target === "/api/settings") {
    if (!userCanManageGlobalFilestore(user)) {
      res.status(403).json({ error: "仅文件收集管理器可操作全局配置" });
      return true;
    }
    const payload = await parseFilestoreJsonBody(req, res);
    if (payload.siteUrl !== undefined) {
      await setFilestoreSiteSetting(FILESTORE_SITE_URL_KEY, normalizeSiteUrl(payload.siteUrl));
    }
    if (payload.siteTitle !== undefined) {
      await setFilestoreSiteSetting(FILESTORE_SITE_TITLE_KEY, normalizeSiteTitle(payload.siteTitle));
    }
    if (payload.taskTemplates !== undefined) {
      if (!Array.isArray(payload.taskTemplates)) throw filestoreApiError(400, "模板数据格式不正确");
      await saveFilestoreTemplates(payload.taskTemplates);
    }
    res.json(await filestoreSettings());
    return true;
  }
  if (req.method === "GET" && target === "/api/tasks") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    const rows = await prisma.fileCollectTask.findMany({
      where: userIsSuperAdmin(user) ? {} : { createdById: user.userId },
      orderBy: [{ createdAt: "desc" }],
      include: taskInclude(false),
    });
    res.json(rows.map((row) => normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user) })));
    return true;
  }
  if (req.method === "POST" && target === "/api/tasks") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    const payload = normalizeFilestoreTaskPayload(await parseFilestoreJsonBody(req, res));
    const now = new Date();
    const row = await prisma.fileCollectTask.create({
      data: {
        slug: await nextFilestoreToken(),
        title: payload.title,
        description: payload.description || null,
        status: payload.status,
        visibility: "public",
        fields: JSON.stringify(storedFields(payload.fields)),
        fileRules: JSON.stringify(payload.fileRules),
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries,
        deadline: payload.deadline,
        createdById: user.userId,
        publishedAt: payload.status === "open" ? now : null,
        closedAt: payload.status === "closed" ? now : null,
      },
      include: taskInclude(true),
    });
    res.status(201).json(normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }));
    return true;
  }
  const publicTaskMatch = target.match(/^\/api\/public\/tasks\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && publicTaskMatch) {
    const row = await prisma.fileCollectTask.findUnique({
      where: { slug: publicTaskMatch[1] },
      include: taskInclude(false),
    });
    if (!row) {
      res.status(404).json({ error: "提交链接不存在" });
      return true;
    }
    const remoteUploadPolicy = await filestoreRemoteUploadPolicy(row.id).catch(() => ({
      available: false,
      shouldDirect: false,
      minSizeMb: 0,
      minSizeBytes: 0,
    }));
    res.json({
      ...normalizeFilestoreTask(row),
      siteTitle: (await filestoreSettings()).siteTitle,
      remoteUpload: {
        enabled: remoteUploadPolicy.available,
        mode: remoteUploadPolicy.available ? "onedrive-cn" : "local",
        minSizeMb: remoteUploadPolicy.minSizeMb,
        minSizeBytes: remoteUploadPolicy.minSizeBytes,
      },
    });
    return true;
  }
  const publicStatusMatch = target.match(/^\/api\/public\/status\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && publicStatusMatch) {
    const row = await prisma.fileCollectTask.findUnique({
      where: { slug: publicStatusMatch[1] },
      include: taskInclude(true),
    });
    if (!row) {
      res.status(404).json({ error: "成功名单不存在" });
      return true;
    }
    const detail = normalizeFilestoreTask(row, { includeSubmissions: true }) as any;
    const fieldKeys = (detail.fields ?? []).map((field: FilestoreField) => field.key);
    res.json({
      title: detail.title,
      deadline: detail.deadline,
      status: detail.status,
      siteTitle: (await filestoreSettings()).siteTitle,
      stats: {
        submitted: detail.stats.submitted,
        expected: detail.stats.expected,
        missing: detail.stats.missing.length,
      },
      submissions: detail.submissions.map((item: any) => {
        let displayName = String(item.data.name || "").trim();
        let identity = String(item.data.student_id || "").trim();
        if (!displayName && fieldKeys.length) displayName = String(item.data[fieldKeys[0]] || "").trim();
        if (!identity) {
          for (const key of fieldKeys) {
            const value = String(item.data[key] || "").trim();
            if (value && value !== displayName) {
              identity = value;
              break;
            }
          }
        }
        return {
          id: item.id,
          displayName: displayName || `提交 #${item.id}`,
          identity,
          createdAt: item.createdAt,
          files: item.files.map((file: any) => ({
            storedName: file.storedName,
            size: file.size,
          })),
        };
      }),
    });
    return true;
  }
  const taskDetailMatch = target.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === "GET" && taskDetailMatch) {
    const row = await getFilestoreTaskForActor(Number(taskDetailMatch[1]), user, true);
    if (!row) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    res.json(normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }));
    return true;
  }
  if (req.method === "PATCH" && taskDetailMatch) {
    const current = await getFilestoreTaskForActor(Number(taskDetailMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const rawPayload = await parseFilestoreJsonBody(req, res);
    const payload = normalizeFilestoreTaskPayload(rawPayload);
    const now = new Date();
    await prisma.fileCollectTask.update({
      where: { id: current.id },
      data: {
        title: payload.title,
        description: payload.description || null,
        status: payload.status,
        fields: JSON.stringify(storedFields(payload.fields)),
        fileRules: JSON.stringify(payload.fileRules),
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries,
        deadline: payload.deadline,
        publishedAt: payload.status === "open" && !current.publishedAt ? now : undefined,
        closedAt: payload.status === "closed" ? now : payload.status === "open" ? null : undefined,
      },
    });
    const renameResult = rawPayload.renameExistingFiles
      ? await rerenameFilestoreTaskFiles(current.id, payload.renameTemplate)
      : null;
    const row = await getFilestoreTaskForActor(current.id, user, true);
    const detail = normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }) as any;
    if (renameResult) detail.renameResult = renameResult;
    res.json(detail);
    return true;
  }
  const repairFilenamesMatch = target.match(/^\/api\/tasks\/(\d+)\/repair-filenames$/);
  if (req.method === "POST" && repairFilenamesMatch) {
    const current = await getFilestoreTaskForActor(Number(repairFilenamesMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    res.json(await repairFileCollectTaskFilenames(current.id));
    return true;
  }
  if (req.method === "DELETE" && taskDetailMatch) {
    const current = await getFilestoreTaskForActor(Number(taskDetailMatch[1]), user, false);
    if (!current) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const files = await prisma.fileCollectFile.findMany({
      where: { submission: { taskId: current.id } },
      select: { path: true },
    });
    await prisma.fileCollectTask.delete({ where: { id: current.id } });
    await Promise.all(files.map((file) => unlinkFileCollectPath(file.path)));
    await rm(path.resolve(process.cwd(), "uploads", "file-collect", String(current.id)), { recursive: true, force: true });
    res.json({ ok: true });
    return true;
  }
  const ownerMatch = target.match(/^\/api\/tasks\/(\d+)\/owner$/);
  if (req.method === "PATCH" && ownerMatch) {
    if (!userIsSuperAdmin(user)) {
      res.status(403).json({ error: "仅超级管理员可操作" });
      return true;
    }
    const task = await prisma.fileCollectTask.findUnique({ where: { id: Number(ownerMatch[1]) } });
    if (!task) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const payload = await parseFilestoreJsonBody(req, res);
    const userId = Number(payload.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw filestoreApiError(400, "绑定用户 ID 无效");
    const owner = await prisma.user.findFirst({
      where: {
        id: userId,
        status: { not: "banned" },
        OR: [
          { role: "admin" },
          { toolPermissions: { some: { toolCode: "file_collect" } } },
        ],
      },
      select: { id: true },
    });
    if (!owner) throw filestoreApiError(400, "未找到可绑定的文件收集管理员");
    await prisma.fileCollectTask.update({ where: { id: task.id }, data: { createdById: userId } });
    const row = await getFilestoreTaskForActor(task.id, user, true);
    res.json(normalizeFilestoreTask(row, { includeCreator: true, includeSubmissions: true }));
    return true;
  }
  const exportMatch = target.match(/^\/api\/tasks\/(\d+)\/export\.csv$/);
  if (req.method === "GET" && exportMatch) {
    const row = await getFilestoreTaskForActor(Number(exportMatch[1]), user, true);
    if (!row) {
      res.status(404).json({ error: "任务不存在" });
      return true;
    }
    const detail = normalizeFilestoreTask(row, { includeCreator: userIsSuperAdmin(user), includeSubmissions: true }) as any;
    const fields = detail.fields as FilestoreField[];
    const headers = ["提交编号", "提交时间", "IP", ...fields.map((field) => field.label), "文件"];
    const lines = [headers.map(csvCell).join(",")];
    for (const submission of detail.submissions) {
      lines.push([
        submission.id,
        submission.createdAt,
        submission.ip,
        ...fields.map((field) => submission.data[field.key] || ""),
        submission.files.map((file: any) => file.storedName).join("; "),
      ].map(csvCell).join(","));
    }
    const body = `\uFEFF${lines.join("\r\n")}\r\n`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", filenameHeader(`${detail.title}.csv`));
    res.send(body);
    return true;
  }
  const zipMatch = target.match(/^\/api\/tasks\/(\d+)\/download\.zip$/);
  if (req.method === "GET" && zipMatch) {
    res.status(410).json({ error: "ZIP 已改为浏览器端打包，请在管理界面点击下载 ZIP" });
    return true;
  }
  const prepareRemoteSubmitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)\/prepare-remote$/);
  if (req.method === "POST" && prepareRemoteSubmitMatch) {
    const payload = await parseFilestoreJsonBody(req, res);
    const task = await prisma.fileCollectTask.findUnique({ where: { slug: prepareRemoteSubmitMatch[1] } });
    if (!task) throw filestoreApiError(404, "提交链接不存在");
    if (normalizeStatus(task.status) !== "open") throw filestoreApiError(400, "任务未开放提交");
    if (task.deadline && Date.now() > task.deadline.getTime()) throw filestoreApiError(400, "已超过截止时间");
    const remotePolicy = await filestoreRemoteUploadPolicy(task.id);
    if (!remotePolicy.available) {
      throw filestoreApiError(400, "当前任务未启用世纪互联直传");
    }
    const fields = parseStoredFields(task.fields);
    const rules = parseStoredRules(task.fileRules);
    const dataSource = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : payload;
    const data = normalizeSubmissionData(fields, dataSource);
    const files = normalizeDirectUploadFiles(payload.files);
    validateUploadFiles(files, rules);
    const uploadPolicy = await filestoreRemoteUploadPolicy(task.id, files);
    if (!uploadPolicy.shouldDirect) {
      throw filestoreApiError(400, "所选文件未达到世纪互联直传阈值，请使用普通上传");
    }
    const directFileIndexes = new Set(
      files
        .map((file, index) => ({ file, index }))
        .filter(({ file }) => shouldFilestoreFileUseRemote(file.size, uploadPolicy.minSizeBytes))
        .map(({ index }) => index),
    );
    const identity = submissionIdentity(data);

    const created = await prisma.$transaction(async (tx) => {
      const submission = await tx.fileCollectSubmission.create({
        data: {
          taskId: task.id,
          submitterId: null,
          identity,
          data: JSON.stringify(data),
          ip: req.ip,
          status: "uploading",
        },
      });
      const fileRows = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const storedName = renderStoredName(task.renameTemplate, data, file.originalname, index + 1, files.length);
        const physicalName = `${submission.id}-${index + 1}-${randomUUID()}-${safeStoredFilename(storedName)}`;
        const relativePath = buildFileCollectRelativePath(task.id, physicalName);
        fileRows.push(await tx.fileCollectFile.create({
          data: {
            submissionId: submission.id,
            originalName: file.originalname,
            storedName,
            mimeType: file.mimetype || "application/octet-stream",
            size: file.size,
            path: relativePath,
          },
        }));
      }
      return { submission, files: fileRows };
    });

    try {
      const uploadFiles = [];
      const localFiles = [];
      for (let index = 0; index < created.files.length; index += 1) {
        const file = created.files[index];
        if (!directFileIndexes.has(index)) {
          localFiles.push({
            id: file.id,
            index,
            originalName: file.originalName,
            storedName: file.storedName,
            size: file.size,
            mimeType: file.mimeType,
          });
          continue;
        }
        if (file.size <= 0) throw filestoreApiError(400, `${file.storedName} 是空文件，暂不支持直传`);
        const session = await createRemoteMediaUploadSession({
          relativePath: file.path,
          contentType: file.mimeType || "application/octet-stream",
        });
        if (!session) throw filestoreApiError(400, "当前任务未启用世纪互联直传");
        uploadFiles.push({
          id: file.id,
          index,
          originalName: file.originalName,
          storedName: file.storedName,
          size: file.size,
          mimeType: file.mimeType,
          uploadUrl: session.uploadUrl,
          expiresAt: session.expiresAt,
        });
      }
      res.json({
        ok: true,
        directUpload: true,
        submissionId: created.submission.id,
        files: uploadFiles,
        localFiles,
      });
    } catch (error) {
      await prisma.fileCollectSubmission.delete({ where: { id: created.submission.id } }).catch(() => null);
      await Promise.all(created.files.map((file) => unlinkFileCollectPath(file.path)));
      throw error;
    }
    return true;
  }
  const completeRemoteSubmitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)\/complete-remote$/);
  if (req.method === "POST" && completeRemoteSubmitMatch) {
    let uploadedFiles: Express.Multer.File[] = [];
    const movedPaths: string[] = [];
    try {
      const contentType = String(req.headers["content-type"] || "");
      const isMultipart = contentType.includes("multipart/form-data");
      let body: Record<string, unknown>;
      if (isMultipart) {
        uploadedFiles = await parseFilestoreUpload(req, res);
        body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
      } else {
        body = await parseFilestoreJsonBody(req, res);
      }
      const submissionId = Number(body.submissionId ?? body.id);
      if (!Number.isInteger(submissionId) || submissionId <= 0) throw filestoreApiError(400, "提交编号无效");
      const submission = await prisma.fileCollectSubmission.findUnique({
        where: { id: submissionId },
        include: {
          task: true,
          files: { orderBy: { id: "asc" } },
        },
      });
      if (!submission || submission.task.slug !== completeRemoteSubmitMatch[1]) {
        throw filestoreApiError(404, "提交记录不存在");
      }
      if (submission.status === "submitted") {
        res.json({
          ok: true,
          id: submission.id,
          submissionId: submission.id,
          createdAt: isoDate(submission.createdAt),
          files: submission.files.map((file) => file.storedName),
        });
        return true;
      }
      if (submission.status !== "uploading") throw filestoreApiError(400, "提交状态无法完成");
      if (!submission.files.length) throw filestoreApiError(400, "没有待确认文件");

      const uploadPolicy = await filestoreRemoteUploadPolicy(submission.taskId, submission.files);
      const expectedRemoteFiles = uploadPolicy.available
        ? submission.files.filter((file) => shouldFilestoreFileUseRemote(file.size, uploadPolicy.minSizeBytes))
        : [];
      const expectedRemoteIds = new Set(expectedRemoteFiles.map((file) => file.id));
      const expectedLocalFiles = submission.files.filter((file) => !expectedRemoteIds.has(file.id));
      const confirmedRemoteIds = new Set(parseNumericIdList(body.remoteFileIds));
      const submittedLocalIds = parseNumericIdList(body.localFileIds);
      if (confirmedRemoteIds.size && expectedRemoteFiles.some((file) => !confirmedRemoteIds.has(file.id))) {
        throw filestoreApiError(400, "直传文件列表不完整，请刷新后重试");
      }
      if (expectedLocalFiles.length) {
        if (submittedLocalIds.length !== expectedLocalFiles.length) {
          throw filestoreApiError(400, "本地文件列表不完整，请刷新后重试");
        }
        const expectedLocalIds = new Set(expectedLocalFiles.map((file) => file.id));
        if (submittedLocalIds.some((id) => !expectedLocalIds.has(id))) {
          throw filestoreApiError(400, "本地文件列表与提交记录不匹配");
        }
      }
      if (uploadedFiles.length !== expectedLocalFiles.length) {
        throw filestoreApiError(400, "本地文件数量与提交记录不匹配");
      }

      for (const file of expectedRemoteFiles) {
        const uploaded = await waitForFileCollectRemoteUpload(file);
        if (!uploaded) throw filestoreApiError(400, `${file.storedName} 尚未上传完成`);
      }

      if (expectedLocalFiles.length) {
        const taskDir = path.resolve(process.cwd(), "uploads", "file-collect", String(submission.taskId));
        mkdirSync(taskDir, { recursive: true });
        const localById = new Map(expectedLocalFiles.map((file) => [file.id, file]));
        for (let index = 0; index < submittedLocalIds.length; index += 1) {
          const expected = localById.get(submittedLocalIds[index]);
          const uploaded = uploadedFiles[index];
          if (!expected || !uploaded) throw filestoreApiError(400, "本地文件列表与提交记录不匹配");
          if (uploaded.size !== expected.size) throw filestoreApiError(400, `${expected.storedName} 上传大小不一致`);
          if (uploaded.originalname !== expected.originalName) throw filestoreApiError(400, `${expected.storedName} 文件名不一致`);
          const absoluteTarget = path.join(taskDir, path.basename(expected.path));
          await rename(uploaded.path, absoluteTarget);
          movedPaths.push(expected.path);
        }
      }

      const stalePaths = await prisma.$transaction(async (tx) => {
        const oldPaths: string[] = [];
        if (submission.identity) {
          const oldRows = await tx.fileCollectSubmission.findMany({
            where: {
              taskId: submission.taskId,
              identity: submission.identity,
              status: "submitted",
              id: { not: submission.id },
            },
            include: { files: true },
          });
          for (const old of oldRows) {
            await tx.fileCollectSubmission.delete({ where: { id: old.id } });
            oldPaths.push(...old.files.map((file) => file.path));
          }
        }
        await tx.fileCollectSubmission.update({
          where: { id: submission.id },
          data: { status: "submitted" },
        });
        await tx.fileCollectTask.update({
          where: { id: submission.taskId },
          data: {
            submissionCount: await tx.fileCollectSubmission.count({ where: { taskId: submission.taskId, status: "submitted" } }),
            fileCount: await tx.fileCollectFile.count({ where: { submission: { taskId: submission.taskId, status: "submitted" } } }),
          },
        });
        return oldPaths;
      });
      await Promise.all(stalePaths.map((item) => unlinkFileCollectPath(item)));
      res.json({
        ok: true,
        id: submission.id,
        submissionId: submission.id,
        createdAt: isoDate(submission.createdAt),
        files: submission.files.map((file) => file.storedName),
      });
    } catch (error) {
      await Promise.all(uploadedFiles.map((file) => unlink(file.path).catch(() => null)));
      if (movedPaths.length) await Promise.all(movedPaths.map((item) => unlinkFileCollectPath(item)));
      throw error;
    }
    return true;
  }
  const submitMatch = target.match(/^\/api\/submit\/([A-Za-z0-9_-]+)$/);
  if (req.method === "POST" && submitMatch) {
    let uploadedFiles: Express.Multer.File[] = [];
    const movedPaths: string[] = [];
    try {
      const task = await prisma.fileCollectTask.findUnique({ where: { slug: submitMatch[1] } });
      if (!task) throw filestoreApiError(404, "提交链接不存在");
      if (normalizeStatus(task.status) !== "open") throw filestoreApiError(400, "任务未开放提交");
      if (task.deadline && Date.now() > task.deadline.getTime()) throw filestoreApiError(400, "已超过截止时间");
      uploadedFiles = await parseFilestoreUpload(req, res);
      const fields = parseStoredFields(task.fields);
      const rules = parseStoredRules(task.fileRules);
      const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
      const data = normalizeSubmissionData(fields, body);
      validateUploadFiles(uploadedFiles, rules);
      if ((await filestoreRemoteUploadPolicy(task.id, uploadedFiles)).shouldDirect) {
        throw filestoreApiError(400, "本次提交包含达到直传阈值的文件，请刷新页面后重试");
      }
      const identity = submissionIdentity(data);
      const taskDir = path.resolve(process.cwd(), "uploads", "file-collect", String(task.id));
      mkdirSync(taskDir, { recursive: true });
      const result = await prisma.$transaction(async (tx) => {
        if (identity) {
          const oldRows = await tx.fileCollectSubmission.findMany({
            where: { taskId: task.id, identity },
            include: { files: true },
          });
          for (const old of oldRows) {
            await tx.fileCollectSubmission.delete({ where: { id: old.id } });
            for (const file of old.files) await unlinkFileCollectPath(file.path);
          }
        }
        const submission = await tx.fileCollectSubmission.create({
          data: {
            taskId: task.id,
            submitterId: null,
            identity,
            data: JSON.stringify(data),
            ip: req.ip,
            status: "submitted",
          },
        });
        const fileRows = [];
        for (let index = 0; index < uploadedFiles.length; index += 1) {
          const file = uploadedFiles[index];
          const storedName = renderStoredName(task.renameTemplate, data, file.originalname, index + 1, uploadedFiles.length);
          const physicalName = `${submission.id}-${index + 1}-${randomUUID()}-${safeStoredFilename(storedName)}`;
          const relativePath = buildFileCollectRelativePath(task.id, physicalName);
          const absoluteTarget = path.join(taskDir, physicalName);
          await rename(file.path, absoluteTarget);
          movedPaths.push(relativePath);
          fileRows.push(await tx.fileCollectFile.create({
            data: {
              submissionId: submission.id,
              originalName: file.originalname,
              storedName,
              mimeType: file.mimetype || "application/octet-stream",
              size: file.size,
              path: relativePath,
            },
          }));
        }
        await tx.fileCollectTask.update({
          where: { id: task.id },
          data: {
            submissionCount: await tx.fileCollectSubmission.count({ where: { taskId: task.id, status: "submitted" } }),
            fileCount: await tx.fileCollectFile.count({ where: { submission: { taskId: task.id, status: "submitted" } } }),
          },
        });
        return { submission, files: fileRows };
      });
      res.json({
        ok: true,
        id: result.submission.id,
        submissionId: result.submission.id,
        createdAt: isoDate(result.submission.createdAt),
        files: result.files.map((file) => file.storedName),
      });
    } catch (error) {
      await Promise.all(uploadedFiles.map((file) => unlink(file.path).catch(() => null)));
      if (movedPaths.length) await Promise.all(movedPaths.map((item) => unlinkFileCollectPath(item)));
      throw error;
    }
    return true;
  }
  const fileInfoMatch = target.match(/^\/api\/files\/(\d+)$/);
  if (req.method === "GET" && fileInfoMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileInfoMatch[1]) },
      include: { submission: { include: { task: { include: { createdBy: { select: { id: true, username: true, nickname: true, role: true } } } } } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    res.json({
      id: file.id,
      submissionId: file.submissionId,
      taskId: file.submission.taskId,
      originalName: file.originalName,
      storedName: file.storedName,
      mimeType: file.mimeType,
      size: file.size,
      taskTitle: file.submission.task.title,
      submissionData: parseJsonObject(file.submission.data),
      submissionCreatedAt: isoDate(file.submission.createdAt),
    });
    return true;
  }
  const fileAccessMatch = target.match(/^\/api\/files\/(\d+)\/access$/);
  if (req.method === "GET" && fileAccessMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileAccessMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    const action = new URL(req.originalUrl || req.url || "/", "http://filestore.local").searchParams.get("action") === "preview"
      ? "preview"
      : "download";
    const remoteUrl = await resolveFileCollectRemoteAccess(file);
    const remotePreviewUrl = action === "preview" && remoteUrl
      ? await resolveOneDriveChinaPreviewUrl(file.path).catch(() => "")
      : "";
    const origin = requestPublicOrigin(req);
    const publicOfficePreviewUrl = origin && action === "preview" && !remotePreviewUrl && !remoteUrl && canUseOfficeWebViewer(file)
      ? `${origin}${MOUNT_PATH}/api/files/${file.id}/public-preview/${encodeURIComponent(file.storedName)}?token=${encodeURIComponent(signFileCollectPreviewToken(file))}`
      : "";
    const previewSourceUrl = action === "preview" && isOfficePreviewFile(file.storedName)
      ? publicOfficePreviewUrl
      : "";
    const viewerUrl = previewSourceUrl ? buildOfficeViewerUrl(previewSourceUrl) : "";
    const previewUrl = remotePreviewUrl || viewerUrl;
    const previewMessage = action === "preview" && isOfficePreviewFile(file.storedName) && !previewUrl
      ? officeWebViewerLimitMessage(file) || "该文件暂不支持在线预览，请下载后查看。"
      : "";
    res.json({
      ok: true,
      id: file.id,
      action,
      backend: remoteUrl ? "onedrive-cn" : "local",
      url: action === "preview" ? previewUrl : remoteUrl,
      viewer: remotePreviewUrl ? "onedrive" : (viewerUrl ? "office" : null),
      previewMessage,
      filename: file.storedName,
      mimeType: file.mimeType || "application/octet-stream",
    });
    return true;
  }
  const filePublicPreviewMatch = target.match(/^\/api\/files\/(\d+)\/public-preview(?:\/[^/]+)?$/);
  if (req.method === "GET" && filePublicPreviewMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(filePublicPreviewMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !verifyFileCollectPreviewToken(queryStringValue(req.query.token), file)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    if (!isOfficePreviewFile(file.storedName)) throw filestoreApiError(400, "该文件不支持在线预览");
    const remoteUrl = await resolveFileCollectRemoteAccess(file);
    if (remoteUrl) {
      res.redirect(302, remoteUrl);
      return true;
    }
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw filestoreApiError(404, "文件已丢失");
    res.type(file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
    res.sendFile(absolute);
    return true;
  }
  const fileDownloadMatch = target.match(/^\/api\/files\/(\d+)\/(download|preview)$/);
  if (req.method === "GET" && fileDownloadMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileDownloadMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    const absolute = await ensureMediaLocalPathFromUploadUrl(`/uploads/${file.path}`);
    if (!absolute) throw filestoreApiError(404, "文件已丢失");
    if (fileDownloadMatch[2] === "preview") {
      res.type(file.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.storedName)}`);
      res.sendFile(absolute);
    } else {
      res.download(absolute, file.storedName);
    }
    return true;
  }
  if (req.method === "DELETE" && fileInfoMatch) {
    const file = await prisma.fileCollectFile.findUnique({
      where: { id: Number(fileInfoMatch[1]) },
      include: { submission: { include: { task: true } } },
    });
    if (!file || !canAccessFilestoreTask(user, file.submission.task)) {
      res.status(404).json({ error: "文件不存在" });
      return true;
    }
    await prisma.fileCollectFile.delete({ where: { id: file.id } });
    await unlinkFileCollectPath(file.path);
    await refreshFileCollectStats(file.submission.taskId);
    res.json({ ok: true });
    return true;
  }
  const submissionMatch = target.match(/^\/api\/submissions\/(\d+)$/);
  if (req.method === "DELETE" && submissionMatch) {
    const submission = await prisma.fileCollectSubmission.findUnique({
      where: { id: Number(submissionMatch[1]) },
      include: { task: true, files: true },
    });
    if (!submission || !canAccessFilestoreTask(user, submission.task)) {
      res.status(404).json({ error: "提交记录不存在" });
      return true;
    }
    await prisma.fileCollectSubmission.delete({ where: { id: submission.id } });
    await Promise.all(submission.files.map((file) => unlinkFileCollectPath(file.path)));
    await refreshFileCollectStats(submission.taskId);
    res.json({ ok: true });
    return true;
  }
  if (req.method === "GET" && target === "/api/platform/users") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "仅超级管理员可绑定旧任务创建者" });
      return true;
    }
    const q = String(req.query.q ?? "").trim();
    const take = Math.min(12, Math.max(1, Number(req.query.size ?? 8)));
    if (!q) {
      res.json([]);
      return true;
    }
    const rows = await prisma.user.findMany({
      where: {
        status: { not: "banned" },
        OR: [
          { role: "admin" },
          { toolPermissions: { some: { toolCode: "file_collect" } } },
        ],
        AND: [
          {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { nickname: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: [{ id: "asc" }],
      take,
      select: {
        id: true,
        username: true,
        nickname: true,
        role: true,
      },
    });
    res.json(rows.map((item) => ({
      userId: item.id,
      username: item.username,
      displayName: item.nickname || item.username,
      role: item.role,
    })));
    return true;
  }
  if (req.method === "POST" && target === "/api/platform/ai/regex") {
    if (!user?.userId) {
      res.status(401).json({ error: "请先登录平台账号" });
      return true;
    }
    // Parse JSON body on demand since express.json() is registered after filestoreProxy
    await new Promise<void>((resolve, reject) => {
      express.json()(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "提示词不能为空" });
      return true;
    }
    try {
      const messages = [
        {
          role: "system" as const,
          content: "你是一个正则表达式生成助手。请根据用户的自然语言描述（例如：必须以20开头，十位数字），生成且仅生成一个符合要求的 JavaScript/Python 正则表达式，并且返回一个 JSON 对象，格式为 {\"regex\": \"正则表达式\", \"description\": \"对正则表达式的简短中文解释\", \"placeholder\": \"符合此规则的输入示例（如 2018010101）\"}。注意：只能返回合法的 JSON 对象，不要用 markdown 代码块包裹，也不要有任何多余文字。"
        },
        {
          role: "user" as const,
          content: prompt
        }
      ];
      const { content } = await requestAiJson(messages);
      let parsed = { regex: "", description: "", placeholder: "" };
      try {
        const cleanContent = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        parsed = JSON.parse(cleanContent);
      } catch (err) {
        const regexMatch = content.match(/"regex"\\s*:\\s*"([^"]+)"/);
        const descMatch = content.match(/"description"\\s*:\\s*"([^"]+)"/);
        const placeholderMatch = content.match(/"placeholder"\\s*:\\s*"([^"]+)"/);
        parsed = {
          regex: regexMatch ? regexMatch[1] : "",
          description: descMatch ? descMatch[1] : "",
          placeholder: placeholderMatch ? placeholderMatch[1] : "",
        };
      }
      res.json(parsed);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "AI 生成失败" });
    }
    return true;
  }
  return false;
}

function proxyToFilestore(req: Request, res: Response, user: FilestoreAccessUser | null) {
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${config.filestorePort}`,
    "x-cpu-filestore-admin": TRUSTED_PROXY_TOKEN,
    ...(user ? {
      "x-cpu-filestore-user-id": String(user.userId),
      "x-cpu-filestore-username": encodeFilestoreHeaderValue(user.username),
      "x-cpu-filestore-display-name": encodeFilestoreHeaderValue(user.nickname || user.username),
      "x-cpu-filestore-role": user.role,
      "x-cpu-filestore-is-manager": user.isToolManager ? "1" : "0",
    } : {}),
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
    const user = await assertFilestoreAccess(req, res);
    if (user === false) return;
    try {
      if (await handleFilestoreUtilityRoute(req, res, user)) return;
    } catch (error) {
      sendFilestoreApiError(res, error);
      return;
    }
    if (upstreamPath(req).split("?")[0].startsWith("/api/")) {
      res.status(404).json({ error: "接口不存在" });
      return;
    }
    await ensureFilestoreStarted();
    proxyToFilestore(req, res, user);
  } catch (error) {
    res.status(503).send(error instanceof Error ? error.message : "Filestore 暂不可用");
  }
};
