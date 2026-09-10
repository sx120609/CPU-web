import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createQqBotDeploymentDrain, qqBotDrainRequested } from "../src/utils/qqbotDeploymentDrain";
import { attachQqBotWebSocketGateway, configureQqBotConnection } from "../src/services/qqbot/connection";
const { WebSocket } = require("ws");

test("deployment waits for pending work and a fresh quiet period, closing only once", () => {
  let now = 0, pending = 1, requested = false, closed = 0;
  const drain = createQqBotDeploymentDrain({ now: () => now, requested: () => requested, pending: () => pending, connected: () => true, close: () => closed++ });
  now = 10000; drain.tick(); assert.equal(closed, 0);
  requested = true; now = 20000; drain.tick(); assert.equal(closed, 0);
  pending = 0; now = 24999; drain.tick(); assert.equal(closed, 0);
  drain.activity(); now = 29998; drain.tick(); assert.equal(closed, 0);
  now = 29999; drain.tick(); assert.equal(closed, 1);
  now = 40000; drain.tick(); assert.equal(closed, 1);
});

test("a real NapCat connection waits for a handler and delayed reply before reconnecting", { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "qqbot-drain-"));
  const file = path.join(directory, "request.json");
  const saved = { file: process.env.CPU_WEB_QQBOT_DRAIN_FILE, release: process.env.CPU_WEB_RELEASE_ID };
  process.env.CPU_WEB_QQBOT_DRAIN_FILE = file;
  process.env.CPU_WEB_RELEASE_ID = "old-release";
  let finishHandler!: () => void;
  const handled = new Promise<void>(resolve => { finishHandler = resolve; });
  let handlerStarted!: () => void;
  const started = new Promise<void>(resolve => { handlerStarted = resolve; });
  let delayed = 1;
  configureQqBotConnection({
    getConfig: async () => ({ enabled: true, connectionMode: "inbound", napcatBaseUrl: "", accessToken: "test-token" }),
    handleWebhook: async () => { handlerStarted(); await handled; },
    logMessage: async () => undefined,
    pendingWork: () => delayed,
  });
  const server = createServer();
  attachQqBotWebSocketGateway(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/api/qqbot/napcat`, { headers: { authorization: "Bearer test-token" } });
  try {
    await once(socket, "open");
    await writeFile(file, JSON.stringify({ release: "wrong-release", successor: "next" }));
    assert.equal(qqBotDrainRequested(), false);
    await writeFile(file, JSON.stringify({ release: "old-release", successor: "next" }));
    assert.equal(qqBotDrainRequested(), true);
    socket.send(JSON.stringify({ post_type: "message" }));
    await started;
    await new Promise(resolve => setTimeout(resolve, 5300));
    assert.equal(socket.readyState, WebSocket.OPEN);
    finishHandler();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(socket.readyState, WebSocket.OPEN);
    delayed = 0;
    const [code] = await once(socket, "close");
    assert.equal(code, 1012);
  } finally {
    finishHandler(); socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (saved.file === undefined) delete process.env.CPU_WEB_QQBOT_DRAIN_FILE; else process.env.CPU_WEB_QQBOT_DRAIN_FILE = saved.file;
    if (saved.release === undefined) delete process.env.CPU_WEB_RELEASE_ID; else process.env.CPU_WEB_RELEASE_ID = saved.release;
    await rm(directory, { recursive: true, force: true });
  }
});
