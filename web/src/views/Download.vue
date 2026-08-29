<template>
  <div class="download-page">
    <section class="download-hero">
      <div class="hero-copy">
        <span class="hero-eyebrow">药大拾间客户端</span>
        <h1>一个页面，装好药大拾间</h1>
        <p>
          安卓/鸿蒙卓易通、iOS、Windows 和 macOS 的入口都集中在这里。
          页面会优先推荐当前设备适合的版本，已有安装提示与更新弹窗仍会照常工作。
        </p>
        <div class="hero-actions">
          <a
            v-if="recommendedCard?.downloadUrl"
            class="primary-action"
            :href="recommendedCard.downloadUrl"
            target="_blank"
            rel="noopener noreferrer"
            @click="openDownloadGuide(recommendedCard.key)"
          >
            下载{{ recommendedCard.name }}
            <AppIcon name="arrow-down" />
          </a>
          <router-link
            v-else-if="recommendedCard?.route"
            class="primary-action"
            :to="recommendedCard.route"
          >
            {{ recommendedCard.actionLabel }}
            <AppIcon name="arrow-right" />
          </router-link>
          <a v-else class="primary-action secondary" href="#platforms">
            选择你的设备
            <AppIcon name="arrow-down" />
          </a>
          <span class="device-result">
            <span class="device-dot" aria-hidden="true"></span>
            {{ detectedLabel }}
          </span>
        </div>
      </div>

      <div class="hero-mark" aria-hidden="true">
        <div class="hero-logo">药</div>
        <div>
          <strong>药大拾间</strong>
          <span>一个入口，连接校园生活</span>
        </div>
      </div>
    </section>

    <section id="platforms" class="platform-section" aria-labelledby="platform-title">
      <header class="section-head">
        <div>
          <span>安卓/鸿蒙卓易通 · iOS · Windows · macOS</span>
          <h2 id="platform-title">选择你的设备</h2>
        </div>
        <p>版本信息来自现有发布源，不在页面里写死桌面端下载地址。</p>
      </header>

      <div class="platform-grid">
        <article
          v-for="card in platformCards"
          :key="card.key"
          class="platform-card"
          :class="{ recommended: card.key === detectedPlatform }"
        >
          <header class="platform-card-head">
            <span class="platform-symbol" :class="`platform-symbol--${card.key}`">
              {{ card.symbol }}
            </span>
            <span class="platform-title">
              <span class="platform-name-row">
                <strong>{{ card.name }}</strong>
                <em v-if="card.key === detectedPlatform">当前设备</em>
              </span>
              <small>{{ card.support }}</small>
            </span>
            <span class="version-badge" :class="{ loading: card.loading }">
              {{ card.versionLabel }}
            </span>
          </header>

          <p class="platform-summary">{{ card.summary }}</p>

          <ul class="feature-list">
            <li v-for="feature in card.features" :key="feature">
              <AppIcon name="success" />
              {{ feature }}
            </li>
          </ul>

          <div class="platform-action-row">
            <a
              v-if="card.downloadUrl"
              class="platform-action"
              :href="card.downloadUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click="openDownloadGuide(card.key)"
            >
              {{ card.actionLabel }}
              <AppIcon name="arrow-down" />
            </a>
            <router-link
              v-else-if="card.route"
              class="platform-action"
              :to="card.route"
            >
              {{ card.actionLabel }}
              <AppIcon name="arrow-right" />
            </router-link>
            <button v-else type="button" class="platform-action unavailable" disabled>
              {{ card.loading ? "正在获取下载信息" : "安装包暂时不可用" }}
            </button>
            <span>{{ card.actionHint }}</span>
          </div>

          <details class="install-steps">
            <summary>{{ card.key === "ios" ? "点击查看教程" : "查看安装步骤" }}</summary>
            <ol>
              <li v-for="step in card.steps" :key="step">{{ step }}</li>
            </ol>
          </details>
        </article>
      </div>
    </section>

    <section class="web-entry">
      <div>
        <span class="web-entry-kicker">不在自己的设备上？</span>
        <h2>也可以直接使用网页版</h2>
        <p>
          网页版适合临时访问；Windows、M 芯片 Mac 和安卓/鸿蒙卓易通
          仍优先推荐对应客户端，iPhone / iPad 可将课表添加到主屏幕。
        </p>
      </div>
      <div class="web-entry-actions">
        <router-link to="/home">进入药大拾间</router-link>
        <router-link class="soft" to="/schedule">打开课表</router-link>
      </div>
    </section>

    <p class="download-note">
      药大拾间是学生自主开发维护的校园互助平台，并非学校官方应用，仅供学习研究与校园公益使用，严禁未经授权的商业用途。
      安装包请只从本页或项目官方发布页获取。
    </p>

    <DownloadSafetyGuideDialog
      v-model="downloadGuideVisible"
      :platform="downloadGuidePlatform"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  getDesktopDownload,
  getMacDesktopDownload,
  type DesktopDownloadInfo,
} from "@/api/site";
import {
  ANDROID_APP_DOWNLOAD_URL,
  ANDROID_APP_LATEST_VERSION_NAME,
  isLikelyAndroidDevice,
  isLikelyIosDevice,
} from "@/utils/clientInfo";
import DownloadSafetyGuideDialog from "@/components/common/DownloadSafetyGuideDialog.vue";
import AppIcon from "@/components/common/AppIcon.vue";

