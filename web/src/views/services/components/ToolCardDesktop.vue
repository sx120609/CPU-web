<template>
  <button data-cpu-button="surface" type="button" class="tool-card-d" :style="{ '--tone': tool.accent }">
    <span class="pk-tile" aria-hidden="true"><el-icon><component :is="tool.iconComponent" /></el-icon></span>
    <span class="tool-card-d-copy">
      <b>
        <span>{{ tool.name }}</span>
        <em v-if="badge" class="pk-badge" :class="`is-${toolBadgeTone(tool, Boolean(loginRequired))}`">{{ badge }}</em>
      </b>
      <small>{{ tool.summary }}</small>
    </span>
  </button>
</template>

<script setup lang="ts">
import type { ServiceTool } from "@/data/serviceTools";
import { toolBadgeTone } from "../servicesPage";

defineProps<{ tool: ServiceTool; badge?: string; loginRequired?: boolean }>();
</script>

<style scoped>
.tool-card-d {
  display: flex;
  min-width: 0;
  min-height: 84px;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
}
.tool-card-d:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
@media (hover: hover) {
  .tool-card-d:hover {
    border-color: color-mix(in srgb, var(--tone, var(--cpu-primary)) 46%, var(--cpu-border-soft));
    box-shadow: var(--cpu-shadow-md);
    transform: translateY(-1px);
  }
}
.tool-card-d-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }
.tool-card-d-copy b { display: flex; min-width: 0; align-items: center; gap: 8px; font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.4; }
.tool-card-d-copy b > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-card-d-copy small { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.55; }
@media (prefers-reduced-motion: reduce) {
  .tool-card-d { transition: none; }
}
</style>
