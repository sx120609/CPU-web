#!/usr/bin/env node
import { constants } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAgentPrompt } from "../src/agent-prompt.js";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maxFiles = 512;
const maxBytes = 60 * 1024 * 1024;
const allowed = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".wasm",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".avif",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".mp4",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".txt",
]);
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function pathInside(root, path) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function validateManifest(manifest) {
  assert(manifest && typeof manifest === "object", "manifest.json 必须是对象");
  assert(
    Object.keys(manifest).every((key) =>
      [
        "schemaVersion",
        "id",
        "type",
        "name",
        "version",
        "description",
        "entry",
        "permissions",
        "game",
        "extension",
      ].includes(key),
    ),
    "manifest 包含未支持的字段",
  );
  assert(manifest.schemaVersion === 1, "schemaVersion 必须是 1");
  assert(
    typeof manifest.id === "string" &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.id) &&
      manifest.id.length <= 80,
    "id 必须是最长 80 字符的小写 kebab-case",
  );
  assert(
    ["game", "tool", "extension"].includes(manifest.type),
    "type 必须是 game、tool 或 extension",
  );
  assert(
    typeof manifest.name === "string" &&
      manifest.name.trim().length > 0 &&
      manifest.name.trim().length <= 80,
    "name 必须是 1–80 字符",
  );
  assert(
    typeof manifest.description === "string" &&
      manifest.description.trim().length > 0 &&
      manifest.description.trim().length <= 2000,
    "description 必须是 1–2000 字符纯文本",
  );
  assert(
    !/[<>]/.test(manifest.name + manifest.description),
    "名称与介绍不可包含 HTML 标签",
  );
  assert(
    typeof manifest.version === "string" &&
      manifest.version.length <= 80 &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
        manifest.version,
      ),
    "version 必须是 semver，如 1.0.0",
  );
  assert(
    typeof manifest.entry === "string" && /\.html?$/i.test(manifest.entry),
    "entry 必须是包内 HTML 文件路径",
  );
  validatePath(manifest.entry);
  assert(
    manifest.permissions === undefined ||
      (Array.isArray(manifest.permissions) &&
        manifest.permissions.every((value) =>
          [
            "storage",
            "site.public",
            "ui.toast",
            "ui.confirm",
            "navigation",
            "fullscreen",
            "motion.shake",
          ].includes(value),
        ) &&
        new Set(manifest.permissions).size === manifest.permissions.length),
    "permissions 含有不支持或重复的权限",
  );
  if (manifest.type === "game") {
    const game = manifest.game;
    assert(
      game && ["portrait", "landscape", "any"].includes(game.orientation),
      "游戏需声明 game.orientation",
    );
    assert(
      Object.keys(game).every((key) =>
        ["orientation", "controls", "aspectRatio"].includes(key),
      ),
      "game 包含未支持的字段",
    );
    assert(
      Array.isArray(game.controls) &&
        game.controls.length > 0 &&
        game.controls.every((value) =>
          ["pointer", "keyboard", "touch"].includes(value),
        ) &&
        new Set(game.controls).size === game.controls.length,
      "游戏需声明有效且不重复的 game.controls",
    );
    assert(
      game.aspectRatio === undefined ||
        (typeof game.aspectRatio === "number" &&
          Number.isFinite(game.aspectRatio) &&
          game.aspectRatio >= 0.1 &&
          game.aspectRatio <= 10),
      "game.aspectRatio 必须是 [0.1, 10] 内的数值",
    );
  } else assert(manifest.game === undefined, "工具无需 game 配置");
  if (manifest.type === "extension") {
    const extension = manifest.extension;
    assert(
      extension &&
        typeof extension === "object" &&
        !Array.isArray(extension) &&
        Object.keys(extension).every((key) => key === "slots"),
      "extension 必须仅包含 slots",
    );
    assert(
      Array.isArray(extension.slots) &&
        extension.slots.length > 0 &&
        extension.slots.every((slot) => ["splash", "dialog"].includes(slot)) &&
        new Set(extension.slots).size === extension.slots.length,
      "extension.slots 必须是非空且不重复的 splash/dialog 列表",
    );
  } else assert(manifest.extension === undefined, "非插件不能声明 extension");
  return manifest;
}

