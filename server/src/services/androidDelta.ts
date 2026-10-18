import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Incremental Android updates (`CPUDLT01`). The Android applier is
 * `android/app/src/main/java/cn/lizmt/cpuweb/schedule/update/ApkDelta.kt`.
 *
 * A patch rebuilds the published APK byte for byte from the installed one, so
 * the APK signature stays valid. It walks the new APK's ZIP entries in file
 * order: unchanged entries are copied from the old APK, uncompressed entries
 * that changed (DEX, resources.arsc) become a bsdiff-style difference against
 * the old entry, and everything else (changed compressed entries, the signing
 * block, the central directory) is literal. The operation stream is deflated.
 */

const MAGIC = Buffer.from("CPUDLT01", "ascii");
const OP_END = 0x00;
const OP_COPY = 0x01;
const OP_DATA = 0x02;
const OP_DIFF = 0x03;

export type DeltaHeader = { fromSize: number; fromSha256: string; toSize: number; toSha256: string };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// region ZIP layout

type ZipEntry = {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  headerOffset: number;
  dataOffset: number;
  /** The local header, the data and any data descriptor. */
  end: number;
};

/** Entries of a ZIP (APK) in file order, from its central directory. */
export function zipEntries(bytes: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 65_535); index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP：找不到中央目录结尾");
  const count = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error("不支持 ZIP64 安装包");
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("中央目录损坏");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const headerOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (bytes.readUInt32LE(headerOffset) !== 0x04034b50) throw new Error(`本地文件头损坏：${name}`);
    const localName = bytes.readUInt16LE(headerOffset + 26);
    const localExtra = bytes.readUInt16LE(headerOffset + 28);
    const dataOffset = headerOffset + 30 + localName + localExtra;
    let end = dataOffset + compressedSize;
    if (flags & 0x08) end += bytes.readUInt32LE(end) === 0x08074b50 ? 16 : 12;
    entries.push({ name, method, crc, compressedSize, headerOffset, dataOffset, end });
  }
  return entries.sort((a, b) => a.headerOffset - b.headerOffset);
}

// endregion

// region bsdiff (Colin Percival's bsdiff 4.3, ported)