type DownloadPlatform = "android" | "ios" | "windows" | "macos";

type PlatformCard = {
  key: DownloadPlatform;
  symbol: string;
  name: string;
  support: string;
  summary: string;
  features: string[];
  steps: string[];
  actionLabel: string;
  actionHint: string;
  versionLabel: string;
  loading: boolean;
  downloadUrl?: string;
  route?: string;
};

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
  if (isLikelyIosDevice()) return "ios";
  if (isLikelyAndroidDevice()) return "android";
  const source = navigator.userAgent.toLowerCase();
  if (source.includes("windows")) return "windows";
  if (source.includes("mac")) return "macos";
  return null;
});

const detectedLabel = computed(() => {
  const labels: Record<DownloadPlatform, string> = {
    android: "已识别为安卓/鸿蒙设备",
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

const platformCards = computed<PlatformCard[]>(() => [
  {
    key: "android",
    symbol: "A",
    name: "安卓/鸿蒙卓易通",
    support: "安卓与鸿蒙手机、平板",
    summary: "卓易通原生客户端承载完整站点，并提供更适合手机的下载、通知和课表能力。",
    features: ["课表与桌面小组件", "站内通知与文件下载", "跟随网站持续更新"],
    steps: [
      "点击下载 APK，并等待浏览器完成下载。",
      "打开安装包；若系统询问，请允许当前浏览器安装未知来源应用。",
      "安装完成后从桌面打开药大拾间。",
    ],
    actionLabel: "下载安卓/鸿蒙卓易通",
    actionHint: "APK 安装包",
    versionLabel: `v${ANDROID_APP_LATEST_VERSION_NAME}`,
    loading: false,
    downloadUrl: ANDROID_APP_DOWNLOAD_URL,
  },
  {
    key: "ios",
    symbol: "iOS",
    name: "iPhone / iPad",
    support: "iOS 与 iPadOS · Safari",
    summary: "使用 Web App 方式，无需描述文件或 IPA；进入课表后，页面顶部的下载按钮会打开完整安装教程。",
    features: ["顶部下载按钮内置完整教程", "Safari 添加到主屏幕", "支持 iOS 课表小组件"],
    steps: [
      "必须使用 Safari 打开本页，再点击“打开课表并安装”；微信、QQ 等内置浏览器不支持添加到主屏幕。",
      "进入课表后，在页面顶部操作栏找到向下箭头形状的下载按钮，点击即可打开安装教程。",
      "根据 Safari 版本，点击底部的“…”后再点共享按钮，或直接点击分享按钮，然后选择“查看更多”→“添加到主屏幕”。",
      "确认名称并点击“添加”，之后即可从桌面图标进入药大拾间课表。",
    ],
    actionLabel: "打开课表并安装",
    actionHint: "进入后点击页面顶部的下载按钮",
    versionLabel: "Web App",
    loading: false,
    route: "/schedule",
  },
  {
    key: "windows",
    symbol: "Win",
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
    symbol: "Mac",
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

function openDownloadGuide(platform: DownloadPlatform) {
  if (platform !== "android" && platform !== "windows") return;
  downloadGuidePlatform.value = platform;
  downloadGuideVisible.value = true;
}

onMounted(async () => {
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
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: 20px 0 36px;
  color: var(--cpu-text);
}

.download-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  gap: 32px;
  overflow: hidden;
  padding: 36px 40px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 26%, var(--cpu-border-soft));
  border-radius: 24px;
  background:
    radial-gradient(circle at 92% 8%, color-mix(in srgb, var(--cpu-primary-light) 25%, transparent) 0, transparent 34%),
    linear-gradient(140deg, color-mix(in srgb, var(--cpu-primary) 12%, var(--cpu-surface)) 0%, var(--cpu-surface) 64%);
  box-shadow: var(--cpu-shadow-md);
}

.hero-copy {
  position: relative;
  z-index: 1;
}

.hero-eyebrow,
.section-head span,
.web-entry-kicker {
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.hero-copy h1 {
  max-width: 680px;
  margin: 10px 0 12px;
  font-size: clamp(32px, 3.6vw, 46px);
  line-height: 1.1;
  letter-spacing: -0.035em;
}

.hero-copy > p {
  max-width: 700px;
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 22px;
}

.primary-action,
.platform-action,
.web-entry-actions a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 42px;
  padding: 0 18px;
  border: 1px solid var(--cpu-primary);
  border-radius: 12px;
  background: var(--cpu-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
}

.primary-action:hover,
.platform-action:hover,
.web-entry-actions a:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--cpu-primary-dark) 22%, transparent);
}

.primary-action.secondary {
  border-color: var(--cpu-border);
  background: var(--cpu-surface);
  color: var(--cpu-text);
}

.device-result {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.device-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cpu-primary);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--cpu-primary) 12%, transparent);
}

