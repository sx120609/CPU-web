<template>
  <div class="midterm-pane">
    <div class="ctrl-bar" v-if="parsed">
      <div class="ctrl-left">
        <label class="filter-field compact">
          <span class="lbl">学期</span>
          <el-select v-model="semester" size="small" clearable placeholder="全部学期" @change="reload">
            <el-option v-for="s in parsed.semesters" :key="s.value" :value="s.value" :label="s.label" />
          </el-select>
        </label>
        <label class="filter-field">
          <span class="lbl">关键词</span>
          <el-input v-model="keyword" size="small" placeholder="课程名 / 代码" clearable />
        </label>
      </div>
      <div class="ctrl-right">
        <span class="stat">📝 {{ publishedCount }} / {{ filteredList.length }} 门已出分</span>
        <span class="stat" v-if="midtermAverage !== null">
          · 期中均分 <b>{{ midtermAverage.toFixed(1) }}</b>
        </span>
        <span class="stat" v-if="totalCredits">· {{ totalCredits.toFixed(1) }} 学分</span>
      </div>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="scope-tip"
      title="部分课程暂未公布期中成绩时，会显示为“—”。"
    />

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
      <el-empty v-if="!loading && !filteredList.length" description="暂无期中成绩数据" />
      <div v-else>
        <div v-for="(rows, semKey) in groupedBySem" :key="semKey" class="sem-block">
          <div class="sem-head">
            <h3>{{ semKey }}</h3>
            <span class="sem-sum">
              {{ publishedCountOf(rows) }} / {{ rows.length }} 门已出分
              <template v-if="midtermAverageOf(rows) !== null"> · 均分 {{ midtermAverageOf(rows)?.toFixed(1) }}</template>
            </span>
          </div>

          <div class="mobile-grade-list">
            <article v-for="row in rows" :key="`${row.semester}-${row.courseCode || row.courseName}`" class="grade-card">
              <div class="grade-main">
                <div class="course-title">{{ row.courseName }}</div>
                <div class="course-sub">
                  <span v-if="row.courseCode">{{ row.courseCode }}</span>
                  <span v-if="row.credits">{{ row.credits }} 学分</span>
                  <span v-if="row.hours">{{ row.hours }} 学时</span>
                  <span v-if="row.examType">{{ row.examType }}</span>
                </div>
              </div>
              <div class="score-badges">
                <span class="score-pill" :style="{ color: totalColor(row.scoreNum) }">
                  总评 {{ row.score || "—" }}
                </span>
                <span class="score-pill" :style="{ color: midtermColor(midtermNum(row.midterm)), fontWeight: 600 }">
                  期中 {{ row.midterm || "—" }}
                </span>
              </div>
              <div class="grade-detail">
                <span>平时 {{ row.usual || "—" }}</span>
                <span>期末 {{ row.final || "—" }}</span>
                <span>性质 {{ row.courseAttr || "—" }}</span>
              </div>
            </article>
          </div>

          <div class="table-scroll">
            <el-table :data="rows" stripe size="default">
              <el-table-column v-if="!isMobile" prop="courseCode" label="课程代码" width="110" />
              <el-table-column prop="courseName" label="课程名称" min-width="220" />
              <el-table-column label="总评" width="80" align="right">
                <template #default="{ row }">
                  <span :style="{ color: totalColor(row.scoreNum), fontWeight: 600 }">{{ row.score || "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="期中" width="80" align="right">
                <template #default="{ row }">
                  <span :style="{ color: midtermColor(midtermNum(row.midterm)), fontWeight: 600 }">{{ row.midterm || "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column v-if="!isMobile" prop="credits" label="学分" width="70" align="right" />
              <el-table-column label="平时" width="60" align="right">
                <template #default="{ row }">{{ row.usual || "—" }}</template>
              </el-table-column>
              <el-table-column label="期末" width="60" align="right">
                <template #default="{ row }">{{ row.final || "—" }}</template>
              </el-table-column>
              <el-table-column prop="courseAttr" label="性质" width="90" />
              <el-table-column prop="examType" label="考试" width="100" />
              <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
            </el-table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { jwxtApi } from "@/api/jwxt";

interface GradeRow {
  semester: string;
  courseCode?: string;
  courseName: string;
  score: string;
  scoreNum: number | null;
  usual?: string;
  midterm?: string;
  final?: string;
  credits?: number;
  hours?: number;
  courseAttr?: string;
  examType?: string;
  remark?: string;
}

const props = defineProps<{ data: any; loading?: boolean }>();
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);
const semester = ref("");
const keyword = ref("");
const loadError = ref("");
let loadSeq = 0;

const isMobile = ref(false);
let mql: MediaQueryList | null = null;

function onMqlChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches;
}

onMounted(() => {
  if (typeof window === "undefined" || !window.matchMedia) return;
  mql = window.matchMedia("(max-width: 760px)");
  isMobile.value = mql.matches;
  mql.addEventListener?.("change", onMqlChange);
});

onBeforeUnmount(() => {
  mql?.removeEventListener?.("change", onMqlChange);
  mql = null;
});

watch(() => props.data, (v) => {
  parsed.value = v?.parsed ?? null;
  if (v?.parsed) loadError.value = "";
}, { immediate: true });
watch(() => props.loading, (v) => { loading.value = Boolean(v); }, { immediate: true });

function normalizeNum(input?: string | number | null) {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const n = parseFloat(String(input ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function midtermNum(value?: string | number | null) {
  return normalizeNum(value);
}

const filteredList = computed<GradeRow[]>(() => {
  if (!parsed.value?.list || !Array.isArray(parsed.value.list)) return [];
  const kw = keyword.value.trim().toLowerCase();
  return (parsed.value.list as GradeRow[]).filter((row) => {
    if (kw) {
      const hit =
        row.courseName.toLowerCase().includes(kw) ||
        (row.courseCode ?? "").toLowerCase().includes(kw) ||
        (row.courseAttr ?? "").toLowerCase().includes(kw);
      if (!hit) return false;
    }
    return true;
  });
});

const groupedBySem = computed(() => {
  const out: Record<string, GradeRow[]> = {};
  const semesters = Array.from(new Set(filteredList.value.map((row) => row.semester || "未知学期"))).sort().reverse();
  for (const sem of semesters) out[sem] = [];
  for (const row of filteredList.value) (out[row.semester || "未知学期"] ??= []).push(row);
  for (const sem of Object.keys(out)) {
    out[sem] = sortRowsByPublishedMidterm(out[sem]);
  }
  return out;
});

function publishedCountOf(rows: GradeRow[]) {
  return rows.filter((row) => hasPublishedMidterm(row)).length;
}

function midtermAverageOf(rows: GradeRow[]) {
  const nums = rows.map((row) => midtermNum(row.midterm)).filter((n): n is number => n !== null);
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

const publishedCount = computed(() => publishedCountOf(filteredList.value));
const midtermAverage = computed(() => midtermAverageOf(filteredList.value));
const totalCredits = computed(() =>
  filteredList.value.reduce((sum, row) => sum + (typeof row.credits === "number" ? row.credits : 0), 0)
);

function hasPublishedMidterm(row: GradeRow) {
  return Boolean(String(row.midterm ?? "").trim());
}

function hasPublishedTotal(row: GradeRow) {
  return Boolean(String(row.score ?? "").trim());
}

function sortRowsByPublishedMidterm(rows: GradeRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      Number(hasPublishedMidterm(b.row)) - Number(hasPublishedMidterm(a.row)) ||
      Number(hasPublishedTotal(b.row)) - Number(hasPublishedTotal(a.row)) ||
      a.index - b.index
    )
    .map(({ row }) => row);
}

function midtermColor(n: number | null) {
  if (n === null) return "var(--cpu-text-muted)";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "var(--cpu-text)";
  return "#dc2626";
}

function totalColor(n: number | null) {
  if (n === null) return "var(--cpu-text-muted)";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "var(--cpu-text)";
  return "#dc2626";
}

async function reload() {
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await jwxtApi.midtermGrades({ semester: semester.value || undefined }, { silent: true });
    if (seq === loadSeq) parsed.value = result.parsed;
  } catch (error) {
    if (seq === loadSeq) loadError.value = requestMessage(error) || "期中成绩加载失败，请稍后重试";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.midterm-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.ctrl-left {
  display: grid;
  grid-template-columns: minmax(130px, 150px) minmax(160px, 220px);
  gap: 10px;
  align-items: end;
  min-width: 0;
}
.ctrl-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
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
.stat { font-size: 13px; color: var(--cpu-text-secondary); }
.stat b { color: var(--cpu-primary); font-size: 15px; }
.scope-tip { margin-top: -2px; }
.scope-tip :deep(.el-alert__title) { line-height: 1.55; }
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
.sem-block { margin-bottom: 20px; }
.sem-block:last-child { margin-bottom: 0; }
.sem-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 8px;
}
.sem-head h3 { margin: 0; font-size: 15px; color: var(--cpu-primary); font-weight: 600; }
.sem-sum { font-size: 12px; color: var(--cpu-text-muted); }
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-scroll :deep(.el-table) {
  min-width: 920px;
}
.mobile-grade-list { display: none; }

.grade-card {
  position: relative;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  padding: 14px;
  background: var(--cpu-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.grade-main {
  min-width: 0;
}

.course-title {
  line-height: 1.45;
  font-size: 15px;
  font-weight: 600;
  color: var(--cpu-text);
}

.course-sub,
.grade-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 8px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.score-badges {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.score-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 8px;
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .ctrl-left {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ctrl-right {
    width: 100%;
    gap: 8px;
    line-height: 1.6;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--cpu-surface-subtle);
    white-space: nowrap;
  }

  .sem-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .mobile-grade-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .table-scroll { display: none; }
}

@media (max-width: 430px) {
  .ctrl-left {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 380px) {
  .score-badges {
    grid-template-columns: 1fr;
  }
}
</style>