/** Larsson–Sadakane suffix sorting, with the recursion of `split` replaced by an explicit stack. */
function suffixArray(old: Uint8Array): Int32Array {
  const size = old.length;
  const I = new Int32Array(size + 1);
  const V = new Int32Array(size + 1);
  const buckets = new Int32Array(256);
  for (let i = 0; i < size; i += 1) buckets[old[i]] += 1;
  for (let i = 1; i < 256; i += 1) buckets[i] += buckets[i - 1];
  for (let i = 255; i > 0; i -= 1) buckets[i] = buckets[i - 1];
  buckets[0] = 0;
  for (let i = 0; i < size; i += 1) I[++buckets[old[i]]] = i;
  I[0] = size;
  for (let i = 0; i < size; i += 1) V[i] = buckets[old[i]];
  V[size] = 0;
  for (let i = 1; i < 256; i += 1) if (buckets[i] === buckets[i - 1] + 1) I[buckets[i]] = -1;
  I[0] = -1;

  // Tasks: [kind, a, b] with kind 0 = split(a, b), 1 = finish the middle group [a, b).
  const stack: number[] = [];
  const split = (rootStart: number, rootLength: number, h: number) => {
    stack.push(0, rootStart, rootLength);
    while (stack.length) {
      const b = stack.pop()!;
      const a = stack.pop()!;
      const kind = stack.pop()!;
      if (kind === 1) {
        const jj = a;
        const kk = b;
        for (let i = 0; i < kk - jj; i += 1) V[I[jj + i]] = kk - 1;
        if (jj === kk - 1) I[jj] = -1;
        continue;
      }
      const start = a;
      const length = b;
      if (length < 16) {
        for (let k = start; k < start + length;) {
          let j = 1;
          let x = V[I[k] + h];
          for (let i = 1; k + i < start + length; i += 1) {
            if (V[I[k + i] + h] < x) { x = V[I[k + i] + h]; j = 0; }
            if (V[I[k + i] + h] === x) {
              const swap = I[k + j]; I[k + j] = I[k + i]; I[k + i] = swap;
              j += 1;
            }
          }
          for (let i = 0; i < j; i += 1) V[I[k + i]] = k + j - 1;
          if (j === 1) I[k] = -1;
          k += j;
        }
        continue;
      }
      const x = V[I[start + (length >> 1)] + h];
      let jj = 0;
      let kk = 0;
      for (let i = start; i < start + length; i += 1) {
        if (V[I[i] + h] < x) jj += 1;
        if (V[I[i] + h] === x) kk += 1;
      }
      jj += start;
      kk += jj;
      let i = start;
      let j = 0;
      let k = 0;
      while (i < jj) {
        if (V[I[i] + h] < x) {
          i += 1;
        } else if (V[I[i] + h] === x) {
          const swap = I[i]; I[i] = I[jj + j]; I[jj + j] = swap;
          j += 1;
        } else {
          const swap = I[i]; I[i] = I[kk + k]; I[kk + k] = swap;
          k += 1;
        }
      }
      while (jj + j < kk) {
        if (V[I[jj + j] + h] === x) {
          j += 1;
        } else {
          const swap = I[jj + j]; I[jj + j] = I[kk + k]; I[kk + k] = swap;
          k += 1;
        }
      }
      // Same order as the recursive original: left part, middle group, right part.
      if (start + length > kk) stack.push(0, kk, start + length - kk);
      stack.push(1, jj, kk);
      if (jj > start) stack.push(0, start, jj - start);
    }
  };

  for (let h = 1; I[0] !== -(size + 1); h += h) {
    let length = 0;
    let i = 0;
    while (i < size + 1) {
      if (I[i] < 0) {
        length -= I[i];
        i -= I[i];
      } else {
        if (length) I[i - length] = -length;
        length = V[I[i]] + 1 - i;
        split(i, length, h);
        i += length;
        length = 0;
      }
    }
    if (length) I[i - length] = -length;
  }
  for (let i = 0; i < size + 1; i += 1) I[V[i]] = i;
  return I;
}

function matchLength(old: Uint8Array, oldStart: number, next: Uint8Array, nextStart: number): number {
  const limit = Math.min(old.length - oldStart, next.length - nextStart);
  let i = 0;
  while (i < limit && old[oldStart + i] === next[nextStart + i]) i += 1;
  return i;
}

function compare(old: Buffer, oldStart: number, next: Buffer, nextStart: number): number {
  const length = Math.min(old.length - oldStart, next.length - nextStart);
  return Buffer.compare(old.subarray(oldStart, oldStart + length), next.subarray(nextStart, nextStart + length));
}

function search(I: Int32Array, old: Buffer, next: Buffer, nextStart: number, start: number, end: number): { pos: number; length: number } {
  let st = start;
  let en = end;
  while (en - st >= 2) {
    const x = st + ((en - st) >> 1);
    if (compare(old, I[x], next, nextStart) < 0) st = x;
    else en = x;
  }
  const x = matchLength(old, I[st], next, nextStart);
  const y = matchLength(old, I[en], next, nextStart);
  return x > y ? { pos: I[st], length: x } : { pos: I[en], length: y };
}

type Control = { add: Uint8Array; extra: Uint8Array; seek: number };

