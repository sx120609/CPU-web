<template>
  <div class="forum-index">
      <h2 class="page-title">讨论板块</h2>

      <div v-if="error && !loading" class="cpu-card forum-error">
        <el-empty :description="error">
          <el-button type="primary" @click="loadBoards">重试</el-button>
        </el-empty>
      </div>

      <template v-else>
        <button type="button" class="latest-entry cpu-card" @click="$router.push('/forum/latest')">
          <div class="latest-entry-icon">🆕</div>
          <div class="latest-entry-body">
            <div class="latest-entry-title">最新内容</div>
            <div class="latest-entry-desc">按时间看看最近有哪些新帖子和新回复</div>
          </div>
          <span class="latest-entry-arrow">查看全部 →</span>
        </button>

        <div v-loading="loading" class="boards-content">
          <div class="cluster" v-if="general.length">
            <h3 class="cluster-title">💬 综合讨论</h3>
            <div class="grid">
              <div
                v-for="b in general"
                :key="b.slug"
                class="board-card"
                role="button"
                tabindex="0"
                @click="openBoard(b.slug)"
                @keydown.enter.prevent="openBoard(b.slug)"
                @keydown.space.prevent="openBoard(b.slug)"
              >
                <div class="icon" :style="{ background: b.color || '#168776' }">{{ b.icon || "💬" }}</div>
                <div class="body">
                  <div class="name">{{ b.name }}</div>
                  <div class="desc">{{ b.description }}</div>
                  <div class="meta">{{ b.topicCount }} 帖</div>
                </div>
              </div>
            </div>
          </div>

          <div class="cluster" v-if="ugc.length">
            <h3 class="cluster-title">🎒 学生共建</h3>
            <div class="grid">
              <div
                v-for="b in ugc"
                :key="b.slug"
                class="board-card"
                role="button"
                tabindex="0"
                @click="openBoard(b.slug)"
                @keydown.enter.prevent="openBoard(b.slug)"
                @keydown.space.prevent="openBoard(b.slug)"
              >
                <div class="icon" :style="{ background: b.color || '#168776' }">{{ b.icon || "🎒" }}</div>
                <div class="body">
                  <div class="name">{{ b.name }}</div>
                  <div class="desc">{{ b.description }}</div>
                  <div class="meta">{{ b.topicCount }} 帖</div>
                </div>
              </div>
            </div>
          </div>

          <div class="cluster" v-if="campusWall">
            <h3 class="cluster-title">📮 外部镜像</h3>
            <div class="grid">
              <div
                class="board-card readonly"
                role="button"
                tabindex="0"
                @click="openBoard(campusWall.slug)"
                @keydown.enter.prevent="openBoard(campusWall.slug)"
                @keydown.space.prevent="openBoard(campusWall.slug)"
              >
                <div class="icon" :style="{ background: campusWall.color || '#0ea5e9' }">{{ campusWall.icon || "📮" }}</div>
                <div class="body">
                  <div class="name">{{ campusWall.name }}</div>
                  <div class="desc">单独展示的逛逛镜像内容，不参与本站热榜和最新流；仅补充近 3 天稿件的后续更新，超过三天的稿件不再更新。</div>
                  <div class="meta">{{ campusWall.topicCount }} 帖</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="footer-tip">
        <el-icon><InfoFilled /></el-icon>
        <span>查看学校官方公告？<router-link to="/announcements">→ 校园公告</router-link></span>
      </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { InfoFilled } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";

const router = useRouter();
const CAMPUS_WALL_SLUG = "campus-wall";

const all = ref<Board[]>([]);
const loading = ref(false);
const error = ref("");
let disposed = false;
let boardLoadSeq = 0;

onMounted(loadBoards);

onBeforeUnmount(() => {
  disposed = true;
  boardLoadSeq += 1;
});

const general = computed(() => all.value.filter((b) => b.type === "normal" && b.slug !== CAMPUS_WALL_SLUG));
const ugc = computed(() => all.value.filter((b) => ["market", "question", "coursereview"].includes(b.type)));
const campusWall = computed(() => all.value.find((b) => b.slug === CAMPUS_WALL_SLUG) ?? null);

async function loadBoards() {
  if (disposed) return;
  const seq = ++boardLoadSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await boardApi.list({ suppressErrorMessage: true });
    if (disposed || seq !== boardLoadSeq) return;
    all.value = next;
  } catch (e) {
    if (disposed || seq !== boardLoadSeq) return;
    all.value = [];
    error.value = normalizeBoardListError(e);
  } finally {
    if (!disposed && seq === boardLoadSeq) loading.value = false;
  }
}

function normalizeBoardListError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "板块列表加载失败";
  }
  return "板块列表加载失败，请稍后再试";
}

function openBoard(slug: string) {
  const board = all.value.find((item) => item.slug === slug);
  if (board?.type === "market") {
    router.push("/market");
    return;
  }
  router.push(`/forum/b/${slug}`);
}
</script>

<style scoped>
.forum-index { display: flex; flex-direction: column; gap: 24px; }
.page-title { margin: 0; font-size: 22px; }
.cluster-title { margin: 0 0 12px; font-size: 16px; color: var(--cpu-text); font-weight: 600; }
.cpu-card {
  background: var(--cpu-card);
  border-radius: 14px;
  border: 1px solid var(--cpu-border-soft);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}
.boards-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 120px;
}
.forum-error {
  padding: 24px 16px;
}
.latest-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.latest-entry:hover {
  border-color: var(--cpu-primary);
  transform: translateY(-1px);
  box-shadow: 0 10px 28px rgba(22, 135, 118, 0.08);
}
.latest-entry-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.22);
  font-size: 24px;
  flex-shrink: 0;
}
.latest-entry-body {
  flex: 1;
  min-width: 0;
}
.latest-entry-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--cpu-text);
}
.latest-entry-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
  line-height: 1.55;
}
.latest-entry-arrow {
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 12px;
}

.board-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
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

.board-card:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.board-card.readonly { background: linear-gradient(135deg, var(--cpu-card) 0%, rgba(16, 185, 129, 0.08) 100%); }

.footer-tip {
  margin-top: 8px;
  padding: 10px 14px;
  background: var(--cpu-surface-subtle);
  border-radius: 10px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
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
.name { font-size: 15px; font-weight: 600; color: var(--cpu-text); overflow-wrap: anywhere; }

.desc {
  font-size: 12px;
  color: var(--cpu-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}

.meta {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .forum-index {
    gap: 18px;
  }

  .page-title {
    font-size: 20px;
  }

  .latest-entry {
    align-items: flex-start;
    padding: 14px;
    gap: 12px;
  }

  .latest-entry-arrow {
    display: none;
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
