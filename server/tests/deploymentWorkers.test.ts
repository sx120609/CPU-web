import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ownsBackgroundWork } from "../src/utils/deploymentWorkers";
import { deploymentChildEnvironment } from "../src/utils/deploymentEnvironment";

test("admin updates use stable base ports and acquire a fresh deployment lock", () => {
  const environment = deploymentChildEnvironment({ PORT: "23434", VOICEHUB_PORT: "23534", CPU_WEB_DEPLOY_BASE_PORT: "23333", CPU_WEB_DEPLOY_VOICE_PORT: "23335", CPU_WEB_UPDATE_LOCKED: "1", DEPLOY_ALLOW_SCHEMA_EXPAND: "1", DEPLOY_BLUE_PORT: "23433" });
  assert.equal(environment.PORT, "23333");
  assert.equal(environment.VOICEHUB_PORT, "23335");
  assert.equal(environment.DEPLOY_BLUE_PORT, "23433");
  assert.equal(environment.CPU_WEB_UPDATE_LOCKED, undefined);
  assert.equal(environment.DEPLOY_ALLOW_SCHEMA_EXPAND, undefined);
});

test("only the promoted release owns background jobs; missing/corrupt markers fail closed", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cpu-background-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, "owner");
  assert.equal(ownsBackgroundWork(undefined, undefined), true);
  assert.equal(ownsBackgroundWork(marker, "candidate"), false);
  await writeFile(marker, "old");
  assert.equal(ownsBackgroundWork(marker, "old"), true);
  assert.equal(ownsBackgroundWork(marker, "candidate"), false);
  await writeFile(marker, "candidate\n");
  assert.equal(ownsBackgroundWork(marker, "candidate"), true);
  assert.equal(ownsBackgroundWork(marker, "old"), false);
  assert.equal(ownsBackgroundWork(marker, undefined), false);
});
