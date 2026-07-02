<template>
  <div class="exams-pane">
    <div class="ctrl-bar">
      <div class="ctrl-left">
        <label class="filter-field">
          <span class="lbl">学期</span>
          <el-select v-model="semester" size="small" placeholder="选择学期" @change="reload">
            <el-option v-for="s in semesterOptions" :key="s" :value="s" :label="s" />
          </el-select>
        </label>
        <label class="filter-field compact">
          <span class="lbl">类型</span>
          <el-select v-model="type" size="small" clearable placeholder="全部" @change="reload">
            <el-option label="期初" value="1" />
            <el-option label="期中" value="2" />
            <el-option label="期末" value="3" />
          </el-select>
        </label>
      </div>
      <div class="ctrl-right" v-if="parsed">
        <span class="stat">{{ parsed.list?.length ?? 0 }} 场考试</span>
      </div>
    </div>

    <div v-loading="loading">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="loadError"
      >
        <template #default>
          <el-button size="small" :loading="loading" @click="reload">重试</el-button>
        </template>
      </el-alert>
      <el-alert
        v-if="needSemester"
        type="info"
        :closable="false"
        show-icon
        title="请先选择学期"
      >
        请先在上方选择学期，再查看考试安排。
      </el-alert>
      <div v-else-if="parsed && !parsed.list?.length" class="empty-card">
        <el-icon size="48" color="var(--cpu-text-muted)"><Calendar /></el-icon>
        <h3>这个学期暂时没有查到考试安排</h3>
        <p>
          你可以切换学期或考试类型再试，也可以去学校教务系统确认：
        </p>
        <ul>
          <li>切换上方<b>学期</b>或<b>类型</b>（期末/期中/期初）重新查询</li>
          <li>
            <a href="http://jsxsd.cpu.edu.cn/zgykdx/xsks/xsksap_query?Ves632DSdyV=NEW_XSD_KSBM" target="_blank" rel="noopener noreferrer">
              去学校教务系统原站
            </a>
            查看是否有数据
          </li>
        </ul>
      </div>
      <el-empty v-else-if="!loading && !parsed" description="暂无考试安排数据" />
      <div v-else class="exam-list">
        <div v-for="(e, i) in parsed?.list ?? []" :key="i" class="exam-card">
          <div class="left">
            <div class="cname">{{ e.courseName }}</div>
            <div class="meta">
              <span v-if="e.courseCode">{{ e.courseCode }}</span>
              <span v-if="e.examType">· {{ e.examType }}</span>
            </div>
          </div>
          <div class="middle">
            <div class="time" v-if="e.examTime">🕒 {{ e.examTime }}</div>
            <div class="loc" v-if="e.location">📍 {{ e.location }}</div>
            <div class="seat" v-if="e.seat">座位：{{ e.seat }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Calendar } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";

const props = defineProps<{ data: any; loading?: boolean }>();
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);
const semester = ref<string>("");
const type = ref<string>("");
const loadError = ref("");
let loadSeq = 0;

watch(() => props.data, (v) => {
  parsed.value = v?.parsed ?? null;
  if (v?.parsed) loadError.value = "";
  if (parsed.value?.currentSemester && !semester.value) {
    semester.value = parsed.value.currentSemester;
  }
}, { immediate: true });
watch(() => props.loading, (v) => { loading.value = Boolean(v); }, { immediate: true });

const semesterOptions = computed(() => {
  // 优先用 parsed 返回的；如果没有就用一组常见近期学期作为兜底
  const fromApi = (parsed.value?.semesters ?? []).map((s: any) => s.value).filter(Boolean);
  if (fromApi.length) return fromApi;
  // 当前年作为基准，倒推
  const y = new Date().getFullYear();
  const list: string[] = [];
  for (let i = 0; i < 4; i++) {
    list.push(`${y - i}-${y - i + 1}-2`);
    list.push(`${y - i}-${y - i + 1}-1`);
  }
  return list;
});

const needSemester = computed(() => parsed.value?.needSemester === true);

async function reload() {
  if (!semester.value) {
    loadError.value = "";
    return;
  }
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await jwxtApi.exams({ semester: semester.value, type: type.value || undefined }, { silent: true });
    if (seq === loadSeq) parsed.value = result.parsed;
  } catch (error) {
    if (seq === loadSeq) loadError.value = requestMessage(error) || "考试安排加载失败，请稍后重试";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.exams-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.ctrl-left {
  display: grid;
  grid-template-columns: minmax(150px, 180px) minmax(110px, 130px);
  gap: 10px;
  align-items: end;
  min-width: 0;
}
.filter-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.filter-field :deep(.el-select),
.filter-field :deep(.el-input) {
  width: 100%;
}
.filter-field :deep(.el-select .el-select__wrapper),
.filter-field :deep(.el-input .el-input__wrapper) {
  min-height: 36px;
}
.lbl { font-size: 12px; color: var(--cpu-text-secondary); }
.stat { font-size: 13px; color: var(--cpu-primary); font-weight: 500; }

.pane-alert {
  margin-bottom: 12px;
}

.pane-alert :deep(.el-alert__content) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.exam-list { display: flex; flex-direction: column; gap: 10px; }
.exam-card {
  display: flex;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
  align-items: center;
}
.cname { font-size: 15px; font-weight: 600; color: var(--cpu-text); }
.meta { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 2px; display: flex; gap: 6px; }
.left { flex: 1; min-width: 0; }
.middle { font-size: 13px; color: var(--cpu-text-secondary); text-align: right; }
.time { font-weight: 500; color: #b45309; }
.loc { margin-top: 3px; }
.seat { font-size: 12px; color: var(--cpu-text-muted); margin-top: 3px; }

.empty-card {
  background: var(--cpu-surface-subtle);
  border: 1px dashed var(--cpu-border-soft);
  border-radius: 12px;
  padding: 32px 24px;
  text-align: center;
  color: var(--cpu-text-secondary);
}
.empty-card h3 { margin: 12px 0 6px; font-size: 16px; color: var(--cpu-text); }
.empty-card p { margin: 0 0 8px; font-size: 13px; }
.empty-card ul {
  text-align: left;
  display: inline-block;
  margin: 0 auto;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.8;
}
.empty-card ul b { color: var(--cpu-primary); }
.empty-card a { color: var(--cpu-primary); }

@media (max-width: 640px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .ctrl-left {
    grid-template-columns: 1fr 1fr;
  }

  .ctrl-right {
    align-self: flex-start;
  }

  .exam-card {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
    padding: 13px 12px;
  }

  .middle {
    text-align: left;
    line-height: 1.5;
  }

  .meta {
    flex-wrap: wrap;
    line-height: 1.5;
  }

  .empty-card {
    padding: 24px 16px;
  }
}

@media (max-width: 430px) {
  .ctrl-left {
    grid-template-columns: 1fr;
  }
}
</style>
