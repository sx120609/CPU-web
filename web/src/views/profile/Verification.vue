<template>
  <main class="verification-page" v-loading="loading && !snapshot">
    <header class="page-bar">
      <button type="button" class="back-link" @click="router.push('/profile')">
        <el-icon><ArrowLeft /></el-icon><span>个人中心</span>
      </button>
      <span>拾间认证</span>
      <span class="bar-placeholder" aria-hidden="true"></span>
    </header>

    <section class="verification-hero">
      <div class="hero-mark" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <path d="M10 1.25 12.1 2.5l2.43-.13 1.1 2.17 2.17 1.1-.13 2.43L18.75 10l-1.08 1.93.13 2.43-2.17 1.1-1.1 2.17-2.43-.13L10 18.75 7.9 17.5l-2.43.13-1.1-2.17-2.17-1.1.13-2.43L1.25 10l1.08-1.93-.13-2.43 2.17-1.1 1.1-2.17 2.43.13L10 1.25Z" />
          <path class="hero-check" d="m6.15 10.15 2.35 2.3 5.3-5.25" />
        </svg>
      </div>
      <div>
        <p class="eyebrow">药大拾间 · 拾间认证</p>
        <h1>让同学确认账号背后的真实身份</h1>
        <p>面向具有可核验身份的个人，以及校内社团、学生组织、学院或部门账号。通过后，昵称旁会展示蓝色认证标记，完整说明可在个人主页查看。</p>
      </div>
    </section>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
    >
      <template #default><el-button size="small" @click="load">重新加载</el-button></template>
    </el-alert>

    <section v-if="snapshot?.verification" class="home-card active-card">
      <div class="card-heading">
        <div>
          <span class="section-kicker">当前认证</span>
          <h2>拾间认证已生效</h2>
        </div>
        <span class="status-pill is-approved">已认证</span>
      </div>
      <div class="verified-preview">
        <UserAvatar :size="44" :src="auth.user?.avatar" :name="auth.user?.nickname" :seed="auth.user?.id" alt="我的头像" />
        <div>
          <div class="preview-name">
            <strong>{{ auth.user?.nickname }}</strong>
            <UserVerificationBadge :verification="snapshot.verification" />
          </div>
          <strong class="verified-label">{{ snapshot.verification.categoryLabel || verificationTypeLabel(snapshot.verification.type) }} · {{ snapshot.verification.label }}</strong>
          <p>认证于 {{ fmtDate(snapshot.verification.verifiedAt, "YYYY-MM-DD") }}<template v-if="snapshot.verification.expiresAt"> · 有效至 {{ fmtDate(snapshot.verification.expiresAt, "YYYY-MM-DD") }}</template></p>
        </div>
      </div>
      <p class="trust-note">认证标记仅表示该账号与所标注个人身份或组织关系已经平台核验，不代表学校官方立场，也不代表平台为其发布内容背书。</p>
      <div class="card-actions">
        <el-button type="primary" plain :disabled="snapshot.submission.hasPending" @click="showForm = true">申请更新说明</el-button>
        <el-button type="danger" text :loading="removing" @click="removeVerification">解除认证</el-button>
      </div>
    </section>

    <section v-if="latestApplication" class="home-card application-state">
      <div class="card-heading">
        <div>
          <span class="section-kicker">{{ latestApplication.source === "admin_grant" ? "认证记录" : "最近申请" }}</span>
          <h2>{{ statusTitle(latestApplication.status, latestApplication.source) }}</h2>
        </div>
        <span class="status-pill" :class="`is-${latestApplication.status}`">{{ statusLabel(latestApplication.status) }}</span>
      </div>
      <dl class="application-summary">
        <div><dt>认证类型</dt><dd>{{ verificationTypeLabel(latestApplication.type) }}</dd></div>
        <div><dt>{{ latestApplication.source === "admin_grant" ? "认证说明" : "申请认证" }}</dt><dd>{{ latestApplication.requestedLabel }}</dd></div>
        <div><dt>{{ latestApplication.source === "admin_grant" ? "授予时间" : "提交时间" }}</dt><dd>{{ fmtDate(latestApplication.createdAt) }}</dd></div>
        <div v-if="latestApplication.reviewNote"><dt>审核说明</dt><dd>{{ latestApplication.reviewNote }}</dd></div>
      </dl>
      <p v-if="latestApplication.status === 'pending'" class="state-tip">审核结果会通过站内通知送达。需要补充信息时，管理员会按照你留下的联系方式核验。</p>
      <el-button v-else-if="!snapshot?.verification" type="primary" plain @click="showForm = true">重新申请</el-button>
    </section>

    <section v-if="canShowForm" class="home-card form-card">
      <div class="card-heading">
        <div>
          <span class="section-kicker">提交申请</span>
          <h2>{{ snapshot?.verification ? "更新拾间认证" : "申请拾间认证" }}</h2>
        </div>
        <span class="quota">30 天内还可提交 {{ snapshot?.submission.remaining ?? 3 }} 次</span>
      </div>

      <div class="form-intro">
        <span class="form-intro-icon"><AppIcon name="school" /></span>
        <div><b>个人与组织账号均可申请</b><p>支持可核验的个人身份、校园角色或创作者身份，也支持校内社团、学生组织、学院及部门账号。</p></div>
      </div>

      <el-form label-position="top" class="verification-form" @submit.prevent>
        <el-form-item label="认证类型" required>
          <el-radio-group v-model="form.type">
            <el-radio-button value="individual">个人认证</el-radio-button>
            <el-radio-button value="campus_organization">组织账号</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="认证名称" required>
          <el-input
            v-model="form.requestedLabel"
            maxlength="30"
            show-word-limit
            :placeholder="form.type === 'individual' ? '例如：校园摄影创作者' : '例如：中国药科大学轮滑协会'"
          />
          <p class="field-help">审核通过后，昵称旁显示蓝色认证标记；这段完整说明会显示在悬停提示和个人主页，管理员可按核验结果校正。</p>
        </el-form-item>
        <el-form-item :label="form.type === 'individual' ? '个人身份说明' : '组织与账号的关系'" required>
          <el-input
            v-model="form.identityDescription"
            type="textarea"
            :rows="4"
            maxlength="500"
            show-word-limit
            :placeholder="form.type === 'individual' ? '说明需要认证的个人身份、校园角色或公开经历' : '说明组织性质、你的运营职责，以及为什么由这个账号代表该组织'"
          />
        </el-form-item>
        <el-form-item label="可核验信息" required>
          <el-input
            v-model="form.evidence"
            type="textarea"
            :rows="5"
            maxlength="1200"
            show-word-limit
            :placeholder="form.type === 'individual' ? '可填写公开主页、作品、任职公示、活动报道或其他核验方式' : '可填写官方公众号文章、组织公示页面、指导老师或上级组织的核验方式等'"
          />
          <p class="field-help is-important">请勿提交身份证、学生证照片、密码或其他敏感证件。确需进一步核验时，管理员会另行联系。</p>
        </el-form-item>
        <el-form-item label="核验联系方式（选填）">
          <el-input v-model="form.contact" maxlength="120" placeholder="例如：邮箱、QQ 或微信；仅管理员可见" />
        </el-form-item>
        <label class="truth-check">
          <input v-model="form.acknowledged" type="checkbox" />
          <span>我确认所填个人身份或组织关系真实，并同意平台在必要时联系核验。冒用身份可能导致认证撤销和账号处罚。</span>
        </label>
        <el-button class="submit-button" type="primary" size="large" :loading="submitting" :disabled="!canSubmit" @click="submitApplication">
          提交认证申请
        </el-button>
      </el-form>
    </section>

    <section class="home-card process-card">
      <div class="card-heading"><div><span class="section-kicker">认证流程</span><h2>三步完成核验</h2></div></div>
      <ol class="process-list">
        <li><span>1</span><div><b>填写公开说明</b><p>认证名称由申请人填写，最终以审核通过内容为准。</p></div></li>
        <li><span>2</span><div><b>管理员核验</b><p>结合公开资料、作品、组织渠道或联系人确认账号身份。</p></div></li>
        <li><span>3</span><div><b>展示认证标记</b><p>结果通过站内通知送达，论坛和个人主页同步显示。</p></div></li>
      </ol>
    </section>

    <section v-if="history.length > 1" class="home-card history-card">
      <div class="card-heading"><div><span class="section-kicker">申请记录</span><h2>历史记录</h2></div></div>
      <div v-for="item in history.slice(1)" :key="item.id" class="history-row">
        <div><b>{{ item.requestedLabel }}</b><span>{{ item.source === "admin_grant" ? "管理员授予 · " : "" }}{{ fmtDate(item.createdAt) }}</span></div>
        <span class="status-pill" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AppIcon from "@/components/common/AppIcon.vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import UserVerificationBadge from "@/components/common/UserVerificationBadge.vue";
