<template>
  <div class="download-page">
    <div class="download-desktop">
      <section class="desktop-hero">
        <div class="desktop-hero-copy">
          <span class="page-kicker">药大拾间客户端</span>
          <h1>按你的设备，直接安装</h1>
          <p>保留真正需要的版本、入口和安装提示。系统会识别当前设备，其他平台也可以随时查看。</p>
          <div class="desktop-hero-meta">
            <span><AppIcon name="success" /> 官方发布源</span>
            <span><AppIcon name="sync" /> 跟随站点更新</span>
            <span><AppIcon name="shield" /> 安装前安全提示</span>
          </div>
        </div>

        <article v-if="recommendedCard" class="desktop-recommend-card">
          <header>
            <span class="platform-icon platform-icon--primary"><AppIcon :name="platformIconName(recommendedCard.key)" /></span>
            <div>
              <small>推荐给当前设备</small>
              <h2>{{ recommendedCard.name }}</h2>
            </div>
            <span class="version-pill">{{ recommendedCard.versionLabel }}</span>
          </header>
          <p>{{ recommendedCard.summary }}</p>
          <div class="recommend-action-row">
          <a
              v-if="recommendedCard.downloadUrl"
              class="download-action"
            :href="recommendedCard.downloadUrl"
            target="_blank"
            rel="noopener noreferrer"
            @click="openDownloadGuide(recommendedCard.key)"
          >
              {{ recommendedCard.actionLabel }}
              <AppIcon name="download" />
          </a>
          <router-link
              v-else-if="recommendedCard.route"
              class="download-action"
            :to="recommendedCard.route"
          >
            {{ recommendedCard.actionLabel }}
            <AppIcon name="arrow-right" />
          </router-link>
            <span class="detected-device">
              <span aria-hidden="true"></span>
            {{ detectedLabel }}
          </span>
        </div>
        </article>
        <a v-else class="desktop-recommend-card desktop-recommend-card--empty" href="#desktop-platforms">
          <span class="platform-icon platform-icon--primary"><AppIcon name="download" /></span>
          <span><small>暂未识别当前设备</small><b>手动选择客户端</b></span>
          <AppIcon name="arrow-down" />
        </a>
      </section>

      <section id="desktop-platforms" class="desktop-platform-section" aria-labelledby="desktop-platform-title">
        <header class="desktop-section-head">
          <div>
            <span class="page-kicker">全部平台</span>
            <h2 id="desktop-platform-title">选择客户端</h2>
          </div>
          <p>桌面端版本信息实时读取发布源，下载地址不写死在页面中。</p>
        </header>

        <div class="desktop-platform-grid">
        <article
          v-for="card in platformCards"
          :key="card.key"
            class="desktop-platform-card"
          :class="{ recommended: card.key === detectedPlatform }"
        >
            <header class="desktop-platform-card-head">
              <span class="platform-icon" :class="`platform-icon--${card.key}`"><AppIcon :name="platformIconName(card.key)" /></span>
              <span class="platform-heading">
                <span class="platform-name-line">
                <strong>{{ card.name }}</strong>
                  <em v-if="card.key === detectedPlatform">推荐</em>
              </span>
              <small>{{ card.support }}</small>
            </span>
              <span class="version-pill" :class="{ loading: card.loading }">
              {{ card.versionLabel }}
            </span>
          </header>

            <p class="desktop-platform-summary">{{ card.summary }}</p>
            <div class="feature-chips">
              <span v-for="feature in card.features" :key="feature">{{ feature }}</span>
            </div>

            <footer class="desktop-platform-footer">
            <a
              v-if="card.downloadUrl"
                class="card-action"
              :href="card.downloadUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click="openDownloadGuide(card.key)"
            >
              {{ card.actionLabel }}
                <AppIcon name="download" />
            </a>
            <router-link
              v-else-if="card.route"
                class="card-action"
              :to="card.route"
            >
              {{ card.actionLabel }}
              <AppIcon name="arrow-right" />
            </router-link>
              <button v-else type="button" class="card-action unavailable" disabled>
              {{ card.loading ? "正在获取下载信息" : "安装包暂时不可用" }}
            </button>
              <span>{{ card.actionHint }}</span>
            </footer>

            <details class="desktop-install-steps">
              <summary>{{ card.key === "ios" ? "查看添加教程" : "查看安装步骤" }}<AppIcon name="arrow-down" /></summary>
            <ol>
              <li v-for="step in card.steps" :key="step">{{ step }}</li>
            </ol>
          </details>
        </article>
      </div>
      </section>

      <section class="desktop-web-entry">
        <span class="platform-icon"><AppIcon name="link" /></span>
        <div>
          <span class="page-kicker">无需安装</span>
          <h2>临时使用，直接打开网页版</h2>
          <p>公共设备上无需留下安装记录；自己的设备仍推荐使用对应客户端。</p>
        </div>
        <div class="desktop-web-actions">
          <router-link to="/home">进入药大拾间</router-link>
          <router-link class="soft" to="/schedule">打开课表</router-link>
        </div>
      </section>
    </div>

    <div class="download-mobile">
      <header class="mobile-page-head">
        <span class="page-kicker">客户端下载</span>
        <h1>{{ recommendedCard ? "为这台设备准备好了" : "选择你的设备" }}</h1>
        <p>{{ detectedLabel }}</p>
      </header>

      <section v-if="recommendedCard" class="mobile-recommend-card">
        <header>
          <span class="platform-icon platform-icon--primary"><AppIcon :name="platformIconName(recommendedCard.key)" /></span>
          <div>
            <small>推荐</small>
            <h2>{{ recommendedCard.name }}</h2>
          </div>
          <span class="version-pill">{{ recommendedCard.versionLabel }}</span>
        </header>
        <p>{{ recommendedCard.summary }}</p>
        <a
          v-if="recommendedCard.downloadUrl"
          class="mobile-primary-action"
          :href="recommendedCard.downloadUrl"
          target="_blank"
          rel="noopener noreferrer"
          @click="openDownloadGuide(recommendedCard.key)"
        >
          {{ recommendedCard.actionLabel }}
          <AppIcon name="download" />
        </a>
        <router-link
          v-else-if="recommendedCard.route"
          class="mobile-primary-action"
          :to="recommendedCard.route"
        >
          {{ recommendedCard.actionLabel }}
          <AppIcon name="arrow-right" />
        </router-link>
        <details class="mobile-install-steps">
          <summary>{{ recommendedCard.key === "ios" ? "如何添加到主屏幕" : "安装时需要注意什么" }}<AppIcon name="arrow-down" /></summary>
          <ol><li v-for="step in recommendedCard.steps" :key="step">{{ step }}</li></ol>
        </details>
      </section>

      <section class="mobile-platform-section" aria-labelledby="mobile-platform-title">
        <header>
          <div><h2 id="mobile-platform-title">{{ recommendedCard ? "其他设备" : "全部平台" }}</h2><p>点开后查看版本与安装步骤</p></div>
        </header>
        <div class="mobile-platform-list">
          <details v-for="card in mobilePlatformCards" :key="card.key" class="mobile-platform-item">
            <summary>
              <span class="platform-icon" :class="`platform-icon--${card.key}`"><AppIcon :name="platformIconName(card.key)" /></span>
              <span class="mobile-platform-name"><b>{{ card.name }}</b><small>{{ card.support }}</small></span>
              <span class="mobile-version">{{ card.versionLabel }}</span>
              <AppIcon name="arrow-down" />
            </summary>
            <div class="mobile-platform-detail">
              <p>{{ card.summary }}</p>
              <a
                v-if="card.downloadUrl"
                class="mobile-secondary-action"
                :href="card.downloadUrl"
                target="_blank"
                rel="noopener noreferrer"
                @click="openDownloadGuide(card.key)"
              >{{ card.actionLabel }}<AppIcon name="download" /></a>
              <router-link v-else-if="card.route" class="mobile-secondary-action" :to="card.route">{{ card.actionLabel }}<AppIcon name="arrow-right" /></router-link>
              <button v-else type="button" class="mobile-secondary-action unavailable" disabled>{{ card.loading ? "正在获取下载信息" : "安装包暂时不可用" }}</button>
              <ol><li v-for="step in card.steps" :key="step">{{ step }}</li></ol>
            </div>
          </details>
        </div>
      </section>

      <section class="mobile-web-entry">
        <span class="platform-icon"><AppIcon name="link" /></span>
        <div><h2>不安装也能用</h2><p>临时访问可直接打开网页版。</p></div>
        <router-link to="/home">直接进入</router-link>
      </section>
    </div>

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

