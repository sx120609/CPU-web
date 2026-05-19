<template>
  <div class="feed-page">
    <div class="feed-head">
      <div>
        <h2 class="title">{{ isHot ? "热榜 Top 10" : "最新内容" }}</h2>
        <p class="desc">
          {{ isHot ? "优先展示近 24 小时内的高热内容，公告稿件不进入榜单。" : "聚合所有内容分区，按发布时间从新到老排列，公告稿件已剔除。" }}
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
        <TopicListItem v-for="t in latestList" :key="t.id" :topic="t" />
        <el-pagination
          v-if="latestTotal > latestSize"
          :current-page="latestPage"
          :page-size="latestSize"
          :total="latestTotal"
          layout="prev, pager, next"
          class="pager"
          @current-change="onPage"
        />
      </template>

      <el-empty v-if="!loading && !currentList.length" description="暂无内容" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { homeApi } from "@/api/home";
import { fmtRelative } from "@/utils/format";

const route = useRoute();
const isHot = computed(() => route.name === "forum-hot");
const loading = ref(false);
const hotList = ref<any[]>([]);
const latestList = ref<any[]>([]);
const latestTotal = ref(0);
const latestPage = ref(1);
const latestSize = ref(20);
const currentList = computed(() => isHot.value ? hotList.value : latestList.value);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    if (isHot.value) {
      hotList.value = await homeApi.hotRanking();
      return;
    }
    const res = await homeApi.latestFeed({ page: latestPage.value, size: latestSize.value });
    latestList.value = res.list;
    latestTotal.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function onPage(page: number) {
  latestPage.value = page;
  await load();
}
</script>

<style scoped>
.feed-page { display: flex; flex-direction: column; gap: 16px; }
.feed-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.title { margin: 0; font-size: 22px; color: #111827; }
.desc { margin: 6px 0 0; font-size: 13px; color: #6b7280; line-height: 1.65; }
.cpu-card { background: #fff; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04); }

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
.pager { display: flex; justify-content: center; padding-top: 12px; }

@media (max-width: 700px) {
  .feed-page { gap: 12px; }
  .title { font-size: 20px; }
  .cpu-card { border-radius: 10px; padding: 12px; }
  .rank-row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .rank-score {
    grid-column: 2;
    text-align: left;
    min-width: 0;
    font-size: 14px;
  }
}
</style>
