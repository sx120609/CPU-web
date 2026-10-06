<template>
  <button data-cpu-button="surface" type="button" class="tool-row-m" :style="{ '--tone': tool.accent }">
    <span class="tool-row-m-tile" aria-hidden="true"><el-icon><component :is="tool.iconComponent" /></el-icon></span>
    <span class="tool-row-m-copy">
      <b>
        <span>{{ tool.name }}</span>
        <em v-if="badge" :class="`is-${badgeTone}`">{{ badge }}</em>
      </b>
      <small>{{ tool.summary }}</small>
    </span>
    <el-icon class="tool-row-m-arrow" aria-hidden="true"><ArrowRight /></el-icon>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";
import type { ServiceTool } from "@/data/serviceTools";
import { toolBadgeTone } from "../servicesPage";

const props = defineProps<{ tool: ServiceTool; badge?: string; loginRequired?: boolean }>();

const badgeTone = computed(() => toolBadgeTone(props.tool, Boolean(props.loginRequired)));
</script>

<style scoped>
.tool-row-m {
  --tool-row-m-fill: 11%;
  --tool-row-m-ink: 100%;
  display: flex;
  width: 100%;
  min-height: 60px;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.tool-row-m:last-child { border-bottom: 0; }
.tool-row-m:active { background: var(--cpu-surface-soft); }
.tool-row-m:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }

.tool-row-m-tile {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--tool-row-m-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--tool-row-m-ink), var(--cpu-text));
  font-size: var(--cpu-fs-xl);
}

.tool-row-m-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.tool-row-m-copy b { display: flex; min-width: 0; align-items: center; gap: 7px; color: var(--cpu-text); font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.35; }
.tool-row-m-copy b > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-row-m-copy em {
  --badge: var(--cpu-text-secondary);
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--cpu-radius-pill);
  background: color-mix(in srgb, var(--badge) 12%, var(--cpu-card));
  color: color-mix(in srgb, var(--badge) 78%, var(--cpu-text));
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  font-weight: 500;
}
.tool-row-m-copy em.is-open { --badge: var(--cpu-success); }
.tool-row-m-copy em.is-login { --badge: var(--cpu-gold); }
.tool-row-m-copy em.is-info { --badge: #0284c7; }
.tool-row-m-copy small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.45; }
.tool-row-m-arrow { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-m); }

:global(html[data-theme="dark"] .tool-row-m) {
  --tool-row-m-fill: 20%;
  --tool-row-m-ink: 46%;
}
</style>
