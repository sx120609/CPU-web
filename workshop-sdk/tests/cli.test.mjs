import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, pack, validateManifest } from "../bin/cli.mjs";

for (const type of ["game", "tool"]) {
  test(`${type} scaffold creates missing parents and refuses to overwrite existing projects`, async () => {
    const root = await mkdtemp(join(tmpdir(), "workshop-sdk-test-"));
    try {
      const source = await scaffold(type, join(root, "nested", type));
      const manifest = await readFile(join(source, "manifest.json"), "utf8");
      assert.equal(JSON.parse(manifest).type, type);
      assert.ok((await pack(source, join(root, `${type}.zip`))).files >= 5);
      await assert.rejects(scaffold(type, source), /目标已存在/);
      assert.equal(await readFile(join(source, "manifest.json"), "utf8"), manifest);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("generic extension scaffold packs and validates supported slots and permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "workshop-sdk-test-"));
  try {
    const source = await scaffold("extension", join(root, "extension"));
    const manifest = JSON.parse(
      await readFile(join(source, "manifest.json"), "utf8"),
    );
    assert.deepEqual(validateManifest(manifest).extension, {
      slots: ["dialog"],
    });
    assert.ok((await pack(source, join(root, "extension.zip"))).files >= 5);
    validateManifest({
      ...manifest,
      permissions: [
        "storage",
        "site.public",
        "ui.toast",
        "ui.confirm",
        "navigation",
        "fullscreen",
        "motion.shake",
      ],
    });
    for (const extension of [
      { slots: [] },
      { slots: ["page"] },
      { slots: ["dialog", "dialog"] },
      { slots: ["dialog"], url: "evil" },
    ])
      assert.throws(() => validateManifest({ ...manifest, extension }));
    assert.throws(() => validateManifest({ ...manifest, type: "tool" }));
    assert.throws(() =>
      validateManifest({ ...manifest, permissions: ["fetch"] }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
