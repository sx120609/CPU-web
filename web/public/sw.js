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
        padding: 24px 16px;
        box-sizing: border-box;
      }
      .card {
        width: min(100%, 520px);
        margin: 0 auto;
        padding: 24px 22px 20px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(22, 135, 118, 0.10);
        color: #168776;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      h1 {
        margin: 14px 0 10px;
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
      .schedule-list {
        display: grid;
        gap: 12px;
        margin: 18px 0 16px;
      }
      .day-group {
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 16px;
        background: rgba(248, 250, 252, 0.92);
        overflow: hidden;
      }
      .day-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px 10px;
        background: rgba(22, 135, 118, 0.08);
        color: #145f53;
        font-size: 13px;
        font-weight: 700;
      }
      .day-group ul {
        list-style: none;
        margin: 0;
        padding: 10px 12px 12px;
        display: grid;
        gap: 10px;
      }
      .course {
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.20);
        background: #ffffff;
        padding: 12px;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
      }
      .course strong {
        display: block;
        font-size: 15px;
        line-height: 1.35;
        margin-bottom: 6px;
      }
      .course .meta,
      .course .note {
        display: block;
        font-size: 13px;
        line-height: 1.5;
        color: #526071;
      }
      .course .note {
        color: #6b7280;
      }
      .empty {
        border: 1px dashed rgba(148, 163, 184, 0.38);
        border-radius: 16px;
        background: rgba(248, 250, 252, 0.82);
        padding: 20px 16px;
        color: #64748b;
        text-align: center;
        line-height: 1.6;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      a, button {
        color: #168776;
        text-decoration: none;
        font-weight: 700;
        font: inherit;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        background: #168776;
        color: #ffffff;
        cursor: pointer;
      }
      .secondary-link {
        color: #516072;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="badge">离线课表</span>
      <h1 id="title">正在读取本地课表</h1>
      <p id="summary">当前网络不可用，正在尝试恢复最近一次缓存的课表内容。</p>
      <div id="schedule-list" class="schedule-list">
        <div class="empty">正在读取离线缓存，请稍候。</div>
      </div>
      <p class="hint">联网后重新打开，这里会恢复完整交互版课表；离线状态下展示的是最近一次成功读取的本地缓存。</p>
      <div class="actions">
        <button type="button" onclick="window.location.href='/schedule'">重新尝试联网打开</button>
        <a class="secondary-link" href="/schedule">仍想打开完整页</a>
      </div>
    </main>
    <script>
      (() => {
        const title = document.getElementById("title");
        const summary = document.getElementById("summary");
        const list = document.getElementById("schedule-list");
        const LAST_CACHE_BASE = "cpu-schedule-last-cache-key-v1";
        const LAST_STATE_BASE = "cpu-schedule-last-state-v1";
        const CACHE_PREFIX = "cpu-schedule-cache-v3:";
        const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

        function escapeHtml(value) {
          return String(value || "").replace(/[&<>"']/g, (char) => {
            if (char === "&") return "&amp;";
            if (char === "<") return "&lt;";
            if (char === ">") return "&gt;";
            if (char === String.fromCharCode(34)) return "&quot;";
            return "&#39;";
          });
        }

        function readJson(key) {
          if (!key) return null;
          try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        }

        function pad(value) {
          return String(value).padStart(2, "0");
        }

        function formatTime(savedAt) {
          const date = new Date(savedAt || Date.now());
          return pad(date.getHours()) + ":" + pad(date.getMinutes());
        }

        function findBestScheduleCache() {
          const candidates = [];
          for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i) || "";
            if (key === LAST_CACHE_BASE || key.indexOf(LAST_CACHE_BASE + ":") === 0) {
              const scheduleKey = localStorage.getItem(key) || "";
              const envelope = readJson(scheduleKey);
              if (envelope && envelope.data) {
                candidates.push({ envelope, scheduleKey, lastKey: key });
              }
            }
          }
          if (!candidates.length) {
            for (let i = 0; i < localStorage.length; i += 1) {
              const key = localStorage.key(i) || "";
              if (key.indexOf(CACHE_PREFIX) !== 0) continue;
              const envelope = readJson(key);
              if (envelope && envelope.data) {
                candidates.push({ envelope, scheduleKey: key, lastKey: "" });
              }
            }
          }
          candidates.sort((left, right) => Number(right.envelope.savedAt || 0) - Number(left.envelope.savedAt || 0));
          return candidates[0] || null;
        }

        function readLastState(candidate) {
          if (!candidate) return null;
          if (candidate.lastKey && candidate.lastKey.indexOf(LAST_CACHE_BASE + ":") === 0) {
            return readJson(candidate.lastKey.replace(LAST_CACHE_BASE, LAST_STATE_BASE));
          }
          for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i) || "";
            if (key === LAST_STATE_BASE || key.indexOf(LAST_STATE_BASE + ":") === 0) {
              const state = readJson(key);
              if (state) return state;
            }
          }
          return null;
        }

        function courseMatchesWeek(course, week) {
          if (!week) return true;
          if (Array.isArray(course.weekList) && course.weekList.length) {
            return course.weekList.indexOf(week) !== -1;
          }
          return true;
        }

        function collectCourses(data, selectedWeek) {
          const rows = [];
          const cells = Array.isArray(data && data.cells) ? data.cells : [];
          for (const cell of cells) {
            const courses = Array.isArray(cell && cell.courses) ? cell.courses : [];
            for (const course of courses) {
              if (!courseMatchesWeek(course, selectedWeek)) continue;
              rows.push({
                day: Number(cell.day) || 0,
                bigSlot: Number(cell.bigSlot) || 0,
                startSlot: Number(course.startSlot) || 0,
                name: course.name || "未命名课程",
                teacher: course.teacher || "",
                location: course.location || "",
                note: course.slotNote || course.weeks || "",
              });
            }
          }
          rows.sort((left, right) => (
            left.day - right.day
            || left.bigSlot - right.bigSlot
            || left.startSlot - right.startSlot
            || String(left.name).localeCompare(String(right.name), "zh-CN")
          ));
          return rows;
        }

        function renderCourses(courses) {
          const groups = DAYS.map((label, index) => ({
            label,
            day: index + 1,
            rows: courses.filter((course) => course.day === index + 1),
          })).filter((group) => group.rows.length);

          if (!groups.length) {
            list.innerHTML = '<div class="empty">这份离线缓存里没有可展示的课程。联网后重新打开可刷新最新课表。</div>';
            return;
          }

          list.innerHTML = groups.map((group) => (
            '<section class="day-group">'
            + '<div class="day-head"><span>' + escapeHtml(group.label) + '</span><span>' + group.rows.length + ' 节课</span></div>'
            + '<ul>'
            + group.rows.map((course) => (
              '<li class="course">'
              + '<strong>' + escapeHtml(course.name) + '</strong>'
              + (course.location ? '<span class="meta">@' + escapeHtml(course.location) + '</span>' : '')
              + (course.teacher ? '<span class="meta">' + escapeHtml(course.teacher) + '</span>' : '')
              + (course.note ? '<span class="note">' + escapeHtml(course.note) + '</span>' : '')
              + '</li>'
            )).join("")
            + '</ul>'
            + '</section>'
          )).join("");
        }

        const candidate = findBestScheduleCache();
        if (!candidate) {
          title.textContent = "还没有离线课表";
          summary.textContent = "当前设备还没找到可用的课表缓存，请先联网成功打开一次课表。";
          list.innerHTML = '<div class="empty">联网打开一次后，这里就能显示最近一次缓存的课表内容。</div>';
          return;
        }

        const data = candidate.envelope.data || {};
        const state = readLastState(candidate);
        const week = Number((state && state.week) || data.currentWeek || 0);
        const semester = (state && state.semester) || data.currentSemester || "";
        title.textContent = semester ? semester + " · 离线课表" : "离线课表";
        summary.textContent = "第 " + (week || data.currentWeek || "--") + " 周 · 本地缓存 " + formatTime(candidate.envelope.savedAt);
        renderCourses(collectCourses(data, week));
      })();
    </script>
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
  try {
    const response = await fetch(request);
    await putResponse(APP_SHELL_CACHE, SCHEDULE_PATH, response);
    return response;
  } catch {
    return offlineShellResponse();
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
