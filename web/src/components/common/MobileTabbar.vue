<template>
  <div :class="{ 'is-hidden': hidden }">
    <nav class="tabbar" :style="{ '--count': items.length }" aria-label="移动端主导航">
      <RouterLink
        v-for="(item, index) in items"
        :key="item.label"
        :to="item.to"
        class="tabbar-item"
        :class="{ 'is-active': index === activeIndex }"
        :aria-current="index === activeIndex ? 'page' : undefined"
        draggable="false"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import type { Component } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

// 位置、显隐和底部占位由 MainLayout 的 .mobile-tabbar 规则决定，这里只管外观。
defineProps<{
  items: { label: string; icon: Component; to: RouteLocationRaw }[];
  activeIndex: number;
  hidden: boolean;
}>();
</script>

<style scoped>
.tabbar { display: grid; height: 100%; grid-template-columns: repeat(var(--count), minmax(0, 1fr)); padding-bottom: env(safe-area-inset-bottom, 0px); background: var(--cpu-card); box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.tabbar-item { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.3; text-decoration: none; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; user-select: none; }
.tabbar-item .el-icon { font-size: 24px; }
.tabbar-item.is-active { color: var(--cpu-primary); font-weight: 500; }
.tabbar-item:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -4px; }
</style>
