<template>
  <span
    v-if="visibleLevel"
    class="reputation-badge"
    :title="`论坛等级：Lv.${visibleLevel.level} ${visibleLevel.name}`"
    :aria-label="`论坛等级 Lv.${visibleLevel.level} ${visibleLevel.name}`"
  >
    <b>Lv.{{ visibleLevel.level }}</b>
    <span class="reputation-name">{{ visibleLevel.name }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

type ReputationLevel = {
  level: number;
  name: string;
  minReputation?: number;
};

const props = defineProps<{ level?: ReputationLevel | null }>();

const visibleLevel = computed(() => {
  const value = props.level;
  const level = Math.max(1, Math.round(Number(value?.level || 0)));
  const name = String(value?.name || "").trim();
  return value && Number.isFinite(level) && name ? { level, name } : null;
});
</script>

<style scoped>
.reputation-badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  max-width: 132px;
  padding: 1px 6px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, #8b5cf6 24%, var(--cpu-border-soft));
  border-radius: 999px;
  background: color-mix(in srgb, #8b5cf6 9%, var(--cpu-card));
  color: color-mix(in srgb, #7c3aed 86%, var(--cpu-text));
  font-size: 10px;
  font-weight: 650;
  line-height: 16px;
  vertical-align: middle;
  white-space: nowrap;
}

.reputation-badge b {
  font-weight: 800;
}

.reputation-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 640px) {
  .reputation-badge {
    max-width: none;
    padding-inline: 5px;
  }

  .reputation-name {
    display: none;
  }
}
</style>
