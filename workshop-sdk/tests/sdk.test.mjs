import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { createWorkshopSDK, createLocalPreviewSDK } from "../src/sdk.js";

function harness() {
  const listeners = new Set();
  const handshake = [];
  const parent = {
    postMessage(data) {
      handshake.push(data);
    },
  };
  const previous = globalThis.window;
  globalThis.window = {
    parent,
    addEventListener(event, listener) {
      if (event === "message") listeners.add(listener);
    },
    removeEventListener(event, listener) {
      if (event === "message") listeners.delete(listener);
    },
  };
  const channels = [];
  return {
    parent,
    handshake,
    connect(source = parent, protocol = 1) {
      const channel = new MessageChannel();
      channels.push(channel);
      for (const listener of [...listeners])
        listener({
          source,
          data: { type: "cpu-workshop:connect", protocol, appId: "work-uuid" },
          ports: [channel.port2],
        });
      return channel.port1;
    },
    dispose() {
      for (const channel of channels) {
        channel.port1.close();
        channel.port2.close();
      }
      globalThis.window = previous;
    },
  };
}

test("SDK rejects forged handshakes and uses the validated parent channel", async () => {
  const host = harness();
  const sdk = createWorkshopSDK({ timeout: 1000 });
  try {
    assert.deepEqual(host.handshake, [
      { type: "cpu-workshop:ready", protocol: 1 },
    ]);
    const forged = host.connect({});
    let forgedRequests = 0;
    forged.on("message", () => forgedRequests++);
    host.connect(host.parent, 2);
    const accepted = host.connect();
    accepted.on("message", (request) =>
      accepted.postMessage({
        type: "response",
        id: request.id,
        result: { name: "Star", storageAvailable: true },
      }),
    );
    assert.deepEqual(await sdk.ready, { appId: "work-uuid" });
    assert.equal((await sdk.getEnvironment()).name, "Star");
    assert.equal(forgedRequests, 0);
  } finally {
    sdk.destroy();
    host.dispose();
  }
});

test("SDK serializes document updates and propagates permission errors and pause events", async () => {
  const host = harness();
  const sdk = createWorkshopSDK({ timeout: 1000 });
  try {
    const accepted = host.connect();
    let saved = { counter: 0 };
    const methods = [];
    accepted.on("message", (request) => {
      methods.push(request.method);
      if (request.method === "storage.get")
        accepted.postMessage({
          type: "response",
          id: request.id,
          result: saved,
        });
      else if (request.method === "storage.set") {
        saved = request.params.value;
        accepted.postMessage({
          type: "response",
          id: request.id,
          result: null,
        });
      } else
        accepted.postMessage({
          type: "response",
          id: request.id,
          error: {
            code: "PERMISSION_DENIED",
            message: "Missing storage permission",
          },
        });
    });
    await Promise.all([
      sdk.updateSave((value) => ({ counter: value.counter + 1 })),
      sdk.updateSave((value) => ({ counter: value.counter + 1 })),
    ]);
    assert.equal(saved.counter, 2);
    assert.deepEqual(methods, [
      "storage.get",
      "storage.set",
      "storage.get",
      "storage.set",
    ]);
    await assert.rejects(
      sdk.removeSave(),
      (error) => error.code === "PERMISSION_DENIED",
    );
    const paused = new Promise((resolve) => sdk.on("pause", resolve));
    accepted.postMessage({
      type: "event",
      event: "pause",
      data: { reason: "hidden" },
    });
    assert.deepEqual(await paused, { reason: "hidden" });
  } finally {
    sdk.destroy();
    host.dispose();
  }
});

test("SDK shutdown rejects outstanding requests and preview adapter refuses iframe usage", async () => {
  const host = harness();
  const sdk = createWorkshopSDK({ timeout: 1000 });
  try {
    const accepted = host.connect();
    const received = new Promise((resolve) =>
      accepted.once("message", resolve),
    );
    const request = sdk.getEnvironment();
    await received;
    sdk.destroy();
    await assert.rejects(request, /SDK 已关闭/);
    assert.throws(
      () => createLocalPreviewSDK({ appId: "example" }),
      /本地预览仅限独立页面/,
    );
  } finally {
    sdk.destroy();
    host.dispose();
  }
});

test("extension SDK routes all capabilities and lifecycle events", async () => {
  const host = harness();
  const sdk = createWorkshopSDK({ timeout: 1000 });
  try {
    const port = host.connect();
    const calls = [];
    port.on("message", (req) => {
      calls.push([req.method, req.params]);
      port.postMessage({
        type: "response",
        id: req.id,
        result: { enabled: true },
      });
    });
    await sdk.getSiteInfo();
    await sdk.listWorks({ type: "extension", pageSize: 12 });
    await sdk.showToast({ message: "Hello" });
    await sdk.confirm({ title: "Hi", message: "Continue?" });
    await sdk.openPage("tools");
    await sdk.requestFullscreen();
    await sdk.requestShake();
    await sdk.close();
    assert.deepEqual(
      calls.map(([method]) => method),
      [
        "site.getInfo",
        "site.listWorks",
        "ui.toast",
        "ui.confirm",
        "navigation.open",
        "fullscreen.request",
        "motion.requestShake",
        "runtime.close",
      ],
    );
    assert.deepEqual(calls[4][1], { target: "tools" });
    for (const [event, data] of [
      ["show", {}],
      ["hide", {}],
      ["themechange", { theme: "dark" }],
      ["resize", { width: 320, height: 480 }],
      ["shake", {}],
    ]) {
      const received = new Promise((resolve) => sdk.on(event, resolve));
      port.postMessage({ type: "event", event, data });
      assert.deepEqual(await received, data);
    }
  } finally {
    sdk.destroy();
    host.dispose();
  }
});

test("navigation waits for user consent beyond the ordinary RPC timeout", async () => {
  const host = harness();
  const sdk = createWorkshopSDK({ timeout: 100, interactionTimeout: 2000 });
  try {
    const port = host.connect();
    port.on("message", (request) => {
      assert.equal(request.method, "navigation.open");
      setTimeout(() => port.postMessage({ type: "response", id: request.id, result: null }), 200);
    });
    assert.equal(await sdk.openPage("games"), null);
  } finally { sdk.destroy(); host.dispose(); }
});

test("local preview cannot impersonate site capabilities", async () => {
  const previous = globalThis.window;
  globalThis.window = {};
  globalThis.window.parent = globalThis.window;
  try {
    const sdk = createLocalPreviewSDK({
      appId: "preview-extension",
      type: "extension",
    });
    for (const method of [
      "getSiteInfo",
      "listWorks",
      "showToast",
      "confirm",
      "openPage",
      "requestFullscreen",
      "requestShake",
      "close",
    ])
      await assert.rejects(
        sdk[method](),
        (error) => error.code === "UNSUPPORTED",
      );
  } finally {
    globalThis.window = previous;
  }
});
