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
          <h3>学习通助手访问策略</h3>
          <p>策略由服务器实时下发。客户端安装一次支持动态策略后，今后切换免登录或恢复账号额度都不需要重新发布安装包。</p>
        </div>
        <el-button
          type="primary"
          :loading="savingAccessMode"
          :disabled="Boolean(loadError) || learningAssistantAccessMode === savedLearningAssistantAccessMode"
          @click="saveAccessMode"
        >
          保存访问策略
        </el-button>
      </div>
      <el-radio-group v-model="learningAssistantAccessMode" class="access-mode-grid">
        <el-radio-button value="guest-unlimited">
          安装即用（免登录・不限次数）
        </el-radio-button>
        <el-radio-button value="account-quota">
          账号额度（登录后使用）
        </el-radio-button>
      </el-radio-group>
      <el-alert
        v-if="learningAssistantAccessMode === 'guest-unlimited'"
        type="warning"
        :closable="false"
        show-icon
        title="临时开放期间不扣每日额度和 AI 点数；服务端仍保留异常请求限流。"
        class="mode-alert"
      />
      <p v-else class="tip">恢复后，未登录客户端会立即停止答题；已登录用户继续按下方日额度和 AI 点数规则使用。</p>
    </section>

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
          <div class="rate-actions">
            <el-button type="primary" :loading="savingSponsorRate" @click="saveSponsorRate">保存比例</el-button>
            <el-button
              type="warning"
              plain
              :loading="backfillingSponsors"
              :disabled="savingSponsorRate || savedSponsorPointsPerYuan <= 0 || sponsorRateDirty"
              @click="backfillSponsors"
            >
              补发历史赞助
            </el-button>
          </div>
        </div>
        <p class="tip">设为 0 即关闭赞助点数奖励。不足 1 点的计算结果向下取整。补发使用已保存的比例，修改比例后请先保存；只处理尚未发过点数的已支付订单。</p>
      </section>

      <section class="settings-card">
        <div class="section-head compact">
          <div>
            <h3>活动 / 人工发放</h3>
            <p>可指定一名或多名用户，也可以直接给全体可用账号发放；每位用户都会收到站内通知。</p>
          </div>
        </div>
        <el-form label-position="top" class="grant-form">
          <el-form-item label="发放范围">
            <el-radio-group v-model="grantScope">
              <el-radio-button value="selected">指定用户</el-radio-button>
              <el-radio-button value="all">全体用户（{{ overview.eligibleUserCount }} 人）</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="grantScope === 'selected'" label="接收用户">
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
          <el-alert
            v-else
            type="warning"
            :closable="false"
            show-icon
            title="将发放给全部正常账号"
            :description="`当前共 ${overview.eligibleUserCount} 人，已封禁账号和 bot 账号不会收到点数。`"
            class="all-users-alert"
          />
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
            :disabled="(grantScope === 'selected' && !grantUserIds.length) || (grantScope === 'all' && overview.eligibleUserCount <= 0) || !grantReason.trim()"
            @click="grantPointsToUsers"
          >
            给 {{ grantRecipientCount }} 人发放
          </el-button>
        </el-form>
      </section>
    </div>

    <section class="settings-card ledger-card">
      <div class="section-head ledger-head">
        <div>
          <div class="ledger-title-row">
            <h3>点数流水</h3>
            <span>{{ ledgerTotal }} 笔</span>
          </div>
          <p>按用户、收支类型和日期快速定位记录，筛选汇总会同步计算。</p>
        </div>
        <el-button :loading="ledgerLoading" @click="loadLedger">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <div class="ledger-filters">
        <el-input
          v-model="ledgerFilters.q"
          clearable
          placeholder="搜用户、说明、订单号"
          class="ledger-search"
          @keyup.enter="applyLedgerFilters"
          @clear="applyLedgerFilters"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="ledgerFilters.source" placeholder="全部来源" class="ledger-source" @change="applyLedgerFilters">
          <el-option label="全部来源" value="" />
          <el-option label="后台发放" value="admin_grant" />
          <el-option label="赞助奖励" value="sponsor_reward" />
          <el-option label="AI 消耗" value="ai_usage" />
          <el-option label="失败返还" value="ai_refund" />
        </el-select>
        <el-radio-group v-model="ledgerFilters.direction" class="ledger-direction" @change="applyLedgerFilters">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="income">收入</el-radio-button>
          <el-radio-button value="expense">支出</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-model="ledgerDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          class="ledger-date-range"
          @change="applyLedgerFilters"
        />
        <div class="ledger-filter-actions">
          <el-button type="primary" :loading="ledgerLoading" @click="applyLedgerFilters">查询</el-button>
          <el-button :disabled="ledgerLoading || !ledgerFiltersActive" @click="resetLedgerFilters">重置</el-button>
        </div>
      </div>

      <el-alert
        v-if="ledgerError"
        :title="ledgerError"
        type="error"
        :closable="false"
        show-icon
        class="ledger-alert"
      />

      <div class="ledger-summary">
        <div>
          <span>筛选结果</span>
          <strong>{{ ledgerSummary.transactions }}</strong>
          <small>笔</small>
        </div>
        <div class="summary-income">
          <span>收入</span>
          <strong>+{{ ledgerSummary.income }}</strong>
          <small>点</small>
        </div>
        <div class="summary-expense">
          <span>支出</span>
          <strong>-{{ ledgerSummary.expense }}</strong>
          <small>点</small>
        </div>
        <div :class="ledgerSummary.net >= 0 ? 'summary-income' : 'summary-expense'">
          <span>净变化</span>
          <strong>{{ ledgerSummary.net > 0 ? "+" : "" }}{{ ledgerSummary.net }}</strong>
          <small>点</small>
        </div>
      </div>

      <el-table
        :data="ledgerRows"
        v-loading="ledgerLoading"
        class="ledger-table"
        empty-text="没有符合条件的流水"
        max-height="620"
      >
        <el-table-column label="时间" width="164">
          <template #default="{ row }">
            <span class="ledger-time">{{ fmtDate(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="210">
          <template #default="{ row }">
            <div class="ledger-user">
              <el-avatar :size="34" :src="row.user?.avatar || undefined">
                {{ userInitial(row) }}
              </el-avatar>
              <div class="user-cell">
                <b>{{ row.user?.nickname || row.user?.username || `用户 ${row.userId}` }}</b>
                <span v-if="row.user?.username">@{{ row.user.username }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="112" align="center">
          <template #default="{ row }">
            <b :class="['delta-pill', row.delta > 0 ? 'delta-plus' : 'delta-minus']">
              {{ row.delta > 0 ? "+" : "" }}{{ row.delta }}
            </b>
          </template>
        </el-table-column>
        <el-table-column label="余额" width="105" align="right">
          <template #default="{ row }"><b class="ledger-balance">{{ row.balanceAfter }}</b> 点</template>
        </el-table-column>
        <el-table-column label="来源" width="116">
          <template #default="{ row }">
            <el-tag size="small" effect="light" :type="sourceType(row.source)">{{ sourceLabel(row.source) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }">
            <div class="ledger-reason">
              <span>{{ row.reason || "—" }}</span>
              <small v-if="row.referenceId">{{ row.referenceType || "关联记录" }} · {{ row.referenceId }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作人" min-width="130">
          <template #default="{ row }">{{ row.operator?.nickname || row.operator?.username || "系统" }}</template>
        </el-table-column>
      </el-table>

      <div class="ledger-footer">
        <span>第 {{ ledgerPage }} / {{ ledgerPageCount }} 页</span>
        <el-pagination
          v-model:current-page="ledgerPage"
          v-model:page-size="ledgerSize"
          :total="ledgerTotal"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="loadLedger"
          @size-change="changeLedgerSize"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, Search } from "@element-plus/icons-vue";
import {
  adminApi,
  type AssistantPointLedgerRow,
  type AssistantPointOverview,
  type AssistantPointUser,
} from "@/api/admin";
import { fmtDate } from "@/utils/format";

const loading = ref(false);
const overviewLoading = ref(false);
const ledgerLoading = ref(false);
const usersLoading = ref(false);
const savingQuotas = ref(false);
const savingAccessMode = ref(false);
const savingSponsorRate = ref(false);
const backfillingSponsors = ref(false);
const resetting = ref(false);
const granting = ref(false);
const loadError = ref("");
const reputationLevels = ref<Array<{ level: number; name: string; minReputation: number }>>([]);
const learningAssistantAccessMode = ref<"guest-unlimited" | "account-quota">("guest-unlimited");
const savedLearningAssistantAccessMode = ref<"guest-unlimited" | "account-quota">("guest-unlimited");
const dailyQuotas = ref([
  { level: 0, quota: 5 },
  { level: 1, quota: 10 },
  { level: 2, quota: 20 },
  { level: 3, quota: 30 },
  { level: 4, quota: 50 },
  { level: 5, quota: 80 },
]);
const sponsorPointsPerYuan = ref(1);
const savedSponsorPointsPerYuan = ref(1);
const grantUserIds = ref<number[]>([]);
const grantScope = ref<"selected" | "all">("selected");
const grantPoints = ref(10);
const grantReason = ref("活动奖励");
const pointUsers = ref<AssistantPointUser[]>([]);
const overview = reactive<AssistantPointOverview>({
  totalPoints: 0,
  holderCount: 0,
  eligibleUserCount: 0,
  transactionCount: 0,
  recent: [],
});
const ledgerRows = ref<AssistantPointLedgerRow[]>([]);
const ledgerTotal = ref(0);
const ledgerPage = ref(1);
const ledgerSize = ref(20);
const ledgerDateRange = ref<[string, string] | [] | null>([]);
const ledgerError = ref("");
const ledgerFilters = reactive({
  q: "",
  source: "" as "" | AssistantPointLedgerRow["source"],
  direction: "" as "" | "income" | "expense",
});
const ledgerSummary = reactive({
  transactions: 0,
  income: 0,
  expense: 0,
  net: 0,
});
const grantRecipientCount = computed(() => (
  grantScope.value === "all" ? overview.eligibleUserCount : grantUserIds.value.length
));
const sponsorRateDirty = computed(() => (
  Number(sponsorPointsPerYuan.value || 0) !== savedSponsorPointsPerYuan.value
));
const ledgerPageCount = computed(() => Math.max(1, Math.ceil(ledgerTotal.value / ledgerSize.value)));
const ledgerFiltersActive = computed(() => Boolean(
  ledgerFilters.q.trim()
  || ledgerFilters.source
  || ledgerFilters.direction
  || (Array.isArray(ledgerDateRange.value) && ledgerDateRange.value.length === 2),
));
let userSearchSeq = 0;
let ledgerLoadSeq = 0;

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
    learningAssistantAccessMode.value = siteConfig.learningAssistantAccessMode || "guest-unlimited";
    savedLearningAssistantAccessMode.value = learningAssistantAccessMode.value;
    dailyQuotas.value = (siteConfig.assistantDailyQuotas ?? []).map((item) => ({ ...item }));
    sponsorPointsPerYuan.value = sponsorConfig.assistantPointsPerYuan ?? 0;
    savedSponsorPointsPerYuan.value = sponsorPointsPerYuan.value;
    Object.assign(overview, overviewResult);
    await Promise.all([searchUsers(""), loadLedger()]);
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

async function saveAccessMode() {
  if (
    savingAccessMode.value
    || learningAssistantAccessMode.value === savedLearningAssistantAccessMode.value
  ) return;
  savingAccessMode.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      learningAssistantAccessMode: learningAssistantAccessMode.value,
    });
    learningAssistantAccessMode.value = config.learningAssistantAccessMode;
    savedLearningAssistantAccessMode.value = config.learningAssistantAccessMode;
    ElMessage.success(
      config.learningAssistantAccessMode === "guest-unlimited"
        ? "学习通助手已切换为限时免登录、不限次数"
        : "学习通助手已恢复账号登录与额度限制"
    );
  } finally {
    savingAccessMode.value = false;
  }
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
    savedSponsorPointsPerYuan.value = result.assistantPointsPerYuan;
    ElMessage.success("赞助点数比例已保存");
  } finally {
    savingSponsorRate.value = false;
  }
}

async function backfillSponsors() {
  if (backfillingSponsors.value || savedSponsorPointsPerYuan.value <= 0 || sponsorRateDirty.value) return;
  const confirmed = await ElMessageBox.confirm(
    `将按已保存的“每 ¥1 发放 ${savedSponsorPointsPerYuan.value} 点”规则，为所有尚未获得点数的历史已支付赞助订单补发。已发过的订单会自动跳过。`,
    "补发历史赞助点数",
    {
      type: "warning",
      confirmButtonText: "确认补发",
      cancelButtonText: "取消",
    },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;

  backfillingSponsors.value = true;
  try {
    const result = await adminApi.backfillSponsorAssistantPoints();
    if (result.orderCount <= 0) {
      ElMessage.info("没有需要补发的历史赞助订单");
    } else {
      ElMessage.success(
        `已为 ${result.userCount} 名用户的 ${result.orderCount} 笔赞助补发 ${result.totalPoints} 点`,
      );
    }
    await Promise.all([loadOverview(), loadLedger(), searchUsers("")]);
  } finally {
    backfillingSponsors.value = false;
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
  const recipientCount = grantRecipientCount.value;
  if (granting.value || recipientCount <= 0 || !grantReason.value.trim()) return;
  const confirmed = await ElMessageBox.confirm(
    `将给 ${recipientCount} 名用户每人发放 ${grantPoints.value} 个 AI 点数，共发放 ${recipientCount * grantPoints.value} 点。${grantScope.value === "all" ? "已封禁账号和 bot 账号会被排除。" : ""}`,
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
      allUsers: grantScope.value === "all",
      userIds: grantScope.value === "selected" ? grantUserIds.value : undefined,
      points: Number(grantPoints.value),
      reason: grantReason.value.trim(),
    });
    ElMessage.success(`已给 ${result.recipientCount} 名用户发放 ${result.points} 点`);
    grantUserIds.value = [];
    await Promise.all([loadOverview(), loadLedger(), searchUsers("")]);
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

async function loadLedger() {
  const seq = ++ledgerLoadSeq;
  ledgerLoading.value = true;
  ledgerError.value = "";
  try {
    const range = Array.isArray(ledgerDateRange.value) && ledgerDateRange.value.length === 2
      ? ledgerDateRange.value
      : [];
    const result = await adminApi.assistantPointLedger({
      q: ledgerFilters.q.trim() || undefined,
      source: ledgerFilters.source || undefined,
      direction: ledgerFilters.direction || undefined,
      from: range[0],
      to: range[1],
      page: ledgerPage.value,
      size: ledgerSize.value,
    }, { suppressErrorMessage: true });
    if (seq !== ledgerLoadSeq) return;
    ledgerRows.value = result.list;
    ledgerTotal.value = result.total;
    ledgerPage.value = result.page;
    ledgerSize.value = result.size;
    Object.assign(ledgerSummary, result.summary);
  } catch {
    if (seq !== ledgerLoadSeq) return;
    ledgerRows.value = [];
    ledgerTotal.value = 0;
    Object.assign(ledgerSummary, { transactions: 0, income: 0, expense: 0, net: 0 });
    ledgerError.value = "流水加载失败，请稍后重试";
  } finally {
    if (seq === ledgerLoadSeq) ledgerLoading.value = false;
  }
}

function applyLedgerFilters() {
  ledgerPage.value = 1;
  loadLedger();
}

function resetLedgerFilters() {
  if (ledgerLoading.value) return;
  ledgerFilters.q = "";
  ledgerFilters.source = "";
  ledgerFilters.direction = "";
  ledgerDateRange.value = [];
  ledgerPage.value = 1;
  loadLedger();
}

function changeLedgerSize() {
  ledgerPage.value = 1;
  loadLedger();
}

function userInitial(row: AssistantPointLedgerRow) {
  const name = row.user?.nickname || row.user?.username || String(row.userId);
  return name.slice(0, 1).toUpperCase();
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
.rate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.all-users-alert {
  margin-bottom: 18px;
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
.ledger-card {
  overflow: hidden;
}
.ledger-head {
  align-items: center;
}
.ledger-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ledger-title-row h3 {
  margin-bottom: 0;
}
.ledger-title-row span {
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 10%, transparent);
  font-size: 12px;
  font-weight: 700;
}
.ledger-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) 150px auto minmax(260px, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
}
.ledger-filter-actions {
  display: flex;
  gap: 8px;
}
.ledger-filter-actions :deep(.el-button) {
  margin-left: 0;
}
.ledger-filters :deep(.ledger-date-range) {
  width: 100% !important;
  min-width: 0;
}
.ledger-alert {
  margin-top: 12px;
}
.ledger-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 14px 0;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
  overflow: hidden;
}
.ledger-summary > div {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 13px 16px;
}
.ledger-summary > div + div {
  border-left: 1px solid var(--cpu-border-soft);
}
.ledger-summary span {
  margin-right: auto;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.ledger-summary strong {
  color: var(--cpu-text);
  font-size: 20px;
}
.ledger-summary small {
  color: var(--cpu-text-muted);
}
.ledger-summary .summary-income strong {
  color: var(--el-color-success);
}
.ledger-summary .summary-expense strong {
  color: var(--el-color-danger);
}
.ledger-table {
  width: 100%;
  border-top: 1px solid var(--cpu-border-soft);
}
.ledger-table :deep(.el-table__row:hover > td.el-table__cell) {
  background: color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-card));
}
.ledger-time {
  color: var(--cpu-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ledger-user {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ledger-user :deep(.el-avatar) {
  flex: 0 0 auto;
  color: var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 12%, var(--cpu-card));
  font-size: 13px;
  font-weight: 700;
}
.delta-pill {
  display: inline-flex;
  justify-content: center;
  min-width: 64px;
  padding: 4px 9px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.delta-plus {
  color: var(--el-color-success);
  background: color-mix(in srgb, var(--el-color-success) 10%, transparent);
}
.delta-minus {
  color: var(--el-color-danger);
  background: color-mix(in srgb, var(--el-color-danger) 9%, transparent);
}
.ledger-balance {
  color: var(--cpu-text);
  font-variant-numeric: tabular-nums;
}
.ledger-reason {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.ledger-reason > span,
.ledger-reason > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ledger-reason > small {
  color: var(--cpu-text-muted);
  font-size: 11px;
}
.ledger-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 16px;
}
.ledger-footer > span {
  color: var(--cpu-text-muted);
  font-size: 12px;
  white-space: nowrap;
}
.access-mode-grid {
  display: flex;
  width: 100%;
}
.access-mode-grid :deep(.el-radio-button) {
  flex: 1;
}
.access-mode-grid :deep(.el-radio-button__inner) {
  width: 100%;
  padding-block: 13px;
}
.mode-alert {
  margin-top: 14px;
}
@media (max-width: 980px) {
  .overview-grid,
  .quota-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .two-column {
    grid-template-columns: 1fr;
  }
  .ledger-filters {
    grid-template-columns: minmax(220px, 1fr) 150px auto;
  }
  .ledger-filter-actions {
    justify-content: flex-end;
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
  .ledger-filters {
    grid-template-columns: 1fr;
  }
  .ledger-search,
  .ledger-source,
  .ledger-direction,
  .ledger-filter-actions {
    width: 100%;
  }
  .ledger-direction {
    display: flex;
  }
  .ledger-direction :deep(.el-radio-button) {
    flex: 1;
  }
  .ledger-direction :deep(.el-radio-button__inner) {
    width: 100%;
  }
  .ledger-filter-actions :deep(.el-button) {
    flex: 1;
  }
  .ledger-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ledger-summary > div:nth-child(3) {
    border-top: 1px solid var(--cpu-border-soft);
    border-left: 0;
  }
  .ledger-summary > div:nth-child(4) {
    border-top: 1px solid var(--cpu-border-soft);
  }
  .ledger-footer {
    align-items: flex-start;
    flex-direction: column;
    overflow-x: auto;
  }
}
</style>
