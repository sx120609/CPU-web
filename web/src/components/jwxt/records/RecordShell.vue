<template>
  <!-- 各类教务记录共用的外框：数据来源提示、筛选栏、出错重试，排版与成绩、培养方案页一致。 -->
  <div class="record-shell" v-loading="loading">
    <div class="data-note">
      <span>以下信息整理自教务系统，最终请以学校和学院通知为准。</span>
    </div>

    <div v-if="$slots.controls || $slots.summary || refreshable" class="ctrl-bar">
      <div class="ctrl-left"><slot name="controls" /></div>
      <div class="ctrl-right">
        <span v-if="$slots.summary" class="record-sum"><slot name="summary" /></span>
        <el-button v-if="refreshable" size="small" :icon="Refresh" :disabled="loading" @click="$emit('refresh')">刷新</el-button>
      </div>
    </div>

    <el-alert v-if="error" type="error" :closable="false" show-icon class="pane-alert" :title="error">
      <template #default>
        <el-button size="small" :loading="loading" @click="$emit('refresh')">重试</el-button>
      </template>
    </el-alert>

    <slot />
  </div>
</template>

<script setup lang="ts">
import { Refresh } from "@element-plus/icons-vue";

withDefaults(defineProps<{ loading?: boolean; error?: string; refreshable?: boolean }>(), {
  loading: false,
  error: "",
  refreshable: true,
});
defineEmits<{ (event: "refresh"): void }>();
</script>

<style scoped lang="scss">
.record-shell { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 160px; }

.data-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: var(--cpu-radius-m);
  background: rgba(245, 158, 11, 0.12);
  color: var(--cpu-warn);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
  padding: 10px 12px;
}
.data-note > :last-child { margin-left: auto; }

.ctrl-bar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 10px 12px; }
.ctrl-left { display: flex; min-width: 0; flex: 1 1 auto; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.ctrl-left:empty { display: none; }
.ctrl-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.record-sum { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.record-sum :deep(b) { color: var(--cpu-primary); font-size: var(--cpu-fs-m); font-weight: 500; }
.pane-alert :deep(.el-button) { margin-top: 6px; }
</style>
