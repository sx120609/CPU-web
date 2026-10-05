<template>
  <div class="download-page">
    <DownloadMobile
      v-if="isMobileLayout"
      :cards="platformCards"
      :recommended="recommendedCard"
      :detected-label="detectedLabel"
      :steps-open="iosNativeUnavailable"
      @download="openDownloadGuide"
    />
    <DownloadDesktop
      v-else
      :cards="platformCards"
      :recommended="recommendedCard"
      :detected-label="detectedLabel"
      @download="openDownloadGuide"
    />

    <p class="download-note">
      药大拾间是学生自主开发维护的校园互助平台，并非学校官方应用，仅供学习研究与校园公益使用，严禁未经授权的商业用途。
      安装包请只从本页、项目官方发布页或本页链接的应用商店获取。
    </p>

    <DownloadSafetyGuideDialog
      v-model="downloadGuideVisible"
      :platform="downloadGuidePlatform"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  getDesktopDownload,
  getMacDesktopDownload,
  type DesktopDownloadInfo,
} from "@/api/site";
import {
  ANDROID_APP_DOWNLOAD_URL,
  IOS_APP_MIN_MAJOR_VERSION,
  IOS_APP_STORE_URL,
  HARMONY_APP_STORE_URL,
  ANDROID_APP_LATEST_VERSION_NAME,
  canInstallIosNativeApp,
  isLikelyAndroidDevice,
  isLikelyIosDevice,
  isLikelyHarmonyDevice,
  isAndroidNativeApp,
} from "@/utils/clientInfo";
import { requestAndroidUpdatePrompt } from "@/utils/androidUpdatePrompt";
import DownloadSafetyGuideDialog from "@/components/common/DownloadSafetyGuideDialog.vue";
import { useMobileLayout } from "@/utils/mobileLayout";
import DownloadDesktop from "./download/DownloadDesktop.vue";
import DownloadMobile from "./download/DownloadMobile.vue";
import type { DownloadPlatform, PlatformCard } from "./download/types";
import "./download/download.css";

const isMobileLayout = useMobileLayout();

const route = useRoute();
function checkRequestedUpdate() {
  if (route.query.checkUpdate && isAndroidNativeApp()) requestAndroidUpdatePrompt({ kind: "app", source: "manual" });
}
watch(() => route.query.checkUpdate, checkRequestedUpdate, { flush: "post" });

const emptyDownload = (): DesktopDownloadInfo => ({
  available: false,
  url: "",
  version: "",
  password: "",
});

const windowsDownload = ref<DesktopDownloadInfo>(emptyDownload());
const macDownload = ref<DesktopDownloadInfo>(emptyDownload());
const desktopDownloadsLoading = ref(true);

const detectedPlatform = computed<DownloadPlatform | null>(() => {
  if (typeof navigator === "undefined") return null;
  if (isLikelyHarmonyDevice()) return "harmony";
  if (isLikelyIosDevice()) return "ios";
  if (isLikelyAndroidDevice()) return "android";
  const source = navigator.userAgent.toLowerCase();
  if (source.includes("windows")) return "windows";
  if (source.includes("mac")) return "macos";
  return null;
});

const detectedLabel = computed(() => {
  const labels: Record<DownloadPlatform, string> = {
    android: "已识别为安卓设备",
    harmony: "已识别为鸿蒙设备",
    ios: "已识别为 iPhone / iPad",
    windows: "已识别为 Windows 设备",
    macos: "已识别为 Mac 设备",
  };
  return detectedPlatform.value
    ? labels[detectedPlatform.value]
    : "暂未识别设备，可手动选择平台";
});

function desktopVersionLabel(info: DesktopDownloadInfo) {
  if (desktopDownloadsLoading.value) return "读取中";
  if (!info.available) return "暂不可用";
  return info.version ? `v${info.version}` : "最新版";
}

// The App Store build needs iOS 17; older iPhones and iPads keep the Safari home-screen path.
const iosNativeUnavailable = isLikelyIosDevice() && !canInstallIosNativeApp();

const iosCard: PlatformCard = iosNativeUnavailable ? {
  key: "ios",
  group: "mobile",
  tone: "#64748b",
  name: "iPhone / iPad",
  support: `低于 iOS ${IOS_APP_MIN_MAJOR_VERSION} · Safari 主屏幕版`,
  summary: `原生版需要 iOS / iPadOS ${IOS_APP_MIN_MAJOR_VERSION}.0 或更高版本。当前系统可用 Safari 把课表添加到主屏幕，升级系统后再从 App Store 安装。`,
  features: ["顶部下载按钮内置完整教程", "Safari 添加到主屏幕", "支持 iOS 课表小组件"],
  steps: [
    "必须使用 Safari 打开本页，再点击“打开课表并添加到主屏幕”；微信、QQ 等内置浏览器不支持添加到主屏幕。",
    "进入课表后，在页面顶部操作栏找到向下箭头形状的下载按钮，点击即可打开安装教程。",
    "根据 Safari 版本，点击底部的“…”后再点共享按钮，或直接点击分享按钮，然后选择“查看更多”→“添加到主屏幕”。",
    "确认名称并点击“添加”，之后即可从桌面图标进入药大拾间课表。",
  ],
  actionLabel: "打开课表并添加到主屏幕",
  actionHint: "进入后点击页面顶部的下载按钮",
  versionLabel: "Web App",
  loading: false,
  route: "/schedule",
} : {
  key: "ios",
  group: "mobile",
  tone: "#64748b",
  name: "iPhone / iPad",
  support: `iOS / iPadOS ${IOS_APP_MIN_MAJOR_VERSION}.0 及以上 · App Store`,
  summary: "iOS 原生客户端现已开放下载，可在 App Store 免费安装并自动更新；Safari 主屏幕版仍可继续使用。",
  features: ["原生课表体验", "App Store 安装与更新", "支持 iOS 课表小组件"],
  steps: [
    "点击“在 App Store 下载”，打开药大拾间的 App Store 页面。",
    "点击“获取”并按系统提示完成安装。",
    "打开药大拾间，登录原有账号后使用。Safari 主屏幕版可继续保留。",
    `系统低于 iOS ${IOS_APP_MIN_MAJOR_VERSION} 时，可用 Safari 打开课表，通过分享菜单“添加到主屏幕”继续使用。`,
  ],
  actionLabel: "在 App Store 下载",
  actionHint: `需要 iOS / iPadOS ${IOS_APP_MIN_MAJOR_VERSION}.0 或更高版本`,
  versionLabel: "原生 App",
  loading: false,
  downloadUrl: IOS_APP_STORE_URL,
};

