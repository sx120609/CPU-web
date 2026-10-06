<template>
  <div class="page-header">
    <div class="page-title">
      <h2>{{ title }}</h2>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
    </div>
    <div class="page-extra">
      <slot name="extra" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
  min-width: 0;
}
.page-title {
  min-width: 0;
}
.page-title h2 {
  margin: 0;
  font-size: var(--cpu-fs-xl);
  font-weight: 500;
  color: var(--cpu-text);
  overflow-wrap: anywhere;
}
.page-subtitle {
  margin: 4px 0 0;
  font-size: var(--cpu-fs-s);
  color: var(--cpu-text-muted);
  overflow-wrap: anywhere;
}
.page-extra {
  flex: 0 0 auto;
}

@media (max-width: 640px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .page-title h2 {
    font-size: var(--cpu-fs-xl);
  }
}
</style>