const mobilePlatformCards = computed(() => (
  recommendedCard.value
    ? platformCards.value.filter((card) => card.key !== recommendedCard.value?.key)
    : platformCards.value
));

function platformIconName(platform: DownloadPlatform) {
  return platform === "android" || platform === "ios" ? "mobile" : "desktop";
}

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
  width: min(1160px, 100%);
  margin: 0 auto;
  padding: 10px 0 34px;
  color: var(--cpu-text);
}

.download-mobile {
  display: none;
}

.page-kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.desktop-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr);
  align-items: stretch;
  gap: 20px;
  padding: 28px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 22px;
  background:
    radial-gradient(circle at 4% 0%, color-mix(in srgb, var(--cpu-primary) 8%, transparent), transparent 34%),
    var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}

.desktop-hero-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 12px 8px;
}

.desktop-hero-copy h1 {
  margin: 9px 0 11px;
  font-size: clamp(32px, 4vw, 48px);
  line-height: 1.08;
  letter-spacing: -0.045em;
}

.desktop-hero-copy > p {
  max-width: 620px;
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}

.desktop-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 18px;
  margin-top: 22px;
}

.desktop-hero-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.desktop-hero-meta :deep(.cpu-app-icon) {
  color: var(--cpu-primary);
  font-size: 15px;
}

