<template>
  <article v-if="ad" ref="cardRef" class="forum-ad-card" :class="{ compact }" :data-placement="ad.placement">
    <a
      class="forum-ad-link"
      :href="ad.linkUrl"
      :target="isExternal ? '_blank' : undefined"
      :rel="isExternal ? 'noopener noreferrer sponsored' : 'sponsored'"
      @click="trackClick"
    >
      <div class="ad-media">
        <img
          v-if="ad.imageUrl && imageVisible"
          class="ad-image"
          :src="ad.imageUrl"
          :alt="ad.title"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
          @error="imageVisible = false"
        />
        <AppIcon v-else name="promotion" class="ad-placeholder-icon" />
      </div>
      <div class="ad-copy">
        <div class="ad-kicker"><AppIcon name="promotion" />推广</div>
        <h3>{{ ad.title }}</h3>
        <p v-if="ad.description">{{ ad.description }}</p>
      </div>
      <span class="ad-action">{{ ad.buttonText || "查看详情" }}<AppIcon name="link" /></span>
    </a>
  </article>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import AppIcon from "@/components/common/AppIcon.vue";

const props = withDefaults(defineProps<{ ad: ForumAd; compact?: boolean }>(), { compact: false });
const isExternal = computed(() => /^https?:\/\//i.test(props.ad.linkUrl));
const imageVisible = ref(Boolean(props.ad.imageUrl));
const cardRef = ref<HTMLElement | null>(null);
let impressionObserver: IntersectionObserver | null = null;
let impressionTimer: ReturnType<typeof setTimeout> | null = null;
let impressionTracked = false;

watch(() => props.ad.imageUrl, (value) => {
  imageVisible.value = Boolean(value);
});

watch(() => props.ad.id, async () => {
  impressionTracked = false;
  clearImpressionTimer();
  await nextTick();
  observeCard();
});

onMounted(observeCard);

onBeforeUnmount(() => {
  clearImpressionTimer();
  impressionObserver?.disconnect();
});

function clearImpressionTimer() {
  if (!impressionTimer) return;
  clearTimeout(impressionTimer);
  impressionTimer = null;
}

function observeCard() {
  impressionObserver?.disconnect();
  if (!cardRef.value || impressionTracked) return;
  if (typeof IntersectionObserver === "undefined") {
    trackImpression();
    return;
  }
  impressionObserver = new IntersectionObserver(([entry]) => {
    if (!entry || entry.intersectionRatio < 0.5) {
      clearImpressionTimer();
      return;
    }
    if (!impressionTimer) impressionTimer = setTimeout(trackImpression, 700);
  }, { threshold: [0.5, 0.75] });
  impressionObserver.observe(cardRef.value);
}

function trackImpression() {
  clearImpressionTimer();
  if (impressionTracked) return;
  impressionTracked = true;
  impressionObserver?.disconnect();
  void forumAdsApi.track(props.ad, "impression");
}

function trackClick() {
  if (!impressionTracked) trackImpression();
  void forumAdsApi.track(props.ad, "click");
}
</script>

<style scoped>
.forum-ad-card {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 15%, var(--cpu-border-soft));
  border-radius: 16px;
  background: var(--cpu-card);
  box-shadow: 0 7px 20px rgba(15, 23, 42, 0.045);
}
.forum-ad-link {
  position: relative;
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto;
  align-items: center;
  gap: 15px;
  min-height: 88px;
  padding: 12px;
  color: inherit;
  text-decoration: none;
  transition: background .16s ease, border-color .16s ease;
}
.forum-ad-link:hover { background: color-mix(in srgb, var(--cpu-primary) 4%, var(--cpu-card)); }
.ad-media {
  display: grid;
  width: 108px;
  height: 66px;
  place-items: center;
  overflow: hidden;
  border-radius: 11px;
  color: var(--cpu-primary);
  background: linear-gradient(135deg, color-mix(in srgb, var(--cpu-primary) 13%, var(--cpu-surface-subtle)), var(--cpu-surface-subtle));
}
.ad-image { width: 100%; height: 100%; object-fit: cover; background: var(--cpu-surface-subtle); }
.ad-placeholder-icon { font-size: 26px; }
.ad-copy { min-width: 0; flex: 1; }
.ad-kicker {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 5px;
  color: var(--cpu-text-tertiary, var(--cpu-text-secondary));
  font-size: 11px;
  font-weight: 600;
}
.ad-kicker :deep(.el-icon) { font-size: 12px; }
.ad-copy h3 { margin: 0; overflow: hidden; color: var(--cpu-text); font-size: 15px; font-weight: 700; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.ad-copy p { margin: 4px 0 0; overflow: hidden; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.ad-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border-radius: 999px;
  color: var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 9%, transparent);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.ad-action :deep(.el-icon) { font-size: 13px; }
.compact .forum-ad-link { grid-template-columns: 88px minmax(0, 1fr) auto; min-height: 72px; padding: 9px; }
.compact .ad-media { width: 88px; height: 54px; border-radius: 9px; }
@media (max-width: 600px) {
  .forum-ad-link,
  .compact .forum-ad-link {
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 10px;
    min-height: 72px;
    padding: 9px;
  }
  .ad-media,
  .compact .ad-media { width: 82px; height: 58px; border-radius: 9px; }
  .ad-kicker { margin-bottom: 3px; }
  .ad-action {
    position: absolute;
    right: 10px;
    bottom: 8px;
    padding: 0;
    background: transparent;
    font-size: 11px;
  }
  .ad-copy { padding-bottom: 16px; }
  .ad-copy h3 { font-size: 14px; }
  .ad-copy p { padding-right: 58px; }
}
</style>
