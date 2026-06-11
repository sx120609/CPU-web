<template>
  <div v-if="loading && !user" class="user-page">
    <div class="cpu-card state-card">正在加载用户资料...</div>
  </div>

  <div v-else-if="error && !user" class="user-page">
    <div class="cpu-card state-card">
      <el-empty :description="error">
        <el-button type="primary" :loading="loading" @click="load">重试</el-button>
      </el-empty>
    </div>
  </div>

  <div class="user-page" v-else-if="user">
    <button type="button" class="back-btn" @click="goBack">
      <el-icon><ArrowLeft /></el-icon>
      返回上一页
    </button>

    <div class="cpu-card profile-card">
      <UserAvatar :size="64" class="avatar" :src="user.avatar" :name="user.nickname" alt="用户头像" />
      <div>
        <h2 class="name">
          {{ user.nickname }}
          <el-tag v-if="user.role === 'admin'" size="small" type="danger">管理员</el-tag>
          <el-tag v-else-if="user.role === 'mod'" size="small" type="warning">论坛管理员</el-tag>
          <el-tag v-else-if="user.role === 'bot'" size="small" type="warning">系统账号</el-tag>
          <el-tag v-if="user.reputationLevel" size="small" type="warning" effect="plain">
            Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}
          </el-tag>
        </h2>
        <p class="bio">{{ user.bio || "这个人还没写简介" }}</p>
        <div class="meta">
          <span v-if="user.college">{{ user.college }}</span>
          <span v-if="user.enrollYear">{{ user.enrollYear }} 级</span>
          <span>发帖 {{ user.postCount }}</span>
          <span>回复 {{ user.replyCount }}</span>
          <span>声望 {{ user.reputation }}</span>
          <span v-if="user.sponsorAmount > 0" class="sponsor-badge">已赞助 ¥{{ formatMoney(user.sponsorAmount) }}</span>
        </div>
        <div v-if="auth.isMod" class="staff-panel">
          <UserModerationActions :user="user" display="inline" plain @updated="applyModerationUpdate" />
          <span v-if="user.status === 'muted'" class="staff-note">
            {{ user.mutedUntil ? `禁言至 ${fmtDate(user.mutedUntil)}` : "当前为禁言状态" }}
          </span>
        </div>
      </div>
    </div>

    <div class="cpu-card">
      <h3 class="cpu-section-title">TA 发布的帖子（{{ topics.length }}）</h3>
      <el-empty v-if="!topics.length" description="还没有发过帖子" />
      <div
        v-for="t in topics"
        :key="t.id"
        class="topic-line"
        role="button"
        tabindex="0"
        @click="openTopic(t.id)"
        @keydown.enter.prevent="openTopic(t.id)"
        @keydown.space.prevent="openTopic(t.id)"
      >
        <span class="tag" :style="{ background: t.board?.color || '#168776' }">{{ t.board?.name }}</span>
        <span v-if="t.isAnonymous" class="anon-tag">匿名</span>
        <span class="title">{{ t.title }}</span>
        <span class="meta">{{ fmtRelative(t.createdAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import UserModerationActions from "@/components/common/UserModerationActions.vue";
import { request } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import { fmtDate, fmtRelative } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const user = ref<any>(null);
const topics = ref<any[]>([]);
const loading = ref(false);
const error = ref("");
let loadSeq = 0;

watch(() => route.params.id, () => {
  void load();
}, { immediate: true });

async function load() {
  const seq = ++loadSeq;
  const id = Number(route.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    user.value = null;
    topics.value = [];
    error.value = "用户不存在或已被删除";
    return;
  }
  loading.value = true;
  error.value = "";
  user.value = null;
  topics.value = [];
  try {
    const [nextUser, nextTopics] = await Promise.all([
      request.get<any>(`/user/${id}`, undefined, { suppressErrorMessage: true }),
      request.get<any[]>(`/user/${id}/topics`, undefined, { suppressErrorMessage: true }),
    ]);
    if (seq !== loadSeq) return;
    user.value = nextUser;
    topics.value = nextTopics;
  } catch (loadError) {
    if (seq !== loadSeq) return;
    user.value = null;
    topics.value = [];
    error.value = normalizeUserLoadError(loadError);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function applyModerationUpdate(patch: Record<string, unknown>) {
  if (!user.value) return;
  Object.assign(user.value, patch);
}

function formatMoney(value: number | string) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  router.push("/forum");
}

function openTopic(id: number) {
  router.push(`/forum/topic/${id}`);
}

function normalizeUserLoadError(loadError: unknown) {
  const status = (loadError as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 404) return "用户不存在或已被删除";
  if (status && status < 500) {
    return (loadError as { response?: { data?: { message?: string } } })?.response?.data?.message || "用户资料加载失败";
  }
  return "用户资料加载失败，请稍后再试";
}
</script>

<style scoped>
.user-page { display: flex; flex-direction: column; gap: 16px; }
.state-card {
  min-height: 220px;
  display: grid;
  place-items: center;
  color: #6b7280;
}
.back-btn {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--cpu-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.profile-card { display: flex; align-items: flex-start; gap: 16px; }
.avatar { font-size: 24px; font-weight: 600; flex-shrink: 0; }
.name { margin: 0; font-size: 20px; display: flex; align-items: center; gap: 8px; }
.bio { font-size: 13px; color: #4b5563; margin: 0 0 8px; }
.meta { display: flex; gap: 12px; font-size: 12px; color: #6b7280; flex-wrap: wrap; }
.staff-panel { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.staff-note { font-size: 12px; color: #6b7280; }
.sponsor-badge { color: #b45309; font-weight: 700; }

.topic-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
  border-radius: 6px;
  min-width: 0;
  overflow: hidden;
}
.topic-line:last-child { border-bottom: none; }
.topic-line:hover { background: #f4f6f8; }
.topic-line:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.tag { color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.anon-tag { color: #7c3aed; font-size: 12px; font-weight: 600; }
.title { font-size: 14px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
.cpu-section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }

@media (max-width: 640px) {
  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .profile-card {
    gap: 12px;
  }

  .name {
    font-size: 19px;
    flex-wrap: wrap;
  }

  .staff-panel {
    align-items: flex-start;
    flex-direction: column;
  }

  .topic-line {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 2px;
  }

  .title {
    flex-basis: 100%;
    order: 3;
    white-space: normal;
    line-height: 1.45;
  }

  .topic-line .meta {
    margin-left: auto;
  }
}
</style>