.desktop-recommend-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 22px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft));
  border-radius: 18px;
  background: color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-surface));
}

.desktop-recommend-card header,
.mobile-recommend-card header {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.desktop-recommend-card header div,
.mobile-recommend-card header div {
  min-width: 0;
}

.desktop-recommend-card small,
.mobile-recommend-card small {
  color: var(--cpu-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.desktop-recommend-card h2,
.mobile-recommend-card h2 {
  margin: 3px 0 0;
  font-size: 20px;
  line-height: 1.25;
}

.desktop-recommend-card > p {
  margin: 18px 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.desktop-recommend-card--empty {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}

.desktop-recommend-card--empty > span:nth-child(2) {
  display: grid;
  gap: 3px;
}

.desktop-recommend-card--empty b {
  font-size: 17px;
}

.platform-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}

.platform-icon :deep(.cpu-app-icon) {
  font-size: 21px;
}

.platform-icon--primary {
  background: var(--cpu-primary);
  color: #fff;
}

.platform-icon--android {
  background: color-mix(in srgb, #35b86d 12%, var(--cpu-surface-soft));
  color: #229254;
}

.platform-icon--ios,
.platform-icon--macos {
  background: color-mix(in srgb, var(--cpu-text) 7%, var(--cpu-surface-soft));
  color: var(--cpu-text);
}

.platform-icon--windows {
  background: color-mix(in srgb, #168be5 11%, var(--cpu-surface-soft));
  color: #1677bd;
}

.version-pill,
.mobile-version {
  white-space: nowrap;
  color: var(--cpu-text-muted);
  font-size: 11px;
  font-weight: 750;
}

.version-pill {
  padding: 5px 8px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  background: var(--cpu-card);
}

.version-pill.loading {
  opacity: 0.7;
}

.recommend-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.download-action,
.card-action,
.desktop-web-actions a,
.mobile-primary-action,
.mobile-secondary-action {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--cpu-primary);
  border-radius: 11px;
  background: var(--cpu-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}

.download-action {
  padding: 0 17px;
}

.download-action:hover,
.card-action:hover,
.desktop-web-actions a:hover,
.mobile-primary-action:hover,
.mobile-secondary-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--cpu-primary) 18%, transparent);
}

.detected-device {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--cpu-text-muted);
  font-size: 11px;
}

.detected-device > span {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--cpu-primary);
}