function validatePath(name) {
  assert(
    name.length <= 240 &&
      !/[\\\x00-\x20\x7f%?#:]/.test(name) &&
      !name.startsWith("/") &&
      name
        .split("/")
        .every((part) => part && !part.startsWith(".") && !part.endsWith(".")),
    `非法文件路径：${name}`,
  );
}

async function collect(root) {
  const files = [];
  let total = 0;
  async function visit(folder) {
    for (const name of (await readdir(folder)).sort()) {
      assert(
        !name.startsWith(".") && name !== "node_modules",
        `请移除隐藏文件或依赖目录：${name}`,
      );
      const path = join(folder, name);
      const info = await lstat(path);
      assert(!info.isSymbolicLink(), `不支持符号链接：${relative(root, path)}`);
      if (info.isDirectory()) await visit(path);
      else {
        assert(info.isFile(), `不支持特殊文件：${path}`);
        const archiveName = relative(root, path).split(sep).join("/");
        validatePath(archiveName);
        assert(
          allowed.has(extname(name).toLowerCase()),
          `不支持文件类型：${archiveName}`,
        );
        assert(
          info.size <=
            (archiveName === "manifest.json" ? 16 * 1024 : 12 * 1024 * 1024),
          `文件超过大小限制：${archiveName}`,
        );
        assert(files.length < maxFiles, `最多 ${maxFiles} 个文件`);
        total += info.size;
        assert(total <= maxBytes, "解压后内容不能超过 60 MiB");
        files.push({ name: archiveName, data: await readFile(path) });
      }
    }
  }
  await visit(root);
  return files;
}

/** Useful early checks, not a security review; backend remains authoritative. */
function validateReferences(files) {
  const names = new Set(files.map((file) => file.name));
  for (const file of files) {
    if (![".html", ".css", ".js", ".mjs"].includes(extname(file.name)))
      continue;
    const source = file.data.toString("utf8");
    const patterns =
      extname(file.name) === ".html"
        ? [/(?:src|href)\s*=\s*["']([^"']+)["']/gi]
        : extname(file.name) === ".css"
          ? [
              /url\(\s*["']?([^\s)'"\n]+)["']?\s*\)/gi,
              /@import\s+["']([^"']+)["']/gi,
            ]
          : [
              /(?:\bimport\s*(?:[^;\n]*?\bfrom\s*)?|\bexport\s+[^;\n]*?\bfrom\s*)["']([^"']+)["']/g,
              /\bimport\(\s*["']([^"']+)["']\s*\)/g,
            ];
    for (const pattern of patterns)
      for (const match of source.matchAll(pattern)) {
        const ref = match[1];
        if (ref.startsWith("#") || ref.startsWith("data:")) continue;
        assert(
          !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(ref),
          `${file.name} 需要本地相对资源：${ref}`,
        );
        assert(!ref.includes("\\"), `资源引用不能含反斜杠：${ref}`);
        const resource = ref.split(/[?#]/)[0];
        let decoded;
        try {
          decoded = decodeURIComponent(resource);
        } catch {
          throw new Error(`无效资源 URL：${ref}`);
        }
        const absolute = resolve("/package", dirname(file.name), decoded);
        assert(pathInside("/package", absolute), `资源引用超出包目录：${ref}`);
        const archiveName = relative("/package", absolute).split(sep).join("/");
        assert(names.has(archiveName), `${file.name} 引用的资源不存在：${ref}`);
      }
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
/** ZIP with fixed 1980 timestamps, UTF-8 names and deflate; no extra dependency. */
function zip(files) {
  const entries = [];
  const directory = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const compressed = deflateRawSync(file.data, { level: 9 });
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    entries.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, directoryBytes, end]);
}

export async function scaffold(type, destination) {
  assert(
    ["game", "tool", "extension"].includes(type),
    "模板类型必须是 game、tool 或 extension",
  );
  const target = resolve(destination);
  try {
    await stat(target);
    throw new Error(`目标已存在，请选择空的新目录：${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(join(sdkRoot, "examples", type), target, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await mkdir(join(target, "workshop"));
  for (const name of type === "extension"
    ? ["sdk.js"]
    : ["sdk.js", "shells.js", `${type}-shell.css`])
    await cp(join(sdkRoot, "src", name), join(target, "workshop", name), {
      mode: constants.COPYFILE_EXCL,
    });
  const sdkTypes = await readFile(join(sdkRoot, "src/sdk.d.ts"), "utf8");
  const shellTypes = await readFile(join(sdkRoot, "src/shells.d.ts"), "utf8");
  await mkdir(join(target, "types"));
  await writeFile(join(target, "types/sdk-types.txt"), sdkTypes);
  if (type !== "extension")
    await writeFile(join(target, "types/shells-types.txt"), shellTypes);
  await writeFile(
    join(target, "AGENT-PROMPT.txt"),
    createAgentPrompt({ type, sdkTypes, shellTypes }),
  );
  return target;
}
export async function pack(source, output) {
  const root = await realpath(source);
  assert((await stat(root)).isDirectory(), "输入应是作品目录");
  const destination = resolve(output);
  assert(!pathInside(root, destination), "ZIP 输出必须位于作品目录之外");
  const files = await collect(root);
  const manifest = validateManifest(
    JSON.parse(
      files
        .find((file) => file.name === "manifest.json")
        ?.data.toString("utf8") || "null",
    ),
  );
  assert(
    files.some((file) => file.name === manifest.entry),
    "缺少 manifest.entry 指定的 HTML 入口",
  );
  validateReferences(files);
  await mkdir(dirname(destination), { recursive: true });
  const bytes = zip(files);
  assert(bytes.length <= 20 * 1024 * 1024, "ZIP 不能超过 20 MiB");
  await writeFile(destination, bytes);
  return {
    destination,
    files: files.length,
    bytes: files.reduce((total, file) => total + file.data.length, 0),
  };
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === "init" && rest.length === 2)
    console.log(`模板已创建：${await scaffold(rest[0], rest[1])}`);
  else if (command === "pack" && rest.length === 2) {
    const result = await pack(rest[0], rest[1]);
    console.log(
      `已打包 ${result.files} 个文件（解压 ${result.bytes} 字节）：${result.destination}`,
    );
  } else
    throw new Error(
      "用法：node workshop-sdk/bin/cli.mjs init game|tool|extension <新目录>\n      node workshop-sdk/bin/cli.mjs pack <作品目录> <输出.zip>",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
