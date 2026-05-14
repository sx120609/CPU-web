<template>
  <div class="pyfa-pane" v-loading="loading">
    <div class="ctrl-bar" v-if="parsed">
      <div class="ctrl-left">
        <span class="lbl">学期</span>
        <el-select v-model="filterSem" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部" style="width:240px">
          <el-option v-for="s in semesterOptions" :key="s" :value="s" :label="s" />
        </el-select>
        <span class="lbl">性质</span>
        <el-select v-model="filterAttr" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部" style="width:200px">
          <el-option v-for="a in attrOptions" :key="a" :value="a" :label="a" />
        </el-select>
        <span class="lbl">关键词</span>
        <el-input v-model="keyword" size="small" placeholder="课程名 / 单位" clearable style="width:160px" />
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
    <el-table v-else :data="filtered" stripe size="default" max-height="600">
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
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);

const filterSem = ref<string[]>([]);
const filterAttr = ref<string[]>([]);
const keyword = ref("");

watch(() => props.data, (v) => { parsed.value = v?.parsed ?? null; }, { immediate: true });

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
.ctrl-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.ctrl-left { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lbl { font-size: 12px; color: #6b7280; }
.stat { font-size: 13px; color: var(--cpu-primary); font-weight: 500; }

.sem-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  margin: 4px 0 8px;
}
.sem-stat {
  display: grid;
  grid-template-columns: 110px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #f9fafb;
  border-radius: 6px;
  font-size: 12px;
}
.sem-name { font-weight: 500; color: #374151; }
.sem-bar-wrap { background: #e5e7eb; height: 6px; border-radius: 3px; overflow: hidden; }
.sem-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--cpu-primary), var(--cpu-primary-light));
  transition: width 0.3s;
}
.sem-val { color: #6b7280; white-space: nowrap; }

@media (max-width: 760px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .ctrl-left {
    align-items: stretch;
    flex-direction: column;
  }

  .ctrl-left :deep(.el-select),
  .ctrl-left :deep(.el-input) {
    width: 100% !important;
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

  :deep(.el-table) {
    font-size: 12px;
  }
}
</style>
