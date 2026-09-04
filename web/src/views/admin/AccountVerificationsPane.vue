<template>
  <section class="verification-admin">
    <header class="pane-head">
      <div>
        <h2>组织认证</h2>
        <p>核验账号与校内组织的实际关系。认证仅说明账号归属，不代表学校官方立场。</p>
      </div>
      <span v-if="pendingCount" class="pending-count">{{ pendingCount }} 条待审核</span>
    </header>

    <div class="toolbar">
      <el-segmented v-model="status" :options="statusOptions" @change="resetAndLoad" />
      <el-input v-model="q" clearable placeholder="搜索账号、昵称或认证名称" @keyup.enter="resetAndLoad">
        <template #append><el-button @click="resetAndLoad">搜索</el-button></template>
      </el-input>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-empty v-if="!loading && !items.length" description="暂无符合条件的认证申请" />
    <div v-else class="application-list" v-loading="loading">
      <article v-for="item in items" :key="item.id" class="application-card" :class="{ highlighted: highlightedId === item.id }">
        <header class="application-head">
          <div class="applicant" role="button" tabindex="0" @click="openUser(item.user?.id)" @keydown.enter="openUser(item.user?.id)">
            <UserAvatar :size="42" :src="item.user?.avatar" :name="item.user?.nickname" :seed="item.user?.id" alt="申请人头像" />
            <div>
              <b>{{ item.user?.nickname || "未知用户" }}</b>
              <span>@{{ item.user?.username }} · 用户 #{{ item.userId }}</span>
            </div>
          </div>
          <div class="head-status">
            <el-tag v-if="item.user?.studentSso" size="small" type="primary" effect="plain">统一认证账号</el-tag>
            <span class="status-pill" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span>
          </div>
        </header>

        <dl class="application-detail">
          <div><dt>申请认证</dt><dd><strong>{{ item.requestedLabel }}</strong></dd></div>
          <div><dt>组织与账号关系</dt><dd>{{ item.identityDescription }}</dd></div>
          <div><dt>可核验信息</dt><dd class="preserve-lines">{{ item.evidence }}</dd></div>
          <div v-if="item.contact"><dt>联系方式</dt><dd>{{ item.contact }}</dd></div>
          <div><dt>提交时间</dt><dd>{{ fmtDate(item.createdAt) }}</dd></div>
          <div v-if="item.approvedLabel"><dt>生效说明</dt><dd>{{ item.approvedLabel }}</dd></div>
          <div v-if="item.reviewNote"><dt>审核记录</dt><dd>{{ item.reviewNote }}<span v-if="item.reviewer"> · {{ item.reviewer.nickname }}</span></dd></div>
        </dl>

        <footer class="application-actions">
          <template v-if="item.status === 'pending'">
            <el-button type="success" :loading="busyId === item.id" :disabled="busyId !== null" @click="openApprove(item)">核验通过</el-button>
            <el-button type="danger" plain :loading="busyId === item.id" :disabled="busyId !== null" @click="reject(item)">暂不通过</el-button>
          </template>
          <el-button v-else-if="item.status === 'approved' && item.user?.currentVerification?.label === item.approvedLabel" type="danger" plain :loading="busyId === item.id" :disabled="busyId !== null" @click="revoke(item)">撤销当前认证</el-button>
          <el-button text @click="openUser(item.user?.id)">查看用户主页</el-button>
        </footer>
      </article>
    </div>

    <el-pagination
      v-if="total > size"
      v-model:current-page="page"
      :page-size="size"
      :total="total"
      layout="prev, pager, next"
      @current-change="load"
    />

    <el-dialog v-model="approveOpen" title="核验通过" width="520" :close-on-click-modal="false">
      <el-form v-if="approvingItem" label-position="top">
        <el-form-item label="公开认证说明" required>
          <el-input v-model="approveForm.approvedLabel" maxlength="30" show-word-limit />
          <p class="dialog-help">论坛昵称旁显示蓝色认证标记，完整说明在悬停提示和用户主页中展示。</p>
        </el-form-item>
        <el-form-item label="有效期（选填）">
          <el-date-picker v-model="approveForm.expiresAt" type="date" value-format="YYYY-MM-DD" placeholder="长期有效" :disabled-date="disablePastDate" />
        </el-form-item>
        <el-form-item label="内部审核备注（选填）">
          <el-input v-model="approveForm.reviewNote" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="记录核验渠道或依据" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="busyId !== null" @click="approveOpen = false">取消</el-button>
        <el-button type="primary" :loading="busyId !== null" :disabled="approveForm.approvedLabel.trim().length < 2" @click="approve">确认并展示认证</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import UserAvatar from "@/components/common/UserAvatar.vue";
