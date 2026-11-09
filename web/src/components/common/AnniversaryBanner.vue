<template>
  <section v-if="celebration" class="anniversary-banner" :class="{ 'is-compact': compact }" :aria-label="`${schoolName}建校 ${years} 周年`">
    <svg class="anniversary-ribbon" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-10 92 C 70 40, 150 118, 230 70 S 360 18, 410 46" />
      <path d="M-10 108 C 80 62, 160 128, 240 86 S 370 36, 410 64" />
    </svg>
    <div class="anniversary-years" aria-hidden="true">
      <b>{{ years }}</b>
      <small>周年</small>
    </div>
    <div class="anniversary-copy">
      <h2>{{ schoolName }}建校 {{ years }} 周年</h2>
      <p>{{ celebration.motto }}<span class="anniversary-span">{{ celebration.founded }}—{{ celebrationYear }}</span></p>
    </div>
    <div class="anniversary-count" role="status">
      <template v-if="daysLeft > 0">
        <small>距校庆日</small>
        <span><b>{{ daysLeft }}</b>天</span>
      </template>
      <template v-else-if="daysLeft === 0">
        <small>{{ dateLabel }}</small>
        <span class="is-today">校庆日</span>
      </template>
      <template v-else>
        <small>{{ dateLabel }}</small>
        <span class="is-today">校庆</span>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSiteStore } from "@/stores/site";
import { useSiteThemeStore } from "@/stores/siteTheme";
import { celebrationDateLabel, celebrationYears, daysUntilCelebration } from "@/utils/celebration";

defineProps<{ compact?: boolean }>();

const site = useSiteStore();
const siteTheme = useSiteThemeStore();

/** 横幅跟着校庆主题走：换回经典主题就不显示。 */
const celebration = computed(() => (siteTheme.theme === "anniversary" ? site.celebration : null));
const schoolName = computed(() => site.schoolName);
const years = computed(() => (celebration.value ? celebrationYears(celebration.value) : 0));
const celebrationYear = computed(() => celebration.value?.date.slice(0, 4) ?? "");
const dateLabel = computed(() => (celebration.value ? celebrationDateLabel(celebration.value) : ""));

// 页面开着过了零点，倒计时也要跟着变。
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => { now.value = new Date(); }, 60_000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
const daysLeft = computed(() => (celebration.value ? daysUntilCelebration(celebration.value, now.value) : 0));
</script>

<style scoped lang="scss">
.anniversary-banner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 88px;
  padding: 14px 20px;
  overflow: hidden;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-anniversary-banner-bg);
  color: var(--cpu-anniversary-banner-ink);
  isolation: isolate;
}

.anniversary-ribbon {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
}

.anniversary-ribbon path {
  fill: none;
  stroke: var(--cpu-anniversary-gold);
  stroke-width: 1.4;
  opacity: 0.45;
  vector-effect: non-scaling-stroke;
}

.anniversary-ribbon path + path {
  opacity: 0.25;
}

.anniversary-years {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 2px;
  color: var(--cpu-anniversary-gold);
  line-height: 1;
}

.anniversary-years b {
  font-family: "Georgia", "Times New Roman", "Songti SC", serif;
  font-size: 44px;
  font-style: italic;
  font-weight: 700;
  letter-spacing: -1px;
}

.anniversary-years small {
  font-size: var(--cpu-fs-xs);
  font-weight: 600;
}

.anniversary-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.anniversary-copy h2 {
  margin: 0;
  overflow: hidden;
  font-size: var(--cpu-fs-l);
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anniversary-copy p {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0;
  font-size: var(--cpu-fs-s);
  letter-spacing: 2px;
  line-height: 1.5;
}

.anniversary-span {
  font-size: var(--cpu-fs-xs);
  letter-spacing: 0;
  opacity: 0.78;
  font-variant-numeric: tabular-nums;
}

.anniversary-count {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding-left: 16px;
  border-left: 1px solid color-mix(in srgb, var(--cpu-anniversary-banner-ink) 28%, transparent);
  line-height: 1.2;
}

.anniversary-count small {
  font-size: var(--cpu-fs-xs);
  opacity: 0.82;
}

.anniversary-count span {
  font-size: var(--cpu-fs-s);
}

.anniversary-count b {
  margin-right: 2px;
  color: var(--cpu-anniversary-gold);
  font-size: var(--cpu-fs-xxl);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.anniversary-count .is-today {
  color: var(--cpu-anniversary-gold);
  font-size: var(--cpu-fs-xl);
  font-weight: 700;
}

.anniversary-banner.is-compact {
  gap: 12px;
  min-height: 76px;
  padding: 12px 14px;
}

.anniversary-banner.is-compact .anniversary-years b {
  font-size: 36px;
}

.anniversary-banner.is-compact .anniversary-copy h2 {
  font-size: var(--cpu-fs-m);
}

.anniversary-banner.is-compact .anniversary-copy p {
  font-size: var(--cpu-fs-xs);
  letter-spacing: 1px;
}

.anniversary-banner.is-compact .anniversary-span {
  display: none;
}

.anniversary-banner.is-compact .anniversary-count {
  padding-left: 12px;
}

.anniversary-banner.is-compact .anniversary-count b {
  font-size: var(--cpu-fs-xl);
}

.anniversary-banner.is-compact .anniversary-count .is-today {
  font-size: var(--cpu-fs-l);
}
</style>
