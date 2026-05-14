<template>
  <div class="cr-page">
    <div class="head">
      <h2>📊 课程点评</h2>
      <el-button v-if="auth.isLoggedIn" type="primary" @click="$router.push({ name: 'post', query: { board: 'coursereview' } })">
        <el-icon><Plus /></el-icon> 写课评
      </el-button>
    </div>

    <el-input v-model="q" placeholder="搜课程名 / 课程代码 / 教师" clearable style="max-width:360px" @keyup.enter="reload">
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>

    <div class="course-grid" v-loading="loading">
      <div v-for="c in list" :key="c.id" class="course" @click="$router.push(`/coursereview/${c.id}`)">
        <div class="c-head">
          <div>
            <div class="code">{{ c.code }}</div>
            <div class="name">{{ c.name }}</div>
            <div class="teacher">{{ c.teacher }}</div>
          </div>
          <div class="score-block" v-if="c.ratingCount">
            <div class="score">{{ c.avgScore.toFixed(1) }}</div>
            <div class="sub">{{ c.ratingCount }} 评</div>
          </div>
          <div v-else class="no-rate">暂无评价</div>
        </div>

        <div v-if="c.ratingCount" class="bars">
          <div class="bar"><span>难度</span><el-rate :model-value="Math.round(c.avgDifficulty)" disabled size="small" /></div>
          <div class="bar"><span>收获</span><el-rate :model-value="Math.round(c.avgReward)" disabled size="small" /></div>
          <div class="bar"><span>推荐</span><el-rate :model-value="Math.round(c.avgRecommend)" disabled size="small" /></div>
        </div>
        <div class="c-foot">
          <span v-if="c.credits">{{ c.credits }} 学分</span>
          <span v-if="c.category">{{ c.category }}</span>
          <span v-if="c.college">{{ c.college }}</span>
        </div>
      </div>
      <el-empty v-if="!loading && !list.length" description="没有匹配课程" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Plus, Search } from "@element-plus/icons-vue";
import { courseApi, type Course } from "@/api/course";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const list = ref<Course[]>([]);
const q = ref("");
const loading = ref(false);

onMounted(reload);

async function reload() {
  loading.value = true;
  try { list.value = await courseApi.list(q.value); }
  finally { loading.value = false; }
}
</script>

<style scoped>
.cr-page { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; }
.head h2 { margin: 0; font-size: 22px; }

.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.course {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.course:hover { border-color: var(--cpu-primary); box-shadow: 0 4px 12px rgba(22,135,118,0.08); }

.c-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.code { font-size: 11px; color: #9ca3af; }
.name { font-size: 16px; color: #1f2937; font-weight: 600; margin-top: 2px; }
.teacher { font-size: 12px; color: #6b7280; margin-top: 2px; }

.score-block { text-align: right; }
.score { font-size: 28px; font-weight: 700; color: var(--cpu-primary); line-height: 1; }
.sub { font-size: 11px; color: #9ca3af; }
.no-rate { font-size: 12px; color: #9ca3af; padding: 6px 0; }

.bars { margin: 10px 0; }
.bar { display: flex; gap: 8px; align-items: center; font-size: 11px; color: #6b7280; }
.bar span { width: 28px; }

.c-foot {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #9ca3af;
  border-top: 1px dashed #f1f5f9;
  padding-top: 8px;
}
</style>
