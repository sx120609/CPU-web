import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { isCompactLayoutNow } from "../src/utils/formFactor";
import { forumListFlipTarget, forumListTarget, installForumListLayoutSync, type ForumListRouteInput } from "../src/utils/forumListRoute";

const extra = { from: "/home", page: "2" };
const route = (name: string, query: ForumListRouteInput["query"] = {}): ForumListRouteInput => ({ name, query });

test("compact layouts show every list as a channel of /forum and keep other query keys", () => {
  assert.deepEqual(forumListTarget(route("forum-hot", extra), true), { name: "forum", query: { ...extra, channel: "hot" } });
  assert.deepEqual(forumListTarget(route("forum-latest", { ...extra, channel: "hot" }), true), { name: "forum", query: extra });
  assert.deepEqual(forumListTarget(route("market", extra), true), { name: "forum", query: { ...extra, channel: "market" } });
  for (const channel of [undefined, "hot", "latest", "market", "question", "freshman", "unknown"]) {
    const query = channel ? { ...extra, channel } : extra;
    assert.equal(forumListTarget(route("forum", query), true), null, String(channel));
  }
});

test("expanded layouts open the desktop page for each channel and keep other query keys", () => {
  assert.deepEqual(forumListTarget(route("forum", { ...extra, channel: "hot" }), false), { name: "forum-hot", query: extra });
  assert.deepEqual(forumListTarget(route("forum", { ...extra, channel: "latest" }), false), { name: "forum-latest", query: extra });
  assert.deepEqual(forumListTarget(route("forum", { ...extra, channel: "market" }), false, { marketEnabled: true }), { name: "market", query: extra });
  assert.deepEqual(forumListTarget(route("forum", { ...extra, channel: "question" }), false), { name: "board", params: { slug: "question" }, query: extra });
  assert.deepEqual(forumListTarget(route("forum", { ...extra, channel: "freshman" }), false), { name: "board", params: { slug: "freshman" }, query: extra });
  assert.deepEqual(forumListTarget(route("forum", { ...extra, channel: "unknown" }), false), { name: "forum", query: extra });
  assert.deepEqual(forumListTarget(route("forum", { channel: ["hot", "latest"] }), false), { name: "forum-hot", query: {} });
  assert.equal(forumListTarget(route("forum", extra), false), null);
  for (const name of ["forum-hot", "forum-latest", "market"]) assert.equal(forumListTarget(route(name, extra), false), null, name);
});

test("the market channel only opens the market board while the feature is on", () => {
  const market = route("forum", { channel: "market", from: "/home" });
  assert.deepEqual(forumListTarget(market, false, { marketEnabled: false }), { name: "forum", query: { from: "/home" } });
  // Before the site settings load, the route's feature gate decides.
  assert.deepEqual(forumListTarget(market, false, { marketEnabled: null }), { name: "market", query: { from: "/home" } });
  assert.deepEqual(forumListTarget(market, false), { name: "market", query: { from: "/home" } });
});

test("other routes are never touched", () => {
  for (const name of ["board", "topic", "home", "post", undefined]) {
    assert.equal(forumListTarget(route(String(name ?? ""), { channel: "hot" }), true), null);
    assert.equal(forumListTarget(route(String(name ?? ""), { channel: "hot" }), false), null);
  }
});

test("applying the guard to its own result never redirects again", () => {
  const names = ["forum", "forum-hot", "forum-latest", "market"];
  const channels = [undefined, "hot", "latest", "market", "question", "freshman", "unknown", ""];
  for (const compact of [true, false]) {
    for (const marketEnabled of [true, false, null]) {
      for (const name of names) {
        for (const channel of channels) {
          const query = channel === undefined ? { from: "/x" } : { from: "/x", channel };
          const target = forumListTarget(route(name, query), compact, { marketEnabled });
          if (!target) continue;
          assert.equal(forumListTarget(target, compact, { marketEnabled }), null, `${name} ${channel} ${compact}`);
        }
      }
    }
  }
});

test("only a flip to the expanded layout continues the phone 最新 feed as the desktop 最新 page", () => {
  assert.deepEqual(forumListFlipTarget(route("forum", extra), false), { name: "forum-latest", query: extra });
  assert.equal(forumListTarget(route("forum", extra), false), null);
  assert.equal(forumListFlipTarget(route("forum", extra), true), null);
  assert.deepEqual(forumListFlipTarget(route("forum", { channel: "hot" }), false), { name: "forum-hot", query: {} });
  assert.deepEqual(forumListFlipTarget(route("forum-hot"), true), { name: "forum", query: { channel: "hot" } });
  assert.equal(forumListFlipTarget(route("forum-latest"), false), null);
});

