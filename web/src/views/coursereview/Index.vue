<template>
  <div class="cr-page">
    <div class="head">
      <h2>📊 课程点评</h2>
      <div class="head-right">
        <el-button v-if="auth.isLoggedIn" :loading="syncing" @click="onSync">
          <el-icon><Refresh /></el-icon> 同步我的课程
        </el-button>
        <el-button v-if="auth.isLoggedIn" type="primary" @click="$router.push({ name: 'post', query: { board: 'coursereview' } })">
          <el-icon><Plus /></el-icon> 写课评
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-radio-group v-model="scope" size="default" @change="reload">
        <el-radio-button value="all">全部课程</el-radio-button>
        <el-radio-button value="mine" :disabled="!auth.isLoggedIn">⭐ 我学过的</el-radio-button>
      </el-radio-group>
      <el-input v-model="q" placeholder="搜课程名 / 代码 / 教师" clearable style="max-width:300px" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <div v-if="scope === 'mine' && !list.length && !loading" class="empty-mine">
      <p>还没有同步过教务系统的课程</p>
      <el-button type="primary" :loading="syncing" @click="onSync">
        <el-icon><Refresh /></el-icon> 立即同步
      </el-button>
      <p class="sub">需要先在「教务直连」页登录学校账号。会从成绩 + 培养方案里把你修过 / 要修的课加进来。</p>
    </div>

    <div class="course-grid" v-loading="loading">
      <div v-for="c in list" :key="c.id" class="course" @click="$router.push(`/coursereview/${c.id}`)">
        <div class="c-head">
          <div>
            <div class="code">{{ c.code }}</div>
            <div class="name">{{ c.name }}</div>
            <div class="teacher">{{ c.teacher || "—" }}</div>
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
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Search, Refresh } from "@element-plus/icons-vue";
import { courseApi, type Course } from "@/api/course";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const list = ref<Course[]>([]);
const q = ref("");
const scope = ref<"all" | "mine">("all");
const loading = ref(false);
const syncing = ref(false);

onMounted(reload);
watch(() => auth.isLoggedIn, (v) => { if (!v) scope.value = "all"; });

async function reload() {
  loading.value = true;
  try {
    list.value = await courseApi.list(q.value, scope.value === "mine");
  } finally { loading.value = false; }
}

async function onSync() {
  if (!auth.isLoggedIn) {
    ElMessage.warning("请先登录站内账号");
    return;
  }
  const jwxtToken = sessionStorage.getItem("cpu-jwxt-token");
  if (!jwxtToken) {
    try {
      await ElMessageBox.confirm(
        "同步课程需要先登录学校教务系统。是否前往「教务直连」页？",
        "未登录教务",
        { confirmButtonText: "前往登录", cancelButtonText: "取消" }
      );
      window.location.href = "/jwxt";
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
      ElMessage.error("教务会话已失效，请去「教务直连」重新登录");
    }
  } finally { syncing.value = false; }
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
