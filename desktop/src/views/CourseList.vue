<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

interface Course {
  courseId: string;
  clazzId: string;
  cpi: string;
  name: string;
  teacher: string;
  image: string;
  progress: number | null;
}

const router = useRouter();
const courses = ref<Course[]>([]);
const loading = ref(true);
const loadingCourse = ref<string | null>(null);

async function fetchCourses() {
  loading.value = true;
  try {
    courses.value = await window.courseBot.getCourses();
    if (courses.value.length === 0) {
      ElMessage.info("没有找到课程，请确认学习通账号是否正确");
    }
  } catch (e) {
    ElMessage.error("获取课程列表失败：" + String(e));
  } finally {
    loading.value = false;
  }
}

async function startCourse(course: Course) {
  loadingCourse.value = course.courseId;
  try {
    await ElMessageBox.confirm(
      `即将打开「${course.name}」的课程窗口，请在窗口中导航到章节页面后点击「开始刷课」。`,
      "打开课程",
      { confirmButtonText: "打开", cancelButtonText: "取消", type: "info" }
    );

    await window.courseBot.openCourse(course.courseId, course.clazzId, course.cpi);
    router.push({ path: "/home", query: { courseName: course.name } });
  } catch (e: any) {
    if (e !== "cancel") ElMessage.error("操作失败：" + String(e));
  } finally {
    loadingCourse.value = null;
  }
}

async function logout() {
  await window.courseBot.chaoxingLogout();
  router.replace("/chaoxing-login");
}

onMounted(fetchCourses);
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-brand">
        <div class="mini-logo">药</div>
        <span>我的课程</span>
      </div>
      <div class="topbar-actions">
        <button class="link-btn" @click="router.push('/tools')">小工具</button>
        <button class="link-btn" @click="fetchCourses" :disabled="loading">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
        <button class="link-btn link-btn-danger" @click="logout">退出</button>
      </div>
    </header>

    <div class="content">
      <!-- 加载中 -->
      <div v-if="loading" class="skeleton-list">
        <div class="skeleton-card" v-for="i in 4" :key="i">
          <div class="sk-avatar"></div>
          <div class="sk-lines"><div class="sk-line sk-w60"></div><div class="sk-line sk-w40"></div></div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="courses.length === 0" class="empty">
        <div class="empty-icon">📚</div>
        <p>暂无课程</p>
        <button class="action-btn-sm" @click="fetchCourses">重新获取</button>
      </div>

      <!-- 课程列表 -->
      <div v-else class="course-list">
        <div v-for="c in courses" :key="c.courseId" class="course-card">
          <div class="course-cover" :style="c.image ? { backgroundImage: `url(${c.image})` } : {}">
            <span v-if="!c.image" class="cover-placeholder">{{ c.name.charAt(0) }}</span>
          </div>
          <div class="course-body">
            <div class="course-name">{{ c.name }}</div>
            <div class="course-meta" v-if="c.teacher">{{ c.teacher }}</div>
          </div>
          <button
            class="go-btn"
            :disabled="loadingCourse === c.courseId"
            @click="startCourse(c)"
          >
            {{ loadingCourse === c.courseId ? '...' : '刷课' }}
          </button>
        </div>
      </div>
    </div>

    <div class="bottom-tip">
      选择课程开始刷课 · 视频自动播放 · 文档自动标记
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f7f9;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #fff;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 600;
  color: #1e293b;
}

.mini-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #168776, #0f6557);
  color: #e8a317;
  display: grid;
  place-items: center;
  font-family: serif;
  font-size: 15px;
  font-weight: 700;
}

.topbar-actions { display: flex; gap: 12px; }

.link-btn {
  border: none;
  background: none;
  font: inherit;
  font-size: 13px;
  color: #148f7b;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.link-btn:hover { background: rgba(20, 143, 123, 0.08); }
.link-btn:disabled { opacity: 0.5; cursor: default; }
.link-btn-danger { color: #ef4444; }
.link-btn-danger:hover { background: rgba(239, 68, 68, 0.08); }

.content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}

/* skeleton */
.skeleton-list { display: flex; flex-direction: column; gap: 10px; }
.skeleton-card {
  display: flex; gap: 12px; align-items: center;
  padding: 14px 16px; background: #fff; border-radius: 12px;
}
.sk-avatar { width: 44px; height: 44px; border-radius: 10px; background: #e5e7eb; flex-shrink: 0; animation: pulse 1.5s ease-in-out infinite; }
.sk-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.sk-line { height: 12px; border-radius: 6px; background: #e5e7eb; animation: pulse 1.5s ease-in-out infinite; }
.sk-w60 { width: 60%; }
.sk-w40 { width: 40%; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* empty */
.empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  padding: 40px 0; color: #94a3b8;
}
.empty-icon { font-size: 40px; }

.action-btn-sm {
  padding: 6px 16px; border-radius: 8px;
  border: 1px solid #e2e8f0; background: #fff;
  font: inherit; font-size: 13px; color: #475569; cursor: pointer;
}
.action-btn-sm:hover { background: #f8fafc; }

/* course list */
.course-list { display: flex; flex-direction: column; gap: 8px; }

.course-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border-radius: 14px;
  transition: box-shadow 0.2s;
}
.course-card:hover { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06); }

.course-cover {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: linear-gradient(135deg, #e0f2ef, #d1e9e4);
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.cover-placeholder {
  font-size: 18px;
  font-weight: 700;
  color: #148f7b;
  opacity: 0.6;
}

.course-body { flex: 1; min-width: 0; }
.course-name {
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.course-meta { font-size: 12px; color: #94a3b8; margin-top: 3px; }

.go-btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #148f7b, #0d6e5e);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.go-btn:hover { opacity: 0.9; }
.go-btn:disabled { opacity: 0.5; cursor: default; }

.bottom-tip {
  padding: 10px 0;
  text-align: center;
  font-size: 11px;
  color: #cbd5e1;
  flex-shrink: 0;
}
</style>
