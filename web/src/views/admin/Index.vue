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

    <!-- 概览数据 -->
    <div class="overview" v-if="overview">
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
            <div class="ov-num">{{ overview.todayLogins }}</div>
            <div class="ov-lbl">近 30 日日活</div>
            <div class="ov-sub">{{ dailyActiveSummary }}</div>
          </div>
          <span class="ov-chip">按登录去重</span>
        </div>
        <div class="ov-trend" v-if="dailyActiveBars.length">
          <div
            v-for="item in dailyActiveBars"
            :key="item.date"
            class="ov-trend-col"
            :class="{ today: item.isToday }"
            :title="`${item.date}：${item.count} 人`"
          >
            <span class="ov-trend-bar" :style="{ height: item.height }"></span>
            <span class="ov-trend-label" :class="{ ghost: !item.showLabel }">{{ item.showLabel ? item.label : "" }}</span>
          </div>
        </div>
      </div>
    </div>

    <el-tabs v-model="tab" class="cpu-card">
      <el-tab-pane label="👥 用户" name="users"><UsersPane v-if="tab === 'users'" /></el-tab-pane>
      <el-tab-pane label="🧩 板块" name="boards" v-if="auth.isAdmin"><BoardsPane v-if="tab === 'boards'" /></el-tab-pane>
      <el-tab-pane label="📝 帖子" name="topics"><TopicsPane v-if="tab === 'topics'" /></el-tab-pane>
      <el-tab-pane label="🔄 同步源" name="feeds" v-if="auth.isAdmin"><FeedsPane v-if="tab === 'feeds'" /></el-tab-pane>
      <el-tab-pane label="📮 逛逛" name="weiwall" v-if="auth.isAdmin"><WeiwallPane v-if="tab === 'weiwall'" /></el-tab-pane>
      <el-tab-pane label="📣 公告" name="announcements" v-if="auth.isAdmin"><AnnouncementsPane v-if="tab === 'announcements'" /></el-tab-pane>
      <el-tab-pane label="💳 支付对接" name="epay" v-if="auth.isAdmin"><EpayPane v-if="tab === 'epay'" /></el-tab-pane>
      <el-tab-pane label="💛 赞助" name="sponsor" v-if="auth.isAdmin"><SponsorPane v-if="tab === 'sponsor'" /></el-tab-pane>
      <el-tab-pane label="🤖 QQBot" name="qqbot" v-if="auth.isAdmin"><QqBotPane v-if="tab === 'qqbot'" /></el-tab-pane>
      <el-tab-pane label="🧠 审核" name="ai-review" v-if="auth.isAdmin"><AiReviewPane v-if="tab === 'ai-review'" /></el-tab-pane>
      <el-tab-pane label="🗄 数据备份" name="database" v-if="auth.isAdmin"><DatabasePane v-if="tab === 'database'" /></el-tab-pane>
      <el-tab-pane label="🗂 媒体存储" name="media-storage" v-if="auth.isAdmin"><MediaStoragePane v-if="tab === 'media-storage'" /></el-tab-pane>
      <el-tab-pane label="⚙ 功能开关" name="features" v-if="auth.isAdmin"><FeaturesPane v-if="tab === 'features'" /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { adminApi, type AdminOverview } from "@/api/admin";
import UsersPane from "./UsersPane.vue";
import BoardsPane from "./BoardsPane.vue";
import TopicsPane from "./TopicsPane.vue";
import FeedsPane from "./FeedsPane.vue";
import WeiwallPane from "./WeiwallPane.vue";
import AnnouncementsPane from "./AnnouncementsPane.vue";
import EpayPane from "./EpayPane.vue";
import SponsorPane from "./SponsorPane.vue";
import QqBotPane from "./QqBotPane.vue";
import AiReviewPane from "./AiReviewPane.vue";
import DatabasePane from "./DatabasePane.vue";
import MediaStoragePane from "./MediaStoragePane.vue";
import FeaturesPane from "./FeaturesPane.vue";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const tab = ref(typeof route.query.tab === "string" ? route.query.tab : "users");
const overview = ref<AdminOverview | null>(null);
const dailyActiveSeries = computed(() => overview.value?.dailyActiveSeries ?? []);
const dailyActivePeak = computed(() => dailyActiveSeries.value.reduce((max, item) => Math.max(max, item.count), 0));
const dailyActiveAverage = computed(() => {
  if (!dailyActiveSeries.value.length) return 0;
  const total = dailyActiveSeries.value.reduce((sum, item) => sum + item.count, 0);
  return Math.round((total / dailyActiveSeries.value.length) * 10) / 10;
});
const dailyActiveBars = computed(() => {
  const peak = Math.max(1, dailyActivePeak.value);
  return dailyActiveSeries.value.map((item, index, list) => {
    const ratio = item.count > 0 ? item.count / peak : 0;
    return {
      ...item,
      isToday: index === list.length - 1,
      label: item.date.slice(5).replace("-", "/"),
      showLabel: index === 0 || index === list.length - 1 || index % 7 === 0,
      height: `${Math.max(item.count > 0 ? 14 : 8, Math.round(ratio * 100))}%`,
    };
  });
});
const dailyActiveSummary = computed(() => {
  if (!dailyActiveSeries.value.length) return "按每日登录去重统计";
  const trackedDays = dailyActiveSeries.value.filter((item) => item.count > 0).length;
  if (trackedDays <= 1) return "按每日登录去重统计，历史数据会逐步累计";
  return `30 日均 ${dailyActiveAverage.value} · 峰值 ${dailyActivePeak.value}`;
});

onMounted(async () => {
  try { overview.value = await adminApi.overview(); } catch { /* ignore */ }
});

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
.me { font-size: 13px; color: #4b5563; }

.overview {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.ov-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  padding: 14px 16px;
  min-width: 0;
}
.ov-card-wide {
  grid-column: span 2;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 30%),
    linear-gradient(135deg, #f8fbff 0%, #ffffff 54%, #f3f8ff 100%);
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
.ov-lbl { font-size: 12px; color: #6b7280; margin-top: 4px; }
.ov-sub { font-size: 11px; color: #6b7280; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-trend {
  margin-top: 14px;
  height: 132px;
  display: grid;
  grid-template-columns: repeat(30, minmax(0, 1fr));
  gap: 6px;
  align-items: end;
}
.ov-trend-col {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: end;
  align-items: center;
  gap: 6px;
}
.ov-trend-bar {
  width: 100%;
  min-height: 8px;
  border-radius: 999px;
  background: linear-gradient(180deg, #60a5fa 0%, #2563eb 100%);
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.22);
}
.ov-trend-col.today .ov-trend-bar {
  background: linear-gradient(180deg, #34d399 0%, #059669 100%);
}
.ov-trend-label {
  min-height: 16px;
  font-size: 10px;
  line-height: 1.2;
  color: #94a3b8;
}
.ov-trend-label.ghost {
  visibility: hidden;
}
.cpu-card { background: #fff; border-radius: 12px; padding: 12px 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

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
  .ov-trend {
    gap: 4px;
    height: 112px;
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
