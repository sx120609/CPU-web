<template>
  <section v-if="topics.length" class="pinned-strip" aria-label="重要内容">
    <div class="pinned-strip-head">
      <span class="pinned-label">重要</span>
      <span class="pinned-count">{{ topics.length }} 条置顶</span>
    </div>
    <button data-cpu-button="surface"
      v-for="(topic, index) in topics"
      :key="topic.id"
      :ref="(element) => setTopicElement(topic.id, element)"
      type="button"
      class="pinned-topic"
      @click="openTopic(topic.id)"
    >
      <span class="pinned-index">{{ index + 1 }}</span>
      <span class="pinned-title">{{ topic.title }}</span>
      <span class="pinned-board">{{ topic.board?.name }}</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { Topic } from "@/api/topic";
import { hasTrackedTopicImpression, queueTopicImpression } from "@/utils/topicImpressions";

const props = defineProps<{ topics: Topic[] }>();
const route = useRoute();
const router = useRouter();
const topicElements = new Map<number, HTMLElement>();
const impressionTimers = new Map<number, ReturnType<typeof setTimeout>>();
let impressionObserver: IntersectionObserver | null = null;

watch(
  () => props.topics.map((topic) => topic.id).join(","),
  async () => {
    await nextTick();
    observeTopics();
  },
  { flush: "post" },
);

onMounted(observeTopics);
onBeforeUnmount(clearImpressionTracking);

function setTopicElement(topicId: number, value: unknown) {
  const previous = topicElements.get(topicId);
  if (previous) impressionObserver?.unobserve(previous);
  if (!(value instanceof HTMLElement)) {
    topicElements.delete(topicId);
    clearImpressionTimer(topicId);
    return;
  }
  value.dataset.topicId = String(topicId);
  topicElements.set(topicId, value);
  impressionObserver?.observe(value);
}

function clearImpressionTimer(topicId: number) {
  const timer = impressionTimers.get(topicId);
  if (timer !== undefined) clearTimeout(timer);
  impressionTimers.delete(topicId);
}

function clearImpressionTracking() {
  impressionObserver?.disconnect();
  impressionObserver = null;
  for (const topicId of impressionTimers.keys()) clearImpressionTimer(topicId);
}

function recordVisibleImpression(topicId: number) {
  clearImpressionTimer(topicId);
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const element = topicElements.get(topicId);
  if (element) impressionObserver?.unobserve(element);
  void queueTopicImpression(topicId);
}

function observeTopics() {
  clearImpressionTracking();
  const visibleEntries = props.topics.filter((topic) => {
    const topicId = Number(topic.id);
    return Number.isInteger(topicId) && topicId > 0 && !topic.hidden && !hasTrackedTopicImpression(topicId);
  });
  if (!visibleEntries.length) return;
  if (typeof IntersectionObserver === "undefined") {
    for (const topic of visibleEntries) recordVisibleImpression(Number(topic.id));
    return;
  }
  impressionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const topicId = Number((entry.target as HTMLElement).dataset.topicId);
      if (!Number.isInteger(topicId) || topicId <= 0) continue;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        if (!hasTrackedTopicImpression(topicId) && !impressionTimers.has(topicId)) {
          impressionTimers.set(topicId, setTimeout(() => recordVisibleImpression(topicId), 450));
        }
      } else {
        clearImpressionTimer(topicId);
      }
    }
  }, { threshold: [0, 0.5] });
  for (const topic of visibleEntries) {
    const element = topicElements.get(Number(topic.id));
    if (element) impressionObserver.observe(element);
  }
}

function openTopic(id: number) {
  router.push({ path: `/forum/topic/${id}`, query: { from: route.fullPath } });
}
</script>

<style scoped>
.pinned-strip { padding: 4px 0; overflow: hidden; border-radius: var(--cpu-radius-l); background: var(--cpu-card); color: var(--cpu-text); font-size: var(--cpu-fs-m); }
.pinned-strip-head { display: flex; align-items: center; gap: 8px; padding: 10px 16px 4px; }
.pinned-label { height: 18px; padding: 0 5px; border-radius: var(--cpu-radius-s); background: var(--cpu-accent-soft); color: var(--cpu-accent); font-size: var(--cpu-fs-xs); font-weight: 500; line-height: 18px; }
.pinned-count { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.pinned-topic { display: grid; width: 100%; min-height: 44px; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 0 16px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.pinned-topic + .pinned-topic { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
/* Touch screens keep :hover after a tap, so the tint is for mice only; taps get :active feedback. */
@media (hover: hover) { .pinned-topic:hover { background: var(--cpu-surface-soft); } }
.pinned-topic:active { background: var(--cpu-surface-soft); }
.pinned-topic:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.pinned-index { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); font-weight: 500; text-align: center; font-variant-numeric: tabular-nums; }
.pinned-title { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.pinned-board { max-width: 90px; overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
</style>