import {
  accountVerificationApi,
  type AccountVerificationApplication,
  type AccountVerificationStatus,
} from "@/api/accountVerification";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const statusOptions = [
  { label: "待审核", value: "pending" },
  { label: "已通过", value: "approved" },
  { label: "未通过", value: "rejected" },
  { label: "全部", value: "all" },
];
const status = ref<AccountVerificationStatus | "all">("pending");
const q = ref("");
const page = ref(1);
const size = 30;
const total = ref(0);
const pendingCount = ref(0);
const loading = ref(false);
const busyId = ref<number | null>(null);
const items = ref<AccountVerificationApplication[]>([]);
const highlightedId = Number(route.query.application || 0);
const approveOpen = ref(false);
const approvingItem = ref<AccountVerificationApplication | null>(null);
const approveForm = reactive({ approvedLabel: "", reviewNote: "", expiresAt: "" });

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const result = await accountVerificationApi.adminList({ status: status.value, q: q.value.trim(), page: page.value, size }, { suppressErrorMessage: true });
    items.value = result.list;
    total.value = result.total;
    pendingCount.value = result.pending;
  } catch (error) {
    ElMessage.error(requestMessage(error) || "认证申请加载失败");
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  void load();
}

function openApprove(item: AccountVerificationApplication) {
  approvingItem.value = item;
  approveForm.approvedLabel = item.requestedLabel;
  approveForm.reviewNote = "";
  approveForm.expiresAt = "";
  approveOpen.value = true;
}

async function approve() {
  const item = approvingItem.value;
  const approvedLabel = approveForm.approvedLabel.trim();
  if (!item || approvedLabel.length < 2 || busyId.value !== null) return;
  busyId.value = item.id;
  try {
    await accountVerificationApi.review(item.id, {
      action: "approve",
      approvedLabel,
      reviewNote: approveForm.reviewNote.trim(),
      expiresAt: approveForm.expiresAt || null,
    });
    approveOpen.value = false;
    ElMessage.success("组织认证已生效");
    await load();
  } finally {
    busyId.value = null;
  }
}

async function reject(item: AccountVerificationApplication) {
  if (busyId.value !== null) return;
  const result = await ElMessageBox.prompt("请写明可操作的未通过原因，用户会在站内通知和申请记录中看到。", "暂不通过", {
    confirmButtonText: "确认并通知用户",
    cancelButtonText: "取消",
    inputType: "textarea",
    inputPlaceholder: "例如：暂未找到能够证明账号由该组织授权运营的公开信息",
    inputValidator: (value) => value.trim().length >= 2 || "请填写未通过原因",
  }).catch(() => null);
  const reviewNote = result?.value?.trim();
  if (!reviewNote) return;
  busyId.value = item.id;
  try {
    await accountVerificationApi.review(item.id, { action: "reject", reviewNote });
    ElMessage.success("已通知申请人");
    await load();
  } finally {
    busyId.value = null;
  }
}

async function revoke(item: AccountVerificationApplication) {
  if (busyId.value !== null) return;
  const result = await ElMessageBox.prompt("撤销后蓝色认证标记会立即消失。请填写撤销原因，用户会收到通知。", "撤销组织认证", {
    confirmButtonText: "确认撤销",
    cancelButtonText: "取消",
    type: "warning",
    inputType: "textarea",
    inputPlaceholder: "例如：账号已不再由该组织授权运营",
    inputValidator: (value) => value.trim().length >= 2 || "请填写撤销原因",
  }).catch(() => null);
  const reason = result?.value?.trim();
  if (!reason) return;
  busyId.value = item.id;
  try {
    await accountVerificationApi.revoke(item.id, reason);
    ElMessage.success("认证已撤销并通知用户");
    await load();
  } finally {
    busyId.value = null;
  }
}