/** The bsdiff controls turning [old] into [next]: add diff bytes, copy extra bytes, move in [old]. */
export function bsdiff(old: Buffer, next: Buffer): Control[] {
  const controls: Control[] = [];
  const I = suffixArray(old);
  const oldSize = old.length;
  const newSize = next.length;
  let scan = 0;
  let len = 0;
  let pos = 0;
  let lastScan = 0;
  let lastPos = 0;
  let lastOffset = 0;
  while (scan < newSize) {
    let oldScore = 0;
    let scsc = (scan += len);
    for (; scan < newSize; scan += 1) {
      const found = search(I, old, next, scan, 0, oldSize);
      pos = found.pos;
      len = found.length;
      for (; scsc < scan + len; scsc += 1) {
        if (scsc + lastOffset < oldSize && old[scsc + lastOffset] === next[scsc]) oldScore += 1;
      }
      if ((len === oldScore && len !== 0) || len > oldScore + 8) break;
      if (scan + lastOffset < oldSize && old[scan + lastOffset] === next[scan]) oldScore -= 1;
    }
    if (len !== oldScore || scan === newSize) {
      let s = 0;
      let sf = 0;
      let lenf = 0;
      for (let i = 0; lastScan + i < scan && lastPos + i < oldSize;) {
        if (old[lastPos + i] === next[lastScan + i]) s += 1;
        i += 1;
        if (s * 2 - i > sf * 2 - lenf) { sf = s; lenf = i; }
      }
      let lenb = 0;
      if (scan < newSize) {
        let sb = 0;
        s = 0;
        for (let i = 1; scan >= lastScan + i && pos >= i; i += 1) {
          if (old[pos - i] === next[scan - i]) s += 1;
          if (s * 2 - i > sb * 2 - lenb) { sb = s; lenb = i; }
        }
      }
      if (lastScan + lenf > scan - lenb) {
        const overlap = lastScan + lenf - (scan - lenb);
        let ss = 0;
        let lens = 0;
        s = 0;
        for (let i = 0; i < overlap; i += 1) {
          if (next[lastScan + lenf - overlap + i] === old[lastPos + lenf - overlap + i]) s += 1;
          if (next[scan - lenb + i] === old[pos - lenb + i]) s -= 1;
          if (s > ss) { ss = s; lens = i + 1; }
        }
        lenf += lens - overlap;
        lenb -= lens;
      }
      const add = new Uint8Array(lenf);
      for (let i = 0; i < lenf; i += 1) add[i] = (next[lastScan + i] - old[lastPos + i]) & 0xff;
      const extraLength = scan - lenb - (lastScan + lenf);
      const extra = next.subarray(lastScan + lenf, lastScan + lenf + extraLength);
      controls.push({ add, extra, seek: pos - lenb - (lastPos + lenf) });
      lastScan = scan - lenb;
      lastPos = pos - lenb;
      lastOffset = pos - scan;
    }
  }
  return controls;
}

// endregion

// region Encoding

class Writer {
  private chunks: Buffer[] = [];
  private pending: number[] = [];

  byte(value: number) { this.pending.push(value & 0xff); }

  varint(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`无效的长度 ${value}`);
    let remaining = value;
    while (remaining >= 0x80) {
      this.pending.push((remaining % 0x80) | 0x80);
      remaining = Math.floor(remaining / 0x80);
    }
    this.pending.push(remaining);
  }

  zigzag(value: number) { this.varint(value >= 0 ? value * 2 : -value * 2 - 1); }

  bytes(value: Uint8Array) {
    this.flush();
    this.chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }

  private flush() {
    if (this.pending.length) { this.chunks.push(Buffer.from(this.pending)); this.pending = []; }
  }

  result() { this.flush(); return Buffer.concat(this.chunks); }
}

type Op =
  | { kind: "copy"; offset: number; length: number }
  | { kind: "data"; bytes: Buffer }
  | { kind: "diff"; oldOffset: number; oldLength: number; next: Buffer };

export type DeltaStats = { copied: number; literal: number; diffed: number; diffedEntries: string[] };

