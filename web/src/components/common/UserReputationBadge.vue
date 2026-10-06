<template>
  <span
    v-if="visibleLevel && !auth.forumHidden"
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
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

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
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  line-height: 16px;
  vertical-align: middle;
  white-space: nowrap;
}

.reputation-badge b {
  font-weight: 700;
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
