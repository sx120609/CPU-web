<template>
  <div class="ai-quota-pane">
    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
      class="pane-alert"
    >
      <template #default>
        <el-button size="small" :loading="loading" @click="reload">重试</el-button>
      </template>
    </el-alert>

    <div class="overview-grid" v-loading="loading">
      <div class="overview-card">
        <span>全站可用点数</span>
        <strong>{{ overview.totalPoints }}</strong>
      </div>
      <div class="overview-card">
        <span>持有点数用户</span>
        <strong>{{ overview.holderCount }}</strong>
      </div>
      <div class="overview-card">
        <span>点数流水</span>
        <strong>{{ overview.transactionCount }}</strong>
      </div>
      <div class="overview-card accent">
        <span>赞助兑换</span>
        <strong>¥1 = {{ sponsorPointsPerYuan }} 点</strong>
      </div>
    </div>

    <section class="settings-card" v-loading="loading">
      <div class="section-head">
        <div>
          <h3>等级日额度</h3>
          <p>先消耗等级对应的每日次数；当天次数用完后，每次调用再消耗 1 个点数。每日次数按北京时间 00:00 重置，点数不会自动过期。</p>
        </div>
        <el-button type="primary" :loading="savingQuotas" :disabled="Boolean(loadError)" @click="saveQuotas">
          保存日额度
        </el-button>
      </div>

      <div class="quota-grid">
        <label v-for="tier in dailyQuotas" :key="tier.level" class="quota-item">
          <span>
            <b>Lv.{{ tier.level }}</b>
            {{ levelName(tier.level) }}
          </span>
          <el-input-number v-model="tier.quota" :min="0" :max="9999" />
          <small>次 / 天</small>
        </label>
      </div>

      <div class="danger-row">
        <div>
          <strong>重置所有人今日额度</strong>
          <span>只清零今天已经使用的等级次数，不会改动点数余额或上方额度档位。</span>
        </div>
        <el-button type="danger" plain :loading="resetting" @click="resetToday">
          重置今日额度
        </el-button>
      </div>
    </section>

    <div class="two-column">
      <section class="settings-card">
        <div class="section-head compact">
          <div>
            <h3>赞助获取点数</h3>
            <p>赞助成功时，按实际到账金额和这里的比例一次性发放。修改后只影响后续到账订单。</p>
          </div>
        </div>
        <div class="rate-form">
          <span>每赞助 ¥1 发放</span>
          <el-input-number v-model="sponsorPointsPerYuan" :min="0" :max="10000" />
          <span>点</span>
          <el-button type="primary" :loading="savingSponsorRate" @click="saveSponsorRate">保存比例</el-button>
        </div>
        <p class="tip">设为 0 即关闭赞助点数奖励。不足 1 点的计算结果向下取整。</p>
      </section>

      <section class="settings-card">
        <div class="section-head compact">
          <div>
            <h3>活动 / 人工发放</h3>
            <p>可选择一名用户，也可同时选择多名用户批量发放（单批最多 200 人）；每位用户都会收到站内通知。</p>
          </div>
        </div>
        <el-form label-position="top" class="grant-form">
          <el-form-item label="接收用户">
            <el-select
              v-model="grantUserIds"
              multiple
              filterable
              remote
              :multiple-limit="200"
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="3"
              :remote-method="searchUsers"
              :loading="usersLoading"
              placeholder="搜索用户名 / 昵称 / 邮箱，可多选"
            >
              <el-option
                v-for="user in pointUsers"
                :key="user.id"
                :value="user.id"
                :label="`${user.nickname || user.username}（${user.username}）`"
              >
                <div class="user-option">
                  <span>{{ user.nickname || user.username }} <small>@{{ user.username }}</small></span>
                  <b>{{ user.assistantPoints }} 点</b>
                </div>
              </el-option>
            </el-select>
          </el-form-item>
          <div class="grant-row">
            <el-form-item label="每人发放点数">
              <el-input-number v-model="grantPoints" :min="1" :max="1000000" />
            </el-form-item>
            <el-form-item label="发放原因">
              <el-input v-model="grantReason" maxlength="80" show-word-limit placeholder="例如：迎新活动奖励" />
            </el-form-item>
          </div>
          <el-button
            type="success"
            :loading="granting"
            :disabled="!grantUserIds.length || !grantReason.trim()"
            @click="grantPointsToUsers"
          >
            给 {{ grantUserIds.length || 0 }} 人发放
          </el-button>
        </el-form>
      </section>
    </div>

    <section class="settings-card">
      <div class="section-head">
        <div>
          <h3>最近点数流水</h3>
          <p>记录后台发放、赞助奖励、AI 消耗和失败返还，便于核对每一次余额变化。</p>
        </div>
        <el-button :loading="overviewLoading" @click="loadOverview">刷新流水</el-button>
      </div>
      <el-table :data="overview.recent" v-loading="overviewLoading" stripe>
        <el-table-column label="时间" min-width="155">
          <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="用户" min-width="170">
          <template #default="{ row }">
            <div class="user-cell">
              <b>{{ row.user?.nickname || row.user?.username || `用户 ${row.userId}` }}</b>
              <span v-if="row.user?.username">@{{ row.user.username }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="90" align="right">
          <template #default="{ row }">
            <b :class="row.delta > 0 ? 'delta-plus' : 'delta-minus'">{{ row.delta > 0 ? "+" : "" }}{{ row.delta }}</b>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="余额" width="90" align="right" />
        <el-table-column label="来源" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="sourceType(row.source)">{{ sourceLabel(row.source) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="说明" min-width="170" show-overflow-tooltip />
        <el-table-column label="操作人" min-width="140">
          <template #default="{ row }">{{ row.operator?.nickname || row.operator?.username || "系统" }}</template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adminApi,
  type AssistantPointOverview,
  type AssistantPointUser,
} from "@/api/admin";
import { fmtDate } from "@/utils/format";

const loading = ref(false);
const overviewLoading = ref(false);
const usersLoading = ref(false);
const savingQuotas = ref(false);
const savingSponsorRate = ref(false);
const resetting = ref(false);
const granting = ref(false);
const loadError = ref("");
const reputationLevels = ref<Array<{ level: number; name: string; minReputation: number }>>([]);
const dailyQuotas = ref([
  { level: 0, quota: 5 },
  { level: 1, quota: 10 },
  { level: 2, quota: 20 },
  { level: 3, quota: 30 },
  { level: 4, quota: 50 },
  { level: 5, quota: 80 },
]);
const sponsorPointsPerYuan = ref(1);
const grantUserIds = ref<number[]>([]);
const grantPoints = ref(10);
const grantReason = ref("活动奖励");
const pointUsers = ref<AssistantPointUser[]>([]);
const overview = reactive<AssistantPointOverview>({
  totalPoints: 0,
  holderCount: 0,
  transactionCount: 0,
  recent: [],
});
let userSearchSeq = 0;

onMounted(reload);

async function reload() {
  loading.value = true;
  loadError.value = "";
  try {
    const [siteConfig, sponsorConfig, overviewResult] = await Promise.all([
      adminApi.siteConfig({ suppressErrorMessage: true }),
      adminApi.sponsorConfig(),
      adminApi.assistantPointOverview({ suppressErrorMessage: true }),
    ]);
    reputationLevels.value = (siteConfig.reputationLevels ?? []).map((item) => ({ ...item }));
    dailyQuotas.value = (siteConfig.assistantDailyQuotas ?? []).map((item) => ({ ...item }));
    sponsorPointsPerYuan.value = sponsorConfig.assistantPointsPerYuan ?? 0;
    Object.assign(overview, overviewResult);
    await searchUsers("");
  } catch {
    loadError.value = "AI 额度管理数据加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function levelName(level: number) {
  if (level === 0) return "新账号（0 信誉）";
  return reputationLevels.value[level - 1]?.name || `等级 ${level}`;
}

async function saveQuotas() {
  if (savingQuotas.value) return;
  savingQuotas.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      assistantDailyQuotas: dailyQuotas.value.map((item) => ({
        level: item.level,
        quota: Number(item.quota || 0),
      })),
    });
    dailyQuotas.value = config.assistantDailyQuotas.map((item) => ({ ...item }));
    ElMessage.success("AI 每日额度已保存");
  } finally {
    savingQuotas.value = false;
  }
}

