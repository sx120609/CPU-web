<template>
  <transition name="smart-post-task">
    <aside
      v-if="smartPost.task && smartPost.status"
      class="smart-post-task-card"
      :class="[`is-${smartPost.status.state}`, { 'is-collapsed': !expanded }]"
    >
      <button v-if="!expanded" type="button" class="smart-post-task-pill" :aria-label="collapsedLabel" @click="expanded = true">
        <span class="smart-post-task-dot" aria-hidden="true" />
        <span class="smart-post-task-pill-copy">
          <strong>{{ collapsedTitle }}</strong>
          <span v-if="isRunning" class="smart-post-mini-track" aria-hidden="true">
            <i :style="{ width: `${smartPost.status.progress}%` }" />
          </span>
        </span>
        <span class="smart-post-task-pill-action">查看</span>
      </button>

      <template v-else>
        <div class="smart-post-task-head">
          <div>
            <strong>智慧发帖 Agent</strong>
            <span>{{ workflowLabel }} · 同账号设备同步</span>
          </div>
          <div class="smart-post-task-head-actions">
            <el-tag v-if="isRunning" size="small" type="primary" effect="light">处理中</el-tag>
            <el-tag v-else-if="smartPost.status.state === 'completed'" size="small" type="success" effect="light">草稿已生成</el-tag>
            <el-tag v-else size="small" type="danger" effect="light">处理失败</el-tag>
            <el-button size="small" text @click="expanded = false">收起</el-button>
          </div>
        </div>

        <p class="smart-post-task-message">{{ smartPost.status.message }}</p>
        <el-progress
          v-if="isRunning"
          :percentage="smartPost.status.progress"
          :stroke-width="8"
          :show-text="true"
        />
        <p v-if="isRunning" class="smart-post-task-hint">
          {{ smartPost.pollWarning || "Agent 会在后台继续处理，你可以放心浏览其他页面。" }}
        </p>
        <p v-else-if="smartPost.status.state === 'completed'" class="smart-post-task-result">
          {{ smartPost.status.result?.summary || "草稿已经准备好，返回后仍可继续修改，不会自动发布。" }}
        </p>
        <p v-else class="smart-post-task-error">{{ smartPost.status.error || "Agent 处理失败，请返回后重试。" }}</p>

        <div class="smart-post-task-actions">
          <el-button v-if="isRunning" size="small" @click="returnToDraft">返回发帖页</el-button>
          <template v-else-if="smartPost.status.state === 'completed'">
            <el-button size="small" type="primary" @click="returnToDraft">返回并填入草稿</el-button>
            <el-button size="small" text @click="smartPost.dismiss">稍后忽略</el-button>
          </template>
          <template v-else>
            <el-button size="small" type="primary" plain @click="returnToDraft">返回重新提交</el-button>
            <el-button size="small" text @click="smartPost.dismiss">关闭</el-button>
          </template>
        </div>
      </template>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useSmartPostJobStore } from "@/stores/smartPostJob";

const router = useRouter();
const auth = useAuthStore();
const smartPost = useSmartPostJobStore();
const isRunning = computed(() => smartPost.status?.state === "queued" || smartPost.status?.state === "running");
const expanded = ref(!isCompactViewport());
const collapsedTitle = computed(() => {
  if (isRunning.value) return `Agent ${smartPost.status?.progress || 0}%`;
  return smartPost.status?.state === "completed" ? "草稿已生成" : "Agent 任务失败";
});
const collapsedLabel = computed(() => `智慧发帖：${collapsedTitle.value}，点击查看详情`);
const workflowLabel = computed(() => smartPost.status?.operation === "format" ? "单轮排版任务" : "三轮后台任务");

watch(
  () => [auth.ready, auth.user?.id] as const,
  ([ready, userId]) => {
    if (!ready) return;
    if (userId) smartPost.resume(userId);
    else smartPost.clearForLogout();
  },
  { immediate: true },
);

watch(
  () => smartPost.task?.jobId,
  (jobId) => {
    if (jobId) expanded.value = !isCompactViewport();
  },
);

function returnToDraft() {
  const target = smartPost.task?.returnPath || "/post";
  if (router.currentRoute.value.fullPath !== target) void router.push(target);
}

function isCompactViewport() {
  return window.matchMedia("(max-width: 640px)").matches;
}
</script>

<style scoped>
.smart-post-task-card {
  position: fixed;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 4800;
  width: min(390px, calc(100vw - 28px));
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 28%, var(--el-border-color));
  border-radius: 14px;
  background: var(--el-bg-color-overlay);
  box-shadow: 0 14px 44px rgba(15, 23, 42, 0.22);
}

.smart-post-task-card.is-completed {
  border-color: color-mix(in srgb, var(--el-color-success) 42%, var(--el-border-color));
}

.smart-post-task-card.is-failed {
  border-color: color-mix(in srgb, var(--el-color-danger) 42%, var(--el-border-color));
}

.smart-post-task-card.is-collapsed {
  width: min(218px, calc(100vw - 28px));
  padding: 0;
  overflow: hidden;
  border-radius: 999px;
  box-shadow: 0 8px 26px rgba(15, 23, 42, 0.18);
}

.smart-post-task-pill {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 50px;
  padding: 8px 13px;
  border: 0;
  background: transparent;
  color: var(--el-text-color-primary);
  cursor: pointer;
  text-align: left;
}

.smart-post-task-pill-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.smart-post-task-pill-copy strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-post-task-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--el-color-primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--el-color-primary) 14%, transparent);
}

.is-running .smart-post-task-dot,
.is-queued .smart-post-task-dot {
  animation: smart-post-dot-pulse 1.4s ease-in-out infinite;
}

.is-completed .smart-post-task-dot { background: var(--el-color-success); }
.is-failed .smart-post-task-dot { background: var(--el-color-danger); }

.smart-post-mini-track {
  width: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--el-fill-color-dark);
}

.smart-post-mini-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
  transition: width 0.25s ease;
}

.smart-post-task-pill-action {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
}

.smart-post-task-head,
.smart-post-task-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.smart-post-task-head > div {
  display: grid;
  gap: 2px;
}

.smart-post-task-head .smart-post-task-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.smart-post-task-head strong {
  color: var(--el-text-color-primary);
  font-size: 15px;
}

.smart-post-task-head span,
.smart-post-task-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.smart-post-task-message {
  margin: 14px 0 10px;
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 1.55;
}

.smart-post-task-hint,
.smart-post-task-result,
.smart-post-task-error {
  margin: 9px 0 0;
  line-height: 1.55;
}

.smart-post-task-result {
  color: var(--el-color-success-dark-2);
  font-size: 13px;
}

.smart-post-task-error {
  max-height: 104px;
  overflow: auto;
  color: var(--el-color-danger);
  font-size: 13px;
  white-space: pre-wrap;
}

.smart-post-task-actions {
  justify-content: flex-end;
  margin-top: 14px;
}

.smart-post-task-enter-active,
.smart-post-task-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.smart-post-task-enter-from,
.smart-post-task-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@keyframes smart-post-dot-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

@media (max-width: 640px) {
  .smart-post-task-card {
    right: 14px;
    bottom: max(14px, env(safe-area-inset-bottom));
  }

  .smart-post-task-card:not(.is-collapsed) {
    max-height: min(72dvh, 520px);
    overflow: auto;
  }
}
</style>
