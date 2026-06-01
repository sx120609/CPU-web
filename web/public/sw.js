const SW_VERSION = "cpu-schedule-offline-20260601-v1";
const APP_SHELL_CACHE = `${SW_VERSION}:shell`;
const ASSET_CACHE = `${SW_VERSION}:assets`;
const SCHEDULE_PATH = "/schedule";
const WARMUP_MESSAGE = "cpu-schedule-offline-warmup";
const STATIC_PREFIXES = ["/assets/", "/brand/", "/splash/"];
const PRECACHE_URLS = [
  SCHEDULE_PATH,
  "/manifest-v3.webmanifest?v=20260530",
  "/apple-touch-icon-v3.png?v=20260530-hw",
  "/icon-192-v3.png?v=20260530-hw",
  "/icon-512-v3.png?v=20260530-hw",
  "/favicon.svg?v=20260530",
];

function toUrl(input) {
  return new URL(input, self.location.origin);
}

function isSameOrigin(url) {
  return toUrl(url).origin === self.location.origin;
}

function isSchedulePath(pathname) {
  return pathname === SCHEDULE_PATH || pathname.startsWith(`${SCHEDULE_PATH}/`);
}

function isStaticAssetPath(pathname) {
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (pathname === "/manifest-v3.webmanifest" || pathname === "/favicon.svg") return true;
  if (pathname.startsWith("/icon-") || pathname.startsWith("/apple-touch-icon")) return true;
  return false;
}

function shouldCacheAssetRequest(request) {
  if (!isSameOrigin(request.url)) return false;
  const url = toUrl(request.url);
  return isStaticAssetPath(url.pathname);
}

async function putResponse(cacheName, key, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  await cache.put(key, response.clone());
  return response;
}

async function fetchAndCache(request, cacheName, key = request) {
  const response = await fetch(request);
  await putResponse(cacheName, key, response);
  return response;
}

async function warmupUrls(urls) {
  for (const raw of urls) {
    try {
      const url = toUrl(raw);
      if (url.origin !== self.location.origin) continue;
      const request = new Request(url.toString(), { cache: "reload" });
      if (isSchedulePath(url.pathname)) {
        await fetchAndCache(request, APP_SHELL_CACHE, SCHEDULE_PATH);
      } else if (isStaticAssetPath(url.pathname)) {
        await fetchAndCache(request, ASSET_CACHE);
      }
    } catch {
      // Warmup is best effort; a later online visit can refill the cache.
    }
  }
}

function offlineShellResponse() {
  return new Response(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#168776" />
    <title>药大拾间 · 离线课表</title>
    <style>
      :root { color-scheme: light; }
      html, body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at 18% 0%, rgba(174, 211, 255, 0.56), transparent 30%),
          radial-gradient(circle at 88% 14%, rgba(183, 232, 219, 0.42), transparent 28%),
          linear-gradient(180deg, #edf4ff 0%, #f7fbff 42%, #f8fafc 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        color: #172033;
      }
      body {
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .card {
        width: min(100%, 420px);
        padding: 24px 22px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.6;
        color: #4a5565;
      }
      .hint {
        font-size: 13px;
        color: #667085;
      }
      a {
        color: #168776;
        text-decoration: none;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>课表暂时离线</h1>
      <p>当前设备还没有缓存完整的课表页面资源，请先联网成功打开一次课表。</p>
      <p class="hint">之后即使断网，移动端客户端和添加到桌面的课表页也能直接打开最近一次缓存内容。</p>
      <a href="/schedule">重新尝试打开课表</a>
    </main>
  </body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await self.skipWaiting();
    await warmupUrls(PRECACHE_URLS);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("cpu-schedule-offline-") && ![APP_SHELL_CACHE, ASSET_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== WARMUP_MESSAGE || !Array.isArray(data.urls)) return;
  event.waitUntil(warmupUrls(data.urls));
});

async function handleScheduleNavigation(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  try {
    const response = await fetch(request);
    await putResponse(APP_SHELL_CACHE, SCHEDULE_PATH, response);
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true }) || await cache.match(SCHEDULE_PATH);
    return cached || offlineShellResponse();
  }
}

async function refreshAssetInBackground(request) {
  try {
    await fetchAndCache(request, ASSET_CACHE);
  } catch {
    // Keep using the cached copy until the next successful refresh.
  }
}

async function handleAssetRequest(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    void refreshAssetInBackground(request);
    return cached;
  }
  return fetchAndCache(request, ASSET_CACHE);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !isSameOrigin(request.url)) return;
  const url = toUrl(request.url);

  if (request.mode === "navigate" && isSchedulePath(url.pathname)) {
    event.respondWith(handleScheduleNavigation(request));
    return;
  }

  if (shouldCacheAssetRequest(request)) {
    event.respondWith(handleAssetRequest(request));
  }
});
