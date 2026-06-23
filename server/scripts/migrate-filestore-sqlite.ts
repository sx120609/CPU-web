import { execFileSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma";

const SITE_TITLE_DEFAULT = "药大拾间文件收集";
const FILESTORE_SITE_TITLE_KEY = "filestore.siteTitle";
const FILESTORE_SITE_URL_KEY = "filestore.siteUrl";
const FILESTORE_TEMPLATE_VISIBILITY = "filestore-global";

type OldTask = Record<string, any>;
type OldSubmission = Record<string, any>;
type OldFile = Record<string, any>;
type OldSetting = { key: string; value: string };

type SqliteDump = {
  tasks: OldTask[];
  submissions: OldSubmission[];
  files: OldFile[];
  settings: OldSetting[];
};

const serverRoot = path.resolve(process.cwd());
const filestoreRoot = path.join(serverRoot, "filestore");
const sqlitePath = path.resolve(process.env.FILESTORE_SQLITE_PATH || path.join(filestoreRoot, "data", "filestore.db"));
const uploadRoot = path.join(serverRoot, "uploads", "file-collect");

function log(message: string) {
  console.log(`[filestore:migrate] ${message}`);
}

function readSqliteDump(): SqliteDump | null {
  if (!existsSync(sqlitePath)) {
    log(`未发现旧 SQLite：${sqlitePath}`);
    return null;
  }
  const python = process.env.PYTHON || process.env.FILESTORE_PYTHON || "";
  const candidates = [python, "python3", "python"].filter(Boolean);
  const script = String.raw`
import json
import sqlite3
import sys

db = sys.argv[1]
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

def rows(table):
    try:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table}").fetchall()]
    except sqlite3.Error:
        return []

print(json.dumps({
    "tasks": rows("tasks"),
    "submissions": rows("submissions"),
    "files": rows("files"),
    "settings": rows("settings"),
}, ensure_ascii=False))
`;
  let lastError: unknown = null;
  for (const command of candidates) {
    try {
      const output = execFileSync(command, ["-c", script, sqlitePath], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
      return JSON.parse(output) as SqliteDump;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("无法调用 Python 读取旧 SQLite");
}

function parseJson(value: unknown, fallback: unknown) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function normalizeFieldKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function normalizeFields(raw: unknown) {
  const fields = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const result = [];
  for (const item of fields) {
    const field = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = normalizeFieldKey(field.key ?? field.id);
    const label = String(field.label ?? "").trim().slice(0, 80);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      label,
      required: field.required !== false,
      pattern: String(field.pattern ?? "").trim().slice(0, 200),
      placeholder: String(field.placeholder ?? "").trim().slice(0, 120),
    });
  }
  return result.length ? result : [{ id: "name", label: "姓名", required: true, pattern: "", placeholder: "" }];
}

function normalizeAllowedTypes(value: unknown) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(list
    .map((item) => String(item ?? "").trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9]+$/.test(item))
    .slice(0, 30))];
}

function normalizeRules(raw: unknown) {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const maxSizeMb = Number(source.maxSizeMb || 20);
  const maxCount = Number(source.maxCount || 1);
  return {
    allowedTypes: normalizeAllowedTypes(source.allowedTypes),
    maxSizeMb: Number.isFinite(maxSizeMb) && maxSizeMb > 0 ? Math.min(maxSizeMb, 100) : 20,
    maxCount: Number.isInteger(maxCount) && maxCount > 0 ? Math.min(maxCount, 20) : 1,
  };
}

function normalizeStatus(value: unknown) {
  return String(value || "open") === "closed" ? "closed" : "open";
}

function parseDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeStoredFilename(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160) || "file";
}

function submissionIdentity(data: Record<string, unknown>) {
  return String(data.student_id || data.name || "").trim().replace(/\s+/g, "");
}

async function existingUserId(value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  return user?.id ?? null;
}

