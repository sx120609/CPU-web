import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
import test from "node:test";
import express from "express";
import ts from "typescript";

function listen(server: Server) {
  return new Promise<string>(resolve => server.listen(0, "127.0.0.1", () => {
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}

function close(server: Server) {
  server.closeAllConnections();
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("VoiceHub keeps its Nuxt bootstrap and raw uploads while main-site CSP and Android enforcement remain active", async t => {
  const bootstrap = '<script>window.__NUXT__={config:{app:{baseURL:"/voicehub/"}}}</script>';
  const upstreamPolicy = "script-src 'self' 'nonce-nuxt-bootstrap'; object-src 'none'";
  const upstream = createServer(async (req, res) => {
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie, body: Buffer.concat(chunks).toString() }));
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.url === "/voicehub/dashboard") res.setHeader("Content-Security-Policy", upstreamPolicy);
    res.end(bootstrap);
  });
  const voiceOrigin = await listen(upstream);
  t.after(() => close(upstream));
  process.env.VOICEHUB_ORIGIN = voiceOrigin;
  const { voiceHubProxyMiddleware } = await import("../src/services/voiceHubProxy");
  const { securityHeaders } = await import("../src/middleware/securityHeaders");
  const { createAndroidUpdateGate } = await import("../src/middleware/androidUpdate");
  const { createDeploymentRelay } = await import("../src/utils/deploymentRelay");
  const requirement = {
    minimumVersionCode: 59, startsAt: "2026-10-13T08:00:00Z",
    deadlineAt: "2026-10-16T08:00:00Z", message: "Update required",
  };
  const androidUpdateGate = createAndroidUpdateGate({
    readRequirement: async () => requirement,
    now: () => Date.parse(requirement.deadlineAt),
  });

  // Execute the actual production gateway registrations without starting unrelated
  // database-backed routes/workers. Recreating their order here would miss this regression.
  const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function createApp(");
  const end = source.indexOf("  app.use(compression(", start);
  assert.ok(start >= 0 && end > start);
  const prefix = source.slice(start, end).replace("export function", "function");
  const compiled = ts.transpileModule(`${prefix}\nreturn app;\n}\ncreateApp();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const app = runInNewContext(compiled, {
    express, createDeploymentRelay, securityHeaders, androidUpdateGate, voiceHubProxyMiddleware,
  }) as express.Express;
  app.use(express.json());
  app.use((_req, res) => res.json({ ok: true }));
  const gateway = createServer(app);
  const origin = await listen(gateway);
  t.after(() => close(gateway));

  for (const path of ["/voicehub", "/voicehub/", "/voicehub/?reviewSong=42"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), bootstrap);
    assert.equal(response.headers.get("content-security-policy"), null,
      "the main SPA policy blocks Nuxt's inline runtime config before hydration");
  }
  const dashboard = await fetch(origin + "/voicehub/dashboard");
  assert.equal(dashboard.headers.get("content-security-policy"), upstreamPolicy);
  await dashboard.text();
  const rawBody = "{\n  \"song\": \"preserve whitespace\"\n}";
  const upload = await fetch(origin + "/voicehub/api/import?mode=raw", {
    method: "POST", body: rawBody,
    headers: { "Content-Type": "application/json", Cookie: "cpu-session=existing" },
  });
  assert.deepEqual(await upload.json(), {
    path: "/voicehub/api/import?mode=raw", cookie: "cpu-session=existing", body: rawBody,
  });

  for (const path of ["/", "/api/courses", "/voicehub-other"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") || "", /require-trusted-types-for 'script'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    await response.text();
  }
  const blocked = await fetch(origin + "/api/courses", {
    headers: { "User-Agent": "Android CPUWebScheduleApp/58 CPUTimeNative/1" },
  });
  assert.equal(blocked.status, 426);
  assert.match(blocked.headers.get("content-security-policy") || "", /require-trusted-types-for 'script'/);
  assert.equal((await blocked.json()).data.reason, "ANDROID_UPDATE_REQUIRED");
});
