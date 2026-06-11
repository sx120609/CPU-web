<template>
  <div class="cr-page">
    <div class="head">
      <h2>📊 课程点评</h2>
      <div class="head-right">
        <el-button v-if="auth.canAccessForum" :loading="syncing" :disabled="syncing" @click="onSync">
          <el-icon><Refresh /></el-icon> 同步我的课程
        </el-button>
        <el-button v-if="auth.canAccessForum" type="primary" @click="$router.push({ name: 'post', query: { board: 'coursereview' } })">
          <el-icon><Plus /></el-icon> 写课评
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="scope" size="default" @change="reload">
        <el-radio-button value="all">全部课程</el-radio-button>
        <el-radio-button value="mine" :disabled="!auth.canAccessForum">⭐ 我学过的</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="q"
        placeholder="搜课程名 / 代码 / 教师"
        clearable
        style="max-width:300px"
        @keyup.enter="reload"
        @clear="reload"
        @change="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <div v-if="error && !loading" class="list-error">
      <el-empty :description="error">
        <el-button type="primary" @click="reload">重试</el-button>
      </el-empty>
    </div>

    <div v-else-if="scope === 'mine' && !list.length && !loading" class="empty-mine">
      <p>还没有导入你的课程</p>
      <el-button type="primary" :loading="syncing" :disabled="syncing" @click="onSync">
        <el-icon><Refresh /></el-icon> 立即同步
      </el-button>
      <p class="sub">需要先在「教务数据」页完成统一认证授权。系统会从成绩与培养方案中整理你修过或计划修读的课程。</p>
    </div>

    <div v-else class="course-grid" v-loading="loading">
      <div
        v-for="c in list"
        :key="c.id"
        class="course"
        role="button"
        tabindex="0"
        @click="openCourse(c.id)"
        @keydown.enter.prevent="openCourse(c.id)"
        @keydown.space.prevent="openCourse(c.id)"
      >
        <div class="c-head">
          <div>
            <div class="code">{{ c.code }}</div>
            <div class="name">{{ c.name }}</div>
            <div class="teacher">{{ c.teachers?.length ? c.teachers.map((t) => t.name).join("、") : "—" }}</div>
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
      <el-empty v-if="!loading && !list.length && scope !== 'mine'" description="没有匹配课程" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Search, Refresh } from "@element-plus/icons-vue";
import { courseApi, type Course } from "@/api/course";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const list = ref<Course[]>([]);
const q = ref("");
const scope = ref<"all" | "mine">("all");
const loading = ref(false);
const syncing = ref(false);
const error = ref("");
let loadSeq = 0;

onMounted(reload);
watch(() => auth.canAccessForum, (v) => {
  if (v || scope.value !== "mine") return;
  scope.value = "all";
  void reload();
});

function openCourse(id: number) {
  router.push(`/coursereview/${id}`);
}

async function reload() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const nextList = await courseApi.list(q.value, scope.value === "mine", { suppressErrorMessage: true });
    if (seq === loadSeq) list.value = nextList;
  } catch (e) {
    if (seq === loadSeq) {
      list.value = [];
      error.value = normalizeCourseListError(e);
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function onSync() {
  if (syncing.value) return;
  if (!auth.canAccessForum) {
    ElMessage.warning("请先登录并开启论坛功能");
    return;
  }
  const jwxtToken = sessionStorage.getItem("cpu-jwxt-token");
  if (!jwxtToken) {
    try {
      await ElMessageBox.confirm(
        "导入课程需要先完成教务数据授权。是否前往「教务数据」页？",
        "需要授权",
        { confirmButtonText: "前往授权", cancelButtonText: "取消" }
      );
      await router.push("/jwxt");
    } catch { /* 取消 */ }
    return;
  }
  syncing.value = true;
  try {
    const r = await courseApi.sync();
    ElMessage.success(
      `同步完成：新建 ${r.coursesCreated} 门，已有 ${r.coursesExisting} 门；关联 ${r.linksCreated} 条`
    );
    scope.value = "mine";
    await reload();
  } catch (e: any) {
    // 拦截器已弹错；这里兜底（教务 session 失效会显示 401 → 让用户重登）
    if (e?.response?.status === 401) {
      ElMessage.error("教务授权已失效，请到「教务数据」页重新授权");
    }
  } finally { syncing.value = false; }
}

function normalizeCourseListError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "课程列表加载失败";
  }
  return "课程列表加载失败，请稍后再试";
}
</script>

<style scoped>
.cr-page { display: flex; flex-direction: column; gap: 16px; }
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head h2 { margin: 0; font-size: 22px; }
.head-right { display: flex; gap: 8px; }

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.empty-mine {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border-radius: 12px;
  padding: 32px 24px;
  text-align: center;
  color: #4b5563;
}
.empty-mine p { margin: 0 0 10px; }
.empty-mine .sub { font-size: 12px; color: #6b7280; margin-top: 14px; }

.list-error {
  background: #fff;
  border-radius: 12px;
  padding: 24px 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
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
.course:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

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

@media (max-width: 700px) {
  .head {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .head h2 {
    font-size: 20px;
  }

  .head-right {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .head-right .el-button {
    margin-left: 0;
  }

  .filter-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .filter-bar .el-input {
    max-width: none !important;
  }

  .course-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .course {
    border-radius: 10px;
    padding: 14px;
  }

  .c-head {
    gap: 8px;
  }

  .c-foot {
    gap: 8px;
    flex-wrap: wrap;
  }
}
</style>
