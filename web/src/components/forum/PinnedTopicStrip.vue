<template>
  <section v-if="topics.length" class="pinned-strip" aria-label="重要内容">
    <div class="pinned-strip-head">
      <span class="pinned-label">重要</span>
      <span class="pinned-count">{{ topics.length }} 条置顶</span>
    </div>
    <button
      v-for="(topic, index) in topics"
      :key="topic.id"
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
import { useRoute, useRouter } from "vue-router";
import type { Topic } from "@/api/topic";

defineProps<{ topics: Topic[] }>();
const route = useRoute();
const router = useRouter();

function openTopic(id: number) {
  router.push({ path: `/forum/topic/${id}`, query: { from: route.fullPath } });
}
</script>

<style scoped>
.pinned-strip { padding: 10px 12px; border: 1px solid color-mix(in srgb, #f59e0b 24%, var(--cpu-border-soft)); border-radius: 12px; background: color-mix(in srgb, #f59e0b 5%, var(--cpu-card)); }
.pinned-strip-head { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.pinned-label { padding: 2px 7px; border-radius: 999px; background: #f59e0b; color: #fff; font-size: 10px; font-weight: 800; }
.pinned-count { color: var(--cpu-text-muted); font-size: 11px; }
.pinned-topic { display: grid; width: 100%; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 2px; border: 0; border-top: 1px dashed var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.pinned-topic:first-of-type { border-top: 0; }
.pinned-topic:hover .pinned-title { color: var(--cpu-primary); }
.pinned-topic:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.pinned-index { color: #b45309; font-size: 11px; font-weight: 800; text-align: center; }
.pinned-title { overflow: hidden; color: var(--cpu-text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.pinned-board { max-width: 90px; overflow: hidden; color: var(--cpu-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
</style>
