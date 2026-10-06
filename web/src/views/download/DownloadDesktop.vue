<template>
  <div class="dl-d">
    <header class="dl-d-head">
      <div>
        <h1>下载药大拾间</h1>
        <p>课表、通知和校园服务，在手机和电脑上都有对应的客户端。</p>
      </div>
      <span class="dl-d-detected"><i class="dl-dot" :class="{ 'is-unknown': !recommended }" aria-hidden="true" />{{ detectedLabel }}</span>
    </header>

    <section class="dl-d-hero" :class="{ 'dl-d-hero--solo': !qrVisible, 'dl-d-hero--empty': !recommended }">
      <article v-if="recommended" class="dl-d-featured" :style="{ '--tone': recommended.tone }">
        <div class="dl-d-featured-main">
          <div class="dl-d-featured-id">
            <span class="dl-tile dl-tile--lg" aria-hidden="true"><AppIcon :name="platformIconName(recommended)" /></span>
            <div>
              <small>推荐给这台设备</small>
              <h2>{{ recommended.name }}<span class="dl-version" :class="{ 'is-loading': recommended.loading }">{{ recommended.versionLabel }}</span></h2>
              <p>{{ recommended.support }}</p>
            </div>
          </div>
          <p class="dl-d-featured-summary">{{ recommended.summary }}</p>
          <ul class="dl-checks">
            <li v-for="feature in recommended.features" :key="feature"><AppIcon name="check" />{{ feature }}</li>
          </ul>
          <div class="dl-d-featured-cta">
            <DownloadAction :card="recommended" variant="primary" @download="forwardDownload" />
            <span>{{ recommended.actionHint }}</span>
          </div>
        </div>
        <div class="dl-d-featured-steps">
          <h3>安装步骤</h3>
          <ol class="dl-steps">
            <li v-for="step in recommended.steps" :key="step">{{ step }}</li>
          </ol>
        </div>
      </article>
      <article v-else class="dl-d-featured dl-d-featured--empty">
        <span class="dl-tile dl-tile--lg" aria-hidden="true"><AppIcon name="download" /></span>
        <div>
          <h2>没有识别出这台设备</h2>
          <p>在下面的列表里选择对应平台{{ qrVisible ? "，或者用手机扫码打开本页" : "" }}。</p>
        </div>
      </article>

      <aside v-if="qrVisible" class="dl-d-qr">
        <img :src="qrImage" alt="药大拾间下载页二维码" width="148" height="148" />
        <div>
          <h2>手机扫码下载</h2>
          <p>用手机相机或浏览器扫一扫，页面会按手机系统推荐 Android、鸿蒙或 iPhone 版本。</p>
        </div>
      </aside>
    </section>

    <section class="dl-d-all" aria-labelledby="dl-d-all-title">
      <header class="dl-d-section-head">
        <h2 id="dl-d-all-title">全部平台</h2>
        <p>桌面端版本信息实时读取发布源</p>
      </header>

      <div v-for="group in groups" :key="group.key" class="dl-d-group">
        <h3>{{ group.label }}</h3>
        <ul class="dl-d-list">
          <li v-for="card in group.cards" :key="card.key" :class="{ 'is-open': openKey === card.key }">
            <div class="dl-d-row">
              <span class="dl-tile" :style="{ '--tone': card.tone }" aria-hidden="true"><AppIcon :name="platformIconName(card)" /></span>
              <div class="dl-d-row-id">
                <b>{{ card.name }}<em v-if="card.key === recommended?.key">当前设备</em></b>
                <small>{{ card.support }}</small>
              </div>
              <p class="dl-d-row-summary">{{ card.summary }}</p>
              <span class="dl-version" :class="{ 'is-loading': card.loading }">{{ card.versionLabel }}</span>
              <DownloadAction :card="card" @download="forwardDownload" />
              <button
                data-cpu-button="surface"
                type="button"
                class="dl-d-row-toggle"
                :aria-expanded="openKey === card.key"
                :aria-controls="`dl-d-detail-${card.key}`"
                @click="openKey = openKey === card.key ? null : card.key"
              >
                安装步骤<AppIcon name="arrow-down" />
              </button>
            </div>
            <div v-show="openKey === card.key" :id="`dl-d-detail-${card.key}`" class="dl-d-row-detail">
              <ul class="dl-checks">
                <li v-for="feature in card.features" :key="feature"><AppIcon name="check" />{{ feature }}</li>
              </ul>
              <ol class="dl-steps">
                <li v-for="step in card.steps" :key="step">{{ step }}</li>
              </ol>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <section class="dl-d-web">
      <span class="dl-tile" aria-hidden="true"><AppIcon name="link" /></span>
      <div>
        <h2>不安装也能用</h2>
        <p>公共设备上可以直接打开网页版，不留下安装记录；自己的设备仍推荐使用对应客户端。</p>
      </div>
      <div class="dl-d-web-actions">
        <router-link data-cpu-button="action" class="dl-action" to="/home">进入药大拾间</router-link>
        <router-link data-cpu-button="action" class="dl-action" to="/schedule">打开课表</router-link>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useSiteStore } from "@/stores/site";