/** Builds a patch from [old] to [next]; both are whole APK files. */
export function createApkDelta(old: Buffer, next: Buffer, options: { minDiffBytes?: number } = {}): { patch: Buffer; stats: DeltaStats } {
  const minDiff = options.minDiffBytes ?? 4096;
  const oldEntries = zipEntries(old);
  const newEntries = zipEntries(next);
  const byName = new Map(oldEntries.map((entry) => [entry.name, entry]));
  const byContent = new Map<string, ZipEntry[]>();
  for (const entry of oldEntries) {
    const key = `${entry.crc}:${entry.compressedSize}:${entry.method}`;
    byContent.set(key, [...(byContent.get(key) ?? []), entry]);
  }
  const ops: Op[] = [];
  const stats: DeltaStats = { copied: 0, literal: 0, diffed: 0, diffedEntries: [] };
  const sameBytes = (a: Buffer, aStart: number, b: Buffer, bStart: number, length: number) =>
    a.subarray(aStart, aStart + length).equals(b.subarray(bStart, bStart + length));
  const data = (start: number, end: number) => {
    if (end > start) { ops.push({ kind: "data", bytes: next.subarray(start, end) }); stats.literal += end - start; }
  };
  const copy = (offset: number, length: number) => {
    if (length > 0) { ops.push({ kind: "copy", offset, length }); stats.copied += length; }
  };

  let cursor = 0;
  for (const entry of newEntries) {
    data(cursor, entry.headerOffset);
    const headerLength = entry.dataOffset - entry.headerOffset;
    const named = byName.get(entry.name);
    // Local headers rarely change; copying them keeps unchanged entries to one operation.
    if (named && named.dataOffset - named.headerOffset === headerLength && sameBytes(old, named.headerOffset, next, entry.headerOffset, headerLength)) {
      copy(named.headerOffset, headerLength);
    } else {
      data(entry.headerOffset, entry.dataOffset);
    }
    const candidates = [named, ...(byContent.get(`${entry.crc}:${entry.compressedSize}:${entry.method}`) ?? [])]
      .filter((value): value is ZipEntry => Boolean(value));
    const identical = candidates.find((candidate) => candidate.compressedSize === entry.compressedSize
      && sameBytes(old, candidate.dataOffset, next, entry.dataOffset, entry.compressedSize));
    const dataEnd = entry.dataOffset + entry.compressedSize;
    if (identical) {
      copy(identical.dataOffset, entry.compressedSize);
    } else if (named && named.method === 0 && entry.method === 0 && entry.compressedSize >= minDiff && named.compressedSize >= minDiff) {
      ops.push({ kind: "diff", oldOffset: named.dataOffset, oldLength: named.compressedSize, next: next.subarray(entry.dataOffset, dataEnd) });
      stats.diffed += entry.compressedSize;
      stats.diffedEntries.push(entry.name);
    } else {
      data(entry.dataOffset, dataEnd);
    }
    data(dataEnd, entry.end);
    cursor = entry.end;
  }
  data(cursor, next.length);

  // Merge neighbours so the stream stays short.
  const merged: Op[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last?.kind === "copy" && op.kind === "copy" && last.offset + last.length === op.offset) last.length += op.length;
    else if (last?.kind === "data" && op.kind === "data") merged[merged.length - 1] = { kind: "data", bytes: Buffer.concat([last.bytes, op.bytes]) };
    else merged.push(op.kind === "copy" ? { ...op } : op);
  }

  const writer = new Writer();
  for (const op of merged) {
    if (op.kind === "copy") {
      writer.byte(OP_COPY); writer.varint(op.offset); writer.varint(op.length);
    } else if (op.kind === "data") {
      writer.byte(OP_DATA); writer.varint(op.bytes.length); writer.bytes(op.bytes);
    } else {
      const oldPart = old.subarray(op.oldOffset, op.oldOffset + op.oldLength);
      writer.byte(OP_DIFF); writer.varint(op.oldOffset); writer.varint(op.oldLength); writer.varint(op.next.length);
      for (const control of bsdiff(oldPart, op.next)) {
        writer.varint(control.add.length); writer.bytes(control.add);
        writer.varint(control.extra.length); writer.bytes(control.extra);
        writer.zigzag(control.seek);
      }
    }
  }
  writer.byte(OP_END);
  const header: DeltaHeader = { fromSize: old.length, fromSha256: sha256(old), toSize: next.length, toSha256: sha256(next) };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  const patch = Buffer.concat([MAGIC, length, headerBytes, deflateRawSync(writer.result(), { level: 9 })]);
  return { patch, stats };
}