async function upsertSetting(key: string, value: string) {
  await prisma.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function migrateSettings(settings: OldSetting[]) {
  const map = new Map(settings.map((item) => [item.key, item.value]));
  const siteTitle = String(map.get("site_title") || "").trim();
  const siteUrl = String(map.get("site_url") || "").trim().replace(/\/+$/, "");
  if (siteTitle) await upsertSetting(FILESTORE_SITE_TITLE_KEY, /^filestore(?:\s|$)/i.test(siteTitle) ? SITE_TITLE_DEFAULT : siteTitle.slice(0, 80));
  if (siteUrl) await upsertSetting(FILESTORE_SITE_URL_KEY, siteUrl.slice(0, 240));

  const templates = parseJson(map.get("task_templates"), []);
  if (!Array.isArray(templates)) return;
  await prisma.fileCollectTemplate.deleteMany({ where: { visibility: FILESTORE_TEMPLATE_VISIBILITY } });
  for (const item of templates) {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = String(source.name || "").trim().slice(0, 60);
    if (!name) continue;
    await prisma.fileCollectTemplate.create({
      data: {
        name,
        description: String(source.description || "").trim().slice(0, 1000) || null,
        visibility: FILESTORE_TEMPLATE_VISIBILITY,
        fields: JSON.stringify(normalizeFields(source.fields)),
        fileRules: JSON.stringify(normalizeRules(source.fileRules)),
        renameTemplate: String(source.renameTemplate || "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
        folderTemplate: String(source.folderTemplate || "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
        expectedEntries: String(source.expectedEntries || "").trim().slice(0, 20000),
        createdById: null,
      },
    });
  }
  if (templates.length) log(`已迁移全局模板 ${templates.length} 个`);
}

async function migrateTasks(dump: SqliteDump) {
  const submissionsByTask = new Map<number, OldSubmission[]>();
  for (const submission of dump.submissions) {
    const taskId = Number(submission.task_id);
    if (!Number.isInteger(taskId)) continue;
    const list = submissionsByTask.get(taskId) || [];
    list.push(submission);
    submissionsByTask.set(taskId, list);
  }
  const filesBySubmission = new Map<number, OldFile[]>();
  for (const file of dump.files) {
    const submissionId = Number(file.submission_id);
    if (!Number.isInteger(submissionId)) continue;
    const list = filesBySubmission.get(submissionId) || [];
    list.push(file);
    filesBySubmission.set(submissionId, list);
  }

  let migratedTasks = 0;
  let migratedSubmissions = 0;
  let migratedFiles = 0;
  for (const oldTask of dump.tasks) {
    const token = String(oldTask.token || "").trim();
    const title = String(oldTask.title || "").trim();
    if (!token || !title) continue;
    const exists = await prisma.fileCollectTask.findUnique({ where: { slug: token }, select: { id: true } });
    if (exists) {
      log(`跳过已存在任务：${title} (${token})`);
      continue;
    }
    const createdAt = parseDate(oldTask.created_at) || new Date();
    const status = normalizeStatus(oldTask.status);
    const newTask = await prisma.fileCollectTask.create({
      data: {
        slug: token,
        title: title.slice(0, 120),
        description: String(oldTask.description || "").trim().slice(0, 1000) || null,
        status,
        visibility: "public",
        fields: JSON.stringify(normalizeFields(parseJson(oldTask.fields_json, []))),
        fileRules: JSON.stringify(normalizeRules(parseJson(oldTask.file_rules_json, {}))),
        renameTemplate: String(oldTask.rename_template || "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
        folderTemplate: String(oldTask.folder_template || "{name}-{student_id}").trim().slice(0, 120) || "{name}-{student_id}",
        expectedEntries: String(oldTask.expected_entries || "").trim().slice(0, 20000),
        deadline: parseDate(oldTask.deadline),
        createdById: await existingUserId(oldTask.created_by_user_id),
        createdAt,
        publishedAt: status === "open" ? createdAt : null,
        closedAt: status === "closed" ? createdAt : null,
      },
    });
    migratedTasks += 1;

    const oldSubmissions = (submissionsByTask.get(Number(oldTask.id)) || []).sort((a, b) => Number(a.id) - Number(b.id));
    for (const oldSubmission of oldSubmissions) {
      const data = parseJson(oldSubmission.data_json, {}) as Record<string, unknown>;
      const createdAt = parseDate(oldSubmission.created_at) || new Date();
      const newSubmission = await prisma.fileCollectSubmission.create({
        data: {
          taskId: newTask.id,
          submitterId: null,
          identity: submissionIdentity(data),
          data: JSON.stringify(data),
          ip: String(oldSubmission.ip || ""),
          status: "submitted",
          createdAt,
        },
      });
      migratedSubmissions += 1;

      const oldFiles = (filesBySubmission.get(Number(oldSubmission.id)) || []).sort((a, b) => Number(a.id) - Number(b.id));
      const taskUploadDir = path.join(uploadRoot, String(newTask.id));
      await mkdir(taskUploadDir, { recursive: true });
      for (const oldFile of oldFiles) {
        const source = path.resolve(filestoreRoot, String(oldFile.path || ""));
        const sourceStat = await stat(source).catch(() => null);
        if (!sourceStat?.isFile()) {
          log(`跳过缺失文件：${source}`);
          continue;
        }
        const storedName = String(oldFile.stored_name || oldFile.original_name || "file");
        const physicalName = `${newSubmission.id}-${Number(oldFile.id) || 0}-${randomUUID()}-${safeStoredFilename(storedName)}`;
        const target = path.join(taskUploadDir, physicalName);
        await copyFile(source, target);
        await prisma.fileCollectFile.create({
          data: {
            submissionId: newSubmission.id,
            originalName: String(oldFile.original_name || storedName),
            storedName,
            mimeType: String(oldFile.mime_type || "application/octet-stream"),
            size: Number(oldFile.size || sourceStat.size || 0),
            path: path.posix.join("file-collect", String(newTask.id), physicalName),
            createdAt,
          },
        });
        migratedFiles += 1;
      }
    }
    const [submissionCount, fileCount] = await Promise.all([
      prisma.fileCollectSubmission.count({ where: { taskId: newTask.id, status: "submitted" } }),
      prisma.fileCollectFile.count({ where: { submission: { taskId: newTask.id, status: "submitted" } } }),
    ]);
    await prisma.fileCollectTask.update({
      where: { id: newTask.id },
      data: { submissionCount, fileCount },
    });
  }
  log(`迁移完成：任务 ${migratedTasks} 个，提交 ${migratedSubmissions} 条，文件 ${migratedFiles} 个`);
}

async function main() {
  const dump = readSqliteDump();
  if (!dump) return;
  await mkdir(uploadRoot, { recursive: true });
  await migrateSettings(dump.settings);
  await migrateTasks(dump);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
