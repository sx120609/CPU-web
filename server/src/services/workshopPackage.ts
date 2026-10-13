import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { z } from "zod";
import { Errors } from "../utils/response";

export const WORKSHOP_MAX_ZIP_BYTES = 20 * 1024 * 1024;
export const WORKSHOP_MAX_EXPANDED_BYTES = 60 * 1024 * 1024;
export const WORKSHOP_MAX_FILE_BYTES = 12 * 1024 * 1024;
export const WORKSHOP_MAX_FILES = 512;
export const WORKSHOP_MAX_MANIFEST_BYTES = 16 * 1024;

const extensions = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".wasm",
  ".txt",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".ogg",
  ".wav",
  ".m4a",
  ".mp4",
  ".webm",
]);

/** Package paths also become URL paths. Reject ambiguous separators/encodings before JSZip sanitizes them. */
export function safeWorkshopPath(value: string, directory = false) {
  const name = directory && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!name || name.length > 240 || /[\\\x00-\x20\x7f%?#:]/u.test(name) || name.startsWith("/")) {
    throw Errors.badRequest("作品包包含不安全的文件路径");
  }
  const segments = name.split("/");
  if (
    segments.some(
      (part) =>
        !part || part === "." || part === ".." || part.startsWith(".") || part.endsWith("."),
    )
  ) {
    throw Errors.badRequest("作品包包含不安全的文件路径");
  }
  if (!directory && !extensions.has(path.posix.extname(name).toLowerCase())) {
    throw Errors.badRequest(`作品包不支持此文件类型：${name}`);
  }
  return name;
}

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const workshopManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    type: z.enum(["game", "tool", "extension"]),
    name: z.string().trim().min(1).max(80),
    version: z.string().max(80).regex(semver, "版本号必须符合 SemVer，例如 1.0.0"),
    description: z.string().trim().min(1).max(2000),
    entry: z
      .string()
      .max(240)
      .refine((entry) => {
        try {
          safeWorkshopPath(entry);
          return /\.html?$/i.test(entry);
        } catch {
          return false;
        }
      }, "入口必须是安全的 HTML 文件路径"),
    permissions: z
      .array(
        z.enum([
          "storage",
          "site.public",
          "ui.toast",
          "ui.confirm",
          "navigation",
          "fullscreen",
          "motion.shake",
        ]),
      )
      .max(32)
      .refine((items) => new Set(items).size === items.length, "权限不能重复")
      .optional(),
    extension: z
      .object({
        slots: z
          .array(z.enum(["splash", "dialog"]))
          .min(1)
          .max(2)
          .refine((items) => new Set(items).size === items.length, "位置不能重复"),
      })
      .strict()
      .optional(),
    game: z
      .object({
        orientation: z.enum(["portrait", "landscape", "any"]),
        controls: z
          .array(z.enum(["pointer", "keyboard", "touch"]))
          .min(1)
          .max(3)
          .refine((items) => new Set(items).size === items.length, "操作方式不能重复"),
        aspectRatio: z.number().finite().min(0.1).max(10).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if ((manifest.type === "extension") !== Boolean(manifest.extension))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extension"],
        message: "站点插件必须声明 extension 位置，其他作品不能声明",
      });
    if (manifest.type === "game" && !manifest.game) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game"],
        message: "游戏作品必须声明 game 操作与方向配置",
      });
    }
    if (manifest.type !== "game" && manifest.game) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["game"],
        message: "非游戏作品不能声明 game 配置",
      });
    }
  });
export type WorkshopManifest = z.infer<typeof workshopManifestSchema>;

type ZipEntry = { name: string; directory: boolean; bytes: number };

