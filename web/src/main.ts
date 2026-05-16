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

function installMessagePositionGuard() {
  const positionMessage = (el: Element) => {
    const message = el as HTMLElement;
    if (!message.classList.contains("el-message")) return;
    const top = parseFloat(message.style.top || "20");
    if (!Number.isFinite(top)) return;
    const baseTop = Number(message.dataset.cpuBaseTop ?? top);
    message.dataset.cpuBaseTop = String(baseTop);
    const headerOffset = window.matchMedia("(max-width: 768px)").matches ? 118 : 72;
    const nextTop = `${baseTop + headerOffset}px`;
    if (message.style.top !== nextTop) {
      message.style.top = nextTop;
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            positionMessage(node);
            node.querySelectorAll(".el-message").forEach(positionMessage);
          }
        });
      } else if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
        positionMessage(mutation.target);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
}

installTouchGuards();
installMessagePositionGuard();

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
