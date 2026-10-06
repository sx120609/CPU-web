<template>
  <button data-cpu-button="surface" type="button" class="me-row-m" :style="{ '--tone': tone }">
    <span class="me-row-m-tile" aria-hidden="true"><el-icon><component :is="icon" /></el-icon></span>
    <span class="me-row-m-copy">
      <b>{{ title }}</b>
      <small v-if="description">{{ description }}</small>
    </span>
    <span v-if="badge" class="me-row-m-badge">{{ badge }}</span>
    <span v-if="value" class="me-row-m-value">{{ value }}</span>
    <el-icon class="me-row-m-arrow" aria-hidden="true"><ArrowRight /></el-icon>
  </button>
</template>

<script setup lang="ts">
import type { Component } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";

withDefaults(defineProps<{
  icon: Component;
  title: string;
  tone?: string;
  description?: string;
  value?: string;
  badge?: string | number;
}>(), {
  tone: "var(--cpu-primary)",
  description: "",
  value: "",
  badge: "",
});
</script>

<style scoped>
.me-row-m {
  --me-row-m-fill: 11%;
  --me-row-m-ink: 100%;
  display: flex;
  width: 100%;
  min-height: 54px;
  align-items: center;
  gap: 11px;
  padding: 9px 12px 9px 13px;
  border: 0;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.me-row-m:last-child { border-bottom: 0; }
.me-row-m:active { background: var(--cpu-surface-soft); }
.me-row-m:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }

.me-row-m-tile {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: var(--tone) var(--me-row-m-fill);
  color: var(--tone) var(--me-row-m-ink);
  font-size: var(--cpu-fs-l);
}

.me-row-m-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.me-row-m-copy b { overflow: hidden; color: var(--cpu-text); font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.me-row-m-copy small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.45; }

.me-row-m-value {
  max-width: 46%;
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.me-row-m-badge {
  min-width: 18px;
  height: 18px;
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-danger);
  color: #fff;
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  line-height: 18px;
  text-align: center;
}
.me-row-m-arrow { flex: 0 0 auto; margin-left: -4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

:global(html[data-theme="dark"] .me-row-m) {
  --me-row-m-fill: 20%;
  --me-row-m-ink: 46%;
}
</style>
