<template>
  <div class="admin-page">
    <div class="admin-head">
      <h1 class="title">🛠 管理后台</h1>
      <div class="user-tag">
        <el-tag :type="auth.user?.role === 'admin' ? 'danger' : 'warning'" size="small">
          {{ auth.user?.role === 'admin' ? '管理员' : '版主' }}
        </el-tag>
        <span class="me">{{ auth.user?.nickname }}</span>
      </div>
    </div>

    <!-- 概览数据 -->
    <div class="overview" v-if="overview">
      <div class="ov-card">
        <div class="ov-num">{{ overview.users }}</div>
        <div class="ov-lbl">用户</div>
        <div class="ov-sub" v-if="overview.banned">{{ overview.banned }} 封禁</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.topics }}</div>
        <div class="ov-lbl">帖子</div>
        <div class="ov-sub" v-if="overview.hiddenTopics">{{ overview.hiddenTopics }} 已隐</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.todayTopics }}</div>
        <div class="ov-lbl">今日新帖</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.replies }}</div>
        <div class="ov-lbl">回复</div>
      </div>
      <div class="ov-card">
        <div class="ov-num">{{ overview.feeds }} / {{ overview.boards }}</div>
        <div class="ov-lbl">同步源 / 板块</div>
      </div>
    </div>

    <el-tabs v-model="tab" class="cpu-card">
      <el-tab-pane label="👥 用户" name="users"><UsersPane v-if="tab === 'users'" /></el-tab-pane>
      <el-tab-pane label="📝 帖子" name="topics"><TopicsPane v-if="tab === 'topics'" /></el-tab-pane>
      <el-tab-pane label="🔄 同步源" name="feeds" v-if="auth.isAdmin"><FeedsPane v-if="tab === 'feeds'" /></el-tab-pane>
      <el-tab-pane label="📣 公告" name="announcements"><AnnouncementsPane v-if="tab === 'announcements'" /></el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { adminApi } from "@/api/admin";
import UsersPane from "./UsersPane.vue";
import TopicsPane from "./TopicsPane.vue";
import FeedsPane from "./FeedsPane.vue";
import AnnouncementsPane from "./AnnouncementsPane.vue";

const auth = useAuthStore();
const tab = ref("users");
const overview = ref<any>(null);

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
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.ov-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  padding: 16px 18px;
}
.ov-num { font-size: 26px; font-weight: 700; color: var(--cpu-primary); line-height: 1; }
.ov-lbl { font-size: 12px; color: #6b7280; margin-top: 4px; }
.ov-sub { font-size: 11px; color: #b45309; margin-top: 3px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 12px 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
</style>
