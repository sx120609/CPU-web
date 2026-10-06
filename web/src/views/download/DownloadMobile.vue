<template>
  <div class="dl-m">
    <header class="dl-m-head">
      <h1>客户端下载</h1>
      <p><i class="dl-dot" :class="{ 'is-unknown': !recommended }" aria-hidden="true" />{{ detectedLabel }}</p>
    </header>

    <section v-if="recommended" class="dl-m-featured" :style="{ '--tone': recommended.tone }">
      <div class="dl-m-featured-id">
        <span class="dl-tile dl-tile--lg" aria-hidden="true"><AppIcon :name="platformIconName(recommended)" /></span>
        <div>
          <small>推荐给这台设备</small>
          <h2>{{ recommended.name }}</h2>
        </div>
        <span class="dl-version" :class="{ 'is-loading': recommended.loading }">{{ recommended.versionLabel }}</span>
      </div>
      <p class="dl-m-summary">{{ recommended.summary }}</p>
      <div class="dl-m-cta">
        <DownloadAction :card="recommended" variant="primary" @download="forwardDownload" />
        <small>{{ recommended.actionHint }}</small>
      </div>
      <details class="dl-m-steps" :open="stepsOpen">
        <summary>安装步骤<AppIcon name="arrow-down" /></summary>
        <ol class="dl-steps">
          <li v-for="step in recommended.steps" :key="step">{{ step }}</li>
        </ol>
      </details>
    </section>

    <section v-for="group in groups" :key="group.key" class="dl-m-group" :aria-labelledby="`dl-m-group-${group.key}`">
      <h2 :id="`dl-m-group-${group.key}`">{{ group.label }}</h2>
      <div class="dl-m-list">
        <details v-for="card in group.cards" :key="card.key" class="dl-m-item">
          <summary>
            <span class="dl-tile" :style="{ '--tone': card.tone }" aria-hidden="true"><AppIcon :name="platformIconName(card)" /></span>
            <span class="dl-m-item-id"><b>{{ card.name }}</b><small>{{ card.support }}</small></span>
            <span class="dl-version" :class="{ 'is-loading': card.loading }">{{ card.versionLabel }}</span>
            <AppIcon class="dl-m-chevron" name="arrow-down" />
          </summary>
          <div class="dl-m-detail">
            <p>{{ card.summary }}</p>
            <DownloadAction :card="card" @download="forwardDownload" />
            <ol class="dl-steps">
              <li v-for="step in card.steps" :key="step">{{ step }}</li>
            </ol>
          </div>
        </details>
      </div>
    </section>

    <router-link class="dl-m-web" to="/home">
      <span class="dl-tile" aria-hidden="true"><AppIcon name="link" /></span>
      <span class="dl-m-item-id"><b>不安装也能用</b><small>临时访问可直接打开网页版</small></span>
      <AppIcon class="dl-m-chevron" name="arrow-right" />
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import DownloadAction from "./DownloadAction.vue";
import { platformGroups, platformIconName, type DownloadPlatform, type PlatformCard } from "./types";

const props = defineProps<{
  cards: PlatformCard[];
  recommended?: PlatformCard;
  detectedLabel: string;
  stepsOpen?: boolean;
}>();
const emit = defineEmits<{ download: [platform: DownloadPlatform, event: MouseEvent] }>();

// 推荐的平台已经在上方单独展示，下面只列其余平台。
const groups = computed(() => platformGroups
  .map((group) => ({
    ...group,
    cards: props.cards.filter((card) => card.group === group.key && card.key !== props.recommended?.key),
  }))
  .filter((group) => group.cards.length));

function forwardDownload(platform: DownloadPlatform, event: MouseEvent) {
  emit("download", platform, event);
}
</script>

<style scoped>
.dl-m { display: flex; min-width: 0; max-width: 720px; margin: 0 auto; flex-direction: column; gap: 16px; }
.dl-m h1,
.dl-m h2,
.dl-m p { margin: 0; }
.dl-m a,
.dl-m summary { -webkit-tap-highlight-color: transparent; }
.dl-m :is(a, summary):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.dl-m-head { padding: 0 2px; }
.dl-m-head h1 { font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.dl-m-head p { display: flex; align-items: center; gap: 6px; margin-top: 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

.dl-m-featured,
.dl-m-list,
.dl-m-web {
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}

.dl-m-featured {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px 0;
  border-color: var(--cpu-border-soft);
}
.dl-m-featured-id { display: flex; min-width: 0; align-items: center; gap: 12px; }
.dl-m-featured-id > div { min-width: 0; flex: 1; }
.dl-m-featured-id small { color: var(--cpu-primary); font-size: var(--cpu-fs-xs); font-weight: 500; }
.dl-m-featured-id h2 { margin-top: 1px; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; }
.dl-m-summary { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }
.dl-m-cta { display: flex; flex-direction: column; gap: 7px; }
.dl-m-cta .dl-action { width: 100%; min-height: 48px; border-radius: 14px !important; font-size: var(--cpu-fs-m); }
.dl-m-cta small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-align: center; }

.dl-m-steps { border-top: 1px solid var(--cpu-border-soft); }
.dl-m-steps summary,
.dl-m-item summary { cursor: pointer; list-style: none; }
.dl-m-steps summary::-webkit-details-marker,
.dl-m-item summary::-webkit-details-marker { display: none; }
.dl-m-steps summary {
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  font-weight: 500;
}
.dl-m-steps summary .cpu-app-icon,
.dl-m-chevron { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-m); transition: transform .16s ease; }
.dl-m-steps[open] summary .cpu-app-icon,
.dl-m-item[open] > summary .dl-m-chevron { transform: rotate(180deg); }
.dl-m-steps .dl-steps { padding: 2px 0 16px; }

.dl-m-group { display: flex; flex-direction: column; gap: 8px; }
.dl-m-group h2 { padding: 0 2px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 500; }
.dl-m-list { overflow: hidden; }
.dl-m-item { border-bottom: 1px solid var(--cpu-border-soft); }
.dl-m-item:last-child { border-bottom: 0; }
.dl-m-item summary,
.dl-m-web { display: flex; min-height: 64px; align-items: center; gap: 11px; padding: 10px 12px; }
.dl-m-item summary:active,
.dl-m-web:active { background: var(--cpu-surface-soft); }
.dl-m-item-id { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.dl-m-item-id b { color: var(--cpu-text); font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.35; }
.dl-m-item-id small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.45; }
.dl-m-detail { display: flex; flex-direction: column; gap: 12px; padding: 2px 12px 16px; }
.dl-m-detail > p { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }
.dl-m-detail .dl-action { width: 100%; min-height: 44px; }

.dl-m-web { color: inherit; text-decoration: none; }

@media (max-width: 340px) {
  .dl-m-item .dl-version { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dl-m-steps summary .cpu-app-icon,
  .dl-m-chevron { transition: none; }
}
</style>
