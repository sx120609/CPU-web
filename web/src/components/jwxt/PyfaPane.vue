<template>
  <div class="pyfa-pane" v-loading="loading">
    <div class="data-note">
      以下信息整理自教务系统，最终请以学校和学院通知为准。
    </div>

    <div class="ctrl-bar" v-if="parsed">
      <div class="ctrl-left">
        <label class="filter-field wide">
          <span class="lbl">学期</span>
          <el-select v-model="filterSem" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部">
            <el-option v-for="s in semesterOptions" :key="s" :value="s" :label="s" />
          </el-select>
        </label>
        <label class="filter-field">
          <span class="lbl">性质</span>
          <el-select v-model="filterAttr" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部">
            <el-option v-for="a in attrOptions" :key="a" :value="a" :label="a" />
          </el-select>
        </label>
        <label class="filter-field">
          <span class="lbl">关键词</span>
          <el-input v-model="keyword" size="small" placeholder="课程名 / 单位" clearable />
        </label>
      </div>
      <div class="ctrl-right">
        <span class="stat">📚 {{ filtered.length }} / {{ parsed.list.length }} 门</span>
        <span class="stat">· {{ totalCredits.toFixed(1) }} 学分</span>
      </div>
    </div>

    <!-- 按学期分组的轻量统计条 -->
    <div v-if="parsed?.bySemester?.length" class="sem-stats">
      <div v-for="s in parsed.bySemester" :key="s.semester" class="sem-stat">
        <div class="sem-name">{{ s.semester }}</div>
        <div class="sem-bar-wrap">
          <div class="sem-bar" :style="{ width: barWidth(s.credits) + '%' }"></div>
        </div>
        <div class="sem-val">{{ s.courses }} 门 · {{ s.credits.toFixed(1) }} 学分</div>
      </div>
    </div>

    <el-empty v-if="!filtered.length && parsed" description="没有符合条件的课程" />
    <div v-else class="mobile-course-list">
      <article v-for="row in filtered" :key="`${row.semester || ''}-${row.courseCode || row.courseName}`" class="pyfa-card">
        <div class="pyfa-card-head">
          <div>
            <b>{{ row.courseName }}</b>
            <span>{{ row.semester || "未标注学期" }}<template v-if="row.courseCode"> · {{ row.courseCode }}</template></span>
          </div>
          <el-tag v-if="row.attr" size="small" :type="attrTagType(row.attr)" effect="plain">{{ row.attr }}</el-tag>
        </div>
        <div class="pyfa-meta">
          <span v-if="row.unit">{{ row.unit }}</span>
          <span v-if="row.credits">{{ row.credits }} 学分</span>
          <span v-if="row.hours">{{ row.hours }} 学时</span>
          <span v-if="row.examMethod">{{ row.examMethod }}</span>
          <span v-if="row.isExam">{{ row.isExam }}</span>
        </div>
      </article>
    </div>
    <div v-if="filtered.length" class="table-scroll">
      <el-table :data="filtered" stripe size="default" max-height="600">
        <el-table-column prop="semester" label="开课学期" width="120" sortable />
        <el-table-column prop="courseCode" label="课程编号" width="120" />
        <el-table-column prop="courseName" label="课程名称" min-width="200" />
        <el-table-column prop="unit" label="开课单位" width="160" />
        <el-table-column prop="credits" label="学分" width="70" align="right" sortable />
        <el-table-column prop="hours" label="学时" width="70" align="right" />
        <el-table-column prop="examMethod" label="考核" width="100" />
        <el-table-column label="性质" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.attr" size="small" :type="attrTagType(row.attr)" effect="plain">{{ row.attr }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="isExam" label="考试" width="80" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";

interface PyfaCourse {
  semester?: string;
  courseCode?: string;
  courseName: string;
  unit?: string;
  credits?: number;
  hours?: number;
  examMethod?: string;
  attr?: string;
  isExam?: string;
}

const props = defineProps<{ data: any; loading?: boolean }>();
const parsed = ref<any>(normalizePyfa(props.data));
const loading = ref(props.loading ?? false);

const filterSem = ref<string[]>([]);
const filterAttr = ref<string[]>([]);
const keyword = ref("");

