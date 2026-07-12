<template>
  <div class="admin-page">
    <div class="admin-head">
      <h1 class="title">🛠 管理后台</h1>
      <div class="user-tag">
        <el-tag :type="auth.user?.role === 'admin' ? 'danger' : 'warning'" size="small">
          {{ auth.user?.role === 'admin' ? '超级管理员' : '论坛管理员' }}
        </el-tag>
        <span class="me">{{ auth.user?.nickname }}</span>
      </div>
    </div>

    <el-alert
      v-if="overviewError"
      type="warning"
      :closable="false"
      show-icon
      class="overview-alert"
      :title="overviewError"
    >
      <template #default>
        <el-button size="small" :loading="overviewLoading" @click="loadOverview">重试</el-button>
      </template>
    </el-alert>

    <!-- 概览数据 -->
    <div class="overview" v-if="overview" v-loading="overviewLoading">
      <div class="ov-card">
        <div class="ov-num">{{ overview.users }}</div>
        <div class="ov-lbl">用户</div>
        <div class="ov-sub">{{ overview.banned || 0 }} 封禁 · {{ overview.todayLogins || 0 }} 今日登录</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.forumEnabledUsers }} / {{ overview.forumEligibleUsers }}</div>
        <div class="ov-lbl">论坛已开启</div>
        <div class="ov-sub">{{ overview.forumPendingUsers || 0 }} 未开启 · {{ overview.forumEnabledToday || 0 }} 今日新开</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.topics }}</div>
        <div class="ov-lbl">帖子</div>
        <div class="ov-sub">{{ overview.todayTopics }} 今日新帖 · {{ overview.hiddenTopics || 0 }} 已隐</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.replies }}</div>
        <div class="ov-lbl">回复</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.iosClients }} / {{ overview.androidClients }} / {{ overview.harmonyClients }}</div>
        <div class="ov-lbl">iOS / 安卓 / 鸿蒙</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.feeds }} / {{ overview.boards }}</div>
        <div class="ov-lbl">同步源 / 板块</div>
      </div>
      <div class="ov-card ov-card-wide">
        <div class="ov-card-head">
          <div>
            <div class="ov-num">{{ dailyActiveToday }}</div>
            <div class="ov-lbl">今日登录</div>
            <div class="ov-sub">{{ dailyActiveSummary }}</div>
          </div>
          <span class="ov-chip">按登录去重</span>
        </div>
        <DailyActiveChart
          v-if="dailyActiveSeries.length"
          class="ov-chart"
          :option="dailyActiveChartOption"
        />
      </div>
    </div>

    <el-tabs v-model="tab" class="cpu-card">
      <el-tab-pane label="👥 用户" name="users"><UsersPane v-if="tab === 'users'" /></el-tab-pane>
      <el-tab-pane label="🧩 板块" name="boards" v-if="auth.isAdmin"><BoardsPane v-if="tab === 'boards'" /></el-tab-pane>
      <el-tab-pane label="📝 帖子" name="topics"><TopicsPane v-if="tab === 'topics'" /></el-tab-pane>
      <el-tab-pane label="🔄 同步源" name="feeds" v-if="auth.isAdmin"><FeedsPane v-if="tab === 'feeds'" /></el-tab-pane>
      <el-tab-pane label="🌐 教务节点" name="jwxt-agents" v-if="auth.isAdmin"><JwxtAgentsPane v-if="tab === 'jwxt-agents'" /></el-tab-pane>
      <el-tab-pane label="📮 逛逛" name="weiwall" v-if="auth.isAdmin"><WeiwallPane v-if="tab === 'weiwall'" /></el-tab-pane>
      <el-tab-pane label="📣 公告" name="announcements" v-if="auth.isAdmin"><AnnouncementsPane v-if="tab === 'announcements'" /></el-tab-pane>
      <el-tab-pane label="💳 支付对接" name="epay" v-if="auth.isAdmin"><EpayPane v-if="tab === 'epay'" /></el-tab-pane>
      <el-tab-pane label="🛍️ 商城" name="market" v-if="auth.isAdmin"><MarketPane v-if="tab === 'market'" /></el-tab-pane>
      <el-tab-pane label="💛 赞助" name="sponsor" v-if="auth.isAdmin"><SponsorPane v-if="tab === 'sponsor'" /></el-tab-pane>
      <el-tab-pane label="🤖 QQBot" name="qqbot" v-if="auth.isAdmin"><QqBotPane v-if="tab === 'qqbot'" /></el-tab-pane>
      <el-tab-pane label="🧠 审核" name="ai-review" v-if="auth.isAdmin"><AiReviewPane v-if="tab === 'ai-review'" /></el-tab-pane>
      <el-tab-pane label="🗄 数据备份" name="database" v-if="auth.isAdmin"><DatabasePane v-if="tab === 'database'" /></el-tab-pane>
      <el-tab-pane label="🗂 媒体存储" name="media-storage" v-if="auth.isAdmin"><MediaStoragePane v-if="tab === 'media-storage'" /></el-tab-pane>
      <el-tab-pane label="📦 文件收集" name="filestore-settings" v-if="auth.isAdmin"><FilestoreSettingsPane v-if="tab === 'filestore-settings'" /></el-tab-pane>
      <el-tab-pane label="⚙ 功能开关" name="features" v-if="auth.isAdmin"><FeaturesPane v-if="tab === 'features'" /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, onMounted, watch } from "vue";
