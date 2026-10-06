<template>
  <div class="empty-state">
    <el-icon :size="40" color="#cbd5e1"><Box /></el-icon>
    <p>{{ text }}</p>
  </div>
</template>

<script setup lang="ts">
import { Box } from "@element-plus/icons-vue";
defineProps<{ text: string }>();
</script>

<style scoped>
.empty-state {
  padding: 36px 0;
  text-align: center;
  color: var(--cpu-text-muted);
}
.empty-state p {
  margin-top: 8px;
  font-size: var(--cpu-fs-s);
}
</style>