const platformCards = computed<PlatformCard[]>(() => [
  {
    key: "android",
    group: "mobile",
    tone: "#16a34a",
    name: "Android",
    support: "安卓手机、平板",
    summary: "Android 客户端承载完整站点，并提供更适合手机的下载、通知和课表能力。",
    features: ["课表与桌面小组件", "站内通知与文件下载", "跟随网站持续更新"],
    steps: [
      "点击下载 APK，并等待浏览器完成下载。",
      "打开安装包；若系统询问，请允许当前浏览器安装未知来源应用。",
      "安装完成后从桌面打开药大拾间。",
    ],
    actionLabel: "下载 Android 客户端",
    actionHint: "APK 安装包",
    versionLabel: `v${ANDROID_APP_LATEST_VERSION_NAME}`,
    loading: false,
    downloadUrl: ANDROID_APP_DOWNLOAD_URL,
  },
  {
    key: "harmony",
    group: "mobile",
    tone: "#dc4a3d",
    name: "鸿蒙原生版",
    support: "鸿蒙手机、平板 · 华为应用市场",
    summary: "鸿蒙原生客户端已上线，可前往华为应用市场安装并获取更新。",
    features: ["原生课表体验", "华为应用市场安装与更新", "登录原有账号"],
    steps: [
      "点击“在华为应用市场下载”，打开药大拾间的应用详情页。",
      "按应用市场提示完成安装；支持的系统版本以应用详情页为准。",
      "安装完成后打开药大拾间，登录原有账号即可使用。",
    ],
    actionLabel: "在华为应用市场下载",
    actionHint: "系统兼容性以应用市场为准",
    versionLabel: "原生 App",
    loading: false,
    downloadUrl: HARMONY_APP_STORE_URL,
  },
  iosCard,
  {
    key: "windows",
    group: "desktop",
    tone: "#1677d2",
    name: "Windows",
    support: "Windows 10 / 11 · 64 位",
    summary: "桌面客户端整合校园网自动连接、学习通助手与药大拾间桌面常驻能力。",
    features: ["校园网自动连接", "药大拾间 · 学习通助手", "桌面常驻与静默更新"],
    steps: [
      "下载 Windows 安装程序。",
      "更新旧版时先从托盘完全退出药大拾间，再运行安装程序。",
      "安装完成后可按需开启开机自启动与校园网自动连接。",
    ],
    actionLabel: "下载 Windows 客户端",
    actionHint: "64 位安装程序",
    versionLabel: desktopVersionLabel(windowsDownload.value),
    loading: desktopDownloadsLoading.value,
    downloadUrl: windowsDownload.value.available ? windowsDownload.value.url : undefined,
  },
  {
    key: "macos",
    group: "desktop",
    tone: "#64748b",
    name: "macOS",
    support: "Apple Silicon · M1 及后续 M 系列",
    summary: "面向 M 芯片 Mac 的原生桌面包，功能与 Windows 桌面端保持同一条更新路线。",
    features: ["校园网自动连接", "药大拾间 · 学习通助手", "Apple Silicon 原生构建"],
    steps: [
      "确认 Mac 使用 M1、M2、M3、M4 或后续 M 系列芯片；当前不支持 Intel Mac。",
      "下载并打开 DMG 安装包。",
      "按 macOS 提示完成安装；首次启动时允许系统完成安全检查。",
    ],
    actionLabel: "下载 macOS 客户端",
    actionHint: "M 芯片 DMG",
    versionLabel: desktopVersionLabel(macDownload.value),
    loading: desktopDownloadsLoading.value,
    downloadUrl: macDownload.value.available ? macDownload.value.url : undefined,
  },
]);

const recommendedCard = computed(() => (
  platformCards.value.find((card) => card.key === detectedPlatform.value)
));

type DownloadGuidePlatform = "android" | "windows";

const downloadGuideVisible = ref(false);
const downloadGuidePlatform = ref<DownloadGuidePlatform>("windows");

function openDownloadGuide(platform: DownloadPlatform, event: MouseEvent) {
  if (platform === "android" && isAndroidNativeApp()) {
    event.preventDefault();
    requestAndroidUpdatePrompt({ kind: "install" });
    return;
  }
  if (platform !== "android" && platform !== "windows") return;
  downloadGuidePlatform.value = platform;
  downloadGuideVisible.value = true;
}

onMounted(async () => {
  checkRequestedUpdate();
  try {
    const [windows, macos] = await Promise.all([
      getDesktopDownload(),
      getMacDesktopDownload(),
    ]);
    windowsDownload.value = windows;
    macDownload.value = macos;
  } finally {
    desktopDownloadsLoading.value = false;
  }
});
</script>

<style scoped>
.download-page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding-bottom: 20px;
  color: var(--cpu-text);
}

.download-note {
  max-width: 760px;
  margin: 22px auto 0;
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
}
</style>
