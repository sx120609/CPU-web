<template>
  <div class="course-detail" v-if="data" v-loading="loading">
    <div class="cpu-card head">
      <div class="left">
        <div class="code">{{ data.course.code }}</div>
        <h2 class="name">{{ data.course.name }}</h2>
        <div class="teacher">教师：{{ data.course.teacher }}</div>
        <div class="meta">
          <el-tag v-if="data.course.credits">{{ data.course.credits }} 学分</el-tag>
          <el-tag v-if="data.course.category">{{ data.course.category }}</el-tag>
          <el-tag v-if="data.course.college">{{ data.course.college }}</el-tag>
        </div>
      </div>
      <div class="right" v-if="data.course.ratingCount">
        <div class="score">{{ data.course.avgScore.toFixed(1) }}</div>
        <div class="sub">综合给分</div>
        <div class="dim">
          <div>难度 {{ data.course.avgDifficulty.toFixed(1) }}</div>
          <div>收获 {{ data.course.avgReward.toFixed(1) }}</div>
          <div>推荐 {{ data.course.avgRecommend.toFixed(1) }}</div>
        </div>
      </div>
    </div>

    <div class="cpu-card">
      <div class="head-row">
        <h3 class="cpu-section-title">学生点评 ({{ data.ratings.length }})</h3>
        <el-button v-if="auth.isLoggedIn" type="primary" size="small" @click="goReview">
          <el-icon><Edit /></el-icon> 写一篇
        </el-button>
      </div>
      <el-empty v-if="!data.ratings.length" description="还没有点评，做第一个吧" />
      <div v-for="r in data.ratings" :key="r.id" class="rating-item" @click="$router.push(`/forum/topic/${r.topicId}`)">
        <div class="r-bars">
          <div>难度 <el-rate :model-value="r.difficulty" disabled size="small" /></div>
          <div>收获 <el-rate :model-value="r.reward" disabled size="small" /></div>
          <div>推荐 <el-rate :model-value="r.recommend" disabled size="small" /></div>
          <div>给分 <el-rate :model-value="r.givingScore" disabled size="small" /></div>
        </div>
        <div class="r-meta">
          <span v-if="r.semester">{{ r.semester }}</span>
          <span>·</span>
          <span>{{ fmtDate(r.createdAt, "YYYY-MM-DD") }}</span>
          <span class="goto">查看完整点评 →</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Edit } from "@element-plus/icons-vue";
import { courseApi } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const data = ref<any>(null);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    data.value = await courseApi.detail(Number(route.params.id));
  } finally { loading.value = false; }
});

function goReview() {
  router.push({ name: "post", query: { board: "coursereview", courseId: route.params.id } });
}
</script>

<style scoped>
.course-detail { display: flex; flex-direction: column; gap: 16px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}
.code { font-size: 12px; color: #9ca3af; }
.name { margin: 4px 0 6px; font-size: 24px; }
.teacher { font-size: 14px; color: #4b5563; margin-bottom: 8px; }
.meta { display: flex; gap: 6px; flex-wrap: wrap; }

.right { text-align: right; }
.score { font-size: 48px; color: var(--cpu-primary); font-weight: 700; line-height: 1; }
.sub { font-size: 12px; color: #6b7280; }
.dim { margin-top: 10px; font-size: 13px; color: #4b5563; line-height: 1.8; }

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.cpu-section-title { margin: 0; font-size: 16px; font-weight: 600; }

.rating-item {
  padding: 12px 0;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
}
.rating-item:last-child { border-bottom: none; }
.rating-item:hover { background: #f9fafb; border-radius: 8px; }

.r-bars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
}
.r-bars > div { display: flex; align-items: center; gap: 4px; }
@media (max-width: 700px) { .r-bars { grid-template-columns: 1fr 1fr; } }

.r-meta {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 6px;
  display: flex;
  gap: 8px;
}
.goto { color: var(--cpu-primary); margin-left: auto; }
</style>
