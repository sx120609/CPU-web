<template>
  <section class="verification-admin">
    <header class="pane-head">
      <div>
        <h2>拾间认证</h2>
        <p>核验个人身份或账号与校内组织的实际关系。认证仅说明身份归属，不代表学校官方立场。</p>
      </div>
      <div class="pane-actions">
        <span v-if="pendingCount" class="pending-count">{{ pendingCount }} 条待审核</span>
        <el-button v-if="auth.isAdmin" type="primary" @click="openGrant">主动认证</el-button>
      </div>
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
            <el-tag v-if="item.source === 'admin_grant'" size="small" type="primary" effect="dark">管理员授予</el-tag>
            <el-tag v-if="item.user?.studentSso" size="small" type="primary" effect="plain">统一认证账号</el-tag>
            <span class="status-pill" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span>
          </div>
        </header>

        <dl class="application-detail">
          <div><dt>认证类型</dt><dd>{{ verificationTypeLabel(item.type) }}</dd></div>
          <div><dt>{{ item.source === "admin_grant" ? "认证说明" : "申请认证" }}</dt><dd><strong>{{ item.requestedLabel }}</strong></dd></div>
          <template v-if="item.source !== 'admin_grant'">
            <div><dt>{{ item.type === "individual" ? "个人身份说明" : "组织与账号关系" }}</dt><dd>{{ item.identityDescription }}</dd></div>
            <div><dt>可核验信息</dt><dd class="preserve-lines">{{ item.evidence }}</dd></div>
            <div v-if="item.contact"><dt>联系方式</dt><dd>{{ item.contact }}</dd></div>
          </template>
          <div v-else><dt>授予方式</dt><dd>站点管理员主动认证，无需用户先提交申请</dd></div>
          <div><dt>{{ item.source === "admin_grant" ? "授予时间" : "提交时间" }}</dt><dd>{{ fmtDate(item.createdAt) }}</dd></div>
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
        <el-form-item label="认证类型">
          <el-tag type="primary" effect="plain">{{ verificationTypeLabel(approvingItem.type) }}</el-tag>
        </el-form-item>
        <el-form-item label="公开认证说明" required>
          <el-input v-model="approveForm.approvedLabel" maxlength="30" show-word-limit />
          <p class="dialog-help">论坛昵称旁显示蓝色认证标记，完整说明在悬停提示和用户主页中展示。</p>
        </el-form-item>
        <el-form-item label="有效期（选填）">
          <el-date-picker v-model="approveForm.expiresAt" type="date" value-format="YYYY-MM-DD" placeholder="长期有效" :disabled-date="disablePastDate" />
        </el-form-item>
        <el-form-item label="审核备注（用户可见，选填）">
          <el-input v-model="approveForm.reviewNote" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="记录核验渠道或依据" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="busyId !== null" @click="approveOpen = false">取消</el-button>
        <el-button type="primary" :loading="busyId !== null" :disabled="approveForm.approvedLabel.trim().length < 2" @click="approve">确认并展示认证</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="grantOpen" title="主动添加拾间认证" width="min(560px, calc(100vw - 24px))" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" show-icon title="无需用户先申请；仅站点管理员可操作，授予过程会写入审核记录并通知用户。" />
      <div class="candidate-search">
        <el-input v-model="candidateQuery" clearable placeholder="搜索账号/学号、昵称或用户 ID" @keyup.enter="searchCandidates">
          <template #append><el-button :loading="candidateSearching" @click="searchCandidates">搜索</el-button></template>
        </el-input>
      </div>
      <div v-if="candidates.length" class="candidate-list">
        <button
          v-for="candidate in candidates"
          :key="candidate.id"
          type="button"
          class="candidate-row"
          :class="{ selected: selectedCandidate?.id === candidate.id }"
          @click="selectCandidate(candidate)"
        >
          <UserAvatar :size="38" :src="candidate.avatar" :name="candidate.nickname" :seed="candidate.id" alt="用户头像" />
          <span class="candidate-copy">
            <b>{{ candidate.nickname }}</b>
            <small>@{{ candidate.username }} · 用户 #{{ candidate.id }}<template v-if="candidate.college"> · {{ candidate.college }}</template></small>
          </span>
          <span v-if="candidate.currentVerification" class="candidate-current">已认证</span>
        </button>
      </div>
      <el-empty v-else-if="candidateSearched && !candidateSearching" :image-size="54" description="没有找到可认证的账号" />

      <el-form class="grant-form" label-position="top">
        <el-form-item label="认证类型" required>
          <el-radio-group v-model="grantForm.type">
            <el-radio-button value="individual">个人认证</el-radio-button>
            <el-radio-button value="campus_organization">组织账号</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="公开认证说明" required>
          <el-input v-model="grantForm.approvedLabel" maxlength="30" show-word-limit :placeholder="grantForm.type === 'individual' ? '例如：校园摄影创作者' : '例如：中国药科大学轮滑协会'" />
          <p class="dialog-help">昵称旁显示 X 式蓝色认证勾，完整说明显示在悬停提示和个人主页。</p>
        </el-form-item>
        <el-form-item label="核验依据（用户可见）" required>
          <el-input v-model="grantForm.reviewNote" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="记录核验该个人身份或组织关系的依据" />
        </el-form-item>
        <el-form-item label="有效期（选填）">
          <el-date-picker v-model="grantForm.expiresAt" type="date" value-format="YYYY-MM-DD" placeholder="长期有效" :disabled-date="disablePastDate" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="grantBusy" @click="grantOpen = false">取消</el-button>
        <el-button type="primary" :loading="grantBusy" :disabled="!canGrant" @click="grantDirectly">确认主动认证</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { useAuthStore } from "@/stores/auth";
