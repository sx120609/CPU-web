<template>
  <article class="wk-card">
    <WorkIcon :slug="work.slug" :name="name" :type="work.version?.type" :size="56" />
    <div class="wk-card-copy">
      <h2>
        <router-link :to="`/workshop/${work.id}`">{{ name }}</router-link>
      </h2>
      <p class="wk-card-summary">{{ work.version?.description || "暂无介绍" }}</p>
      <p class="wk-meta">
        <span>{{ typeLabels[work.version?.type || "tool"] }}</span>
        <span class="wk-card-author">{{ work.author.nickname }}</span>
        <span>{{ workshopAgo(work.updatedAt) }}</span>
      </p>
    </div>
    <div class="wk-card-side">
      <button
        type="button"
        class="wk-card-fav"
        :class="{ 'is-on': work.isFavorited }"
        :disabled="busy"
        :aria-pressed="work.isFavorited"
        :aria-label="work.isFavorited ? `取消收藏，当前 ${work.favoriteCount} 人收藏` : `收藏，当前 ${work.favoriteCount} 人收藏`"
        @click="$emit('favorite', work)"
      >
        <el-icon><component :is="work.isFavorited ? StarFilled : Star" /></el-icon>
        <span>{{ work.favoriteCount }}</span>
      </button>
      <router-link class="wk-card-open" :to="playerPath(work.id)">打开</router-link>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Star, StarFilled } from "@element-plus/icons-vue";
import type { WorkshopWork } from "@/api/workshop";
import WorkIcon from "./WorkIcon.vue";
import { playerPath, typeLabels, workName, workshopAgo } from "./shared";

const props = defineProps<{ work: WorkshopWork; busy?: boolean }>();
defineEmits<{ favorite: [work: WorkshopWork] }>();
const name = computed(() => workName(props.work));
</script>

<style scoped>
.wk-card {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  transition: border-color 0.15s ease;
}
@media (hover: hover) {
  .wk-card:hover { border-color: var(--cpu-border); }
}
.wk-card-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.wk-card h2 {
  margin: 0;
  overflow: hidden;
  font-size: var(--cpu-fs-l);
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-card h2 a {
  color: inherit;
  text-decoration: none;
}
/* 整张卡片都能点进详情；右侧按钮浮在这层之上。 */
.wk-card h2 a::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  content: "";
}
.wk-card-summary {
  display: -webkit-box;
  min-height: calc(var(--cpu-fs-s) * 1.55 * 2);
  margin: 0 0 4px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.wk-card .wk-meta { flex-wrap: nowrap; white-space: nowrap; }
.wk-card .wk-meta > * { flex: 0 0 auto; }
.wk-card .wk-meta > .wk-card-author {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wk-card-side {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  align-self: stretch;
  justify-content: space-between;
  gap: 8px;
}
.wk-card-fav {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 24px;
  padding: 0 2px;
  border: 0;
  background: none;
  color: var(--cpu-text-muted);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.wk-card-fav .el-icon { font-size: 16px; }
.wk-card-fav.is-on { color: var(--cpu-hue-amber-ink); }
.wk-card-fav:disabled { opacity: 0.5; cursor: default; }
.wk-card-open {
  display: inline-flex;
  min-width: 56px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
  font-weight: 600;
  text-decoration: none;
}
@media (hover: hover) {
  .wk-card-open:hover { background: var(--cpu-primary); color: #fff; }
  html[data-theme="dark"] .wk-card-open:hover { color: #06231f; }
}
@media (prefers-reduced-motion: reduce) {
  .wk-card { transition: none; }
}
</style>