import {
  accountVerificationApi,
  type AccountVerificationApplication,
  type AccountVerificationSource,
  type AccountVerificationMe,
  type AccountVerificationStatus,
  type AccountVerificationType,
} from "@/api/accountVerification";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const submitting = ref(false);
const removing = ref(false);
const showForm = ref(false);
const snapshot = ref<AccountVerificationMe | null>(null);
const form = reactive({
  type: "individual" as AccountVerificationType,
  requestedLabel: "",
  identityDescription: "",
  evidence: "",
  contact: "",
  acknowledged: false,
});

const previewMode = import.meta.env.DEV && route.query.preview === "organization-verification";
const history = computed(() => snapshot.value?.applications || []);
const latestApplication = computed(() => history.value[0] || null);
const canShowForm = computed(() => Boolean(snapshot.value)
  && !snapshot.value!.submission.hasPending
  && (!snapshot.value!.verification || showForm.value || latestApplication.value?.status !== "approved"));
const canSubmit = computed(() => form.requestedLabel.trim().length >= 2
  && form.identityDescription.trim().length >= 10
  && form.evidence.trim().length >= 10
  && form.acknowledged
  && (snapshot.value?.submission.remaining ?? 0) > 0
  && !snapshot.value?.submission.hasPending);

onMounted(load);

