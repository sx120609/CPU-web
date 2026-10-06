<template>
  <span class="fs-file-badge" :class="`is-${kind}`" :style="{ '--size': `${size}px` }" aria-hidden="true">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { fileExt, fileKind } from "../shared";

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 36 });
const kind = computed(() => fileKind(props.name));
const label = computed(() => (fileExt(props.name).slice(0, 4) || "FILE").toUpperCase());
</script>

<style scoped>
.fs-file-badge {
  --tone: #64748b;
  display: grid;
  width: var(--size);
  height: var(--size);
  flex: 0 0 auto;
  place-items: center;
  border-radius: calc(var(--size) * .28);
  background: color-mix(in srgb, var(--tone) 13%, var(--cpu-card));
  color: color-mix(in srgb, var(--tone) 88%, var(--cpu-text));
  font-size: calc(var(--size) * .27);
  font-weight: 700;
  letter-spacing: .02em;
  line-height: 1;
}
.fs-file-badge.is-image { --tone: #0d9488; }
.fs-file-badge.is-pdf { --tone: #dc2626; }
.fs-file-badge.is-doc { --tone: #2563eb; }
.fs-file-badge.is-sheet { --tone: #16a34a; }
.fs-file-badge.is-slide { --tone: #ea580c; }
.fs-file-badge.is-archive { --tone: #7c3aed; }
:global(html[data-theme="dark"] .fs-file-badge) { background: color-mix(in srgb, var(--tone) 22%, var(--cpu-card)); color: color-mix(in srgb, var(--tone) 50%, var(--cpu-text)); }
</style>