import {
  accountVerificationApi,
  type AccountVerificationApplication,
  type AccountVerificationCandidate,
  type AccountVerificationStatus,
  type AccountVerificationType,
} from "@/api/accountVerification";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
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
const grantOpen = ref(false);
const grantBusy = ref(false);
const candidateQuery = ref("");
const candidateSearching = ref(false);
const candidateSearched = ref(false);
const candidates = ref<AccountVerificationCandidate[]>([]);
const selectedCandidate = ref<AccountVerificationCandidate | null>(null);
const grantForm = reactive({ type: "individual" as AccountVerificationType, approvedLabel: "", reviewNote: "", expiresAt: "" });
const canGrant = computed(() => Boolean(selectedCandidate.value)
  && grantForm.approvedLabel.trim().length >= 2
  && grantForm.reviewNote.trim().length >= 2
  && !grantBusy.value);

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

function openGrant() {
  grantOpen.value = true;
  candidateQuery.value = "";
  candidateSearched.value = false;
  candidates.value = [];
  selectedCandidate.value = null;
  grantForm.type = "individual";
  grantForm.approvedLabel = "";
  grantForm.reviewNote = "";
  grantForm.expiresAt = "";
}

async function searchCandidates() {
  const query = candidateQuery.value.trim();
  if (!query || candidateSearching.value) return;
  candidateSearching.value = true;
  candidateSearched.value = true;
  selectedCandidate.value = null;
  try {
    const result = await accountVerificationApi.adminCandidates(query, { suppressErrorMessage: true });
    candidates.value = result;
  } catch (error) {
    candidates.value = [];
    ElMessage.error(requestMessage(error) || "用户搜索失败");
  } finally {
    candidateSearching.value = false;
  }
}

function selectCandidate(candidate: AccountVerificationCandidate) {
  if (selectedCandidate.value?.id !== candidate.id) {
    grantForm.type = candidate.currentVerification?.type || "individual";
    grantForm.approvedLabel = candidate.currentVerification?.label || "";
  }
  selectedCandidate.value = candidate;
}

async function grantDirectly() {
  if (!selectedCandidate.value || !canGrant.value) return;
  grantBusy.value = true;
  try {
    await accountVerificationApi.grant({
      userId: selectedCandidate.value.id,
      type: grantForm.type,
      approvedLabel: grantForm.approvedLabel.trim(),
      reviewNote: grantForm.reviewNote.trim(),
      expiresAt: grantForm.expiresAt || null,
    });
    grantOpen.value = false;
    status.value = "approved";
    page.value = 1;
    ElMessage.success(`已为 ${selectedCandidate.value.nickname} 添加拾间认证并发送通知`);
    await load();
  } finally {
    grantBusy.value = false;
  }
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
    ElMessage.success("拾间认证已生效");
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
    inputPlaceholder: "例如：暂未找到能够核验该个人身份或组织关系的公开信息",
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
  const result = await ElMessageBox.prompt("撤销后蓝色认证标记会立即消失。请填写撤销原因，用户会收到通知。", "撤销拾间认证", {
    confirmButtonText: "确认撤销",
    cancelButtonText: "取消",
    type: "warning",
    inputType: "textarea",
    inputPlaceholder: "例如：该身份或组织关系已失效",
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

function verificationTypeLabel(value: AccountVerificationType) {
  return value === "campus_organization" ? "组织账号" : "个人认证";
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
.pane-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
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
.candidate-search { margin-top: 14px; }
.candidate-list { display: grid; max-height: 230px; gap: 7px; margin-top: 10px; overflow-y: auto; }
.candidate-row { display: flex; width: 100%; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid var(--cpu-border-soft); border-radius: 10px; background: var(--cpu-card); color: inherit; text-align: left; cursor: pointer; }
.candidate-row:hover, .candidate-row.selected { border-color: #1d9bf0; background: color-mix(in srgb, #1d9bf0 6%, var(--cpu-card)); }
.candidate-row.selected { box-shadow: 0 0 0 2px rgba(29, 155, 240, .1); }
.candidate-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.candidate-copy b, .candidate-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.candidate-copy b { color: var(--cpu-text); font-size: 13px; }
.candidate-copy small { color: var(--cpu-text-muted); font-size: 10px; }
.candidate-current { flex: 0 0 auto; color: #1d9bf0; font-size: 10px; font-weight: 700; }
.grant-form { margin-top: 15px; }
.grant-form :deep(.el-date-editor) { width: 100%; }

@media (max-width: 720px) {
  .pane-head { flex-direction: column; gap: 8px; }
  .pane-actions { width: 100%; justify-content: space-between; }
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
