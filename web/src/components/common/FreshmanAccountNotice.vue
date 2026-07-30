<template>
  <el-dialog
    :model-value="modelValue"
    class="freshman-notice-dialog"
    width="520px"
    :close-on-click-modal="false"
    align-center
    aria-label="新生统一身份认证说明"
    @update:model-value="onVisibilityChange"
  >
    <template #header>
      <div class="freshman-notice-heading">
        <span class="freshman-notice-icon" aria-hidden="true">新</span>
        <div>
          <h2>新生统一身份认证说明</h2>
          <p>给暂时无法登录的新同学</p>
        </div>
      </div>
    </template>

    <div class="freshman-notice-body">
      <p>
        如果你是新生，由于学校的统一身份认证账号暂时还未开放，
        本站部分需要统一认证的服务可能暂时无法使用。
      </p>
      <p class="freshman-notice-emphasis">
        这不是你的操作问题，也不是本站故障，耐心等待学校完成账号开通即可。
      </p>
      <div class="freshman-group-card">
        <div>
          <span>药大拾间用户 QQ 群</span>
          <strong>{{ USER_QQ_GROUP }}</strong>
          <p>账号可以使用后，我们会第一时间在群内通知。</p>
        </div>
        <button type="button" class="freshman-copy-button" @click="copyUserGroup">
          复制群号
        </button>
      </div>
    </div>

    <template #footer>
      <div class="freshman-notice-actions">
        <el-button @click="closeNotice">我知道了</el-button>
        <el-button type="primary" @click="joinUserGroup">加入用户群</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { USER_QQ_GROUP, copyText, openUserGroup } from "@/utils/userGroup";
import { markFreshmanNoticeSeen } from "@/utils/freshmanNotice";

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

function dismiss() {
  markFreshmanNoticeSeen();
  emit("update:modelValue", false);
}

function closeNotice() {
  dismiss();
}

function onVisibilityChange(value: boolean) {
  if (value) {
    emit("update:modelValue", true);
    return;
  }
  dismiss();
}

function joinUserGroup() {
  openUserGroup();
  dismiss();
}

async function copyUserGroup() {
  try {
    await copyText(USER_QQ_GROUP);
    ElMessage.success(`已复制 QQ 群号 ${USER_QQ_GROUP}`);
  } catch {
    ElMessage.error("复制失败，请手动记录群号");
  }
}
</script>

<style scoped lang="scss">
:global(.freshman-notice-dialog) {
  max-width: calc(100vw - 28px);
  border-radius: 18px;
  overflow: hidden;
}

:global(.freshman-notice-dialog .el-dialog__header) {
  margin-right: 0;
  padding: 24px 26px 18px;
  border-bottom: 1px solid var(--cpu-border-soft);
}

:global(.freshman-notice-dialog .el-dialog__body) {
  padding: 22px 26px 10px;
}

:global(.freshman-notice-dialog .el-dialog__footer) {
  padding: 16px 26px 24px;
}

.freshman-notice-heading {
  display: flex;
  align-items: center;
  gap: 13px;
  padding-right: 32px;
}

.freshman-notice-heading h2 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 20px;
  line-height: 1.35;
}

.freshman-notice-heading p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.freshman-notice-icon {
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: #fff;
  background: linear-gradient(145deg, var(--cpu-primary), #2a7468);
  font-size: 20px;
  font-weight: 800;
}

.freshman-notice-body {
  color: var(--cpu-text-secondary);
  font-size: 15px;
  line-height: 1.75;
}

.freshman-notice-body > p {
  margin: 0 0 13px;
}

.freshman-notice-emphasis {
  color: var(--cpu-text);
  font-weight: 600;
}

.freshman-group-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 18px;
  padding: 16px 18px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 24%, var(--cpu-border));
  border-radius: 14px;
  background: color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-card));
}

.freshman-group-card span {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.freshman-group-card strong {
  display: block;
  margin-top: 1px;
  color: var(--cpu-primary);
  font-size: 23px;
  letter-spacing: 1px;
}

.freshman-group-card p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.freshman-copy-button {
  flex: 0 0 auto;
  border: 1px solid var(--cpu-border);
  border-radius: 9px;
  padding: 9px 12px;
  color: var(--cpu-primary);
  background: var(--cpu-card);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.freshman-copy-button:hover {
  border-color: var(--cpu-primary);
}

.freshman-copy-button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.freshman-notice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 640px) {
  :global(.freshman-notice-dialog .el-dialog__header) {
    padding: 20px 18px 16px;
  }

  :global(.freshman-notice-dialog .el-dialog__body) {
    padding: 18px 18px 8px;
  }

  :global(.freshman-notice-dialog .el-dialog__footer) {
    padding: 14px 18px 20px;
  }

  .freshman-notice-heading h2 {
    font-size: 18px;
  }

  .freshman-notice-icon {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    font-size: 18px;
  }

  .freshman-group-card {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
  }

  .freshman-copy-button {
    width: 100%;
  }

  .freshman-notice-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .freshman-notice-actions :deep(.el-button) {
    width: 100%;
    margin: 0;
  }
}
</style>
