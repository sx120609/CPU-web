<template>
  <transition name="smart-post-task">
    <aside v-if="smartPost.task && smartPost.status" class="smart-post-task-card" :class="`is-${smartPost.status.state}`">
      <div class="smart-post-task-head">
        <div>
          <strong>智慧发帖 Agent</strong>
          <span>三轮后台任务 · 同账号设备同步</span>
        </div>
        <el-tag v-if="isRunning" size="small" type="primary" effect="light">处理中</el-tag>
        <el-tag v-else-if="smartPost.status.state === 'completed'" size="small" type="success" effect="light">草稿已生成</el-tag>
        <el-tag v-else size="small" type="danger" effect="light">处理失败</el-tag>
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
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useSmartPostJobStore } from "@/stores/smartPostJob";

const router = useRouter();
const auth = useAuthStore();
const smartPost = useSmartPostJobStore();
const isRunning = computed(() => smartPost.status?.state === "queued" || smartPost.status?.state === "running");

watch(
  () => [auth.ready, auth.user?.id] as const,
  ([ready, userId]) => {
    if (!ready) return;
    if (userId) smartPost.resume(userId);
    else smartPost.clearForLogout();
  },
  { immediate: true },
);

function returnToDraft() {
  const target = smartPost.task?.returnPath || "/post";
  if (router.currentRoute.value.fullPath !== target) void router.push(target);
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

@media (max-width: 640px) {
  .smart-post-task-card {
    right: 14px;
    bottom: max(14px, env(safe-area-inset-bottom));
  }
}
</style>
