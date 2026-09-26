import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { errorHandler } from "../src/middleware/error";

const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const AUTH_PARSER = /app\.use\("\/api\/auth", express\.json\(\{ limit: "1mb" \}\)\);/;
const GLOBAL_PARSER = /app\.use\(express\.json\(\{ limit: "12mb" \}\)\);/;

test("未登录的认证入口先用 1MB 上限解析 JSON，其余接口仍走 12MB 全局解析", async (t) => {
  const authParser = appSource.search(AUTH_PARSER);
  const globalParser = appSource.search(GLOBAL_PARSER);
  assert.ok(authParser > 0, "认证入口需要单独的小上限 JSON 解析器");
  assert.ok(globalParser > authParser, "小上限解析器必须挂在全局解析器之前");

  // 与 app.ts 相同的挂载顺序：已解析的请求会被全局解析器跳过。
  const app = express();
  app.use("/api/auth", express.json({ limit: "1mb" }));
  app.use(express.json({ limit: "12mb" }));
  app.post("/api/*", (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, bytes: number) => fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(bytes) }),
  });

  assert.equal((await post("/api/auth/sso-login", 64 * 1024)).status, 200);
  const rejected = await post("/api/auth/login", 2 * 1024 * 1024);
  assert.equal(rejected.status, 413);
  assert.equal((await rejected.json() as { code: number }).code, 4013);
  assert.equal((await post("/api/site/learning-assistant/responses", 2 * 1024 * 1024)).status, 200);
  assert.equal((await post("/api/uploads/image", 11 * 1024 * 1024)).status, 200);
});
