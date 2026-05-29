import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";
import { useSiteStore } from "./stores/site";

import "element-plus/dist/index.css";
import "./styles/index.scss";

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

installTouchGuards();
installFeedbackLayerGuard();
installNativeAppMarker();

// 注册 Service Worker —— Chrome PWA "installable" 条件之一（manifest + SW + HTTPS）
// 不满足时 beforeinstallprompt 不会触发，"添加到主屏幕"按钮就不会出现
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] 注册失败：", err?.message);
    });
  });
}

const app = createApp(App);
app.use(createPinia());
useAuthStore().hydrate();
// 站点功能开关：尽早拉一次，不阻塞挂载（导航默认乐观显示，拿到结果后自动收敛）
useSiteStore().fetch();
app.use(router);
app.mount("#app");

router.isReady().finally(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.dataset.cpuAppReady = "1";
    });
  });
});
