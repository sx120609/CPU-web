<template>
  <el-dialog
    :model-value="busy.visible"
    width="380px"
    class="fs-busy-dialog"
    append-to-body
    align-center
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="fs-busy" role="status" aria-live="polite">
      <el-icon class="fs-busy-spinner is-loading" aria-hidden="true"><Loading /></el-icon>
      <b>{{ busy.title }}</b>
      <p>{{ busy.message }}</p>
      <p v-if="busy.detail" class="fs-busy-detail">{{ busy.detail }}</p>
      <div v-if="busy.total > 0" class="fs-busy-progress">
        <el-progress :percentage="percent" :show-text="false" :stroke-width="6" />
        <span>{{ busy.current }}/{{ busy.total }}</span>
      </div>
      <el-button v-if="busy.cancelable" :disabled="busy.cancelRequested" @click="cancelBusy">
        {{ busy.cancelRequested ? "正在取消" : "取消" }}
      </el-button>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Loading } from "@element-plus/icons-vue";
import { useInjectedFilestoreWorkspace } from "../workspace";

const { busy, cancelBusy } = useInjectedFilestoreWorkspace();
const percent = computed(() => (busy.total ? Math.min(100, Math.round((busy.current / busy.total) * 100)) : 0));
</script>

<style scoped>
.fs-busy { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 0 2px; text-align: center; }
.fs-busy-spinner { margin-bottom: 4px; color: var(--cpu-primary); font-size: 30px; }
.fs-busy b { font-size: 16px; font-weight: 700; }
.fs-busy p { margin: 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.6; }
.fs-busy .fs-busy-detail { max-width: 100%; overflow: hidden; color: var(--cpu-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.fs-busy-progress { display: flex; width: 100%; align-items: center; gap: 10px; margin-top: 6px; }
.fs-busy-progress .el-progress { flex: 1; }
.fs-busy-progress span { color: var(--cpu-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.fs-busy .el-button { margin-top: 8px; }
:global(.fs-busy-dialog .el-dialog__header) { display: none; }
</style>
