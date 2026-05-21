<template>
  <div class="board-page">
    <div v-if="board" class="board-head">
      <div class="head-left">
        <div class="head-icon" :style="{ background: board.color || '#168776' }">{{ board.icon }}</div>
        <div>
          <h2 class="head-name">{{ board.name }}</h2>
          <p class="head-desc">{{ board.description }}</p>
          <div class="head-meta">
            <span>{{ board.topicCount }} 帖</span>
            <span v-if="board.anonymousEnabled" class="anon-tag">支持匿名</span>
            <span v-if="board.readOnly" class="ro-tag">公告板</span>
            <a v-if="board.feedSource?.homepage" :href="board.feedSource.homepage" target="_blank" class="ro-link">查看来源 →</a>
          </div>
        </div>
      </div>
      <div class="head-right">
        <el-radio-group v-model="sort" size="default" @change="onSortChange">
          <el-radio-button value="new">最新</el-radio-button>
          <el-radio-button value="hot">最热</el-radio-button>
        </el-radio-group>
        <el-button v-if="canPost" type="primary" @click="goPost">
          <el-icon><Edit /></el-icon> 发帖
        </el-button>
      </div>
    </div>

    <div v-if="pinnedList.length" class="topic-list cpu-card pinned-list">
      <div class="section-head">
        <h3>置顶帖</h3>
        <span>{{ pinnedList.length }} 条</span>
      </div>
      <TopicListItem v-for="t in pinnedList" :key="`pin-${t.id}`" :topic="t" />
    </div>

    <div class="topic-list cpu-card" v-loading="loading">
      <div class="section-head">
        <h3>{{ sort === "hot" ? "按热度查看" : "按时间查看" }}</h3>
        <span>{{ total }} 条</span>
      </div>
      <TopicListItem v-for="t in list" :key="t.id" :topic="t" />
      <el-empty v-if="!loading && !list.length" description="还没有帖子" />
      <el-pagination
        v-if="total > size"
        :current-page="page"
        :page-size="size"
        :total="total"
        layout="prev, pager, next"
        class="pager"
        @current-change="onPage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AxiosError } from "axios";
import { Edit } from "@element-plus/icons-vue";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const board = ref<Board | null>(null);
const pinnedList = ref<any[]>([]);
const list = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const sort = ref<"new" | "hot">("new");
const loading = ref(false);

const canPost = computed(() => !!board.value && !board.value.readOnly && auth.canAccessForum);

watch(() => route.params.slug, async () => { await reload(); });
onMounted(async () => { await reload(); });

async function reload() {
  loading.value = true;
  try {
    const slug = String(route.params.slug);
    board.value = await boardApi.detail(slug).catch((error: AxiosError) => {
      if (error.response?.status === 403) {
        router.replace({ name: "forum", query: { redirect: route.fullPath } });
      }
      return null;
    });
    if (!board.value) {
      pinnedList.value = [];
      list.value = [];
      total.value = 0;
      return;
    }
    const [pins, normal] = await Promise.all([
      topicApi.list({ board: slug, size: 20, sort: "new", pinned: "only" }).catch((error: AxiosError) => {
        if (error.response?.status === 403) {
          router.replace({ name: "forum", query: { redirect: route.fullPath } });
        }
        return null;
      }),
      topicApi.list({ board: slug, page: page.value, size: size.value, sort: sort.value, pinned: "exclude" }).catch((error: AxiosError) => {
        if (error.response?.status === 403) {
          router.replace({ name: "forum", query: { redirect: route.fullPath } });
        }
        return null;
      }),
    ]);
    if (!normal) {
      pinnedList.value = [];
      list.value = [];
      total.value = 0;
      return;
    }
    pinnedList.value = pins?.list ?? [];
    list.value = normal.list;
    total.value = normal.total;
  } finally {
    loading.value = false;
  }
}

function onPage(p: number) {
  page.value = p;
  reload();
}

function onSortChange() {
  page.value = 1;
  reload();
}

function goPost() {
  if (!auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: route.fullPath } });
    return;
  }
  router.push({ name: "post", query: { board: route.params.slug } });
}
</script>

<style scoped>
.board-page { display: flex; flex-direction: column; gap: 16px; }

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.head-left { display: flex; gap: 14px; align-items: flex-start; }
.head-icon {
  width: 56px; height: 56px; border-radius: 12px;
  display: grid; place-items: center;
  font-size: 28px; color: #fff;
  flex-shrink: 0;
}

.head-name { margin: 0; font-size: 22px; color: #1f2937; }
.head-desc { margin: 4px 0 6px; font-size: 13px; color: #6b7280; }
.head-meta {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #9ca3af;
  align-items: center;
}
.ro-tag { color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 4px; }
.anon-tag { color: #6d28d9; background: #f3e8ff; padding: 2px 8px; border-radius: 4px; }
.ro-link { color: var(--cpu-primary); text-decoration: none; }
.ro-link:hover { text-decoration: underline; }

.head-right { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }

.topic-list { padding: 8px 6px; }
.cpu-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px 10px;
}
.section-head h3 {
  margin: 0;
  font-size: 15px;
  color: #1f2937;
}
.section-head span {
  font-size: 12px;
  color: #9ca3af;
}
.pinned-list {
  border: 1px solid #fee2e2;
  background: linear-gradient(180deg, #fff9f9 0%, #ffffff 100%);
}

.pager { padding: 12px; display: flex; justify-content: center; }

@media (max-width: 700px) {
  .board-head {
    flex-direction: column;
  }

  .head-left {
    width: 100%;
  }

  .head-icon {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    font-size: 24px;
  }

  .head-name {
    font-size: 20px;
  }

  .head-desc {
    line-height: 1.55;
  }

  .head-meta {
    gap: 8px;
    flex-wrap: wrap;
    line-height: 1.5;
  }

  .head-right {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }

  .head-right .el-button {
    flex: 1;
  }

  .topic-list {
    border-radius: 10px;
    padding: 4px;
  }

  .section-head {
    padding: 8px 8px 10px;
  }

  .pager {
    padding: 10px 0 6px;
  }
}
</style>
