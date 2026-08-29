<template>
  <el-dialog
    v-model="open"
    :title="title"
    :width="dialogWidth"
    align-center
    append-to-body
    :close-on-click-modal="false"
    class="install-dialog"
  >
    <!-- 已安装 / App 内打开：理论上根本看不到这个组件，但保险起见 -->
    <div v-if="isStandalone || isNativeApp" class="content">
      <p class="muted">当前已经在独立应用环境中打开。</p>
    </div>

    <!-- 微信 / QQ 内置浏览器：先引导外部浏览器 -->
    <div v-else-if="inAppBrowser.isInApp" class="content">
      <p>
        检测到当前可能在 <b>{{ inAppBrowser.label }}</b> 内打开。
        内置浏览器通常不支持完整的添加桌面或安装流程。
      </p>
      <ul class="bullets">
        <li>请点击右上角菜单</li>
        <li>选择“在浏览器打开”或“用默认浏览器打开”</li>
        <li>进入外部浏览器后，再按页面提示继续</li>
      </ul>
    </div>

    <!-- Android 普通浏览器：优先提供 APK -->
    <div v-else-if="platform === 'android'" class="content">
      <p>建议安装 <b>药大拾间</b> Android 版，下次可从桌面图标直接打开。</p>
      <p class="migration-note">若手机里还保留 2.x 旧版，确认新版可用后可手动卸载旧版。</p>
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

    <!-- 桌面浏览器：只提供原生桌面客户端，不再展示 PWA，避免用户选错。 -->
    <div v-else class="content">
      <DesktopClientDownloadCard
        v-if="desktopDownloadPlatform"
        :platform="desktopDownloadPlatform"
      />
      <div v-else class="desktop-unsupported">
        <strong>当前桌面系统暂未提供客户端</strong>
        <p>桌面客户端目前支持 Windows 10/11 64 位，以及 Apple Silicon（M 芯片）macOS。</p>
      </div>
    </div>

    <p v-if="!isStandalone && !isNativeApp" class="support-note">
      仍有疑问，建议
      <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
      咨询。
    </p>

    <template #footer>
      <div class="footer">
        <el-button
          v-if="canDownloadAndroidApk"
          :type="deferredPrompt && platform !== 'android' ? 'default' : 'primary'"
          size="default"
          @click="downloadApk"
        >
          下载 Android 客户端
        </el-button>
        <el-button
          v-else-if="deferredPrompt && platform !== 'desktop'"
          type="primary"
          size="default"
          @click="installNow"
        >
          添加到主屏幕
        </el-button>
        <el-button size="default" @click="dismissDialog">
          {{ deferredPrompt && platform !== "desktop" ? "稍后" : "我知道了" }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import DesktopClientDownloadCard from "@/components/install/DesktopClientDownloadCard.vue";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import { USER_QQ_GROUP, openUserGroup } from "@/utils/userGroup";
import { ANDROID_APP_DOWNLOAD_URL, isDesktopNativeApp, isFlutterNativeShell, isLikelyAndroidDevice } from "@/utils/clientInfo";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const APK_DOWNLOAD_URL = ANDROID_APP_DOWNLOAD_URL;

const open = ref(false);
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const isStandalone = ref(false);
const isNativeApp = ref(false);
const inAppBrowser = computed(() => detectInAppBrowser());
let disposed = false;

const platform = computed<"ios" | "android" | "desktop">(() => {
  const ua = navigator.userAgent.toLowerCase();
  // iPadOS 13+ 在桌面模式下 UA 是 macOS；但 maxTouchPoints > 1 可判
  if (/iphone|ipod/.test(ua) || (/ipad/.test(ua)) || (ua.includes("mac") && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (isLikelyAndroidDevice()) return "android";
  return "desktop";
});
const desktopDownloadPlatform = computed<"windows" | "macos" | null>(() => {
  const ua = navigator.userAgent.toLowerCase();
  const looksLikeDesktopMac = ua.includes("mac") && navigator.maxTouchPoints <= 1;
  if (looksLikeDesktopMac) return "macos";
  if (ua.includes("windows")) return "windows";
  return null;
});

const title = computed(() => {
  if (inAppBrowser.value.isInApp) return "建议使用外部浏览器打开";
  if (platform.value === "android") return "安装 Android 版课表";
  if (platform.value === "ios") return "添加到主屏幕";
  if (desktopDownloadPlatform.value === "macos") return "下载 macOS 桌面客户端";
  if (desktopDownloadPlatform.value === "windows") return "下载 Windows 桌面客户端";
  return "桌面客户端";
});

const dialogWidth = computed(() => {
  return window.innerWidth < 480 ? "92dvw" : "440px";
});
const canDownloadAndroidApk = computed(() => {
  return platform.value === "android" && !isNativeApp.value && !inAppBrowser.value.isInApp;
});

function detectStandalone() {
  isStandalone.value = window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;
}

/**
 * 是否在自家原生客户端的 WebView 里。
 * 严格按客户端注入的 UA token 判定（不区分大小写）。
 * 不再做 `; wv` / `Version/X Chrome/X` 这种宽松匹配 —— 那些模式把许多系统浏览器
 * （Chrome / 三星 / 华为等）误判为客户端。
 *
 * 客户端侧需要在 WebView 的 userAgent 里追加 `CPUWebScheduleApp` 或 `CPUWebHarmonyApp`。
 * 同时支持手动用 `?client=android-app` / `?client=harmony-app` 强制，便于开发期测试。
 */
function detectNativeApp() {
  const ua = navigator.userAgent.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  isNativeApp.value = ua.includes("cpuwebscheduleapp")
    || ua.includes("cpuwebharmonyapp")
    || isDesktopNativeApp()
    || isFlutterNativeShell()
    || params.get("client") === "android-app"
    || params.get("client") === "harmony-app";
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
}

onMounted(() => {
  disposed = false;
  detectStandalone();
  detectNativeApp();
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onAppInstalled);
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  window.removeEventListener("appinstalled", onAppInstalled);
});

async function installNow() {
  if (!deferredPrompt.value) return;
  try {
    await deferredPrompt.value.prompt();
    await deferredPrompt.value.userChoice;
  } finally {
    deferredPrompt.value = null;
    open.value = false;
  }
}

function downloadApk() {
  const absoluteUrl = new URL(APK_DOWNLOAD_URL, window.location.origin).toString();
  const link = document.createElement("a");
  link.href = absoluteUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  open.value = false;
}

function dismissDialog() {
  open.value = false;
}

/** 父组件主动调用：手动打开 install 引导（任何平台都打开） */
function openDialog() {
  if (disposed) return;
  detectNativeApp();
  if (isStandalone.value || isNativeApp.value) return;
  open.value = true;
}

/** 父组件主动调用：用户点安装按钮时，安卓显示 APK 下载提示，其他平台走系统安装/手动引导 */
async function requestInstall() {
  if (disposed) return;
  detectNativeApp();
  if (isStandalone.value || isNativeApp.value) return;
  if (platform.value === "android") {
    open.value = true;
    return;
  }
  if (platform.value !== "desktop" && deferredPrompt.value) {
    await installNow();
    return;
  }
  open.value = true;
}

/**
 * 父组件主动调用：自动提示。规则：
 *  - 已 standalone 不弹
 *  - desktop 不弹（桌面用户不太关心"加到桌面"，太骚扰）
 *  - 每次进入页面都可重新提示
 *  - 页面就绪后立即提示，避免用户先开始操作却错过引导
 */
function autoPromptIfEligible() {
  if (disposed) return;
  detectStandalone();
  detectNativeApp();
  if (isStandalone.value || isNativeApp.value) return;
  if (inAppBrowser.value.isInApp) return;
  if (platform.value === "desktop") return;
  open.value = true;
}

const canShow = computed(() => !isStandalone.value && !isNativeApp.value);

defineExpose({ openDialog, requestInstall, autoPromptIfEligible, canShow, platform, isStandalone, isNativeApp });
</script>

<style scoped>
.content { font-size: 14px; line-height: 1.7; color: var(--cpu-text); }
.content p { margin: 0 0 10px; }
.content .muted { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.6; }
.content b { color: var(--cpu-primary); }
.desktop-unsupported {
  display: grid;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-surface-soft);
}
.desktop-unsupported strong { color: var(--cpu-text); font-size: 13px; }
.desktop-unsupported p { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; }
.migration-note {
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 26%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 10%, transparent);
  color: var(--cpu-primary);
  font-size: 12px;
  line-height: 1.6;
}

.bullets {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--cpu-text-secondary);
}
.bullets li {
  padding: 4px 0 4px 18px;
  position: relative;
}
.bullets li::before {
  width: 6px;
  height: 10px;
  position: absolute;
  left: 0;
  top: 3px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  content: "";
  transform: rotate(45deg);
  color: var(--cpu-primary);
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
  color: var(--cpu-text);
  line-height: 1.5;
}
.steps .num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--cpu-primary);
  color: #ffffff;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.steps strong { color: var(--cpu-primary); }
.ic {
  display: inline-block;
  width: 18px;
  height: 18px;
  vertical-align: -3px;
  color: var(--cpu-primary);
  margin-left: 2px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.support-note {
  margin: 12px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.support-note button {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-weight: 650;
  padding: 0;
  cursor: pointer;
}
</style>