.desktop-platform-section {
  padding-top: 34px;
}

.desktop-section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
  padding: 0 2px;
}

.desktop-section-head h2 {
  margin: 5px 0 0;
  font-size: 27px;
  letter-spacing: -0.03em;
}

.desktop-section-head > p {
  max-width: 420px;
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.7;
  text-align: right;
}

.desktop-platform-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.desktop-platform-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 20px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
  transition: border-color 0.16s ease, transform 0.16s ease;
}

.desktop-platform-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft));
}

.desktop-platform-card.recommended {
  border-color: color-mix(in srgb, var(--cpu-primary) 42%, var(--cpu-border-soft));
}

.desktop-platform-card-head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
}

.platform-heading {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.platform-name-line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.platform-name-line strong {
  overflow: hidden;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-name-line em {
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cpu-primary) 10%, transparent);
  color: var(--cpu-primary);
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
}

.platform-heading small {
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desktop-platform-summary {
  min-height: 46px;
  margin: 16px 0 12px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.feature-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.feature-chips span {
  padding: 5px 8px;
  border-radius: 8px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: 10px;
}

.desktop-platform-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-top: auto;
}

.card-action {
  min-height: 40px;
  padding: 0 14px;
}

.card-action.unavailable,
.mobile-secondary-action.unavailable {
  cursor: not-allowed;
  border-color: var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-muted);
  box-shadow: none;
}

.desktop-platform-footer > span {
  color: var(--cpu-text-muted);
  font-size: 10px;
  text-align: right;
}

.desktop-install-steps {
  margin-top: 13px;
  padding-top: 12px;
  border-top: 1px solid var(--cpu-border-soft);
}

.desktop-install-steps summary,
.mobile-install-steps summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  color: var(--cpu-text-muted);
  font-size: 11px;
  font-weight: 700;
  list-style: none;
}

.desktop-install-steps summary::-webkit-details-marker,
.mobile-install-steps summary::-webkit-details-marker,
.mobile-platform-item > summary::-webkit-details-marker {
  display: none;
}

.desktop-install-steps summary :deep(.cpu-app-icon),
.mobile-install-steps summary :deep(.cpu-app-icon),
.mobile-platform-item > summary > :deep(.cpu-app-icon) {
  transition: transform 0.16s ease;
}

.desktop-install-steps[open] summary :deep(.cpu-app-icon),
.mobile-install-steps[open] summary :deep(.cpu-app-icon),
.mobile-platform-item[open] > summary > :deep(.cpu-app-icon) {
  transform: rotate(180deg);
}

.desktop-install-steps ol,
.mobile-install-steps ol,
.mobile-platform-detail ol {
  display: grid;
  gap: 7px;
  margin: 11px 0 0;
  padding-left: 19px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
  line-height: 1.65;
}

.desktop-web-entry {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 15px;
  margin-top: 12px;
  padding: 18px 20px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  background: var(--cpu-card);
}

.desktop-web-entry h2 {
  margin: 3px 0 0;
  font-size: 18px;
}

.desktop-web-entry p {
  margin: 4px 0 0;
  color: var(--cpu-text-muted);
  font-size: 11px;
}

.desktop-web-actions {
  display: flex;
  gap: 8px;
}

.desktop-web-actions a {
  min-height: 38px;
  padding: 0 14px;
  font-size: 12px;
}

.desktop-web-actions a.soft {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}

.download-note {
  max-width: 880px;
  margin: 18px auto 0;
  color: var(--cpu-text-muted);
  font-size: 10px;
  line-height: 1.7;
  text-align: center;
}

@media (max-width: 920px) {
  .desktop-hero {
    grid-template-columns: 1fr;
  }

  .desktop-recommend-card {
    min-height: 0;
  }

  .desktop-platform-footer {
    grid-template-columns: 1fr;
  }

  .desktop-platform-footer > span {
    text-align: center;
  }
}

