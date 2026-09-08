import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createDeploymentRelay } from "../src/utils/deploymentRelay";

test("standby relays the original POST once, then switches new requests while the old response drains", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cpu-relay-"));
  const marker = path.join(root, "traffic");
  let calls = 0;
  let finish: () => void = () => {};
  const oldApp = express();
  oldApp.use(express.json());
  oldApp.post("/api/write", (req, res) => {
    calls++;
    assert.deepEqual(req.body, { message: "preserved" });
    assert.equal(req.headers.cookie, "session=existing");
    res.write("old:");
    finish = () => res.end("finished");
  });
  const old = createServer(oldApp);
  await new Promise<void>(resolve => old.listen(0, "127.0.0.1", resolve));
  const port = (old.address() as any).port;
  const relay = createDeploymentRelay({ port: String(port), marker, release: "new" });
  const app = express();
  app.use(relay.middleware);
  app.get("/api/ready", (_req, res) => res.json({ ready: true }));
  app.get("/api/value", (_req, res) => res.send("new"));
  const next = createServer(app);
  await new Promise<void>(resolve => next.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(next.address() as any).port}`;
  t.after(async () => {
    finish();
    for (const server of [next, old]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await rm(root, { recursive: true, force: true });
  });
  assert.deepEqual(await (await fetch(`${base}/api/ready`)).json(), { ready: true });
  const response = await fetch(`${base}/api/write`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "session=existing" }, body: JSON.stringify({ message: "preserved" }) });
  const body = response.text();
  assert.equal(relay.inFlight(), 1);
  await writeFile(`${marker}.next`, "new");
  await rename(`${marker}.next`, marker);
  assert.equal(await (await fetch(`${base}/api/value`)).text(), "new");
  assert.equal(relay.inFlight(), 1);
  finish();
  assert.equal(await body, "old:finished");
  assert.equal(calls, 1);
  assert.equal(relay.inFlight(), 0);
});
