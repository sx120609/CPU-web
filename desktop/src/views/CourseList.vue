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
    const chapters = await window.courseBot.getChapters(
      course.courseId,
      course.clazzId,
      course.cpi
    );

    if (!chapters || chapters.length === 0) {
      ElMessage.warning("未获取到章节信息");
      return;
    }

    await ElMessageBox.confirm(
      `即将开始刷「${course.name}」，共 ${countLeafChapters(chapters)} 个学习单元。确定开始？`,
      "开始刷课",
      { confirmButtonText: "开始", cancelButtonText: "取消", type: "info" }
    );

    const r = await window.courseBot.startCourse(
      course.courseId,
      course.clazzId,
      course.cpi,
      chapters
    );

    if (r.ok) {
      router.push({
        path: "/home",
        query: { courseName: course.name },
      });
    } else {
      ElMessage.warning(r.message);
    }
  } catch (e: any) {
    if (e !== "cancel") {
      ElMessage.error("操作失败：" + String(e));
    }
  } finally {
    loadingCourse.value = null;
  }
}

function countLeafChapters(chapters: any[]): number {
  let count = 0;
  function walk(nodes: any[]) {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        walk(n.children);
      } else {
        count++;
      }
    }
  }
  walk(chapters);
  return count;
}

async function logout() {
  await window.courseBot.chaoxingLogout();
  router.replace("/chaoxing-login");
}

onMounted(fetchCourses);
</script>

<template>
  <div class="courses-page">
    <header class="header">
      <h2>我的课程</h2>
      <div class="header-actions">
        <el-button link @click="fetchCourses" :loading="loading">刷新</el-button>
        <el-button link type="danger" @click="logout">退出学习通</el-button>
      </div>
    </header>

    <div v-if="loading" class="loading-box">
      <el-skeleton :rows="4" animated />
    </div>

    <div v-else-if="courses.length === 0" class="empty-box">
      <p>暂无课程</p>
      <el-button @click="fetchCourses">重新获取</el-button>
    </div>

    <div v-else class="course-list">
      <div
        v-for="c in courses"
        :key="c.courseId"
        class="course-card"
      >
        <div class="course-info">
          <div class="course-name">{{ c.name }}</div>
          <div class="course-teacher" v-if="c.teacher">{{ c.teacher }}</div>
        </div>
        <el-button
          type="primary"
          size="small"
          :loading="loadingCourse === c.courseId"
          @click="startCourse(c)"
        >
          开始刷课
        </el-button>
      </div>
    </div>

    <div class="footer-tip">
      <el-alert type="info" :closable="false" show-icon>
        选择一门课程开始自动刷课。视频将自动播放，文档将自动标记已读。
      </el-alert>
    </div>
  </div>
</template>

<style scoped>
.courses-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  background: #f7f8fa;
  overflow-y: auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header h2 { font-size: 18px; font-weight: 600; color: #1d2129; }
.header-actions { display: flex; gap: 8px; }
.loading-box { padding: 20px; }
.empty-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #86909c;
}
.course-list { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.course-card {
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: box-shadow 0.2s;
}
.course-card:hover { box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
.course-info { flex: 1; min-width: 0; margin-right: 12px; }
.course-name {
  font-size: 14px;
  font-weight: 500;
  color: #1d2129;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.course-teacher { font-size: 12px; color: #86909c; margin-top: 2px; }
.footer-tip { flex-shrink: 0; }
</style>