/** Inspect raw central/local names: JSZip otherwise overwrites duplicates and normalizes traversal. */
export function inspectWorkshopZip(buffer: Buffer): ZipEntry[] {
  if (buffer.length > WORKSHOP_MAX_ZIP_BYTES || buffer.length < 22)
    throw Errors.badRequest("ZIP 文件无效或超过 20 MiB");
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw Errors.badRequest("ZIP 文件目录无效");
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  const start = buffer.readUInt32LE(end + 16);
  if (
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0 ||
    buffer.readUInt16LE(end + 8) !== count ||
    count === 0 ||
    count > WORKSHOP_MAX_FILES ||
    start + size !== end ||
    count === 0xffff ||
    start === 0xffffffff
  ) {
    throw Errors.badRequest("仅支持单卷普通 ZIP，最多 512 个文件及目录");
  }
  const entries: ZipEntry[] = [];
  const seen = new Map<string, boolean>();
  let expanded = 0;
  let cursor = start;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw Errors.badRequest("ZIP 文件目录损坏");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const bytes = buffer.readUInt32LE(cursor + 24);
    const nameBytes = buffer.readUInt16LE(cursor + 28);
    const extraBytes = buffer.readUInt16LE(cursor + 30);
    const commentBytes = buffer.readUInt16LE(cursor + 32);
    const disk = buffer.readUInt16LE(cursor + 34);
    const attributes = buffer.readUInt32LE(cursor + 38);
    const local = buffer.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameBytes + extraBytes + commentBytes;
    if (
      next > end ||
      !nameBytes ||
      disk !== 0 ||
      flags & 0x2041 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      bytes > WORKSHOP_MAX_FILE_BYTES ||
      local + 30 > start
    ) {
      throw Errors.badRequest("ZIP 包含加密、特殊或过大的文件");
    }
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameBytes);
    const original = rawName.toString("utf8");
    if (!Buffer.from(original).equals(rawName)) throw Errors.badRequest("ZIP 文件名必须使用 UTF-8");
    const mode = (attributes >>> 16) & 0o170000;
    if (mode && mode !== 0o100000 && mode !== 0o040000)
      throw Errors.badRequest("ZIP 不允许符号链接或特殊文件");
    const directory = original.endsWith("/");
    if ((mode === 0o040000 && !directory) || (directory && bytes !== 0))
      throw Errors.badRequest("ZIP 目录格式无效");
    const name = safeWorkshopPath(original, directory);
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw Errors.badRequest("ZIP 包含重复或大小写冲突的路径");
    seen.set(folded, directory);
    if (
      buffer.readUInt32LE(local) !== 0x04034b50 ||
      buffer.readUInt16LE(local + 6) !== flags ||
      buffer.readUInt16LE(local + 8) !== method ||
      buffer.readUInt16LE(local + 26) !== nameBytes
    ) {
      throw Errors.badRequest("ZIP 本地目录与文件目录不一致");
    }
    const localExtra = buffer.readUInt16LE(local + 28);
    if (
      !buffer.subarray(local + 30, local + 30 + nameBytes).equals(rawName) ||
      local + 30 + nameBytes + localExtra + compressed > start
    )
      throw Errors.badRequest("ZIP 文件路径或内容无效");
    expanded += bytes;
    if (expanded > WORKSHOP_MAX_EXPANDED_BYTES) throw Errors.badRequest("ZIP 解压后最多 60 MiB");
    entries.push({ name, directory, bytes });
    cursor = next;
  }
  if (cursor !== end) throw Errors.badRequest("ZIP 文件目录长度无效");
  for (const [name] of seen) {
    const segments = name.split("/");
    for (let count = 1; count < segments.length; count++) {
      if (seen.get(segments.slice(0, count).join("/")) === false)
        throw Errors.badRequest("ZIP 文件与目录路径冲突");
    }
  }
  return entries;
}

export function workshopStorageRoot() {
  // Outside publicly served uploads. Operators must persist this alongside the database.
  return path.resolve(
    process.env.WORKSHOP_STORAGE_ROOT?.trim() || path.join(__dirname, "../../workshop-packages"),
  );
}

export async function extractWorkshopPackage(buffer: Buffer, root = workshopStorageRoot()) {
  const entries = inspectWorkshopZip(buffer);
  if (
    !entries.some(
      (entry) =>
        entry.name === "manifest.json" &&
        !entry.directory &&
        entry.bytes <= WORKSHOP_MAX_MANIFEST_BYTES,
    )
  ) {
    throw Errors.badRequest("ZIP 根目录必须包含 manifest.json（最多 16 KiB）");
  }
  const packageKey = randomUUID();
  const directory = path.join(root, packageKey);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let totalBytes = 0;
  try {
    const zip = await JSZip.loadAsync(buffer, { createFolders: false });
    for (const entry of entries) {
      if (entry.directory) continue;
      const file = zip.file(entry.name);
      if (
        !file ||
        (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName !==
          entry.name
      ) {
        throw Errors.badRequest("ZIP 文件路径无法安全读取");
      }
      const destination = path.join(directory, entry.name);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      let fileBytes = 0;
      const bound = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          fileBytes += chunk.length;
          totalBytes += chunk.length;
          const max =
            entry.name === "manifest.json" ? WORKSHOP_MAX_MANIFEST_BYTES : WORKSHOP_MAX_FILE_BYTES;
          if (
            fileBytes > max ||
            fileBytes > entry.bytes ||
            totalBytes > WORKSHOP_MAX_EXPANDED_BYTES
          ) {
            callback(Errors.badRequest("ZIP 实际解压内容超过大小限制"));
          } else callback(null, chunk);
        },
      });
      await pipeline(
        file.nodeStream("nodebuffer"),
        bound,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
      if (fileBytes !== entry.bytes) throw Errors.badRequest("ZIP 声明大小与实际内容不一致");
    }
    let input: unknown;
    try {
      input = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    } catch {
      throw Errors.badRequest("manifest.json 必须是合法 JSON");
    }
    const result = workshopManifestSchema.safeParse(input);
    if (!result.success)
      throw Errors.badRequest(`作品清单无效：${result.error.issues[0]?.message || "字段错误"}`);
    const manifest = result.data;
    const files = entries.filter((entry) => !entry.directory).map((entry) => entry.name);
    if (!files.includes(manifest.entry)) throw Errors.badRequest("清单指定的 HTML 入口不存在");
    return { packageKey, manifest, files, totalBytes };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error && typeof error === "object" && "status" in error) throw error;
    throw Errors.badRequest("ZIP 作品包损坏或无法解压");
  }
}

export async function removeWorkshopPackage(packageKey: string) {
  if (!/^[a-f0-9-]{36}$/.test(packageKey)) throw Errors.badRequest("作品包标识无效");
  await rm(path.join(workshopStorageRoot(), packageKey), { recursive: true, force: true });
}
