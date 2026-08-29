import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { preloadEducationViews, preloadPrimaryViews, router } from "./router";
import { useAuthStore } from "./stores/auth";
import { useJwxtStore } from "./stores/jwxt";
import { useSiteStore } from "./stores/site";
import { applyInitialAppearance, useAppearanceStore } from "./stores/appearance";
import { installIosNativeImageBridge } from "./utils/nativeBridge";
import {
  isDesktopNativeApp,
  isFlutterNativeShell,
  isLikelyIosDevice,
} from "./utils/clientInfo";
import { scheduleJwxtDataPrewarm } from "./utils/jwxtPrewarm";
import { installUnifiedImageLoading } from "./utils/imageLoading";

import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "photoswipe/style.css";
import "@fontsource-variable/inter/standard.css";
import "@fontsource/jetbrains-mono";
import "./styles/harmonyos-emoji.css";
import "./styles/harmonyos-sans.css";
import "./styles/index.scss";
import "./styles/image-viewer.scss";

const SCHEDULE_OFFLINE_WARMUP_MESSAGE = "cpu-schedule-offline-warmup";
const SCHEDULE_OFFLINE_STATIC_URLS = [
  "/schedule",
  "/manifest-v3.webmanifest?v=20260530",
  "/apple-touch-icon-v3.png?v=20260530-hw",
  "/icon-192-v3.png?v=20260530-hw",
  "/icon-512-v3.png?v=20260530-hw",
  "/favicon.svg?v=20260530",
];

let serviceWorkerReady: Promise<ServiceWorkerRegistration | null> | null = null;
const JWXT_SESSION_BOOTSTRAP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const DESKTOP_RELEASE_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
let jwxtSessionBootstrapScheduled = false;
let jwxtSessionBootstrapInFlight = false;
let jwxtSessionBootstrapLastAt = 0;
let desktopReleaseCheckInFlight = false;
let desktopReleaseCheckLastAt = 0;