import DownloadAction from "./DownloadAction.vue";
import { platformGroups, platformIconName, type DownloadPlatform, type PlatformCard } from "./types";

const props = defineProps<{
  cards: PlatformCard[];
  recommended?: PlatformCard;
  detectedLabel: string;
}>();
const emit = defineEmits<{ download: [platform: DownloadPlatform, event: MouseEvent] }>();

const site = useSiteStore();
const openKey = ref<DownloadPlatform | null>(null);
const qrImage = ref("");
const groups = computed(() => platformGroups.map((group) => ({
  ...group,
  cards: props.cards.filter((card) => card.group === group.key),
})));
// 已经在手机或平板上打开时，不需要再扫码转到手机。
const qrVisible = computed(() => Boolean(qrImage.value) && props.recommended?.group !== "mobile");

onMounted(async () => {
  const origin = [site.siteOrigin, window.location.origin].find((value) => /^https?:\/\//i.test(value || ""));
  if (!origin) return;
  try {
    const { default: QRCode } = await import("qrcode");
    qrImage.value = await QRCode.toDataURL(`${origin.replace(/\/+$/, "")}/download`, {
      width: 296,
      margin: 1,
      color: { dark: "#172033", light: "#ffffffff" },
    });
  } catch {
    qrImage.value = "";
  }
});

function forwardDownload(platform: DownloadPlatform, event: MouseEvent) {
  emit("download", platform, event);
}
</script>

<style scoped>
.dl-d { display: flex; flex-direction: column; gap: 22px; padding-top: 6px; }
.dl-d h1,
.dl-d h2,
.dl-d h3,
.dl-d p { margin: 0; }
.dl-d :is(a, button):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.dl-d-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 0 2px; }
.dl-d-head h1 { font-size: 30px; font-weight: 700; line-height: 1.25; letter-spacing: -.02em; }
.dl-d-head p { margin-top: 6px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-m); line-height: 1.6; }
.dl-d-detected {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}

.dl-d-hero { display: grid; grid-template-columns: minmax(0, 1fr) 236px; gap: 16px; }
/* 没有推荐平台时，提示卡和扫码卡并排成两张等宽的横向卡片。 */
.dl-d-hero--empty { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dl-d-hero--empty .dl-d-qr { flex-direction: row; justify-content: flex-start; text-align: left; }
.dl-d-hero--empty .dl-d-qr img { width: 112px; height: 112px; }
.dl-d-hero--solo { grid-template-columns: minmax(0, 1fr); }

.dl-d-featured,
.dl-d-qr,
.dl-d-list,
.dl-d-web {
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}

.dl-d-featured {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr);
  overflow: hidden;
  border-color: var(--cpu-border-soft);
}
.dl-d-featured-main { display: flex; min-width: 0; flex-direction: column; gap: 16px; padding: 26px 28px; }
.dl-d-featured-id { display: flex; min-width: 0; align-items: center; gap: 14px; }
.dl-d-featured-id > div { min-width: 0; }
.dl-d-featured-id small { color: var(--cpu-primary); font-size: var(--cpu-fs-xs); font-weight: 500; }
.dl-d-featured-id h2 { display: flex; align-items: center; gap: 10px; margin-top: 2px; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; }
.dl-d-featured-id p { margin-top: 2px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.dl-d-featured-summary { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-m); line-height: 1.75; }
.dl-d-featured-cta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-top: auto; padding-top: 4px; }
.dl-d-featured-cta .dl-action { min-height: 46px; padding-inline: 22px; font-size: var(--cpu-fs-m); }
.dl-d-featured-cta > span { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.dl-d-featured-steps {
  min-width: 0;
  padding: 26px 28px;
  border-left: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
}
.dl-d-featured-steps h3,
.dl-d-group h3 { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 500; }
.dl-d-featured-steps h3 { margin-bottom: 14px; }

.dl-d-featured--empty { display: flex; align-items: center; gap: 16px; padding: 28px; border-color: var(--cpu-border-soft); }
.dl-d-featured--empty h2 { font-size: var(--cpu-fs-xl); font-weight: 700; }
.dl-d-featured--empty p { margin-top: 5px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-m); line-height: 1.7; }

