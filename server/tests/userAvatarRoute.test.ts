import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("头像缓存每个用户只保留一份，请求新版本时立即回源", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { userAvatarRouter } = await import("../src/routes/userAvatar");
  const { dataAvatarVersion } = await import("../src/utils/publicAvatar");
  let avatar: string | null = `data:image/png;base64,${Buffer.from("first").toString("base64")}`;
  let loads = 0;
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = (async () => {
    loads += 1;
    return { avatar };
  }) as unknown as typeof originalFindUnique;
  const app = express();
  app.use("/api/user-avatars", userAvatarRouter);
  const server = createServer(app);
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
    return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/user-avatars/41`;
  const request = async (query = "", headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${query}`, { headers });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      etag: response.headers.get("etag"),
      body: Buffer.from(await response.arrayBuffer()).toString("utf8"),
    };
  };

  const firstVersion = dataAvatarVersion(avatar);
  const first = await request(`?v=${firstVersion}`);
  assert.equal(first.status, 200);
  assert.equal(first.body, "first");
  assert.equal(first.cacheControl, "public, max-age=31536000, immutable");
  assert.equal(first.etag, `"avatar-${firstVersion}"`);
  assert.equal(loads, 1);

  // 同一用户的无版本请求、重复请求和非法版本参数都复用同一份缓存。
  assert.equal((await request(`?v=${firstVersion}`)).body, "first");
  const current = await request();
  assert.equal(current.cacheControl, "public, max-age=300, stale-while-revalidate=86400");
  const invalid = await request("?v=not-a-version");
  assert.equal(invalid.body, "first");
  assert.equal(invalid.cacheControl, "public, max-age=300, stale-while-revalidate=86400");
  assert.equal(loads, 1);
  assert.equal((await request(`?v=${firstVersion}`, { "If-None-Match": `"avatar-${firstVersion}"` })).status, 304);

  avatar = `data:image/png;base64,${Buffer.from("second").toString("base64")}`;
  const secondVersion = dataAvatarVersion(avatar);
  const second = await request(`?v=${secondVersion}`);
  assert.equal(second.body, "second");
  assert.equal(second.cacheControl, "public, max-age=31536000, immutable");
  assert.equal(loads, 2);
  assert.equal((await request()).body, "second");
  assert.equal(loads, 2);

  // 旧版本地址仍返回当前头像，但不再标记为 immutable。
  const stale = await request(`?v=${firstVersion}`);
  assert.equal(stale.body, "second");
  assert.equal(stale.cacheControl, "public, max-age=300, stale-while-revalidate=86400");

  avatar = null;
  assert.equal((await request(`?v=${secondVersion}`)).status, 200);
  assert.equal((await request(`?v=${"0".repeat(16)}`)).status, 404);
});