// endregion

// region Applying (used to check every patch before it is published)

export function readDeltaHeader(patch: Buffer): { header: DeltaHeader; bodyOffset: number } {
  if (patch.length < 12 || !patch.subarray(0, 8).equals(MAGIC)) throw new Error("不是增量更新包");
  const length = patch.readUInt32BE(8);
  if (length <= 0 || length > 4096 || 12 + length > patch.length) throw new Error("增量更新包头部无效");
  const header = JSON.parse(patch.toString("utf8", 12, 12 + length)) as DeltaHeader;
  return { header, bodyOffset: 12 + length };
}

export function applyApkDelta(old: Buffer, patch: Buffer): Buffer {
  const { header, bodyOffset } = readDeltaHeader(patch);
  if (old.length !== header.fromSize || sha256(old) !== header.fromSha256) throw new Error("增量包与旧版安装包不匹配");
  const body = inflateRawSync(patch.subarray(bodyOffset));
  const out = Buffer.alloc(header.toSize);
  let written = 0;
  let p = 0;
  const varint = () => {
    let result = 0;
    let multiplier = 1;
    for (;;) {
      if (p >= body.length) throw new Error("增量更新包不完整");
      const byte = body[p++];
      result += (byte & 0x7f) * multiplier;
      if (!(byte & 0x80)) return result;
      multiplier *= 0x80;
    }
  };
  const take = (length: number) => {
    if (p + length > body.length) throw new Error("增量更新包不完整");
    const slice = body.subarray(p, p + length);
    p += length;
    return slice;
  };
  const write = (bytes: Uint8Array) => {
    if (written + bytes.length > out.length) throw new Error("合成的安装包超出预期大小");
    out.set(bytes, written);
    written += bytes.length;
  };
  for (;;) {
    const op = body[p++];
    if (op === OP_END) break;
    if (op === OP_COPY) {
      const offset = varint();
      const length = varint();
      if (offset + length > old.length) throw new Error("增量更新包引用越界");
      write(old.subarray(offset, offset + length));
    } else if (op === OP_DATA) {
      write(take(varint()));
    } else if (op === OP_DIFF) {
      const oldOffset = varint();
      const oldLength = varint();
      const newLength = varint();
      if (oldOffset + oldLength > old.length) throw new Error("增量更新包引用越界");
      const source = old.subarray(oldOffset, oldOffset + oldLength);
      let produced = 0;
      let oldPos = 0;
      while (produced < newLength) {
        const add = take(varint());
        const mixed = Buffer.alloc(add.length);
        for (let i = 0; i < add.length; i += 1) {
          const at = oldPos + i;
          mixed[i] = (add[i] + (at >= 0 && at < source.length ? source[at] : 0)) & 0xff;
        }
        write(mixed);
        oldPos += add.length;
        const extra = take(varint());
        write(extra);
        produced += add.length + extra.length;
        const seek = varint();
        oldPos += seek % 2 === 0 ? seek / 2 : -(seek + 1) / 2;
      }
      if (produced !== newLength) throw new Error("增量更新包控制数据无效");
    } else {
      throw new Error(`增量更新包含有未知操作 ${op}`);
    }
  }
  if (written !== header.toSize || sha256(out) !== header.toSha256) throw new Error("合成的安装包校验失败");
  return out;
}

// endregion
