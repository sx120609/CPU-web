<template>
  <div class="course-detail" v-loading="loading">
    <template v-if="data">
    <div class="cpu-card head">
      <div class="left">
        <div class="code">{{ data.course.code }}</div>
        <h2 class="name">{{ data.course.name }}</h2>
        <div class="teacher-row">
          <span class="teacher-label">授课老师：</span>
          <template v-if="data.course.teachers?.length">
            <el-tag
              v-for="t in data.course.teachers"
              :key="t.courseTeacherId"
              size="small"
              effect="plain"
              class="teacher-tag"
            >{{ t.name }}</el-tag>
          </template>
          <span v-else class="muted">暂无（点击下方"+ 添加"或在写点评时录入）</span>
          <el-button
            v-if="auth.canAccessForum"
            text size="small"
            class="add-teacher-btn"
            :loading="addingTeacher"
            :disabled="addingTeacher"
            @click="onAddTeacher"
          >+ 添加老师</el-button>
        </div>
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
        <el-button v-if="auth.canAccessForum" type="primary" size="small" @click="goReview">
          <el-icon><Edit /></el-icon> 写一篇
        </el-button>
      </div>
      <el-empty v-if="!data.ratings.length" description="还没有点评，做第一个吧" />
      <div
        v-for="r in data.ratings"
        :key="r.id"
        class="rating-item"
        role="button"
        tabindex="0"
        @click="openTopic(r.topicId)"
        @keydown.enter.prevent="openTopic(r.topicId)"
        @keydown.space.prevent="openTopic(r.topicId)"
      >
        <div class="r-bars">
          <div>难度 <el-rate :model-value="r.difficulty" disabled size="small" /></div>
          <div>收获 <el-rate :model-value="r.reward" disabled size="small" /></div>
          <div>推荐 <el-rate :model-value="r.recommend" disabled size="small" /></div>
          <div>给分 <el-rate :model-value="r.givingScore" disabled size="small" /></div>
        </div>
        <div class="r-meta">
          <span v-if="r.teacherName" class="teacher-pill">@{{ r.teacherName }}</span>
          <span v-if="r.semester">{{ r.semester }}</span>
          <span v-if="r.semester || r.teacherName">·</span>
          <span>{{ fmtDate(r.createdAt, "YYYY-MM-DD") }}</span>
          <span class="goto">查看完整点评 →</span>
        </div>
      </div>
    </div>
    </template>

    <div v-else-if="error && !loading" class="cpu-card detail-error">
      <el-empty :description="error">
        <el-button type="primary" @click="reload">重试</el-button>
      </el-empty>
    </div>
    <div v-else class="cpu-card loading-state">正在加载课程...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Edit } from "@element-plus/icons-vue";
import { courseApi } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const data = ref<any>(null);
const loading = ref(false);
const addingTeacher = ref(false);
const error = ref("");
let loadSeq = 0;

onMounted(reload);
watch(() => route.params.id, () => {
  void reload();
});

async function reload() {
  const courseId = Number(route.params.id);
  if (!Number.isFinite(courseId) || courseId <= 0) {
    data.value = null;
    error.value = "课程不存在或已被删除";
    return;
  }
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const nextData = await courseApi.detail(courseId, { suppressErrorMessage: true });
    if (seq === loadSeq) data.value = nextData;
  } catch (e) {
    if (seq === loadSeq) {
      data.value = null;
      error.value = normalizeCourseDetailError(e);
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function goReview() {
  router.push({ name: "post", query: { board: "coursereview", courseId: route.params.id } });
}

function openTopic(topicId: number) {
  router.push(`/forum/topic/${topicId}`);
}

async function onAddTeacher() {
  if (addingTeacher.value) return;
  const courseId = Number(route.params.id);
  if (!Number.isFinite(courseId) || courseId <= 0) return;
  const { value } = await ElMessageBox.prompt(
    "请输入这位老师的姓名（与教务系统一致更好）",
    "添加授课老师",
    {
      inputPlaceholder: "如：王明远",
      inputValidator: (v) => !!v && v.trim().length >= 1 && v.trim().length <= 40,
      inputErrorMessage: "1-40 个字",
    }
  ).catch(() => ({ value: null as any }));
  const name = String(value || "").trim();
  if (!name) return;
  addingTeacher.value = true;
  try {
    await courseApi.addTeacher(courseId, name);
    ElMessage.success("已添加");
    await reload();
  } finally {
    addingTeacher.value = false;
  }
}

function normalizeCourseDetailError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 404) return "课程不存在或已被删除";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "课程详情加载失败";
  }
  return "课程详情加载失败，请稍后再试";
}
</script>

<style scoped>
.course-detail { display: flex; flex-direction: column; gap: 16px; }
.cpu-card { background: var(--cpu-card); border-radius: var(--cpu-radius-l); padding: 20px 24px; }
.detail-error,
.loading-state {
  min-height: 180px;
}
.loading-state {
  display: grid;
  place-items: center;
  color: var(--cpu-text-muted);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}
.code { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.name { margin: 4px 0 6px; font-size: var(--cpu-fs-xl); }
.teacher-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--cpu-fs-m);
  color: var(--cpu-text-secondary);
  margin-bottom: 8px;
}
.teacher-label { color: var(--cpu-text-muted); }
.teacher-tag { margin: 2px 0; }
.add-teacher-btn { margin-left: 4px; }
.muted { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.teacher-pill {
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  padding: 1px 8px;
  border-radius: var(--cpu-radius-m);
  font-size: var(--cpu-fs-xs);
}
.meta { display: flex; gap: 6px; flex-wrap: wrap; }

.right { text-align: right; }
.score { font-size: 48px; color: var(--cpu-primary); font-weight: 700; line-height: 1; }
.sub { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.dim { margin-top: 10px; font-size: var(--cpu-fs-s); color: var(--cpu-text-secondary); line-height: 1.8; }

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.cpu-section-title { margin: 0; font-size: var(--cpu-fs-l); font-weight: 500; }

.rating-item {
  padding: 12px 0;
  border-bottom: 1px dashed var(--cpu-border-soft);
  cursor: pointer;
}
.rating-item:last-child { border-bottom: none; }
.rating-item:hover { background: var(--cpu-surface-soft); border-radius: var(--cpu-radius-m); }
.rating-item:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
  border-radius: var(--cpu-radius-m);
}

.r-bars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
}
.r-bars > div { display: flex; align-items: center; gap: 4px; }
@media (max-width: 700px) { .r-bars { grid-template-columns: 1fr 1fr; } }

.r-meta {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  margin-top: 6px;
  display: flex;
  gap: 8px;
}
.goto { color: var(--cpu-primary); margin-left: auto; }

@media (max-width: 700px) {
  .cpu-card {
    border-radius: var(--cpu-radius-m);
    padding: 14px;
  }

  .head {
    flex-direction: column;
  }

  .name {
    font-size: var(--cpu-fs-xl);
    line-height: 1.35;
  }

  .right {
    width: 100%;
    text-align: left;
    padding-top: 10px;
    border-top: 1px dashed var(--cpu-border-soft);
  }

  .score {
    font-size: 38px;
  }

  .dim {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .head-row {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .head-row .el-button {
    width: 100%;
  }

  .r-bars {
    grid-template-columns: 1fr;
  }

  .r-meta {
    gap: 6px;
    flex-wrap: wrap;
  }

  .goto {
    width: 100%;
    margin-left: 0;
  }
}
</style>