function getEntryModuleSignature(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((script) => {
      const src = script.getAttribute("src");
      if (!src) return "";
      try {
        const url = new URL(src, window.location.origin);
        return url.origin === window.location.origin ? url.pathname : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .sort()
    .join("|");
}

function isEditingText() {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return active.matches("input, textarea, [contenteditable='true']")
    || Boolean(active.closest("[contenteditable='true']"));
}

async function checkDesktopWebRelease(options?: { force?: boolean }) {
  if (!isDesktopNativeApp() || document.visibilityState !== "visible" || desktopReleaseCheckInFlight) return;
  const now = Date.now();
  if (
    !options?.force
    && desktopReleaseCheckLastAt > 0
    && now - desktopReleaseCheckLastAt < DESKTOP_RELEASE_CHECK_MIN_INTERVAL_MS
  ) {
    return;
  }

  desktopReleaseCheckInFlight = true;
  desktopReleaseCheckLastAt = now;
  try {
    const response = await fetch(`/?__cpu_release_check=${now}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) return;

    const latestDocument = new DOMParser().parseFromString(await response.text(), "text/html");
    const currentSignature = getEntryModuleSignature(document);
    const latestSignature = getEntryModuleSignature(latestDocument);
    if (currentSignature && latestSignature && currentSignature !== latestSignature && !isEditingText()) {
      window.location.reload();
    }
  } catch {
    // Release checks are best-effort and must never interrupt normal client use.
  } finally {
    desktopReleaseCheckInFlight = false;
  }
}

function installDesktopWebReleaseRefresh() {
  if (!isDesktopNativeApp()) return;
  globalThis.setTimeout(() => {
    void checkDesktopWebRelease({ force: true });
  }, 5000);
  globalThis.setInterval(() => {
    void checkDesktopWebRelease();
  }, DESKTOP_RELEASE_CHECK_MIN_INTERVAL_MS);
  window.addEventListener("focus", () => {
    void checkDesktopWebRelease();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkDesktopWebRelease();
    }
  });
}

function installTouchGuards() {
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("gesturechange", (event) => event.preventDefault());
  document.addEventListener("gestureend", (event) => event.preventDefault());
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}

function installFeedbackLayerGuard() {
  let frame = 0;
  const scheduleReflow = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      reflowMessages();
      reflowNotifications();
    });
  };

  const reflowMessages = () => {
    const messages = Array.from(document.querySelectorAll<HTMLElement>(".el-message"));
    if (!messages.length) return;

    const topBase = window.matchMedia("(max-width: 768px)").matches ? 132 : 86;
    const gap = 10;
    let nextTop = topBase;

    for (const message of messages) {
      const top = `${nextTop}px`;
      if (message.style.top !== top) message.style.top = top;
      message.style.left = "auto";
      message.style.right = window.matchMedia("(max-width: 768px)").matches ? "12px" : "18px";
      message.style.transform = "none";
      nextTop += message.offsetHeight + gap;
    }
  };

  const reflowNotifications = () => {
    const notifications = Array.from(document.querySelectorAll<HTMLElement>(".el-notification.right"));
    if (!notifications.length) return;

    const topBase = window.matchMedia("(max-width: 768px)").matches ? 132 : 86;
    const gap = 12;
    let nextTop = topBase;

    for (const item of notifications) {
      const top = `${nextTop}px`;
      if (item.style.top !== top) item.style.top = top;
      nextTop += item.offsetHeight + gap;
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        scheduleReflow();
      } else if (mutation.type === "attributes") {
        const target = mutation.target;
        if (
          target instanceof HTMLElement &&
          (target.classList.contains("el-message") || target.classList.contains("el-notification"))
        ) {
          scheduleReflow();
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });

  window.addEventListener("resize", scheduleReflow);
}

function installNativeAppMarker() {
  const ua = navigator.userAgent;
  if (isLikelyIosDevice(ua)) {
    document.documentElement.dataset.cpuPlatform = "ios";
  }
  const nativeOrStandalone = /cpuwebscheduleapp|cpuwebharmonyapp/i.test(ua)
    || isFlutterNativeShell(ua)
    || window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;
  if (nativeOrStandalone) {
    document.body.dataset.cpuNativeApp = "1";
  }

  // 普通 Android 浏览器已经把网页视口放在状态栏/浏览器工具栏下方，
  // 部分厂商浏览器却仍返回非零 safe-area-inset-top。无条件使用会重复留白。
  // 仅 iOS、PWA 和真正的原生壳需要在网页内部再次预留顶部安全区。
  if (nativeOrStandalone || isLikelyIosDevice(ua)) {
    document.body.dataset.cpuTopSafeArea = "1";
  }
}

function shouldWarmScheduleOfflinePath(pathname: string) {
  return pathname === "/schedule"
    || pathname.startsWith("/assets/")
    || pathname.startsWith("/brand/")
    || pathname.startsWith("/splash/")
    || pathname === "/manifest-v3.webmanifest"
    || pathname === "/favicon.svg"
    || pathname.startsWith("/icon-")
    || pathname.startsWith("/apple-touch-icon");
}

function toSameOriginPath(rawUrl?: string | null) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    return `${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

function collectScheduleOfflineUrls() {
  const urls = new Set<string>(SCHEDULE_OFFLINE_STATIC_URLS);
  const currentRouteUrl = toSameOriginPath(window.location.pathname + window.location.search);
  if (currentRouteUrl) urls.add(currentRouteUrl);

  document.querySelectorAll<HTMLLinkElement>(
    'link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-startup-image"], link[rel="modulepreload"], link[rel="stylesheet"]',
  ).forEach((element) => {
    const normalized = toSameOriginPath(element.href);
    if (!normalized) return;
    const pathname = new URL(normalized, window.location.origin).pathname;
    if (shouldWarmScheduleOfflinePath(pathname)) urls.add(normalized);
  });

  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((element) => {
    const normalized = toSameOriginPath(element.src);
    if (!normalized) return;
    const pathname = new URL(normalized, window.location.origin).pathname;
    if (shouldWarmScheduleOfflinePath(pathname)) urls.add(normalized);
  });

  performance.getEntriesByType("resource").forEach((entry) => {
    const normalized = toSameOriginPath(entry.name);
    if (!normalized) return;
    const pathname = new URL(normalized, window.location.origin).pathname;
    if (shouldWarmScheduleOfflinePath(pathname)) urls.add(normalized);
  });

  return [...urls];
}

function warmScheduleOfflineCache(registration: ServiceWorkerRegistration | null) {
  if (!registration) return;
  const currentPath = router.currentRoute.value.path || window.location.pathname;
  if (!currentPath.startsWith("/schedule")) return;
  const target = registration.active ?? navigator.serviceWorker.controller;
  if (!target) return;
  target.postMessage({
    type: SCHEDULE_OFFLINE_WARMUP_MESSAGE,
    urls: collectScheduleOfflineUrls(),
  });
}

function shouldSkipJwxtSessionBootstrap() {
  if (window.location.pathname.replace(/\/+$/, "") === "/login") return true;
  try {
    return sessionStorage.getItem("cpu-just-logged-out") === "1";
  } catch {
    return false;
  }
}

function scheduleJwxtSessionBootstrap(options?: { force?: boolean; immediate?: boolean }) {
  if (shouldSkipJwxtSessionBootstrap() || jwxtSessionBootstrapScheduled || jwxtSessionBootstrapInFlight) return;
  const now = Date.now();
  if (
    !options?.force &&
    jwxtSessionBootstrapLastAt > 0 &&
    now - jwxtSessionBootstrapLastAt < JWXT_SESSION_BOOTSTRAP_MIN_INTERVAL_MS
  ) {
    return;
  }
  jwxtSessionBootstrapScheduled = true;
  const run = () => {
    jwxtSessionBootstrapScheduled = false;
    void bootstrapJwxtSession();
  };
  if (options?.immediate) {
    globalThis.setTimeout(run, 0);
    return;
  }
  const requestIdleCallback = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    globalThis.setTimeout(run, 300);
  }
}

async function bootstrapJwxtSession() {
  if (shouldSkipJwxtSessionBootstrap()) return;
  if (jwxtSessionBootstrapInFlight) return;
  const auth = useAuthStore();
  const jwxt = useJwxtStore();
  jwxtSessionBootstrapInFlight = true;
  jwxtSessionBootstrapLastAt = Date.now();
  try {
    if (!auth.ready) {
      await auth.fetchMe({ probe: true }).catch(() => undefined);
    }
    if (shouldSkipJwxtSessionBootstrap()) return;
    jwxt.hydrate();
    const ready = await jwxt.ensureSession({ refresh: true, silent: true, allowAutoLogin: false }).catch(() => false);
    if (ready) scheduleJwxtDataPrewarm();
  } catch {
    // Keep background restore quiet; education pages still expose manual captcha/login flow.
  } finally {
    jwxtSessionBootstrapInFlight = false;
  }
}

function installJwxtSessionBootstrapTriggers() {
  router.afterEach((to) => {
    const educationRoute = to.path.startsWith("/schedule") || to.path.startsWith("/jwxt");
    scheduleJwxtSessionBootstrap({ immediate: educationRoute });
  });
  window.addEventListener("focus", () => {
    scheduleJwxtSessionBootstrap();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleJwxtSessionBootstrap();
    }
  });
}

function scheduleEducationViewPreload() {
  // 教务页组件较大；首屏挂载后的下一帧立即预取，避免用户点击底栏后才开始下载解析。
  window.requestAnimationFrame(() => {
    void preloadEducationViews();
  });
  const run = () => {
    void preloadPrimaryViews();
  };
  const requestIdleCallback = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 1000 });
  } else {
    globalThis.setTimeout(run, 200);
  }
}

function installJwxtDataPrewarmTriggers() {
  const auth = useAuthStore();
  let lastSessionVersion = auth.sessionVersion;
  auth.$subscribe(() => {
    if (auth.sessionVersion === lastSessionVersion) return;
    lastSessionVersion = auth.sessionVersion;
    if (auth.isLoggedIn) {
      scheduleJwxtDataPrewarm({ force: true });
    }
  });
}

installTouchGuards();
installFeedbackLayerGuard();
installUnifiedImageLoading();
installIosNativeImageBridge();
installNativeAppMarker();
installDesktopWebReleaseRefresh();
applyInitialAppearance();

// 注册 Service Worker —— Chrome PWA "installable" 条件之一（manifest + SW + HTTPS）
// 不满足时 beforeinstallprompt 不会触发，"添加到主屏幕"按钮就不会出现
if ("serviceWorker" in navigator) {
  serviceWorkerReady = new Promise((resolve) => {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((registration) => {
          warmScheduleOfflineCache(registration);
          resolve(registration);
        })
        .catch((err) => {
          console.warn("[sw] 注册失败：", err?.message);
          resolve(null);
        });
    }, { once: true });
  });
}

const app = createApp(App);
app.use(createPinia());
useAppearanceStore().hydrate();
useAuthStore().hydrate();
installJwxtDataPrewarmTriggers();
// 站点功能开关：尽早拉一次，不阻塞挂载（导航默认乐观显示，拿到结果后自动收敛）
useSiteStore().fetch();
app.use(router);
app.mount("#app");
scheduleEducationViewPreload();

router.afterEach((to) => {
  if (!serviceWorkerReady || !to.path.startsWith("/schedule")) return;
  void serviceWorkerReady.then((registration) => warmScheduleOfflineCache(registration));
});

installJwxtSessionBootstrapTriggers();

router.isReady().finally(() => {
  if (serviceWorkerReady) {
    void serviceWorkerReady.then((registration) => warmScheduleOfflineCache(registration));
  }
  scheduleJwxtSessionBootstrap({ force: true, immediate: true });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.dataset.cpuAppReady = "1";
    });
  });
});
