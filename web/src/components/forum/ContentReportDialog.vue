<template>
  <el-dialog v-model="open" title="举报内容" width="460px" append-to-body destroy-on-close>
    <p class="report-target">举报对象：{{ targetLabel || targetTypeLabel }}</p>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="举报原因" required>
        <el-select v-model="reason" class="report-select" placeholder="请选择原因">
          <el-option v-for="option in forumReportReasonOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="补充说明">
        <el-input
          v-model="detail"
          type="textarea"
          :rows="4"
          maxlength="1000"
          show-word-limit
          placeholder="可补充具体情况，帮助管理员判断"
        />
      </el-form-item>
    </el-form>
    <el-alert type="info" :closable="false" show-icon title="举报会提交给论坛管理员和站点管理员处理。" />
    <template #footer>
      <el-button :disabled="submitting" @click="open = false">取消</el-button>
      <el-button type="danger" :loading="submitting" :disabled="!reason" @click="submit">提交举报</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  forumReportApi,
  forumReportReasonOptions,
  type ForumReportReason,
  type ForumReportTargetType,
} from "@/api/forumReport";

const props = defineProps<{
  modelValue: boolean;
  targetType: ForumReportTargetType;
  targetId: number;
  targetLabel?: string;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "submitted"): void;
}>();

const reason = ref<ForumReportReason | "">("");
const detail = ref("");
const submitting = ref(false);
const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const targetTypeLabel = computed(() => (
  props.targetType === "topic" ? "帖子" : props.targetType === "reply" ? "评论" : "私聊消息"
));

watch(() => props.modelValue, (value) => {
  if (!value) return;
  reason.value = "";
  detail.value = "";
});

async function submit() {
  if (!reason.value || !props.targetId || submitting.value) return;
  submitting.value = true;
  try {
    const result = await forumReportApi.submit({
      targetType: props.targetType,
      targetId: props.targetId,
      reason: reason.value,
      detail: detail.value.trim(),
    }, { suppressErrorMessage: true });
    ElMessage.success(result.autoHidden
      ? "举报已提交；该内容已达 3 人举报并暂时隐藏"
      : "举报已提交，管理员会尽快处理");
    open.value = false;
    emit("submitted");
  } catch (error) {
    ElMessage.error(requestMessage(error) || "举报提交失败，请稍后再试");
  } finally {
    submitting.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.report-target { margin: 0 0 16px; color: var(--cpu-text-secondary); line-height: 1.6; overflow-wrap: anywhere; }
.report-select { width: 100%; }
</style>
