<template>
  <div class="forum-index">
    <h2 class="page-title">论坛板块</h2>

    <!-- 公告板（爬虫聚合） -->
    <div class="cluster">
      <h3 class="cluster-title">📢 学校公告（自动同步）</h3>
      <div class="grid">
        <div v-for="b in announces" :key="b.slug" class="board-card readonly" @click="$router.push(`/forum/b/${b.slug}`)">
          <div class="icon" :style="{ background: b.color || '#1d4d8a' }">{{ b.icon || '📢' }}</div>
          <div class="body">
            <div class="name">{{ b.name }}</div>
            <div class="desc">{{ b.description }}</div>
            <div class="meta">{{ b.topicCount }} 条 · 同步自 {{ shortHost(b.feedSource?.homepage) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 综合 / 生活 / 新生 -->
    <div class="cluster" v-if="general.length">
      <h3 class="cluster-title">💬 综合讨论</h3>
      <div class="grid">
        <div v-for="b in general" :key="b.slug" class="board-card" @click="$router.push(`/forum/b/${b.slug}`)">
          <div class="icon" :style="{ background: b.color || '#168776' }">{{ b.icon || '💬' }}</div>
          <div class="body">
            <div class="name">{{ b.name }}</div>
            <div class="desc">{{ b.description }}</div>
            <div class="meta">{{ b.topicCount }} 帖</div>
          </div>
        </div>
      </div>
    </div>

    <!-- UGC 三件套 -->
    <div class="cluster" v-if="ugc.length">
      <h3 class="cluster-title">🎒 UGC 板块</h3>
      <div class="grid">
        <div v-for="b in ugc" :key="b.slug" class="board-card" @click="$router.push(`/forum/b/${b.slug}`)">
          <div class="icon" :style="{ background: b.color || '#168776' }">{{ b.icon || '🎒' }}</div>
          <div class="body">
            <div class="name">{{ b.name }}</div>
            <div class="desc">{{ b.description }}</div>
            <div class="meta">{{ b.topicCount }} 帖</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { boardApi, type Board } from "@/api/board";

const all = ref<Board[]>([]);
onMounted(async () => {
  all.value = await boardApi.list();
});

const announces = computed(() => all.value.filter((b) => b.type === "announce"));
const general = computed(() => all.value.filter((b) => b.type === "normal"));
const ugc = computed(() => all.value.filter((b) => ["market", "question", "coursereview"].includes(b.type)));

function shortHost(url?: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return url; }
}
</script>

<style scoped>
.forum-index { display: flex; flex-direction: column; gap: 24px; }
.page-title { margin: 0; font-size: 22px; }
.cluster-title { margin: 0 0 12px; font-size: 16px; color: #1f2937; font-weight: 600; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.board-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.board-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 4px 14px rgba(22, 135, 118, 0.08);
}
.board-card.readonly { background: linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%); }

.icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 20px;
  flex-shrink: 0;
  color: #fff;
}

.body { flex: 1; min-width: 0; }
.name { font-size: 15px; font-weight: 600; color: #1f2937; }
.desc {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.meta {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
}

@media (max-width: 640px) {
  .forum-index {
    gap: 18px;
  }

  .page-title {
    font-size: 20px;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .board-card {
    border-radius: 10px;
    padding: 12px;
  }

  .desc {
    -webkit-line-clamp: 2;
  }
}
</style>