import type { EChartsOption } from "echarts";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { adminApi, type AdminOverview } from "@/api/admin";

const DailyActiveChart = defineAsyncComponent(() => import("./DailyActiveChart.vue"));
const UsersPane = defineAsyncComponent(() => import("./UsersPane.vue"));
const BoardsPane = defineAsyncComponent(() => import("./BoardsPane.vue"));
const TopicsPane = defineAsyncComponent(() => import("./TopicsPane.vue"));
const FeedsPane = defineAsyncComponent(() => import("./FeedsPane.vue"));
const JwxtAgentsPane = defineAsyncComponent(() => import("./JwxtAgentsPane.vue"));
const WeiwallPane = defineAsyncComponent(() => import("./WeiwallPane.vue"));
const AnnouncementsPane = defineAsyncComponent(() => import("./AnnouncementsPane.vue"));
const EpayPane = defineAsyncComponent(() => import("./EpayPane.vue"));
const MarketPane = defineAsyncComponent(() => import("./MarketPane.vue"));
const SponsorPane = defineAsyncComponent(() => import("./SponsorPane.vue"));
const QqBotPane = defineAsyncComponent(() => import("./QqBotPane.vue"));
const AiReviewPane = defineAsyncComponent(() => import("./AiReviewPane.vue"));
const DatabasePane = defineAsyncComponent(() => import("./DatabasePane.vue"));
const MediaStoragePane = defineAsyncComponent(() => import("./MediaStoragePane.vue"));
const FilestoreSettingsPane = defineAsyncComponent(() => import("./FilestoreSettingsPane.vue"));
const FeaturesPane = defineAsyncComponent(() => import("./FeaturesPane.vue"));

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const tab = ref(typeof route.query.tab === "string" ? route.query.tab : "users");
const overview = ref<AdminOverview | null>(null);
const overviewLoading = ref(false);
const overviewError = ref("");
const dailyActiveSeries = computed(() => overview.value?.dailyActiveSeries ?? []);
const dailyActiveToday = computed(() => dailyActiveSeries.value[dailyActiveSeries.value.length - 1]?.count ?? overview.value?.todayLogins ?? 0);
const dailyActivePeak = computed(() => dailyActiveSeries.value.reduce((max, item) => Math.max(max, item.count), 0));
const dailyActiveAverage = computed(() => {
  if (!dailyActiveSeries.value.length) return 0;
  const total = dailyActiveSeries.value.reduce((sum, item) => sum + item.count, 0);
  return Math.round((total / dailyActiveSeries.value.length) * 10) / 10;
});
const dailyActiveSummary = computed(() => {
  if (!dailyActiveSeries.value.length) return "近 30 天按每日登录去重统计";
  const trackedDays = dailyActiveSeries.value.filter((item) => item.count > 0).length;
  if (trackedDays <= 1) return "近 30 天按每日登录去重统计，历史数据会逐步累计";
  return `近 30 天日均 ${dailyActiveAverage.value} · 峰值 ${dailyActivePeak.value}`;
});
const dailyActiveChartOption = computed<EChartsOption>(() => {
  const lastIndex = Math.max(0, dailyActiveSeries.value.length - 1);
  return {
    animation: false,
    grid: {
      left: 8,
      right: 8,
      top: 20,
      bottom: 16,
      containLabel: true,
    },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "rgba(15, 23, 42, 0.92)",
      borderWidth: 0,
      padding: [8, 10],
      textStyle: {
        color: "#f8fafc",
        fontSize: 12,
      },
      formatter: (params: any) => {
        const date = String(params?.data?.fullDate || params?.name || "");
        const count = Number(params?.data?.value ?? params?.value ?? 0);
        return `${date}<br/>登录人数：${count}`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dailyActiveSeries.value.map((item) => item.date.slice(5).replace("-", "/")),
      axisTick: { show: false },
      axisLine: {
        lineStyle: { color: "#dbe4f0" },
      },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 10,
        interval: (index: number) => index === 0 || index === lastIndex || index % 7 === 0,
      },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitNumber: 3,
      axisLabel: {
        color: "#94a3b8",
        fontSize: 10,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.18)",
          type: "dashed",
        },
      },
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: true,
        data: dailyActiveSeries.value.map((item, index) => ({
          value: item.count,
          fullDate: item.date,
          itemStyle: index === lastIndex
            ? {
                color: "#10b981",
                borderColor: "#ecfdf5",
                borderWidth: 2,
              }
            : undefined,
        })),
        lineStyle: {
          width: 3,
          color: "#3b82f6",
        },
        itemStyle: {
          color: "#ffffff",
          borderColor: "#3b82f6",
          borderWidth: 2,
        },
        areaStyle: {
          color: "rgba(59, 130, 246, 0.10)",
        },
        emphasis: {
          focus: "series",
          scale: true,
          itemStyle: {
            color: "#1d4ed8",
            borderColor: "#dbeafe",
            borderWidth: 3,
          },
        },
      },
    ],
  };
});

