import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServiceDiagnostics } from "../src/middleware/serviceDiagnostics";
import { requestCancellation } from "../src/utils/requestCancellation";
import express from "express";
import type { AddressInfo } from "node:net";
import { errorHandler } from "../src/middleware/error";
import { HttpError } from "../src/utils/response";

test("diagnostics aggregate fixed routes, status, codes and latency without request or error text", () => {
  const lines: string[] = [];
  let now = 100;
  const diagnostics = createServiceDiagnostics(line => lines.push(line), () => now);
  try {
    for (let i = 0; i < 3; i++) {
      const req: any = { path: "/api/auth/sso-begin", originalUrl: "/api/auth/sso-begin?password=secret", body: { password: "secret" } };
      const res: any = Object.assign(new EventEmitter(), { statusCode: 503, locals: { serviceErrorCode: 5302 } });
      diagnostics.middleware(req, res, () => {});
      now += 50; res.emit("finish");
    }
    diagnostics.flush();
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0], /secret|password|originalUrl/);
    const [record] = JSON.parse(lines[0].slice("[service-diagnostics] ".length));
    assert.deepEqual(record, { key: "/api/auth/sso-begin:503:5302", count: 3, meanMs: 50, maxMs: 50 });
  } finally { diagnostics.stop(); }
});

test("HTTP cancellation distinguishes normal response completion and disconnect and cleans listeners", () => {
  const req: any = Object.assign(new EventEmitter(), { aborted: false });
  const res: any = Object.assign(new EventEmitter(), { writableFinished: true });
  const normal = requestCancellation(req, res);
  res.emit("close"); assert.equal(normal.signal.aborted, false); normal.dispose();
  res.writableFinished = false;
  const disconnected = requestCancellation(req, res);
  res.emit("close"); assert.equal(disconnected.signal.aborted, true); disconnected.dispose();
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
});

test("503 responses retain the native envelope and include a bounded retry hint", async t => {
  const lines: string[] = [];
  const diagnostics = createServiceDiagnostics(line => lines.push(line));
  const app = express();
  app.use(diagnostics.middleware);
  app.get("/api/auth/sso-begin", (_req, _res, next) => next(new HttpError(503, 5302, "busy")));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { diagnostics.stop(); server.close(); server.closeAllConnections(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/sso-begin?ticket=secret`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "3");
  assert.deepEqual(await response.json(), { code: 5302, data: null, message: "busy" });
  diagnostics.flush();
  assert.match(lines[0], /503:5302/);
  assert.doesNotMatch(lines[0], /secret|ticket|busy/);
});
