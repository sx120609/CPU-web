<template>
  <div class="feed-page">
    <div class="feed-head">
      <div>
        <h2 class="title">{{ isHot ? "热榜 Top 10" : "最新内容" }}</h2>
        <p class="desc">
          {{ isHot ? "这里展示近 24 小时讨论最活跃的内容。" : "这里按照发布时间查看近期更新。" }}
        </p>
      </div>
    </div>

    <section class="cpu-card" v-loading="loading">
      <template v-if="isHot">
        <div v-for="item in hotList" :key="item.id" class="rank-row" @click="$router.push(`/forum/topic/${item.id}`)">
          <div class="rank-no" :class="{ top3: item.rank <= 3 }">#{{ item.rank }}</div>
          <div class="rank-main">
            <div class="rank-title">{{ item.title }}</div>
            <div class="rank-meta">
              <span>{{ item.board?.name }}</span>
              <span>{{ item.replyCount }} 回</span>
              <span>{{ item.likeCount }} 赞</span>
              <span>{{ fmtRelative(item.lastReplyAt || item.createdAt) }}</span>
            </div>
          </div>
          <div class="rank-score">{{ Math.round(item.hotScore || 0) }}</div>
        </div>
      </template>

      <template v-else>
        <div v-if="pinnedList.length" class="pin-section">
          <div class="section-head">
            <h3>全局置顶</h3>
            <span>{{ pinnedList.length }} 条</span>
          </div>
          <TopicListItem v-for="t in pinnedList" :key="`pin-${t.id}`" :topic="t" />
        </div>
        <div class="section-head" v-if="latestList.length || latestTotal">
          <h3>最新内容</h3>
          <span>已显示 {{ latestList.length }} / {{ latestTotal }}</span>
        </div>
        <TopicListItem v-for="t in latestList" :key="t.id" :topic="t" />
        <div v-if="latestTotal > latestSize" class="latest-actions">
          <el-button v-if="canLoadMore" :loading="loadingMore" @click="loadMore">
            加载更多
          </el-button>
          <el-button v-if="latestList.length > latestSize" text @click="backToTop">
            回到顶部
          </el-button>
        </div>
      </template>

      <el-empty v-if="!loading && !currentList.length" description="暂无内容" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { homeApi } from "@/api/home";
import { fmtRelative } from "@/utils/format";

const route = useRoute();
const isHot = computed(() => route.name === "forum-hot");
const loading = ref(false);
const loadingMore = ref(false);
const hotList = ref<any[]>([]);
const pinnedList = ref<any[]>([]);
const latestList = ref<any[]>([]);
const latestTotal = ref(0);
const latestPage = ref(1);
const latestSize = ref(15);
const currentList = computed(() => isHot.value ? hotList.value : [...pinnedList.value, ...latestList.value]);
const canLoadMore = computed(() => !isHot.value && latestList.value.length < latestTotal.value);

watch(() => route.name, () => {
  resetState();
  void load();
}, { immediate: true });

async function load() {
  loading.value = true;
  try {
    if (isHot.value) {
      hotList.value = await homeApi.hotRanking();
      pinnedList.value = [];
      latestList.value = [];
      latestTotal.value = 0;
      return;
    }
    const res = await homeApi.latestFeed({ page: latestPage.value, size: latestSize.value });
    pinnedList.value = res.pins ?? [];
    latestList.value = res.list ?? [];
    latestTotal.value = res.total;
  } finally {
    loading.value = false;
  }
}

function resetState() {
  hotList.value = [];
  pinnedList.value = [];
  latestList.value = [];
  latestTotal.value = 0;
  latestPage.value = 1;
}

async function loadMore() {
  if (!canLoadMore.value || loadingMore.value) return;
  loadingMore.value = true;
  const nextPage = latestPage.value + 1;
  try {
    const res = await homeApi.latestFeed({ page: nextPage, size: latestSize.value });
    latestPage.value = nextPage;
    pinnedList.value = res.pins ?? pinnedList.value;
    latestTotal.value = res.total;
    latestList.value = [...latestList.value, ...(res.list ?? [])];
  } finally {
    loadingMore.value = false;
  }
}

function backToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
</script>

<style scoped>
.feed-page { display: flex; flex-direction: column; gap: 16px; }
.feed-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.title { margin: 0; font-size: 22px; color: #111827; }
.desc { margin: 6px 0 0; font-size: 13px; color: #6b7280; line-height: 1.65; }
.cpu-card { background: #fff; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04); }
.pin-section {
  margin-bottom: 12px;
  border: 1px solid #fee2e2;
  border-radius: 12px;
  background: linear-gradient(180deg, #fff9f9 0%, #ffffff 100%);
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 10px 8px;
}
.section-head h3 {
  margin: 0;
  font-size: 15px;
  color: #111827;
}
.section-head span {
  font-size: 12px;
  color: #9ca3af;
}

.rank-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 4px;
  border-bottom: 1px dashed #eef2f7;
  cursor: pointer;
}
.rank-row:last-child { border-bottom: none; }
.rank-no {
  min-width: 44px;
  font-size: 13px;
  font-weight: 800;
  color: #94a3b8;
}
.rank-no.top3 { color: #dc2626; }
.rank-title { font-size: 15px; font-weight: 600; color: #111827; line-height: 1.5; }
.rank-meta {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: #6b7280;
}
.rank-score {
  min-width: 50px;
  text-align: right;
  font-size: 18px;
  font-weight: 700;
  color: var(--cpu-primary);
}
.latest-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding-top: 14px;
}

@media (max-width: 700px) {
  .feed-page { gap: 12px; }
  .title { font-size: 20px; }
  .cpu-card { border-radius: 10px; padding: 12px; }
  .section-head {
    padding: 8px 8px 6px;
  }
  .rank-row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .rank-score {
    grid-column: 2;
    text-align: left;
    min-width: 0;
    font-size: 14px;
  }

  .latest-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