async function resetToday() {
  if (resetting.value) return;
  const confirmed = await ElMessageBox.confirm(
    "这会清零所有用户今天已使用的等级次数，但不会修改任何人的 AI 点数。是否继续？",
    "重置所有人今日额度",
    {
      type: "warning",
      confirmButtonText: "确认重置",
      cancelButtonText: "取消",
    },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;

  resetting.value = true;
  try {
    const result = await adminApi.resetCampusAssistantDailyQuota();
    ElMessage.success(result.resetUsers ? `已重置 ${result.resetUsers} 名用户` : "今天暂无已使用的额度");
  } finally {
    resetting.value = false;
  }
}

async function saveSponsorRate() {
  if (savingSponsorRate.value) return;
  savingSponsorRate.value = true;
  try {
    const result = await adminApi.updateSponsorConfig({
      assistantPointsPerYuan: Number(sponsorPointsPerYuan.value || 0),
    });
    sponsorPointsPerYuan.value = result.assistantPointsPerYuan;
    ElMessage.success("赞助点数比例已保存");
  } finally {
    savingSponsorRate.value = false;
  }
}

async function searchUsers(query: string) {
  const seq = ++userSearchSeq;
  usersLoading.value = true;
  try {
    const result = await adminApi.assistantPointUsers(
      { q: query.trim(), size: 50 },
      { suppressErrorMessage: true },
    );
    if (seq !== userSearchSeq) return;
    const selected = new Set(grantUserIds.value);
    const kept = pointUsers.value.filter((user) => selected.has(user.id));
    pointUsers.value = Array.from(
      new Map([...kept, ...result].map((user) => [user.id, user])).values(),
    );
  } finally {
    if (seq === userSearchSeq) usersLoading.value = false;
  }
}

async function grantPointsToUsers() {
  if (granting.value || !grantUserIds.value.length || !grantReason.value.trim()) return;
  const confirmed = await ElMessageBox.confirm(
    `将给 ${grantUserIds.value.length} 名用户每人发放 ${grantPoints.value} 个 AI 点数，共发放 ${grantUserIds.value.length * grantPoints.value} 点。`,
    "确认发放 AI 点数",
    {
      type: "warning",
      confirmButtonText: "确认发放",
      cancelButtonText: "取消",
    },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;

  granting.value = true;
  try {
    const result = await adminApi.grantAssistantPoints({
      userIds: grantUserIds.value,
      points: Number(grantPoints.value),
      reason: grantReason.value.trim(),
    });
    ElMessage.success(`已给 ${result.recipientCount} 名用户发放 ${result.points} 点`);
    grantUserIds.value = [];
    await Promise.all([loadOverview(), searchUsers("")]);
  } finally {
    granting.value = false;
  }
}

async function loadOverview() {
  overviewLoading.value = true;
  try {
    Object.assign(overview, await adminApi.assistantPointOverview());
  } finally {
    overviewLoading.value = false;
  }
}

function sourceLabel(source: string) {
  if (source === "admin_grant") return "后台发放";
  if (source === "sponsor_reward") return "赞助奖励";
  if (source === "ai_refund") return "失败返还";
  return "AI 消耗";
}

function sourceType(source: string) {
  if (source === "admin_grant") return "success";
  if (source === "sponsor_reward") return "warning";
  if (source === "ai_refund") return "info";
  return "danger";
}
</script>

<style scoped>
.ai-quota-pane {
  display: grid;
  gap: 18px;
}
.pane-alert {
  margin-bottom: 0;
}
.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.overview-card,
.settings-card {
  border: 1px solid var(--cpu-border);
  border-radius: 16px;
  background: var(--cpu-card);
}
.overview-card {
  display: grid;
  gap: 6px;
  padding: 18px 20px;
}
.overview-card span {
  color: var(--cpu-text-muted);
  font-size: 13px;
}
.overview-card strong {
  color: var(--cpu-primary);
  font-size: 26px;
}
.overview-card.accent {
  background: linear-gradient(135deg, color-mix(in srgb, var(--cpu-primary) 12%, var(--cpu-card)), var(--cpu-card));
}
.settings-card {
  padding: 20px;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}
.section-head.compact {
  margin-bottom: 14px;
}
.section-head h3 {
  margin: 0 0 6px;
  color: var(--cpu-text);
  font-size: 18px;
}
.section-head p,
.tip {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 13px;
  line-height: 1.7;
}
.quota-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.quota-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--cpu-border);
  border-radius: 12px;
}
.quota-item > span {
  display: grid;
  gap: 3px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.quota-item b {
  color: var(--cpu-text);
  font-size: 14px;
}
.quota-item small {
  color: var(--cpu-text-muted);
  white-space: nowrap;
}
.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--el-color-danger) 28%, var(--cpu-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--el-color-danger) 6%, transparent);
}
.danger-row > div {
  display: grid;
  gap: 5px;
}
.danger-row span {
  color: var(--cpu-text-muted);
  font-size: 13px;
}
.two-column {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 18px;
}
.rate-form,
.grant-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rate-form {
  flex-wrap: wrap;
  margin: 18px 0 8px;
}
.grant-form :deep(.el-select) {
  width: 100%;
}
.grant-row :deep(.el-form-item:first-child) {
  flex: 0 0 180px;
}
.grant-row :deep(.el-form-item:last-child) {
  flex: 1;
}
.user-option {
  display: flex;
  justify-content: space-between;
  gap: 20px;
}
.user-option small,
.user-cell span {
  color: var(--cpu-text-muted);
}
.user-cell {
  display: grid;
  gap: 2px;
}
.delta-plus {
  color: var(--el-color-success);
}
.delta-minus {
  color: var(--el-color-danger);
}
@media (max-width: 980px) {
  .overview-grid,
  .quota-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .two-column {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .overview-grid,
  .quota-grid {
    grid-template-columns: 1fr;
  }
  .settings-card {
    padding: 16px;
  }
  .section-head,
  .danger-row,
  .grant-row {
    align-items: stretch;
    flex-direction: column;
  }
  .section-head :deep(.el-button),
  .danger-row :deep(.el-button) {
    width: 100%;
  }
  .quota-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .quota-item small {
    display: none;
  }
}
</style>
