import test from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import crypto from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("APNs channel deletion completes over real HTTP/2 without writing after END_STREAM", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cpu-apns-delete-"));
  const keyPath = join(directory, "test.p8");
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  const server = http2.createServer();
  const clients: http2.ClientHttp2Session[] = [];
  const requests: { method: unknown; body: string; channel: unknown }[] = [];
  let status = 204;
  server.on("stream", (stream, headers) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", chunk => body += chunk);
    stream.on("end", () => {
      requests.push({ method: headers[":method"], body, channel: headers["apns-channel-id"] });
      stream.respond({ ":status": status });
      stream.end();
    });
    stream.on("error", () => {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const client of clients) client.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const port = (server.address() as { port: number }).port;
  const connect = http2.connect;
  t.mock.method(http2, "connect", (() => {
    const client = connect(`http://127.0.0.1:${port}`);
    clients.push(client);
    return client;
  }) as any);
  const { deleteLiveActivityChannel } = await import("../src/services/apnsClient");
  const config = { keyPath, keyID: "TEST", teamID: "TEST", bundleID: "cn.cputime.test", channels: {}, tickSeconds: 5, configured: true, updatedAt: null };
  await deleteLiveActivityChannel(config, "sandbox", "test-channel");
  status = 404;
  await deleteLiveActivityChannel(config, "sandbox", "already-deleted");
  status = 500;
  await assert.rejects(deleteLiveActivityChannel(config, "sandbox", "retry-later"), /500/);
  assert.deepEqual(requests, ["test-channel", "already-deleted", "retry-later"].map(channel => ({ method: "DELETE", body: "", channel })));
});
