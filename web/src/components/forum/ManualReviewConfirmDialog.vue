<template>
  <el-dialog
    :model-value="modelValue"
    title="提交人工复核前确认"
    width="460px"
    append-to-body
    @close="handleCancel"
  >
    <div class="manual-review-confirm">
      <p>你将提交{{ subject }}人工复核申请。</p>
      <p>复核期间暂时不能继续提交新内容，请确认无误后再继续。</p>
      <p class="cpu-muted">倒计时结束后才能提交，避免误触。</p>
    </div>
    <template #footer>
      <el-button @click="handleCancel">返回修改</el-button>
      <el-button type="warning" :disabled="readSeconds > 0" @click="handleConfirm">
        {{ readSeconds > 0 ? `请先阅读 ${readSeconds}s` : "确认提交" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  subject?: string;
  countdown?: number;
}>(), {
  subject: "内容",
  countdown: 3,
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  confirm: [];
  cancel: [];
}>();

const readSeconds = ref(0);
let readTimer: number | null = null;

watch(
  () => props.modelValue,
  (open) => {
    if (open) startReadTimer();
    else clearReadTimer();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  clearReadTimer();
});

function startReadTimer() {
  clearReadTimer();
  readSeconds.value = Math.max(0, props.countdown);
  if (readSeconds.value <= 0) return;
  readTimer = window.setInterval(() => {
    readSeconds.value -= 1;
    if (readSeconds.value <= 0) {
      clearReadTimer();
    }
  }, 1000);
}

function clearReadTimer() {
  if (readTimer) {
    window.clearInterval(readTimer);
    readTimer = null;
  }
  if (!props.modelValue) {
    readSeconds.value = 0;
  }
}

function handleCancel() {
  emit("update:modelValue", false);
  emit("cancel");
}

function handleConfirm() {
  if (readSeconds.value > 0) return;
  emit("update:modelValue", false);
  emit("confirm");
}
</script>

<style scoped>
.manual-review-confirm {
  color: #374151;
  font-size: 14px;
  line-height: 1.75;
}

.manual-review-confirm p {
  margin: 0 0 10px;
}

.manual-review-confirm p:last-child {
  margin-bottom: 0;
}

.cpu-muted {
  font-size: 12px;
  color: #9ca3af;
}
</style>