watch(() => props.data, (v) => { parsed.value = normalizePyfa(v); }, { immediate: true });
watch(() => props.loading, (v) => { loading.value = Boolean(v); }, { immediate: true });

function normalizePyfa(v: any) {
  const p = v?.parsed ?? v ?? null;
  return p?.parsed ?? p;
}

const semesterOptions = computed<string[]>(() => {
  if (!parsed.value) return [];
  return Array.from(new Set((parsed.value.list as PyfaCourse[]).map((c) => c.semester).filter(Boolean))) as string[];
});

const attrOptions = computed<string[]>(() => {
  if (!parsed.value) return [];
  return Array.from(new Set((parsed.value.list as PyfaCourse[]).map((c) => c.attr).filter(Boolean))) as string[];
});

const filtered = computed<PyfaCourse[]>(() => {
  if (!parsed.value) return [];
  const kw = keyword.value.trim().toLowerCase();
  return (parsed.value.list as PyfaCourse[]).filter((c) => {
    if (filterSem.value.length && !filterSem.value.includes(c.semester ?? "")) return false;
    if (filterAttr.value.length && !filterAttr.value.includes(c.attr ?? "")) return false;
    if (kw) {
      const hit =
        c.courseName.toLowerCase().includes(kw) ||
        (c.courseCode ?? "").toLowerCase().includes(kw) ||
        (c.unit ?? "").toLowerCase().includes(kw);
      if (!hit) return false;
    }
    return true;
  });
});

const totalCredits = computed(() => filtered.value.reduce((s, c) => s + (c.credits ?? 0), 0));

const maxSemCredits = computed(() => {
  if (!parsed.value) return 1;
  return Math.max(...(parsed.value.bySemester ?? []).map((s: any) => s.credits), 1);
});

function barWidth(c: number) {
  return (c / maxSemCredits.value) * 100;
}

function attrTagType(attr?: string): "success" | "warning" | "info" | "primary" | "danger" {
  if (!attr) return "info";
  if (/必修/.test(attr)) return "danger";
  if (/限选|限定选修/.test(attr)) return "warning";
  if (/任选|公选|通识/.test(attr)) return "success";
  if (/选修/.test(attr)) return "primary";
  return "info";
}
</script>

<style scoped>
.pyfa-pane { display: flex; flex-direction: column; gap: 12px; }

.data-note {
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: var(--cpu-warn);
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 12px;
}

.ctrl-bar { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px; }
.ctrl-left {
  display: grid;
  grid-template-columns: minmax(190px, 250px) minmax(160px, 210px) minmax(150px, 190px);
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

.sem-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 10px;
  margin: 4px 0 8px;
}
.sem-stat {
  display: grid;
  grid-template-columns: 110px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--cpu-surface-subtle);
  border-radius: 6px;
  font-size: 12px;
}
.sem-name { font-weight: 500; color: var(--cpu-text); }
.sem-bar-wrap { background: var(--cpu-border-soft); height: 6px; border-radius: 3px; overflow: hidden; }
.sem-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--cpu-primary), var(--cpu-primary-light));
  transition: width 0.3s;
}
.sem-val { color: var(--cpu-text-secondary); white-space: nowrap; }
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-scroll :deep(.el-table) {
  min-width: 1000px;
}
.mobile-course-list { display: none; }

.pyfa-card {
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
}

.pyfa-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.pyfa-card-head b {
  display: block;
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.45;
}

.pyfa-card-head span {
  display: block;
  margin-top: 3px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.pyfa-card-head :deep(.el-tag) {
  flex-shrink: 0;
  max-width: 72px;
}

.pyfa-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 10px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.4;
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

  .ctrl-left .wide {
    grid-column: span 2;
  }

  .ctrl-right {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .sem-stats {
    grid-template-columns: 1fr;
  }

  .sem-stat {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .sem-val {
    white-space: normal;
  }

  .table-scroll { display: none; }

  .mobile-course-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
}

@media (max-width: 430px) {
  .ctrl-left {
    grid-template-columns: 1fr;
  }

  .ctrl-left .wide {
    grid-column: auto;
  }
}
</style>
