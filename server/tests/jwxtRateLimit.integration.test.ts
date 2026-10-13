import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";
process.env.JWT_SECRET = "jwxt-rate-limit-test-secret-0123456789abcdef";

test("rotating unverified JWXT tokens cannot bypass quotas; public icons and verified accounts work", async () => {
  const { jwxtRouter } = await import("../src/routes/jwxt");
  const { withCache } = await import("../src/services/cache");
  const { prisma } = await import("../src/prisma");
  const { signToken } = await import("../src/utils/jwt");
  const iconPath = "/sopplus/_upload/appstore/test/res/icon/test.png";
  const body = Buffer.from("cached-icon");
  await withCache("jwxt-iapp-icon", [iconPath], 60_000, async () => ({
    dataBase64: body.toString("base64"), byteLength: body.length, contentType: "image/png",
  }));
  const app = express();
  app.use("/api/jwxt", jwxtRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status || 500).json({ message: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const original = prisma.user.findUnique;
  try {
    const iconUrl = `${origin}/api/jwxt/iapps/icon?path=${encodeURIComponent(iconPath)}`;
    for (let index = 0; index <= 300; index += 1) {
      const response = await fetch(iconUrl, { headers: { "X-Jwxt-Token": `forged-${index}`, Authorization: "Bearer invalid" } });
      assert.equal(response.status, index < 300 ? 200 : 429, `icon request ${index}`);
      if (index === 0) assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
      else await response.arrayBuffer();
    }
    for (const [path, limit] of [["records?kind=invalid", 90], ["transcript.pdf?variant=invalid", 6]] as const) {
      for (let index = 0; index <= limit; index += 1) {
        const response = await fetch(`${origin}/api/jwxt/${path}`, { headers: { "X-Jwxt-Token": `forged-${index}` } });
        assert.equal(response.status, index < limit ? 400 : 429, `${path} request ${index}`);
        await response.arrayBuffer();
      }
    }
    prisma.user.findUnique = (async (args: any) => ({ id: args.where.id, username: "test", role: "user", status: "active" })) as typeof original;
    for (const userId of [123, 124]) {
      const token = signToken({ userId, studentId: "test", role: "user", campus: "" });
      const response = await fetch(iconUrl, { headers: { Authorization: `Bearer ${token}`, "X-Jwxt-Token": "forged" } });
      assert.equal(response.status, 200, "verified accounts do not share the exhausted anonymous quota");
      assert.equal(response.headers.get("x-ratelimit-remaining"), "299");
      await response.arrayBuffer();
    }
  } finally {
    prisma.user.findUnique = original;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
