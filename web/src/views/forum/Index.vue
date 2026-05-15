<template>
  <div class="forum-index">
    <h2 class="page-title">讨论板块</h2>

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

    <!-- 学生共建板块 -->
    <div class="cluster" v-if="ugc.length">
      <h3 class="cluster-title">🎒 学生共建</h3>
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

    <div class="footer-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>查看学校官方公告？<router-link to="/announcements">→ 校园公告</router-link></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { InfoFilled } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";

const all = ref<Board[]>([]);
onMounted(async () => {
  all.value = await boardApi.list();
});

const general = computed(() => all.value.filter((b) => b.type === "normal"));
const ugc = computed(() => all.value.filter((b) => ["market", "question", "coursereview"].includes(b.type)));
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

.footer-tip {
  margin-top: 8px;
  padding: 10px 14px;
  background: #f9fafb;
  border-radius: 10px;
  font-size: 13px;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 6px;
}
.footer-tip a {
  color: var(--cpu-primary);
  text-decoration: none;
  font-weight: 500;
}
.footer-tip a:hover { text-decoration: underline; }

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
