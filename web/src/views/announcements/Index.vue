<template>
  <div class="announce-page">
    <header class="page-head">
      <h1 class="title">📢 校园公告</h1>
      <p class="sub">来自学校官方公开站点的自动聚合 · 与本站言论无关</p>
    </header>

    <div v-loading="loading" class="cluster">
      <el-empty v-if="!loading && !boards.length" description="暂无公告来源" />
      <div v-for="b in boards" :key="b.slug" class="board-card" @click="$router.push(`/forum/b/${b.slug}`)">
        <div class="icon" :style="{ background: b.color || '#1d4d8a' }">{{ b.icon || '📢' }}</div>
        <div class="body">
          <div class="name-row">
            <span class="name">{{ b.name }}</span>
            <span class="count">{{ b.topicCount }} 条</span>
          </div>
          <div class="desc" v-if="b.description">{{ b.description }}</div>
          <div class="meta">
            <span v-if="b.feedSource?.homepage">同步自 {{ shortHost(b.feedSource.homepage) }}</span>
            <span v-if="b.feedSource?.lastRunAt" class="time">· 最近抓取 {{ fmtRelative(b.feedSource.lastRunAt) }}</span>
          </div>
        </div>
        <el-icon class="arrow"><Right /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Right } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";
import { fmtRelative } from "@/utils/format";

const all = ref<Board[]>([]);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try { all.value = await boardApi.list(); }
  finally { loading.value = false; }
});

const boards = computed(() => all.value.filter((b) => b.type === "announce"));

function shortHost(url?: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return url; }
}
</script>

<style scoped>
.announce-page { display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; flex-direction: column; gap: 4px; }
.title { margin: 0; font-size: 22px; color: #1f2937; }
.sub { margin: 0; font-size: 12px; color: #6b7280; }

.cluster { display: flex; flex-direction: column; gap: 10px; }

.board-card {
  background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%);
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.board-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 4px 14px rgba(22, 135, 118, 0.08);
}
.board-card:active { transform: scale(0.99); }

.icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 22px;
  flex-shrink: 0;
  color: #fff;
}

.body { flex: 1; min-width: 0; }
.name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.name { font-size: 15px; font-weight: 600; color: #1f2937; }
.count { font-size: 12px; color: #6b7280; }
.desc {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.meta {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.meta .time { color: #9ca3af; }

.arrow { color: #9ca3af; flex-shrink: 0; font-size: 16px; }

@media (max-width: 640px) {
  .announce-page { gap: 14px; }
  .title { font-size: 20px; }
  .board-card {
    padding: 12px 14px;
    border-radius: 10px;
  }
  .icon { width: 40px; height: 40px; font-size: 20px; border-radius: 10px; }
}
</style>
