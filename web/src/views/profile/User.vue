<template>
  <div class="user-page" v-if="user">
    <div class="cpu-card profile-card">
      <el-avatar :size="64" class="avatar">{{ user.nickname?.[0] }}</el-avatar>
      <div>
        <h2 class="name">
          {{ user.nickname }}
          <el-tag v-if="user.role === 'admin'" size="small" type="danger">管理员</el-tag>
          <el-tag v-else-if="user.role === 'bot'" size="small" type="warning">机器人</el-tag>
        </h2>
        <p class="username">@{{ user.username }}</p>
        <p class="bio">{{ user.bio || "—" }}</p>
        <div class="meta">
          <span v-if="user.college">{{ user.college }}</span>
          <span v-if="user.enrollYear">{{ user.enrollYear }} 级</span>
          <span>发帖 {{ user.postCount }}</span>
          <span>回复 {{ user.replyCount }}</span>
          <span>声望 {{ user.reputation }}</span>
        </div>
      </div>
    </div>

    <div class="cpu-card">
      <h3 class="cpu-section-title">TA 发布的帖子（{{ topics.length }}）</h3>
      <el-empty v-if="!topics.length" description="还没有发过帖子" />
      <div v-for="t in topics" :key="t.id" class="topic-line" @click="$router.push(`/forum/topic/${t.id}`)">
        <span class="tag" :style="{ background: t.board?.color || '#168776' }">{{ t.board?.name }}</span>
        <span class="title">{{ t.title }}</span>
        <span class="meta">{{ fmtRelative(t.createdAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { request } from "@/api/request";
import { fmtRelative } from "@/utils/format";

const route = useRoute();
const user = ref<any>(null);
const topics = ref<any[]>([]);

watch(() => route.params.id, load);
onMounted(load);

async function load() {
  const id = Number(route.params.id);
  user.value = await request.get<any>(`/user/${id}`);
  topics.value = await request.get<any[]>(`/user/${id}/topics`);
}
</script>

<style scoped>
.user-page { display: flex; flex-direction: column; gap: 16px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.profile-card { display: flex; align-items: flex-start; gap: 16px; }
.avatar { background: linear-gradient(135deg, #168776, #0f6557); color: #fff; font-size: 24px; font-weight: 600; flex-shrink: 0; }
.name { margin: 0; font-size: 20px; display: flex; align-items: center; gap: 8px; }
.username { font-size: 12px; color: #9ca3af; margin: 2px 0 6px; }
.bio { font-size: 13px; color: #4b5563; margin: 0 0 8px; }
.meta { display: flex; gap: 12px; font-size: 12px; color: #6b7280; flex-wrap: wrap; }

.topic-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
  border-radius: 6px;
}
.topic-line:last-child { border-bottom: none; }
.topic-line:hover { background: #f4f6f8; }
.tag { color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.title { font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