.hero-mark {
  position: relative;
  z-index: 1;
  align-self: center;
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 20%, var(--cpu-border-soft));
  border-radius: 18px;
  background: color-mix(in srgb, var(--cpu-surface) 82%, transparent);
  backdrop-filter: blur(16px);
}

.hero-logo {
  display: grid;
  flex: 0 0 auto;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 17px;
  background: linear-gradient(145deg, var(--cpu-primary), var(--cpu-primary-dark));
  color: #ffd46b;
  font-size: 29px;
  font-weight: 900;
  box-shadow: 0 14px 30px color-mix(in srgb, var(--cpu-primary-dark) 24%, transparent);
}

.hero-mark > div:last-child {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.hero-mark strong {
  font-size: 19px;
}

.hero-mark span {
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.platform-section {
  padding: 40px 0 0;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 18px;
}

.section-head h2,
.web-entry h2 {
  margin: 6px 0 0;
  font-size: clamp(24px, 2.6vw, 31px);
  line-height: 1.25;
  letter-spacing: -0.025em;
}

.section-head > p {
  max-width: 420px;
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
  text-align: right;
}

.platform-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

.platform-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 20px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 18px;
  background: var(--cpu-surface);
  box-shadow: var(--cpu-shadow-sm);
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.platform-card::before {
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, var(--cpu-primary), color-mix(in srgb, var(--cpu-primary-light) 60%, transparent));
  content: "";
  opacity: 0.38;
}

.platform-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--cpu-primary) 35%, var(--cpu-border));
  box-shadow: var(--cpu-shadow-md);
}

.platform-card.recommended {
  border-color: color-mix(in srgb, var(--cpu-primary) 62%, var(--cpu-border));
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--cpu-primary) 9%, transparent),
    var(--cpu-shadow-md);
}

.platform-card-head {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
}