function openUser(id?: number) {
  if (id) router.push(`/u/${id}`);
}

function disablePastDate(date: Date) {
  return date.getTime() < new Date().setHours(0, 0, 0, 0) + 24 * 60 * 60 * 1000;
}

function statusLabel(value: AccountVerificationStatus) {
  return ({ pending: "待审核", approved: "已通过", rejected: "未通过", withdrawn: "用户解除", revoked: "已撤销", superseded: "已更新" } satisfies Record<AccountVerificationStatus, string>)[value];
}

function requestMessage(error: unknown) {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === "string" ? message : error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.verification-admin { display: flex; flex-direction: column; gap: 14px; }
.pane-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.pane-head h2 { margin: 0; color: var(--cpu-text); font-size: 20px; }
.pane-head p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.pending-count { flex: 0 0 auto; padding: 5px 10px; border-radius: 999px; background: color-mix(in srgb, #f59e0b 12%, var(--cpu-card)); color: #b45309; font-size: 11px; font-weight: 700; }
.toolbar { display: grid; grid-template-columns: auto minmax(240px, 440px) auto; align-items: center; gap: 10px; }
.application-list { display: grid; gap: 11px; min-height: 120px; }
.application-card { padding: 14px 15px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
.application-card.highlighted { border-color: #1d9bf0; box-shadow: 0 0 0 2px rgba(29, 155, 240, .1); }
.application-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.applicant { display: flex; min-width: 0; align-items: center; gap: 10px; cursor: pointer; }
.applicant > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.applicant b { overflow: hidden; color: var(--cpu-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.applicant span { color: var(--cpu-text-muted); font-size: 10px; }
.head-status { display: flex; align-items: center; gap: 6px; }
.status-pill { padding: 3px 8px; border-radius: 999px; background: var(--cpu-surface-soft); color: var(--cpu-text-muted); font-size: 10px; font-weight: 700; white-space: nowrap; }
.status-pill.is-pending { background: color-mix(in srgb, #f59e0b 12%, var(--cpu-card)); color: #b45309; }
.status-pill.is-approved { background: color-mix(in srgb, #1d9bf0 10%, var(--cpu-card)); color: #0969da; }
.status-pill.is-rejected, .status-pill.is-revoked { background: color-mix(in srgb, #ef4444 10%, var(--cpu-card)); color: #dc2626; }
.application-detail { display: grid; gap: 7px; margin: 13px 0 0; }
.application-detail div { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 10px; padding: 8px 10px; border-radius: 8px; background: var(--cpu-surface-soft); }
.application-detail dt { color: var(--cpu-text-muted); font-size: 11px; }
.application-detail dd { margin: 0; color: var(--cpu-text); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.preserve-lines { white-space: pre-wrap; }
.application-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 12px; }
.application-actions :deep(.el-button + .el-button) { margin-left: 0; }
.dialog-help { width: 100%; margin: 5px 0 0; color: var(--cpu-text-muted); font-size: 11px; line-height: 1.5; }

@media (max-width: 720px) {
  .pane-head { flex-direction: column; gap: 8px; }
  .toolbar { grid-template-columns: 1fr auto; }
  .toolbar :deep(.el-segmented) { grid-column: 1 / -1; max-width: 100%; overflow-x: auto; }
  .application-card { padding: 12px 10px; }
  .application-head { align-items: flex-start; }
  .head-status { align-items: flex-end; flex-direction: column; }
  .application-detail div { grid-template-columns: 82px minmax(0, 1fr); padding: 8px; }
  .application-actions { justify-content: stretch; flex-wrap: wrap; }
  .application-actions :deep(.el-button) { flex: 1 1 120px; }
}
</style>
