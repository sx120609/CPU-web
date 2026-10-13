import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";
process.env.WORKSHOP_MAIN_ORIGIN = "https://cputime.cn";

async function withRuntimeServer<T>(run: (request: (headers: Record<string, string>) => Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}>) => Promise<T>) {
  const { default: express } = await import("express");
  const { securityHeaders } = await import("../src/middleware/securityHeaders");
  const { errorHandler } = await import("../src/middleware/error");
  const { workshopRuntimeRouter } = await import("../src/routes/workshop");
  const app = express();
  app.use(securityHeaders);
  app.use("/api/workshop-runtime", workshopRuntimeRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const request = (headers: Record<string, string>) => new Promise<{
    status: number; headers: http.IncomingHttpHeaders; body: string;
  }>((resolve, reject) => {
    // 签名无效的运行凭据：在读取数据库之前就被拒绝。
    http.get({ host: "127.0.0.1", port, path: "/api/workshop-runtime/abc.def/index.html", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on("error", reject);
  });
  try {
    return await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("作品入口文档出错时返回主站可以嵌入的说明页", async () => {
  await withRuntimeServer(async (request) => {
    for (const headers of [
      { "sec-fetch-dest": "iframe", accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      // 不发送 Sec-Fetch-Dest 的旧浏览器按 Accept 判断。
      { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    ]) {
      const response = await request(headers);
      assert.equal(response.status, 403);
      assert.match(String(response.headers["content-type"]), /^text\/html/);
      assert.equal(response.headers["x-frame-options"], undefined);
      const csp = String(response.headers["content-security-policy"]);
      assert.match(csp, /(?:^|; )sandbox(?:;|$)/);
      assert.match(csp, /frame-ancestors [^;]*https:\/\/cputime\.cn/);
      assert.doesNotMatch(csp, /frame-ancestors 'none'/);
      assert.doesNotMatch(csp, /script-src|'unsafe-eval'/);
      assert.match(response.body, /运行链接无效或已过期/);
      assert.equal(response.headers["cache-control"], "no-store");
    }
  });
});

test("作品子资源和页面主动查询仍得到不可嵌入的 JSON 错误", async () => {
  await withRuntimeServer(async (request) => {
    for (const headers of [
      { "sec-fetch-dest": "empty", accept: "application/json" },
      { "sec-fetch-dest": "script", accept: "*/*" },
      { accept: "*/*" },
    ]) {
      const response = await request(headers);
      assert.equal(response.status, 403);
      assert.match(String(response.headers["content-type"]), /^application\/json/);
      assert.equal(response.headers["x-frame-options"], "DENY");
      assert.equal(JSON.parse(response.body).message, "运行链接无效或已过期");
    }
  });
});

function proxiedRequest(headers: Record<string, string>) {
  // 反向代理没有转发公开域名时，后端看到的就是这样的请求。
  const all: Record<string, string> = { host: "127.0.0.1:3000", ...headers };
  return {
    protocol: "http",
    get: (name: string) => all[name.toLowerCase()],
  } as unknown as import("express").Request;
}

test("作品地址取自发起请求的主站页面，不取反向代理后的内部地址", async () => {
  const { workshopRuntimeOrigin } = await import("../src/services/workshopRuntime");
  const previous = process.env.WORKSHOP_RUNTIME_ORIGIN;
  delete process.env.WORKSHOP_RUNTIME_ORIGIN;
  try {
    assert.equal(workshopRuntimeOrigin(proxiedRequest({ origin: "https://cputime.cn" })), "https://cputime.cn");
    // 资源请求不带 Origin：回到配置的主站域名。
    assert.equal(workshopRuntimeOrigin(proxiedRequest({})), "https://cputime.cn");
    process.env.WORKSHOP_RUNTIME_ORIGIN = "https://workshop-assets.example.com";
    assert.equal(
      workshopRuntimeOrigin(proxiedRequest({ origin: "https://cputime.cn" })),
      "https://workshop-assets.example.com",
    );
  } finally {
    if (previous === undefined) delete process.env.WORKSHOP_RUNTIME_ORIGIN;
    else process.env.WORKSHOP_RUNTIME_ORIGIN = previous;
  }
});

test("作品自身资源的策略使用运行凭据里的地址", async () => {
  const { signWorkshopTicket, verifyWorkshopTicket, workshopRuntimeHeaders } = await import("../src/services/workshopRuntime");
  const claims = {
    kind: "public" as const,
    workId: "8a2cf319-9137-4512-bedc-1328fa3de7cf",
    versionId: "aeacfa51-0987-49a9-a5f2-db8335acb8cb",
    workRevision: 0,
    versionRevision: 0,
    expires: 10_000,
    frameOrigins: ["https://cputime.cn"],
    origin: "https://cputime.cn",
  };
  const encoded = signWorkshopTicket(claims, "test-secret");
  assert.deepEqual(verifyWorkshopTicket(encoded, "test-secret", 9000), claims);
  assert.throws(
    () => verifyWorkshopTicket(signWorkshopTicket({ ...claims, origin: "https://cputime.cn/path" }, "test-secret"), "test-secret", 9000),
    /无效/u,
  );
  // 此字段出现之前签发的凭据仍然有效。
  const { origin: _omitted, ...legacy } = claims;
  assert.deepEqual(verifyWorkshopTicket(signWorkshopTicket(legacy, "test-secret"), "test-secret", 9000), legacy);

  const headers = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), value); },
    removeHeader: (name: string) => { headers.delete(name.toLowerCase()); },
  } as unknown as import("express").Response;
  workshopRuntimeHeaders(proxiedRequest({}), res, claims, encoded);
  const csp = headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes(`script-src 'unsafe-inline' 'wasm-unsafe-eval' https://cputime.cn/api/workshop-runtime/${encoded}/`));
  assert.doesNotMatch(csp, /127\.0\.0\.1/);
  assert.match(csp, /frame-ancestors https:\/\/cputime\.cn/);
});
