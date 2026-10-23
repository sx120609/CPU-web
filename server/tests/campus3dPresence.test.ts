import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { campus3dPresenceRouter } from "../src/routes/campus3dPresence";
import { errorHandler } from "../src/middleware/error";

async function withServer(run: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use("/p", campus3dPresenceRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/p`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() as any }));

test("三维校园联机：游客加入、互相看见、隐身与离开", async () => {
  await withServer(async (base) => {
    const a = (await post(`${base}/join`, {})).body.data, b = (await post(`${base}/join`, {})).body.data;
    assert.match(a.sid, /^[0-9a-f]{24}$/);
    assert.match(a.name, /^游客\d{3}$/);
    assert.notEqual(a.pid, b.pid);

    await post(`${base}/sync`, { sid: b.sid, key: b.key, s: [10, 0, 20, 1.2, 0, 3, 1.4] });
    const seen = (await post(`${base}/sync`, { sid: a.sid, key: a.key, s: [0, 0, 0, 0, 2, 1, 5] })).body.data;
    assert.equal(seen.p.length, 1);
    assert.deepEqual(seen.p[0], [b.pid, b.name, 10, 0, 20, 1.2, 0, 3, 1.4]);
    assert.ok(!JSON.stringify(seen).includes(b.sid) && !JSON.stringify(seen).includes(b.key), "others never see a session id or key");

    // hidden players keep receiving but are not shown
    const hidden = (await post(`${base}/sync`, { sid: b.sid, key: b.key, s: [10, 0, 20, 1.2, 0, 3, 0], h: true })).body.data;
    assert.equal(hidden.p[0][0], a.pid, "hidden player still receives the visible peer");
    assert.equal((await post(`${base}/sync`, { sid: a.sid, key: a.key, s: [0, 0, 0, 0, 0, 1, 0] })).body.data.p.length, 0);
    await post(`${base}/sync`, { sid: b.sid, key: b.key, s: [10, 0, 20, 1.2, 0, 3, 0], h: false });
    const visibleAgain = (await post(`${base}/sync`, { sid: a.sid, key: a.key, s: [0, 0, 0, 0, 0, 1, 0] })).body.data;
    assert.equal(visibleAgain.p[0][0], b.pid, "visibility returns with the same player identity");
    assert.equal(visibleAgain.p[0][8], 0, "paused peer is represented as stationary");

    // a wrong key is refused, bad numbers are rejected
    assert.equal((await post(`${base}/sync`, { sid: b.sid, key: "0".repeat(32), s: [0, 0, 0, 0, 0, 0, 0] })).status, 404);
    assert.notEqual((await post(`${base}/sync`, { sid: a.sid, key: a.key, s: [1e9, 0, 0, 0, 0, 0, 0] })).status, 200);

    await post(`${base}/leave`, { sid: b.sid, key: b.key });
    assert.equal((await post(`${base}/sync`, { sid: b.sid, key: b.key, s: [0, 0, 0, 0, 0, 0, 0] })).status, 404);
  });
});

test("三维校园联机：过期玩家不计入在线人数，旧会话不能复活", async (t) => {
  let now = Date.now() + 60_000;
  t.mock.method(Date, "now", () => now);
  // Exercise the old non-sweep branch deterministically; expiry must not be probabilistic.
  t.mock.method(Math, "random", () => 0.5);
  await withServer(async (base) => {
    const a = (await post(`${base}/join`, {})).body.data;
    const b = (await post(`${base}/join`, {})).body.data;
    const sync = (p: { sid: string; key: string }) => post(`${base}/sync`, { sid: p.sid, key: p.key, s: [0, 0, 0, 0, 0, 0, 0] });
    await sync(a); await sync(b);
    now += 12_000;
    assert.equal((await sync(a)).body.data.n, 2, "12-second boundary is still live");
    now += 1;
    const active = await sync(a);
    assert.equal(active.body.data.n, 1, "expired peer must leave the online count immediately");
    assert.deepEqual(active.body.data.p, []);
    assert.equal((await sync(b)).status, 404, "expired credentials require a fresh join");
    await post(`${base}/leave`, { sid: a.sid, key: a.key });
  });
});
