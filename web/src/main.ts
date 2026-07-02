import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";
import { useSiteStore } from "./stores/site";
import { applyInitialAppearance, useAppearanceStore } from "./stores/appearance";
import { installIosNativeImageBridge } from "./utils/nativeBridge";

import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles/index.scss";

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
  const platform = /cpuwebscheduleapp|cpuwebharmonyapp/i.test(ua)
    || window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;
  if (!platform) return;
  document.body.dataset.cpuNativeApp = "1";
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

installTouchGuards();
installFeedbackLayerGuard();
installIosNativeImageBridge();
installNativeAppMarker();
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
// 站点功能开关：尽早拉一次，不阻塞挂载（导航默认乐观显示，拿到结果后自动收敛）
useSiteStore().fetch();
app.use(router);
app.mount("#app");

router.afterEach((to) => {
  if (!serviceWorkerReady || !to.path.startsWith("/schedule")) return;
  void serviceWorkerReady.then((registration) => warmScheduleOfflineCache(registration));
});

router.isReady().finally(() => {
  if (serviceWorkerReady) {
    void serviceWorkerReady.then((registration) => warmScheduleOfflineCache(registration));
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.dataset.cpuAppReady = "1";
    });
  });
});