onMounted(loadOverview);

async function loadOverview() {
  overviewLoading.value = true;
  overviewError.value = "";
  try {
    overview.value = await adminApi.overview({ suppressErrorMessage: true });
  } catch (error) {
    overview.value = null;
    overviewError.value = requestMessage(error) || "后台概览加载失败";
  } finally {
    overviewLoading.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

watch(() => route.query.tab, (next) => {
  if (typeof next === "string" && next && next !== tab.value) tab.value = next;
});

watch(tab, (next) => {
  if (route.query.tab === next) return;
  router.replace({
    query: {
      ...route.query,
      tab: next,
    },
  }).catch(() => null);
});
</script>

<style scoped>
.admin-page { display: flex; flex-direction: column; gap: 16px; }
.admin-head { display: flex; justify-content: space-between; align-items: center; }
.title { margin: 0; font-size: 24px; }
.user-tag { display: flex; gap: 8px; align-items: center; }
.me { font-size: 13px; color: var(--cpu-text-secondary); }
.overview-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.overview {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.ov-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  padding: 14px 16px;
  min-width: 0;
}
.ov-card-wide {
  grid-column: span 2;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 30%),
    linear-gradient(135deg, var(--cpu-surface-subtle) 0%, var(--cpu-card) 54%, rgba(59, 130, 246, 0.08) 100%);
}
.ov-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.ov-chip {
  flex: none;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 600;
}
.ov-num { font-size: 24px; font-weight: 700; color: var(--cpu-primary); line-height: 1; white-space: nowrap; }
.ov-lbl { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 4px; }
.ov-sub { font-size: 11px; color: var(--cpu-text-secondary); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-chart {
  margin-top: 10px;
  height: 180px;
  width: 100%;
}
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

.cpu-card:hover {
  transform: none;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

@media (max-width: 1100px) {
  .overview { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ov-card-wide { grid-column: span 3; }
}

@media (max-width: 720px) {
  .admin-page { gap: 12px; }
  .admin-head { align-items: flex-start; gap: 10px; flex-direction: column; }
  .title { font-size: 21px; }
  .user-tag { width: 100%; justify-content: space-between; }
  .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ov-card { padding: 12px; }
  .ov-num { font-size: 21px; }
  .ov-card-wide { grid-column: span 2; }
  .ov-card-head {
    flex-direction: column;
    gap: 8px;
  }
  .ov-chip {
    align-self: flex-start;
  }
  .ov-chart {
    height: 160px;
  }
  .cpu-card {
    margin: 0 -4px;
    padding: 8px 8px 12px;
    border-radius: 10px;
  }
  .cpu-card :deep(.el-tabs__header) {
    margin-bottom: 10px;
    overflow: hidden;
  }
  .cpu-card :deep(.el-tabs__nav-wrap) {
    height: 40px;
    max-height: 40px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    overscroll-behavior-y: none;
    touch-action: pan-x;
  }
  .cpu-card :deep(.el-tabs__nav-wrap::-webkit-scrollbar) {
    display: none;
  }
  .cpu-card :deep(.el-tabs__nav-scroll) {
    height: 40px;
    max-height: 40px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    overscroll-behavior-y: none;
    touch-action: pan-x;
  }
  .cpu-card :deep(.el-tabs__nav-scroll::-webkit-scrollbar) {
    display: none;
  }
  .cpu-card :deep(.el-tabs__nav) {
    float: none;
    width: max-content;
    min-width: 100%;
    white-space: nowrap;
  }
  .cpu-card :deep(.el-tabs__item) {
    height: 38px;
    padding: 0 12px;
    font-size: 13px;
  }
}

@media (max-width: 420px) {
  .overview { grid-template-columns: 1fr; }
  .ov-card-wide { grid-column: span 1; }
}
</style>
