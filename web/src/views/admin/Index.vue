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
        <div class="ov-sub">{{ overview.banned || 0 }} 封禁 · {{ overview.recentLogins || 0 }} 近 30 天登录</div>
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
        <div class="ov-num">{{ overview.iosClients }} / {{ overview.androidClients }}</div>
        <div class="ov-lbl">iOS / 安卓客户端</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.feeds }} / {{ overview.boards }}</div>
        <div class="ov-lbl">同步源 / 板块</div>
      </div>
    </div>

    <el-tabs v-model="tab" class="cpu-card">
      <el-tab-pane label="👥 用户" name="users"><UsersPane v-if="tab === 'users'" /></el-tab-pane>
      <el-tab-pane label="🧩 板块" name="boards" v-if="auth.isAdmin"><BoardsPane v-if="tab === 'boards'" /></el-tab-pane>
      <el-tab-pane label="📝 帖子" name="topics"><TopicsPane v-if="tab === 'topics'" /></el-tab-pane>
      <el-tab-pane label="🔄 同步源" name="feeds" v-if="auth.isAdmin"><FeedsPane v-if="tab === 'feeds'" /></el-tab-pane>
      <el-tab-pane label="📣 公告" name="announcements" v-if="auth.isAdmin"><AnnouncementsPane v-if="tab === 'announcements'" /></el-tab-pane>
      <el-tab-pane label="💳 支付对接" name="epay" v-if="auth.isAdmin"><EpayPane v-if="tab === 'epay'" /></el-tab-pane>
      <el-tab-pane label="⚙ 功能开关" name="features" v-if="auth.isAdmin"><FeaturesPane v-if="tab === 'features'" /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { adminApi, type AdminOverview } from "@/api/admin";
import UsersPane from "./UsersPane.vue";
import BoardsPane from "./BoardsPane.vue";
import TopicsPane from "./TopicsPane.vue";
import FeedsPane from "./FeedsPane.vue";
import AnnouncementsPane from "./AnnouncementsPane.vue";
import EpayPane from "./EpayPane.vue";
import FeaturesPane from "./FeaturesPane.vue";

const auth = useAuthStore();
const tab = ref("users");
const overview = ref<AdminOverview | null>(null);

onMounted(async () => {
  try { overview.value = await adminApi.overview(); } catch { /* ignore */ }
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
.ov-num { font-size: 24px; font-weight: 700; color: var(--cpu-primary); line-height: 1; white-space: nowrap; }
.ov-lbl { font-size: 12px; color: #6b7280; margin-top: 4px; }
.ov-sub { font-size: 11px; color: #6b7280; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cpu-card { background: #fff; border-radius: 12px; padding: 12px 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

@media (max-width: 1100px) {
  .overview { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 720px) {
  .admin-page { gap: 12px; }
  .admin-head { align-items: flex-start; gap: 10px; flex-direction: column; }
  .title { font-size: 21px; }
  .user-tag { width: 100%; justify-content: space-between; }
  .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ov-card { padding: 12px; }
  .ov-num { font-size: 21px; }
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
}
</style>