.platform-symbol {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--cpu-primary) 11%, var(--cpu-surface-soft));
  color: var(--cpu-primary);
  font-size: 16px;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.platform-symbol--android {
  background: color-mix(in srgb, #3ddc84 16%, var(--cpu-surface-soft));
  color: color-mix(in srgb, #22a760 78%, var(--cpu-text));
}

.platform-symbol--ios,
.platform-symbol--macos {
  background: color-mix(in srgb, var(--cpu-text) 8%, var(--cpu-surface-soft));
  color: var(--cpu-text);
}

.platform-symbol--windows {
  background: color-mix(in srgb, #168be5 14%, var(--cpu-surface-soft));
  color: color-mix(in srgb, #168be5 82%, var(--cpu-text));
}

.platform-title {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.platform-name-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.platform-name-row strong {
  font-size: 17px;
}

.platform-name-row em {
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cpu-primary) 12%, transparent);
  color: var(--cpu-primary);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
}

.platform-title small {
  overflow: hidden;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-badge {
  grid-column: 2;
  justify-self: start;
  padding: 5px 9px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.version-badge.loading {
  color: var(--cpu-text-muted);
}

.platform-summary {
  min-height: 76px;
  margin: 17px 0 14px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.feature-list {
  display: grid;
  gap: 8px;
  margin: 0 0 18px;
  padding: 0;
  list-style: none;
}

.feature-list li {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--cpu-text);
  font-size: 13px;
}

.feature-list span {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--cpu-primary) 11%, transparent);
  color: var(--cpu-primary);
  font-size: 11px;
  font-weight: 900;
}

.platform-action-row {
  display: grid;
  gap: 8px;
  margin-top: auto;
}

.platform-action {
  width: 100%;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 12px;
  font-size: 13px;
}

.platform-action.unavailable {
  cursor: not-allowed;
  border-color: var(--cpu-border);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-muted);
  box-shadow: none;
}

.platform-action-row > span {
  color: var(--cpu-text-muted);
  font-size: 11px;
  text-align: center;
}

.install-steps {
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--cpu-border-soft);
}

.install-steps summary {
  cursor: pointer;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.install-steps ol {
  display: grid;
  gap: 8px;
  margin: 13px 0 0;
  padding-left: 20px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.web-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 16px;
  padding: 22px 26px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
  border-radius: 18px;
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-surface));
}

.web-entry h2 {
  font-size: 23px;
}

.web-entry p {
  max-width: 720px;
  margin: 8px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.web-entry-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}

.web-entry-actions a {
  min-height: 42px;
  padding: 0 16px;
  border-radius: 12px;
  font-size: 13px;
}

.web-entry-actions a.soft {
  border-color: var(--cpu-border);
  background: var(--cpu-surface);
  color: var(--cpu-text);
}

.download-note {
  margin: 20px 0 0;
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
}

.download-guide-content {
  display: grid;
  gap: 16px;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}

.download-guide-intro,
.download-guide-note {
  margin: 0;
}

.download-guide-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 22px;
}

.download-guide-list li::marker {
  color: var(--cpu-primary);
  font-weight: 800;
}

.download-guide-note {
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-surface));
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.65;
}

.download-guide-note code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary-dark);
  font-family: var(--cpu-font-mono);
  font-size: 0.95em;
}

@media (max-width: 900px) {
  .download-page {
    padding-top: 18px;
  }

  .download-hero {
    grid-template-columns: 1fr;
    gap: 26px;
    padding: 40px;
  }

  .hero-mark {
    max-width: 440px;
  }
}

@media (max-width: 1100px) {
  .platform-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .platform-summary {
    min-height: 52px;
  }
}

@media (max-width: 720px) {
  .download-page {
    padding: 10px 0 32px;
  }

  .download-hero {
    gap: 22px;
    padding: 28px 22px;
    border-radius: 22px;
  }

  .hero-copy h1 {
    font-size: 32px;
  }

  .hero-copy > p {
    font-size: 14px;
  }

  .hero-actions {
    align-items: stretch;
  }

  .primary-action {
    width: 100%;
  }

  .device-result {
    justify-content: center;
    width: 100%;
  }

  .hero-mark {
    padding: 16px;
  }

  .hero-logo {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    font-size: 28px;
  }

  .platform-section {
    padding-top: 38px;
  }

  .section-head {
    display: grid;
    gap: 10px;
  }

  .section-head > p {
    text-align: left;
  }

  .platform-grid {
    grid-template-columns: 1fr;
  }

  .platform-card {
    padding: 20px;
    border-radius: 18px;
  }

  .platform-summary {
    min-height: 0;
  }

  .web-entry {
    display: grid;
    padding: 22px;
  }

  .web-entry-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .download-guide-content {
    font-size: 13px;
  }
}

@media (max-width: 420px) {
  .platform-card-head {
    grid-template-columns: 46px minmax(0, 1fr);
  }

  .platform-symbol {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    font-size: 14px;
  }

  .version-badge {
    grid-column: 2;
    justify-self: start;
  }

  .platform-action-row {
    display: grid;
  }

  .platform-action {
    width: 100%;
  }

  .platform-action-row > span {
    text-align: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .primary-action,
  .platform-action,
  .web-entry-actions a,
  .platform-card {
    transition: none;
  }
}
</style>
