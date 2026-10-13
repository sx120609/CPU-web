import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkshopBridge,
  serializeWorkshopSave,
  type BridgeOptions,
} from "../../web/src/utils/workshopBridge";

function harness(storageAllowed = true, extra: Partial<BridgeOptions> = {}) {
  const listeners = new Set<(event: unknown) => void>();
  let transferred: MessagePort | undefined;
  let value: unknown = null;
  const frameWindow = {
    postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
      transferred = ports[0];
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(_event: string, listener: (event: unknown) => void) {
        listeners.add(listener);
      },
      removeEventListener(_event: string, listener: (event: unknown) => void) {
        listeners.delete(listener);
      },
    },
  });
  const bridge = createWorkshopBridge({
    frame: { contentWindow: frameWindow } as unknown as HTMLIFrameElement,
    appId: "test-work",
    ...extra,
    storageAllowed,
    environment: () => new Proxy({ theme: "dark" }, {}),
    storage: {
      async get() {
        return value;
      },
      async set(next) {
        value = next;
      },
      async remove() {
        value = null;
      },
    },
  });
  return {
    bridge,
    hello(source: unknown = frameWindow, origin = "null") {
      for (const listener of listeners)
        listener({
          source,
          origin,
          data: { type: "cpu-workshop:ready", protocol: 1 },
        });
    },
    get port() {
      return transferred;
    },
    close() {
      bridge.dispose();
      transferred?.close();
      if (original) Object.defineProperty(globalThis, "window", original);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

function request(port: MessagePort, method: string, params?: unknown) {
  return new Promise<{ result?: unknown; error?: { message: string } }>(
    (resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Bridge did not answer")),
        2000,
      );
      port.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      port.postMessage({
        type: "request",
        id: crypto.randomUUID(),
        method,
        params,
      });
    },
  );
}

test("bridge ignores other frames and non-opaque origins; connects only once", async () => {
  const h = harness();
  try {
    h.hello({});
    assert.equal(h.port, undefined);
    h.hello(undefined, "https://attacker.example");
    assert.equal(h.port, undefined);
    h.hello();
    const port = h.port!;
    assert.ok(port);
    h.hello();
    assert.equal(h.port, port);
    assert.deepEqual((await request(port, "env.get")).result, {
      theme: "dark",
    });
  } finally {
    h.close();
  }
});

test("bridge enforces capability allowlist and per-work storage permission", async () => {
  const h = harness(false);
  try {
    h.hello();
    assert.deepEqual((await request(h.port!, "env.get")).result, {
      theme: "dark",
    });
    assert.match(
      (await request(h.port!, "storage.set", { value: "secret" })).error!
        .message,
      /未声明/,
    );
    assert.match(
      (await request(h.port!, "auth.token")).error!.message,
      /未开放/,
    );
  } finally {
    h.close();
  }
});

test("bridge stores JSON only and rejects oversized saves without replacing existing data", async () => {
  const h = harness();
  try {
    h.hello();
    await request(h.port!, "storage.set", { value: { score: 42 } });
    assert.match(
      (await request(h.port!, "storage.set", { value: "药".repeat(30_000) }))
        .error!.message,
      /64 KB/,
    );
    assert.deepEqual((await request(h.port!, "storage.get")).result, {
      score: 42,
    });
    await request(h.port!, "storage.remove");
    assert.equal((await request(h.port!, "storage.get")).result, null);
    assert.throws(() => serializeWorkshopSave(1n), /JSON/);
  } finally {
    h.close();
  }
});

test("extension capabilities enforce permissions, strict params, handler availability and UI limits", async () => {
  const calls: unknown[] = [];
  const h = harness(true, {
    permissions: ["site.public", "ui.toast", "navigation", "motion.shake"],
    handlers: {
      getSiteInfo: async () => ({ name: "CPU" }),
      listWorks: async (params) => {
        calls.push(params);
        return [];
      },
      toast: (params) => {
        calls.push(params);
      },
      navigate: (target) => {
        calls.push(target);
      },
      requestShake: async () => ({ enabled: false, reason: "unsupported" }),
    },
  });
  try {
    h.hello();
    const port = h.port!;
    assert.deepEqual((await request(port, "site.getInfo")).result, {
      name: "CPU",
    });
    assert.deepEqual(
      (
        await request(port, "site.listWorks", {
          type: "extension",
          pageSize: 12,
        })
      ).result,
      [],
    );
    for (const params of [
      { pageSize: 13 },
      { page: 1.5 },
      { q: 42 },
      { token: "secret" },
    ])
      assert.ok((await request(port, "site.listWorks", params)).error);
    assert.ok(
      (await request(port, "ui.toast", { message: "x".repeat(201) })).error,
    );
    assert.equal(
      (await request(port, "ui.toast", { message: "ok" })).result,
      null,
    );
    assert.match(
      (await request(port, "ui.toast", { message: "again" })).error!.message,
      /频繁/,
    );
    assert.ok(
      (await request(port, "navigation.open", { target: "https://evil.test" }))
        .error,
    );
    assert.ok(
      (
        await request(port, "navigation.open", {
          target: "tools",
          query: "secret",
        })
      ).error,
    );
    assert.equal(
      (await request(port, "navigation.open", { target: "tools" })).result,
      null,
    );
    assert.match((await request(port, "storage.get")).error!.message, /未声明/);
    assert.match(
      (
        await request(port, "ui.confirm", {
          title: "Confirm",
          message: "Hello",
        })
      ).error!.message,
      /未声明/,
    );
    assert.deepEqual((await request(port, "motion.requestShake")).result, {
      enabled: false,
      reason: "unsupported",
    });
    assert.deepEqual(calls, [
      { type: "extension", pageSize: 12 },
      { message: "ok", type: "info" },
      "tools",
    ]);
  } finally {
    h.close();
  }
});

test("declared capability still requires a host handler", async () => {
  const h = harness(false, { permissions: ["site.public"] });
  try {
    h.hello();
    assert.match(
      (await request(h.port!, "site.getInfo")).error!.message,
      /未开放/,
    );
  } finally {
    h.close();
  }
});

test("catalog responses can exceed save quota without increasing the save quota", async () => {
  const catalog = { items: Array.from({ length: 12 }, (_, index) => ({
    id: String(index), slug: `work-${index}`, name: "作品", description: "药".repeat(2000), type: "tool", version: "1.0.0",
  })), pagination: { page: 1, pageSize: 12, total: 12, totalPages: 1 } };
  assert.ok(Buffer.byteLength(JSON.stringify(catalog)) > 64 * 1024);
  const h = harness(true, {
    permissions: ["site.public", "storage"],
    handlers: { listWorks: async () => new Proxy(catalog, {}) },
  });
  try {
    h.hello();
    assert.deepEqual((await request(h.port!, "site.listWorks", { pageSize: 12 })).result, catalog);
    assert.match((await request(h.port!, "storage.set", { value: catalog })).error!.message, /64 KB/);
  } finally { h.close(); }
});

test("ordinary RPC responses remain bounded", async () => {
  const h = harness(false, {
    permissions: ["site.public"], handlers: { getSiteInfo: async () => "x".repeat(256 * 1024) },
  });
  try {
    h.hello();
    assert.match((await request(h.port!, "site.getInfo")).error!.message, /响应过大/);
  } finally { h.close(); }
});

test("close responds before host teardown and shake exposes no raw sensor data", async () => {
  let closeCalled = false;
  const h = harness(false, {
    handlers: {
      close: () => {
        closeCalled = true;
      },
    },
  });
  try {
    h.hello();
    const event = new Promise((resolve) => {
      h.port!.onmessage = (message) => resolve(message.data);
    });
    h.bridge.notify("shake", { acceleration: 100 });
    assert.deepEqual(await event, { type: "event", event: "shake", data: {} });
    assert.equal((await request(h.port!, "runtime.close")).result, null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(closeCalled, true);
  } finally {
    h.close();
  }
});

test("disposed bridge suppresses pending async responses", async () => {
  let release!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = harness(false, {
    permissions: ["site.public"],
    handlers: {
      getSiteInfo: () => {
        entered();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  try {
    h.hello();
    let responses = 0;
    h.port!.onmessage = () => {
      responses += 1;
    };
    h.port!.postMessage({
      type: "request",
      id: "pending",
      method: "site.getInfo",
    });
    await started;
    h.bridge.dispose();
    release({ name: "late" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(responses, 0);
  } finally {
    h.close();
  }
});