async function load() {
  if (previewMode) {
    snapshot.value = {
      verification: null,
      applications: [],
      submission: { limit: 3, used: 0, remaining: 3, hasPending: false },
    };
    return;
  }
  loading.value = true;
  loadError.value = "";
  try {
    snapshot.value = await accountVerificationApi.me({ suppressErrorMessage: true });
  } catch (error) {
    loadError.value = requestMessage(error) || "认证信息加载失败，请稍后再试";
  } finally {
    loading.value = false;
  }
}

async function submitApplication() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    await accountVerificationApi.apply({
      type: form.type,
      requestedLabel: form.requestedLabel.trim(),
      identityDescription: form.identityDescription.trim(),
      evidence: form.evidence.trim(),
      contact: form.contact.trim(),
      acknowledged: true,
    });
    ElMessage.success("认证申请已提交，结果会通过站内通知送达");
    form.requestedLabel = "";
    form.identityDescription = "";
    form.evidence = "";
    form.contact = "";
    form.acknowledged = false;
    showForm.value = false;
    await load();
  } finally {
    submitting.value = false;
  }
}

async function removeVerification() {
  if (!snapshot.value?.verification || removing.value) return;
  const confirmed = await ElMessageBox.confirm(
    "解除后，论坛和个人主页将立即不再显示认证标记。之后仍可重新申请，确认解除当前拾间认证？",
    "解除拾间认证",
    { confirmButtonText: "确认解除", cancelButtonText: "取消", type: "warning" },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  removing.value = true;
  try {
    await accountVerificationApi.remove();
    await auth.fetchMe();
    await load();
    ElMessage.success("拾间认证已解除");
  } finally {
    removing.value = false;
  }
}

function statusLabel(status: AccountVerificationStatus) {
  return ({
    pending: "审核中",
    approved: "已通过",
    rejected: "未通过",
    withdrawn: "已解除",
    revoked: "已撤销",
    superseded: "已更新",
  } satisfies Record<AccountVerificationStatus, string>)[status];
}

function statusTitle(status: AccountVerificationStatus, source: AccountVerificationSource = "user_application") {
  if (source === "admin_grant" && status === "approved") return "管理员已授予拾间认证";
  if (status === "pending") return "申请正在核验";
  if (status === "approved") return "认证申请已通过";
  if (status === "rejected") return "申请暂未通过";
  if (status === "revoked") return "认证已被撤销";
  if (status === "superseded") return "认证说明已更新";
  return "认证已解除";
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
.verification-page { display: flex; max-width: 860px; margin: 0 auto; flex-direction: column; gap: 13px; }
.page-bar { display: flex; align-items: center; justify-content: space-between; min-height: 36px; color: var(--cpu-text); font-size: 14px; font-weight: 750; }
.back-link { display: inline-flex; align-items: center; gap: 5px; padding: 5px 0; border: 0; background: transparent; color: var(--cpu-primary); font: inherit; font-weight: 650; cursor: pointer; }
.bar-placeholder { width: 72px; }
.verification-hero { display: flex; align-items: center; gap: 18px; padding: 24px; border: 1px solid color-mix(in srgb, #0f7bff 22%, var(--cpu-border-soft)); border-radius: 16px; background: linear-gradient(135deg, color-mix(in srgb, #0f7bff 9%, var(--cpu-card)), var(--cpu-card) 58%); box-shadow: var(--cpu-shadow-sm); }
.hero-mark { display: grid; width: 62px; height: 62px; flex: 0 0 62px; place-items: center; border-radius: 50%; background: color-mix(in srgb, #1d9bf0 10%, var(--cpu-card)); color: #1d9bf0; }
.hero-mark svg { width: 40px; height: 40px; fill: currentColor; }
.hero-check { fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.eyebrow, .section-kicker { display: block; margin: 0 0 4px; color: #0969da; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
.verification-hero h1 { margin: 0; color: var(--cpu-text); font-size: 24px; }
.verification-hero p:last-child { max-width: 640px; margin: 8px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.7; }
.home-card { padding: 18px 20px; border: 1px solid var(--cpu-border-soft); border-radius: 15px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.card-heading h2 { margin: 0; color: var(--cpu-text); font-size: 18px; }
.status-pill, .quota { flex: 0 0 auto; padding: 4px 9px; border-radius: 999px; background: var(--cpu-surface-soft); color: var(--cpu-text-muted); font-size: 11px; font-weight: 700; }
.status-pill.is-pending { background: color-mix(in srgb, #f59e0b 12%, var(--cpu-card)); color: #b45309; }
.status-pill.is-approved { background: color-mix(in srgb, #0f7bff 11%, var(--cpu-card)); color: #0969da; }
.status-pill.is-rejected, .status-pill.is-revoked { background: color-mix(in srgb, #ef4444 10%, var(--cpu-card)); color: #dc2626; }
.verified-preview { display: flex; align-items: center; gap: 12px; padding: 13px; border-radius: 12px; background: var(--cpu-surface-soft); }
.preview-name { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 6px; }
.verified-preview p { margin: 4px 0 0; color: var(--cpu-text-muted); font-size: 11px; }
.verified-label { display: block; margin-top: 3px; color: #0969da; font-size: 12px; }
.trust-note, .state-tip { margin: 12px 0 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.65; }
.card-actions { display: flex; gap: 8px; margin-top: 14px; }
.application-summary { display: grid; gap: 8px; margin: 0 0 12px; }
.application-summary div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; padding: 9px 10px; border-radius: 9px; background: var(--cpu-surface-soft); }
.application-summary dt { color: var(--cpu-text-muted); font-size: 12px; }
.application-summary dd { margin: 0; color: var(--cpu-text); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.form-intro { display: flex; gap: 10px; margin-bottom: 17px; padding: 12px; border-radius: 11px; background: color-mix(in srgb, #0f7bff 7%, var(--cpu-card)); }
.form-intro-icon { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; border-radius: 9px; background: #0f7bff; color: #fff; }
.form-intro b { color: var(--cpu-text); font-size: 13px; }
.form-intro p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: 11px; line-height: 1.55; }
.verification-form { max-width: 680px; }
.verification-form :deep(.el-form-item) { margin-bottom: 19px; }
.verification-form :deep(.el-form-item__label) { padding-bottom: 6px; color: var(--cpu-text); font-weight: 700; }
.verification-form :deep(.el-input__wrapper), .verification-form :deep(.el-textarea__inner) { border-radius: 9px; box-shadow: 0 0 0 1px var(--cpu-border-soft) inset; }
.field-help { width: 100%; margin: 6px 2px 0; color: var(--cpu-text-muted); font-size: 11px; line-height: 1.5; }
.field-help.is-important { color: #b45309; }
.truth-check { display: flex; align-items: flex-start; gap: 9px; margin: 3px 0 18px; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.6; cursor: pointer; }
.truth-check input { width: 17px; height: 17px; flex: 0 0 auto; margin-top: 1px; accent-color: var(--cpu-primary); }
.submit-button { min-width: 180px; border-radius: 9px; }
.process-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.process-list li { display: flex; gap: 9px; padding: 12px; border-radius: 11px; background: var(--cpu-surface-soft); }
.process-list li > span { display: grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; border-radius: 50%; background: #0f7bff; color: #fff; font-size: 11px; font-weight: 800; }
.process-list b { color: var(--cpu-text); font-size: 12px; }
.process-list p { margin: 4px 0 0; color: var(--cpu-text-muted); font-size: 11px; line-height: 1.55; }
.history-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--cpu-border-soft); }
.history-row div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.history-row b { overflow: hidden; color: var(--cpu-text); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.history-row div span { color: var(--cpu-text-muted); font-size: 10px; }

@media (max-width: 640px) {
  .verification-page { gap: 10px; }
  .page-bar { position: sticky; z-index: 3; top: 0; margin: -7px -2px 0; padding: 7px 2px 5px; background: color-mix(in srgb, var(--cpu-bg) 92%, transparent); backdrop-filter: blur(12px); }
  .back-link span { display: none; }
  .bar-placeholder { width: 24px; }
  .verification-hero { align-items: flex-start; gap: 12px; padding: 17px 14px; border-radius: 13px; }
  .hero-mark { width: 46px; height: 46px; flex-basis: 46px; font-size: 21px; }
  .verification-hero h1 { font-size: 19px; line-height: 1.35; }
  .verification-hero p:last-child { margin-top: 6px; font-size: 11px; line-height: 1.6; }
  .home-card { padding: 14px 12px; border-radius: 12px; box-shadow: none; }
  .card-heading { margin-bottom: 11px; }
  .card-heading h2 { font-size: 16px; }
  .quota { max-width: 120px; padding: 3px 7px; font-size: 9px; text-align: right; }
  .application-summary div { grid-template-columns: 72px minmax(0, 1fr); }
  .verification-form { max-width: none; }
  .verification-form :deep(.el-form-item) { margin-bottom: 17px; }
  .submit-button { width: 100%; min-height: 44px; }
  .process-list { grid-template-columns: 1fr; gap: 7px; }
  .card-actions { display: grid; grid-template-columns: 1fr auto; }
}
</style>
