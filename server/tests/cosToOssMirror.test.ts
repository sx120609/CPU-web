import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  planCosToOssMirror,
  runCosToOssMirror,
  type StorageMirrorFile,
} from "../src/services/cosToOssMirror";

function md5(value: Buffer | string) {
  return createHash("md5").update(value).digest("hex");
}

test("mirror plan copies only missing keys and retains destination conflicts", () => {
  const source: StorageMirrorFile[] = [
    { relativePath: "missing.js", size: 7, etag: md5("missing") },
    { relativePath: "reused.js", size: 6, etag: md5("reused") },
    { relativePath: "size-conflict.js", size: 5, etag: md5("12345") },
    { relativePath: "hash-conflict.js", size: 4, etag: md5("left") },
  ];
  const destination: StorageMirrorFile[] = [
    { relativePath: "reused.js", size: 6, etag: md5("reused") },
    { relativePath: "size-conflict.js", size: 4, etag: md5("1234") },
    { relativePath: "hash-conflict.js", size: 4, etag: md5("right") },
  ];

  const plan = planCosToOssMirror(source, destination);

  assert.deepEqual(plan.pending.map((file) => file.relativePath), ["missing.js"]);
  assert.deepEqual(plan.reused.map((file) => file.relativePath), ["reused.js"]);
  assert.deepEqual(plan.conflicts.map((item) => [item.source.relativePath, item.reason]), [
    ["hash-conflict.js", "etag"],
    ["size-conflict.js", "size"],
  ]);
});

test("mirror runner verifies content and forbids overwriting destination keys", async () => {
  const sourceContent = new Map([
    ["assets/new.js", Buffer.from("new asset")],
    ["assets/reused.js", Buffer.from("same")],
    ["assets/conflict.js", Buffer.from("source")],
  ]);
  const destinationContent = new Map([
    ["assets/reused.js", Buffer.from("same")],
    ["assets/conflict.js", Buffer.from("target")],
  ]);
  const uploads: Array<{ relativePath: string; forbidOverwrite: boolean }> = [];
  const asFiles = (content: Map<string, Buffer>) => Array.from(content, ([relativePath, buffer]) => ({
    relativePath,
    size: buffer.length,
    etag: md5(buffer),
  }));

  const summary = await runCosToOssMirror({
    listSourceFiles: async () => asFiles(sourceContent),
    listDestinationFiles: async () => asFiles(destinationContent),
    downloadSourceFile: async (relativePath) => Buffer.from(sourceContent.get(relativePath) || ""),
    uploadDestinationFile: async (relativePath, buffer, _contentType, options) => {
      uploads.push({ relativePath, forbidOverwrite: options.forbidOverwrite });
      if (destinationContent.has(relativePath)) throw new Error("overwrite attempted");
      destinationContent.set(relativePath, Buffer.from(buffer));
    },
    headDestinationFile: async (relativePath) => {
      const buffer = destinationContent.get(relativePath);
      return { exists: Boolean(buffer), size: buffer?.length ?? null, etag: buffer ? md5(buffer) : "" };
    },
  });

  assert.equal(summary.copiedCount, 1);
  assert.equal(summary.reusedCount, 1);
  assert.equal(summary.conflicts.length, 1);
  assert.equal(summary.failures.length, 0);
  assert.deepEqual(uploads, [{ relativePath: "assets/new.js", forbidOverwrite: true }]);
  assert.equal(destinationContent.get("assets/conflict.js")?.toString(), "target");
});

test("dry run performs no writes and source hash mismatch is reported", async () => {
  let uploadCount = 0;
  const dependencies = {
    listSourceFiles: async () => [{ relativePath: "bad.js", size: 3, etag: md5("not-bad") }],
    listDestinationFiles: async () => [],
    downloadSourceFile: async () => Buffer.from("bad"),
    uploadDestinationFile: async () => { uploadCount += 1; },
    headDestinationFile: async () => ({ exists: false, size: null, etag: "" }),
  };

  const dryRun = await runCosToOssMirror(dependencies, { dryRun: true });
  assert.equal(dryRun.selectedCount, 1);
  assert.equal(dryRun.copiedCount, 0);
  assert.equal(uploadCount, 0);

  const attempted = await runCosToOssMirror(dependencies);
  assert.equal(attempted.copiedCount, 0);
  assert.equal(attempted.failures[0]?.message, "从 COS 下载后的文件哈希不一致");
  assert.equal(uploadCount, 0);
});
