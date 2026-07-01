<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

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
const selectedCourseId = ref("");
const starting = ref(false);

// 配置项
const config = ref({
  autoVideo: true,
  autoDoc: true,
  muted: true,
});

const selectedCourse = () => courses.value.find((c) => c.courseId === selectedCourseId.value);

async function fetchCourses() {
  loading.value = true;
  try {
    courses.value = await window.courseBot.getCourses();
    if (courses.value.length > 0 && !selectedCourseId.value) {
      selectedCourseId.value = courses.value[0].courseId;
    }
  } catch (e) {
    ElMessage.error("获取课程失败：" + String(e));
  } finally {
    loading.value = false;
  }
}

async function startAuto() {
  const course = selectedCourse();
  if (!course) {
    ElMessage.warning("请先选择课程");
    return;
  }
  starting.value = true;
  try {
    const r = await window.courseBot.startCourseAuto(
      course.courseId, course.clazzId, course.cpi
    );
    if (r.ok) {
      router.push({ path: "/home", query: { courseName: course.name } });
    } else {
      ElMessage.warning(r.message);
    }
  } catch (e) {
    ElMessage.error("启动失败：" + String(e));
  } finally {
    starting.value = false;
  }
}

function goBack() {
  router.replace("/courses");
}

onMounted(fetchCourses);
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-brand">
        <button class="back-btn" @click="goBack">&larr;</button>
        <span>小工具</span>
      </div>
    </header>

    <div class="content">
      <!-- 自动刷课工具 -->
      <div class="tool-card">
        <div class="tool-header">
          <div class="tool-icon">&#9881;</div>
          <div>
            <div class="tool-title">自动刷课</div>
            <div class="tool-desc">全自动进入课程、发现章节并依次处理</div>
          </div>
        </div>

        <div class="tool-body">
          <!-- 选择课程 -->
          <div class="config-row">
            <span class="config-label">选择课程</span>
            <select
              v-model="selectedCourseId"
              class="config-select"
              :disabled="loading"
            >
              <option v-if="loading" value="" disabled>加载中...</option>
              <option v-if="!loading && courses.length === 0" value="" disabled>无课程</option>
              <option
                v-for="c in courses"
                :key="c.courseId"
                :value="c.courseId"
              >{{ c.name }}</option>
            </select>
          </div>

          <div class="config-row">
            <span class="config-label">视频自动播放</span>
            <label class="toggle">
              <input type="checkbox" v-model="config.autoVideo" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="config-row">
            <span class="config-label">文档自动阅读</span>
            <label class="toggle">
              <input type="checkbox" v-model="config.autoDoc" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="config-row">
            <span class="config-label">静音模式</span>
            <label class="toggle">
              <input type="checkbox" v-model="config.muted" />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <button
            class="tool-start-btn"
            :disabled="!selectedCourseId || starting"
            @click="startAuto"
          >
            {{ starting ? '启动中...' : '开始自动刷课' }}
          </button>
        </div>

        <div class="tool-note">
          自动模式会尝试多种方式进入课程章节页。如果失败，请使用课程列表的手动模式。
        </div>
      </div>

      <!-- AI 答题（即将上线） -->
      <div class="tool-card tool-card-disabled">
        <div class="tool-header">
          <div class="tool-icon tool-icon-gold">&#129302;</div>
          <div>
            <div class="tool-title">AI 智能答题</div>
            <div class="tool-desc">自动识别题目并作答，需平台额度</div>
          </div>
          <span class="tool-badge">即将上线</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; background: #f5f7f9; }

.topbar {
  display: flex; align-items: center; padding: 14px 18px;
  background: #fff; box-shadow: 0 1px 0 rgba(0,0,0,0.05); flex-shrink: 0;
}
.topbar-brand {
  display: flex; align-items: center; gap: 10px;
  font-size: 17px; font-weight: 600; color: #1e293b;
}
.back-btn {
  border: none; background: none; font-size: 18px;
  color: #148f7b; cursor: pointer; padding: 2px 6px; border-radius: 6px;
}
.back-btn:hover { background: rgba(20,143,123,0.08); }

.content { flex: 1; overflow-y: auto; padding: 14px; }

/* 工具卡片 */
.tool-card {
  background: #fff; border-radius: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  margin-bottom: 12px; overflow: hidden;
}
.tool-card-disabled { opacity: 0.55; pointer-events: none; }

.tool-header {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 18px; position: relative;
}
.tool-icon {
  width: 40px; height: 40px; border-radius: 12px;
  background: rgba(20,143,123,0.1); display: grid; place-items: center;
  font-size: 20px; flex-shrink: 0;
}
.tool-icon-gold { background: rgba(245,158,11,0.1); }
.tool-title { font-size: 15px; font-weight: 600; color: #1e293b; }
.tool-desc { font-size: 12px; color: #94a3b8; margin-top: 2px; }
.tool-badge {
  position: absolute; right: 16px; top: 50%; transform: translateY(-50%);
  font-size: 11px; color: #f59e0b; background: rgba(245,158,11,0.1);
  padding: 2px 8px; border-radius: 6px; font-weight: 500;
}

/* 配置区 */
.tool-body {
  padding: 0 18px 16px; display: flex; flex-direction: column; gap: 0;
}
.config-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 0; border-top: 1px solid #f1f5f9;
}
.config-label { font-size: 13px; color: #475569; }

.config-select {
  width: 180px; padding: 6px 10px; border-radius: 8px;
  border: 1px solid #e2e8f0; font: inherit; font-size: 12px;
  color: #1e293b; background: #f8fafc; outline: none;
  cursor: pointer; appearance: auto;
}
.config-select:focus { border-color: #148f7b; }

/* 开关 */
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; inset: 0; border-radius: 11px;
  background: #cbd5e1; transition: 0.2s; cursor: pointer;
}
.toggle-slider::before {
  content: ''; position: absolute; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; left: 3px; top: 3px;
  transition: 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}
.toggle input:checked + .toggle-slider { background: #148f7b; }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

.tool-start-btn {
  margin-top: 14px; width: 100%; height: 42px; border: none; border-radius: 10px;
  background: linear-gradient(135deg, #148f7b, #0d6e5e); color: #fff;
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: opacity 0.15s; box-shadow: 0 3px 10px rgba(20,143,123,0.25);
}
.tool-start-btn:hover { opacity: 0.9; }
.tool-start-btn:disabled { opacity: 0.5; cursor: default; }

.tool-note {
  padding: 10px 18px 14px; font-size: 11px; color: #94a3b8;
  border-top: 1px solid #f1f5f9;
}
</style>