@media (max-width: 760px) {
  .download-page {
    padding: 0 0 22px;
  }

  .download-desktop {
    display: none;
  }

  .download-mobile {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mobile-page-head {
    padding: 7px 2px 5px;
  }

  .mobile-page-head h1 {
    margin: 5px 0 4px;
    font-size: 24px;
    line-height: 1.18;
    letter-spacing: -0.035em;
  }

  .mobile-page-head p {
    margin: 0;
    color: var(--cpu-text-muted);
    font-size: 11px;
  }

  .mobile-recommend-card {
    padding: 15px;
    border: 1px solid color-mix(in srgb, var(--cpu-primary) 34%, var(--cpu-border-soft));
    border-radius: 15px;
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--cpu-primary) 8%, var(--cpu-card)), var(--cpu-card));
    box-shadow: var(--cpu-shadow-sm);
  }

  .mobile-recommend-card header {
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 10px;
  }

  .mobile-recommend-card h2 {
    overflow: hidden;
    font-size: 17px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-recommend-card > p {
    margin: 13px 0;
    color: var(--cpu-text-secondary);
    font-size: 12px;
    line-height: 1.65;
  }

  .mobile-primary-action {
    width: 100%;
    min-height: 44px;
  }

  .mobile-install-steps {
    margin-top: 12px;
    padding-top: 11px;
    border-top: 1px solid var(--cpu-border-soft);
  }

  .mobile-platform-section {
    padding: 13px 12px 5px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 14px;
    background: var(--cpu-card);
  }

  .mobile-platform-section > header {
    padding: 0 2px 9px;
  }

  .mobile-platform-section h2 {
    margin: 0;
    font-size: 15px;
  }

  .mobile-platform-section header p {
    margin: 3px 0 0;
    color: var(--cpu-text-muted);
    font-size: 10px;
  }

  .mobile-platform-list {
    display: grid;
  }

  .mobile-platform-item {
    border-top: 1px solid var(--cpu-border-soft);
  }

  .mobile-platform-item > summary {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto 16px;
    align-items: center;
    gap: 9px;
    min-height: 62px;
    cursor: pointer;
    list-style: none;
  }

  .mobile-platform-item .platform-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
  }

  .mobile-platform-item .platform-icon :deep(.cpu-app-icon) {
    font-size: 19px;
  }

  .mobile-platform-name {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .mobile-platform-name b,
  .mobile-platform-name small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-platform-name b {
    font-size: 13px;
  }

  .mobile-platform-name small {
    color: var(--cpu-text-muted);
    font-size: 9px;
  }

  .mobile-version {
    font-size: 9px;
  }

  .mobile-platform-detail {
    padding: 0 0 13px 47px;
  }

  .mobile-platform-detail > p {
    margin: 0 0 10px;
    color: var(--cpu-text-secondary);
    font-size: 11px;
    line-height: 1.6;
  }

  .mobile-secondary-action {
    width: 100%;
    min-height: 40px;
    font-size: 11px;
  }

  .mobile-platform-detail ol {
    margin-top: 10px;
    font-size: 10px;
  }

  .mobile-web-entry {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 13px;
    background: var(--cpu-card);
  }

  .mobile-web-entry .platform-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
  }

  .mobile-web-entry h2 {
    margin: 0;
    font-size: 13px;
  }

  .mobile-web-entry p {
    margin: 3px 0 0;
    color: var(--cpu-text-muted);
    font-size: 9px;
  }

  .mobile-web-entry > a {
    padding: 7px 9px;
    border-radius: 9px;
    background: var(--cpu-surface-soft);
    color: var(--cpu-primary);
    font-size: 10px;
    font-weight: 800;
    text-decoration: none;
  }

  .download-note {
    margin-top: 12px;
    padding: 0 6px;
    font-size: 9px;
    text-align: left;
  }
}

@media (max-width: 420px) {
  .mobile-page-head h1 {
    font-size: 22px;
  }

  .mobile-recommend-card {
    padding: 14px;
  }

  .version-pill {
    padding: 4px 6px;
    font-size: 9px;
  }

  .mobile-platform-detail {
    padding-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .download-action,
  .card-action,
  .desktop-web-actions a,
  .mobile-primary-action,
  .mobile-secondary-action,
  .desktop-platform-card {
    transition: none;
  }
}
</style>