.dl-d-qr { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 22px 20px; text-align: center; }
.dl-d-qr img { display: block; width: 148px; height: 148px; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.dl-d-qr h2 { font-size: var(--cpu-fs-m); font-weight: 700; }
.dl-d-qr p { margin-top: 5px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.65; }

.dl-d-all { display: flex; flex-direction: column; gap: 14px; }
.dl-d-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 0 2px; }
.dl-d-section-head h2 { font-size: var(--cpu-fs-xl); font-weight: 700; }
.dl-d-section-head p { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.dl-d-group { display: flex; flex-direction: column; gap: 8px; }
.dl-d-group h3 { padding: 0 2px; }

.dl-d-list { margin: 0; padding: 0; overflow: hidden; list-style: none; }
.dl-d-list > li { border-bottom: 1px solid var(--cpu-border-soft); }
.dl-d-list > li:last-child { border-bottom: 0; }
.dl-d-row {
  display: grid;
  grid-template-columns: 42px minmax(150px, 230px) minmax(0, 1fr) 76px 216px auto;
  align-items: center;
  gap: 16px;
  min-height: 76px;
  padding: 14px 18px;
}
.dl-d-row-id { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.dl-d-row-id b { display: flex; align-items: center; gap: 8px; font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.35; }
.dl-d-row-id em {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  font-weight: 500;
}
.dl-d-row-id small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.45; }
.dl-d-row-summary {
  display: -webkit-box;
  overflow: hidden;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.dl-d-row .dl-version { justify-self: end; }
.dl-d-row .dl-action { width: 100%; }
.dl-d-row-toggle {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  white-space: nowrap;
  cursor: pointer;
}
.dl-d-row-toggle:hover { color: var(--cpu-primary); }
.dl-d-row-toggle .cpu-app-icon { font-size: var(--cpu-fs-s); transition: transform .16s ease; }
.is-open .dl-d-row-toggle .cpu-app-icon { transform: rotate(180deg); }
.dl-d-row-detail {
  display: grid;
  gap: 14px;
  padding: 2px 18px 20px 76px;
}

.dl-d-web { display: flex; align-items: center; gap: 16px; padding: 18px; }
.dl-d-web > div:nth-child(2) { min-width: 0; flex: 1; }
.dl-d-web h2 { font-size: var(--cpu-fs-l); font-weight: 700; }
.dl-d-web p { margin-top: 3px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; }
.dl-d-web-actions { display: flex; flex: 0 0 auto; gap: 8px; }

@media (max-width: 1040px) {
  .dl-d-row { grid-template-columns: 42px minmax(0, 1fr) 76px 216px auto; }
  .dl-d-row-summary { display: none; }
  .dl-d-featured { grid-template-columns: minmax(0, 1fr); }
  .dl-d-featured-steps { border-top: 1px solid var(--cpu-border-soft); border-left: 0; }
}
@media (max-width: 900px) {
  .dl-d-hero { grid-template-columns: minmax(0, 1fr); }
  .dl-d-qr { flex-direction: row; justify-content: flex-start; text-align: left; }
  .dl-d-qr img { width: 112px; height: 112px; }
  .dl-d-row { grid-template-columns: 42px minmax(0, 1fr) 208px auto; }
  .dl-d-row .dl-version { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dl-d-row-toggle .cpu-app-icon { transition: none; }
}
</style>