// An iPad Air (screen 820×1180) whose window is resized or rotated across the 1024 px tablet switch.
const viewport = { width: 820, height: 1180 };
const resizeListeners: Array<() => void> = [];
const queries: Record<string, () => boolean> = {
  "(pointer: coarse)": () => true,
  "(hover: hover) and (pointer: fine)": () => false,
  "(max-width: 768px)": () => viewport.width <= 768,
  "(max-width: 1023px)": () => viewport.width <= 1023,
  "(orientation: portrait)": () => viewport.height >= viewport.width,
};
Object.assign(globalThis, {
  window: {
    get innerWidth() { return viewport.width; },
    get innerHeight() { return viewport.height; },
    screen: { width: 820, height: 1180 },
    location: { search: "" },
    matchMedia: (query: string) => ({ get matches() { return queries[query]?.() ?? false; }, addEventListener() {} }),
    addEventListener: (type: string, listener: () => void) => { if (type === "resize") resizeListeners.push(listener); },
  },
  sessionStorage: { getItem: () => null, setItem() {} },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", maxTouchPoints: 5 },
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function resize(width: number, height: number) {
  viewport.width = width;
  viewport.height = height;
  for (const listener of resizeListeners) listener();
  await wait(5);
}

/** The forum routes with router/index.ts's guard, plus an async app guard registered after the sync, as there. */
async function withRouter(run: (router: Router) => Promise<void>, appGuardDelay = 0) {
  const view = { render: () => null };
  const guard = (to: ForumListRouteInput) => forumListTarget(to, isCompactLayoutNow(), { marketEnabled: true }) ?? true;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", name: "home", component: view },
      { path: "/broken", name: "broken", component: () => Promise.reject(new Error("chunk failed")) },
      { path: "/forum", name: "forum", component: view, beforeEnter: guard },
      { path: "/forum/hot", name: "forum-hot", component: view, beforeEnter: guard },
      { path: "/forum/latest", name: "forum-latest", component: view, beforeEnter: guard },
      { path: "/forum/b/market", name: "market", component: view, beforeEnter: guard },
      { path: "/forum/b/:slug", name: "board", component: view },
      { path: "/forum/topic/:id", name: "topic", component: view },
    ],
  });
  const uninstall = installForumListLayoutSync(router, () => ({ marketEnabled: true }));
  router.beforeEach(async () => {
    if (appGuardDelay) await wait(appGuardDelay);
  });
  try {
    await run(router);
  } finally {
    uninstall();
  }
}

test("a guard redirect onto the current URL still lets the next rotation sync the route", async () => {
  await resize(820, 1180);
  await withRouter(async (router) => {
    await router.push("/forum?channel=market");
    // The drawer's 二手 link while the 二手 channel is open: the guard redirects onto the current URL.
    await router.push("/forum/b/market");
    assert.equal(router.currentRoute.value.fullPath, "/forum?channel=market");
    await resize(1180, 820);
    assert.equal(router.currentRoute.value.fullPath, "/forum/b/market");
  });
});

test("a rotation while the app's guard is waiting does not cancel the navigation", async () => {
  await resize(820, 1180);
  await withRouter(async (router) => {
    await router.push("/forum?channel=hot");
    const navigation = router.push("/forum/topic/1");
    await wait(5);
    await resize(1180, 820);
    assert.equal(await navigation, undefined);
    await wait(40);
    assert.equal(router.currentRoute.value.fullPath, "/forum/topic/1");
  }, 30);
});

test("a navigation error during a rotation does not turn the next navigation into a flip", async () => {
  await resize(820, 1180);
  await withRouter(async (router) => {
    await router.push("/home");
    const navigation = router.push("/broken").catch(() => undefined);
    await wait(5);
    await resize(1180, 820);
    await navigation;
    await router.push("/forum");
    await wait(5);
    assert.equal(router.currentRoute.value.fullPath, "/forum");
  }, 20);
});

test("the desktop hub survives a round trip through the compact layout; the phone 最新 feed continues as 最新", async () => {
  await resize(1180, 820);
  await withRouter(async (router) => {
    await router.push("/forum");
    await resize(820, 1180);
    await resize(1180, 820);
    assert.equal(router.currentRoute.value.fullPath, "/forum");

    await resize(820, 1180);
    await router.push("/home");
    await router.push("/forum");
    await resize(1180, 820);
    assert.equal(router.currentRoute.value.fullPath, "/forum/latest");
    await resize(820, 1180);
    assert.equal(router.currentRoute.value.fullPath, "/forum");
  });
});
