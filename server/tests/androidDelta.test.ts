import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { applyApkDelta, bsdiff, createApkDelta, readDeltaHeader, zipEntries } from "../src/services/androidDelta";

/** A minimal ZIP writer: stored and deflated entries, like an APK without its signature. */
function zip(entries: { name: string; data: Buffer; stored: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const body = entry.stored ? entry.data : deflateRawSync(entry.data);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(entry.stored ? 0 : 8, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function random(seed: number, length: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

/** DEX-like bytes: records with counters, so a code change shifts and edits many of them. */
function structured(seed: number, records: number): Buffer {
  const pool = random(seed, 4096);
  const parts: Buffer[] = [];
  for (let i = 0; i < records; i += 1) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32LE(i * 3 + 17);
    parts.push(Buffer.from("REC"), counter, pool.subarray((i * 13) % 4000, (i * 13) % 4000 + 20));
  }
  return Buffer.concat(parts);
}

test("a patch rebuilds the new APK byte for byte and only carries what changed", () => {
  const dex = structured(1, 3000);
  const changedDex = Buffer.concat([dex.subarray(0, 20000), Buffer.from("a new method ".repeat(40)), dex.subarray(20000, 50000), dex.subarray(50400)]);
  changedDex.write("PATCHED", 3000);
  const image = random(2, 30000);
  const old = zip([
    { name: "AndroidManifest.xml", data: Buffer.from("<manifest v='60'/>".repeat(30)), stored: false },
    { name: "classes.dex", data: dex, stored: true },
    { name: "res/drawable/a.png", data: image, stored: true },
    { name: "assets/web.js", data: Buffer.from("console.log('v60');".repeat(200)), stored: false },
  ]);
  const next = zip([
    { name: "AndroidManifest.xml", data: Buffer.from("<manifest v='61'/>".repeat(30)), stored: false },
    { name: "classes.dex", data: changedDex, stored: true },
    { name: "res/drawable/b.png", data: image, stored: true },
    { name: "assets/web.js", data: Buffer.from("console.log('v61');".repeat(200)), stored: false },
    { name: "assets/new.txt", data: Buffer.from("new"), stored: false },
  ]);
  const { patch, stats } = createApkDelta(old, next);
  assert.deepEqual(applyApkDelta(old, patch), next);
  assert.deepEqual(stats.diffedEntries, ["classes.dex"]);
  // The renamed image is found by its content and copied, not sent again.
  assert.ok(stats.copied >= image.length);
  assert.ok(patch.length < next.length / 10, `patch ${patch.length} of ${next.length}`);
});

test("bsdiff controls turn old bytes into new bytes across inserts, deletes and edits", () => {
  for (const seed of [3, 4, 5]) {
    const old = structured(seed, 800);
    const pieces = [old.subarray(0, 3000), random(seed + 10, 500), old.subarray(3500, 9000), old.subarray(12000)];
    const next = Buffer.concat(pieces);
    next[100] ^= 0xff;
    let oldPos = 0;
    const out: number[] = [];
    for (const control of bsdiff(old, next)) {
      for (let i = 0; i < control.add.length; i += 1) out.push((control.add[i] + (old[oldPos + i] ?? 0)) & 0xff);
      oldPos += control.add.length;
      out.push(...control.extra);
      oldPos += control.seek;
    }
    assert.deepEqual(Buffer.from(out), next);
  }
});

test("a patch refuses another base and damaged data", () => {
  const old = zip([{ name: "classes.dex", data: structured(6, 2000), stored: true }]);
  const next = zip([{ name: "classes.dex", data: structured(7, 2100), stored: true }]);
  const { patch } = createApkDelta(old, next);
  assert.throws(() => applyApkDelta(next, patch), /不匹配/);
  const damaged = Buffer.from(patch);
  damaged[damaged.length - 10] ^= 0x55;
  assert.throws(() => applyApkDelta(old, damaged));
  assert.throws(() => applyApkDelta(old, Buffer.from("not a patch")), /不是增量更新包/);
});

test("the shared fixture the Android applier tests against is still what the generator produces", () => {
  const directory = path.resolve(__dirname, "../../android/app/src/test/resources/delta");
  const old = readFileSync(path.join(directory, "old.zip"));
  const next = readFileSync(path.join(directory, "new.zip"));
  const fixture = readFileSync(path.join(directory, "old-to-new.cpupatch"));
  assert.deepEqual(applyApkDelta(old, fixture), next);
  // Deflate output may differ between zlib builds, so compare what the patch promises.
  const fresh = createApkDelta(old, next).patch;
  assert.deepEqual(readDeltaHeader(fresh).header, readDeltaHeader(fixture).header);
  assert.deepEqual(applyApkDelta(old, fresh), next);
  assert.deepEqual(zipEntries(next).map((entry) => entry.name), [
    "AndroidManifest.xml", "classes.dex", "res/raw/same.bin", "resources.arsc", "assets/notes.txt", "assets/added.txt",
  ]);
});
