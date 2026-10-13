import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import JSZip from "jszip";
import {
  extractWorkshopPackage,
  inspectWorkshopZip,
  WORKSHOP_MAX_FILE_BYTES,
  workshopManifestSchema,
} from "../src/services/workshopPackage";

const manifest = {
  schemaVersion: 1,
  id: "example-game",
  type: "game",
  name: "例子",
  version: "1.0.0",
  description: "静态游戏",
  entry: "index.html",
  permissions: ["storage"],
  game: { orientation: "any", controls: ["pointer"] },
};
function packageZip() {
  return new JSZip()
    .file("manifest.json", JSON.stringify(manifest))
    .file("index.html", '<script type="module" src="./assets/game.mjs"></script>')
    .file("assets/game.mjs", "export const game = 1");
}
async function buffer(zip: JSZip, options: JSZip.JSZipGeneratorOptions<"nodebuffer"> = {}) {
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", ...options });
}

test("a normal nested static package extracts only validated assets and reviewed manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workshop-package-"));
  try {
    const result = await extractWorkshopPackage(await buffer(packageZip()), root);
    assert.deepEqual(result.manifest, manifest);
    assert.ok(result.files.includes("assets/game.mjs"));
    assert.equal(
      await readFile(path.join(root, result.packageKey, "assets/game.mjs"), "utf8"),
      "export const game = 1",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const name of [
  "../outside.js",
  "/outside.js",
  "assets\\outside.js",
  "C:/outside.js",
  "assets/%2e%2e/outside.js",
  "assets/./outside.js",
  "assets/.hidden.js",
  "executable.exe",
]) {
  test(`reject ZIP raw unsafe path ${name} before JSZip can normalize it`, async () => {
    await assert.rejects(
      async () => inspectWorkshopZip(await buffer(packageZip().file(name, "alert(1)"))),
      /不安全|不支持/u,
    );
  });
}
test("reject case collision and exact duplicate central directory entries", async () => {
  assert.throws(() => inspectWorkshopZip(Buffer.alloc(0)), /ZIP/u);
  await assert.rejects(
    async () => inspectWorkshopZip(await buffer(packageZip().file("main.js", "a").file("MAIN.js", "b"))),
    /冲突/u,
  );
  const duplicate = await buffer(packageZip().file("a.js", "a").file("b.js", "b"));
  // Replace both local/central names without using JSZip (which silently overwrites duplicates).
  let offset = duplicate.indexOf(Buffer.from("a.js"));
  while (offset >= 0) {
    Buffer.from("b.js").copy(duplicate, offset);
    offset = duplicate.indexOf(Buffer.from("a.js"), offset + 4);
  }
  assert.throws(() => inspectWorkshopZip(duplicate), /重复/u);
});
test("reject Unix symlinks, file-directory collision and bounded expanded content", async () => {
  const link = packageZip().file("link.js", "../../secret", { unixPermissions: 0o120777 });
  await assert.rejects(async () => inspectWorkshopZip(await buffer(link, { platform: "UNIX" })), /符号链接/u);
  await assert.rejects(
    async () => inspectWorkshopZip(await buffer(packageZip().file("assets", "x"))),
    /不支持|冲突/u,
  );
  await assert.rejects(
    async () =>
      inspectWorkshopZip(
        await buffer(packageZip().file("bomb.txt", Buffer.alloc(WORKSHOP_MAX_FILE_BYTES + 1))),
      ),
    /过大/u,
  );
  const zip = packageZip();
  for (let i = 0; i < 513; i++) zip.file(`asset-${i}.txt`, "");
  await assert.rejects(async () => inspectWorkshopZip(await buffer(zip)), /512/u);
});
test("reject mismatched local/central file names and truncated archives", async () => {
  const contents = await buffer(packageZip());
  assert.throws(() => inspectWorkshopZip(contents.subarray(0, contents.length - 1)), /目录/u);
  const firstLocalName = contents.indexOf(Buffer.from("manifest.json"));
  contents[firstLocalName] = "M".charCodeAt(0);
  assert.throws(() => inspectWorkshopZip(contents), /路径|目录/u);
});
test("invalid manifests or missing entry clean all staged extraction files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workshop-rejected-"));
  try {
    const zip = packageZip().file("manifest.json", JSON.stringify({ ...manifest, entry: "missing.html" }));
    const missing = await buffer(zip);
    await assert.rejects(() => extractWorkshopPackage(missing, root), /入口不存在/u);
    await assert.rejects(() => extractWorkshopPackage(Buffer.from("broken"), root));
    const author = await buffer(
      packageZip().file("manifest.json", JSON.stringify({ ...manifest, authorId: 123 })),
    );
    await assert.rejects(() => extractWorkshopPackage(author, root), /清单无效/u);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest rejects unsafe entries, non-SemVer and unknown permissions", () => {
  for (const value of [
    { ...manifest, entry: "../index.html" },
    { ...manifest, version: "1.0" },
    { ...manifest, permissions: ["network"] },
    { ...manifest, game: { orientation: "any", controls: ["pointer", "pointer"] } },
  ]) {
    assert.equal(workshopManifestSchema.safeParse(value).success, false);
  }
});

test("manifest type requires game settings for games and forbids them for tools", () => {
  const { game, ...withoutGame } = manifest;
  assert.equal(workshopManifestSchema.safeParse(withoutGame).success, false);
  assert.equal(workshopManifestSchema.safeParse({ ...manifest, type: "tool" }).success, false);
  assert.equal(workshopManifestSchema.safeParse({ ...withoutGame, type: "tool" }).success, true);
  assert.equal(workshopManifestSchema.safeParse({ ...withoutGame, game }).success, true);
});

test("lying ZIP size metadata cannot bypass streaming expansion bounds or leave files behind", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workshop-size-"));
  try {
    const contents = await buffer(packageZip().file("oversized.txt", "A".repeat(4096)));
    let cursor = contents.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (cursor >= 0) {
      const nameLength = contents.readUInt16LE(cursor + 28);
      const name = contents.subarray(cursor + 46, cursor + 46 + nameLength).toString();
      if (name === "oversized.txt") {
        contents.writeUInt32LE(1, cursor + 24);
        break;
      }
      cursor = contents.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cursor + 4);
    }
    assert.ok(
      inspectWorkshopZip(contents).some((entry) => entry.name === "oversized.txt" && entry.bytes === 1),
    );
    await assert.rejects(() => extractWorkshopPackage(contents, root), /大小限制|损坏/u);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
