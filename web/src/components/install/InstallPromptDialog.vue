<template>
  <el-dialog
    v-model="open"
    :title="title"
    :width="dialogWidth"
    align-center
    :close-on-click-modal="true"
    class="install-dialog"
  >
    <!-- 已安装 / App 内打开：理论上根本看不到这个组件，但保险起见 -->
    <div v-if="isStandalone || isNativeApp" class="content">
      <p class="muted">当前已经在独立应用环境中打开。</p>
    </div>

    <!-- Android 浏览器：优先提供 APK -->
    <div v-else-if="platform === 'android'" class="content">
      <p>建议安装 <b>药大垎坊课表</b> Android 版，下次可从桌面图标直接打开课表。</p>
      <ul class="bullets">
        <li>安装包很小，只是课表页的轻量 App 壳</li>
        <li>网站正常访问时，App 内容会同步更新</li>
        <li>下载完成后打开 APK，按系统提示安装</li>
      </ul>
      <p class="muted">如果系统提示“未知来源”，需要允许当前浏览器安装应用。</p>
    </div>

    <!-- iOS Safari：必须手动通过分享菜单 -->
    <div v-else-if="platform === 'ios'" class="content">
      <p>iOS 的"添加到主屏幕"必须手动操作，三步即可：</p>
      <ol class="steps">
        <li>
          <span class="num">1</span>
          点击右下角 <strong>三个点</strong>，再点 <strong>共享按钮</strong>
          <svg class="ic" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.5l3 3-1 1-1.3-1.3V10H7.3V4.2L6 5.5l-1-1z" fill="currentColor"/>
            <path d="M3 7h2v6h6V7h2v8H3z" fill="currentColor"/>
          </svg>
        </li>
        <li>
          <span class="num">2</span>
          选择 <strong>「查看更多」</strong>
        </li>
        <li>
          <span class="num">3</span>
          选择 <strong>「添加到主屏幕」</strong>
        </li>
      </ol>
      <p class="muted">必须使用 Safari 浏览器；微信/QQ 等内置浏览器不支持。</p>
    </div>

    <!-- 其他情况（Android 但浏览器没触发 prompt / 桌面浏览器 / 不支持） -->
    <div v-else class="content">
      <p>请在浏览器菜单中找到 <b>「安装应用」</b>、<b>「添加到主屏幕」</b> 或 <b>「创建快捷方式」</b>。</p>
      <p class="muted">部分浏览器（微信/QQ 内置 / 较老 Chrome）不支持安装。</p>
    </div>

    <template #footer>
      <div class="footer">
        <el-button
          v-if="platform === 'android' && !isNativeApp"
          type="primary"
          size="default"
          @click="downloadApk"
        >
          下载 APK
        </el-button>
        <el-button
          v-else-if="deferredPrompt"
          type="primary"
          size="default"
          @click="installNow"
        >
          添加到主屏幕
        </el-button>
        <el-button size="default" @click="dismissDialog">{{ deferredPrompt ? "稍后" : "我知道了" }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { detectInAppBrowser } from "@/utils/inAppBrowser";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "cpu-install-dismissed-v1";
const APK_DOWNLOAD_URL = "/downloads/CPU-Web.apk";

const open = ref(false);
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const isStandalone = ref(false);
const isNativeApp = ref(false);

const platform = computed<"ios" | "android" | "desktop">(() => {
  const ua = navigator.userAgent.toLowerCase();
  // iPadOS 13+ 在桌面模式下 UA 是 macOS；但 maxTouchPoints > 1 可判
  if (/iphone|ipod/.test(ua) || (/ipad/.test(ua)) || (ua.includes("mac") && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/android/.test(ua)) return "android";
  return "desktop";
});

const title = computed(() => {
  if (platform.value === "android") return "安装 Android 版课表";
  if (platform.value === "ios") return "添加到主屏幕";
  return "把课表加到主屏幕";
});

const dialogWidth = computed(() => {
  return window.innerWidth < 480 ? "92vw" : "360px";
});

function detectStandalone() {
  isStandalone.value = window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;
}

function detectNativeApp() {
  const ua = navigator.userAgent.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const isMarkedApp = ua.includes("cpuwebscheduleapp")
    || params.get("client") === "android-app";
  const isAndroidWebView = /android/.test(ua)
    && (ua.includes("; wv") || /version\/\d+(\.\d+)? chrome\//.test(ua))
    && !detectInAppBrowser().isInApp;
  isNativeApp.value = isMarkedApp || isAndroidWebView;
}

function onBeforeInstall(e: Event) {
  e.preventDefault();
  deferredPrompt.value = e as BeforeInstallPromptEvent;
}

function onAppInstalled() {
  // 安装完成 → 关掉对话框，记忆已安装
  deferredPrompt.value = null;
  open.value = false;
  isStandalone.value = true;
  try { localStorage.setItem(DISMISS_KEY, "installed"); } catch { /* ignore */ }
}

onMounted(() => {
  detectStandalone();
  detectNativeApp();
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onAppInstalled);
});
onBeforeUnmount(() => {
  window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  window.removeEventListener("appinstalled", onAppInstalled);
});

async function installNow() {
  if (!deferredPrompt.value) return;
  try {
    await deferredPrompt.value.prompt();
    const { outcome } = await deferredPrompt.value.userChoice;
    if (outcome === "dismissed") {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    }
  } finally {
    deferredPrompt.value = null;
    open.value = false;
  }
}

function downloadApk() {
  window.location.href = APK_DOWNLOAD_URL;
  open.value = false;
}

function dismissDialog() {
  open.value = false;
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
}

/** 父组件主动调用：手动打开 install 引导（任何平台都打开） */
function openDialog() {
  detectNativeApp();
  if (isStandalone.value || isNativeApp.value) return;
  open.value = true;
}

/** 父组件主动调用：用户点安装按钮时，安卓显示 APK 下载提示，其他平台走系统安装/手动引导 */
async function requestInstall() {
  detectNativeApp();
  if (isStandalone.value || isNativeApp.value) return;
  if (platform.value === "android") {
    open.value = true;
    return;
  }
  if (deferredPrompt.value) {
    await installNow();
    return;
  }
  open.value = true;
}

/**
 * 父组件主动调用：自动提示。规则：
 *  - 已 standalone 不弹
 *  - desktop 不弹（桌面用户不太关心"加到桌面"，太骚扰）
 *  - 用户主动 dismiss 过 → 3 天内不重弹
 *  - 否则延迟 1.5s 后弹（让页面先有内容）
 */
function autoPromptIfEligible() {
  detectNativeApp();
  if (isStandalone.value || isNativeApp.value) return;
  if (platform.value === "android") return;
  if (platform.value === "desktop") return;
  const last = (() => { try { return localStorage.getItem(DISMISS_KEY); } catch { return null; } })();
  if (last === "installed") return;
  if (last && last !== "installed") {
    const t = Number(last);
    if (Number.isFinite(t) && Date.now() - t < 3 * 24 * 3600 * 1000) return;
  }
  setTimeout(() => {
    // 重新核对 standalone（用户可能在等待期间已经手动加了）
    detectStandalone();
    detectNativeApp();
    if (!isStandalone.value && !isNativeApp.value) open.value = true;
  }, 1500);
}

const canShow = computed(() => !isStandalone.value && !isNativeApp.value);

defineExpose({ openDialog, requestInstall, autoPromptIfEligible, canShow, platform, isStandalone, isNativeApp });
</script>

<style scoped>
.content { font-size: 14px; line-height: 1.7; color: #1f2937; }
.content p { margin: 0 0 10px; }
.content .muted { color: #6b7280; font-size: 12px; line-height: 1.6; }
.content b { color: #168776; }

.bullets {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  font-size: 13px;
  color: #4b5563;
}
.bullets li {
  padding: 4px 0 4px 18px;
  position: relative;
}
.bullets li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: #168776;
  font-weight: 700;
}

.steps {
  list-style: none;
  padding: 0;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #374151;
  line-height: 1.5;
}
.steps .num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #168776;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.steps strong { color: #168776; }
.ic {
  display: inline-block;
  width: 18px;
  height: 18px;
  vertical-align: -3px;
  color: #168776;
  margin-left: 2px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
