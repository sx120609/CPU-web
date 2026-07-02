import type { FileCollectSubmission, FileCollectTask } from "@/api/tools";

export type FileCollectZipEntry = {
  path: string;
  bytes: Uint8Array;
  date: Date;
};

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function zipSafePathSegment(value: string) {
  return cleanRenderedName(String(value || "file").replace(/[\\/:*?"<>|]+/g, "_"));
}

function cleanRenderedName(value: string) {
  return safeStoredName(value).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

function safeStoredName(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160) || "file";
}

function renderFileCollectTemplate(template: string, data: Record<string, string>, originalName = "", index = 1, totalCount = 1) {
  const extIndex = originalName.lastIndexOf(".");
  const original = extIndex > 0 ? originalName.slice(0, extIndex) : originalName;
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, zipSafePathSegment(value)])),
    index: totalCount > 1 ? String(index) : "",
    original: zipSafePathSegment(original),
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return cleanRenderedName(rendered);
}

export function zipEntryPath(task: FileCollectTask, submission: FileCollectSubmission, file: FileCollectSubmission["files"][number]) {
  if (submission.files.length <= 1) return zipSafePathSegment(file.storedName);
  const folder = renderFileCollectTemplate(task.folderTemplate || "{name}-{student_id}", submission.data);
  return `${folder}/${zipSafePathSegment(file.storedName)}`;
}

export function uniqueZipPath(path: string, used: Set<string>) {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let next = `${dir}${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${dir}${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipHeader(fields: Array<[number, number]>) {
  const bytes = new Uint8Array(fields.reduce((sum, item) => sum + item[1], 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [value, size] of fields) {
    if (size === 2) view.setUint16(offset, value, true);
    if (size === 4) view.setUint32(offset, value, true);
    offset += size;
  }
  return bytes;
}

export function buildZip(entries: FileCollectZipEntry[]) {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.bytes;
    const crc = crc32(data);
    const { time, day } = dosDateTime(entry.date);
    const local = zipHeader([
      [0x04034b50, 4], [20, 2], [0x0800, 2], [0, 2], [time, 2], [day, 2],
      [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2],
    ]);
    parts.push(blobPart(local), blobPart(name), blobPart(data));
    const centralHeader = zipHeader([
      [0x02014b50, 4], [20, 2], [20, 2], [0x0800, 2], [0, 2], [time, 2], [day, 2],
      [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2],
      [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4],
    ]);
    central.push(blobPart(centralHeader), blobPart(name));
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + (part as ArrayBuffer).byteLength, 0);
  const end = zipHeader([
    [0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2],
    [centralSize, 4], [offset, 4], [0, 2],
  ]);
  return new Blob([...parts, ...central, blobPart(end)], { type: "application/zip" });
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
