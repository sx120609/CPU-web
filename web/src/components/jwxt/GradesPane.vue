<template>
  <div class="grades-pane">
    <div class="ctrl-bar" v-if="parsed">
      <div class="ctrl-left">
        <label class="filter-field compact">
          <span class="lbl">学期</span>
          <el-select v-model="semester" size="small" clearable placeholder="全部学期" @change="reload">
            <el-option v-for="s in parsed.semesters" :key="s.value" :value="s.value" :label="s.label" />
          </el-select>
        </label>
        <label class="filter-field wide">
          <span class="lbl">性质</span>
          <el-select v-model="attrFilter" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部">
            <el-option v-for="a in attrOptions" :key="a" :value="a" :label="a" />
          </el-select>
        </label>
        <label class="filter-field">
          <span class="lbl">关键词</span>
          <el-input v-model="keyword" size="small" placeholder="课程名 / 代码" clearable />
        </label>
      </div>
      <div class="ctrl-right">
        <span class="stat">📚 {{ filteredList.length }} / {{ parsed.list.length }} 门</span>
        <span class="stat" v-if="totalCredits">· {{ totalCredits.toFixed(1) }} 学分</span>
        <span class="stat" v-if="avgGpa">
          · 平均 GPA <b>{{ avgGpa.toFixed(2) }}</b> / 5.0
        </span>
        <el-tooltip placement="top">
          <template #content>
            筛选后的 GPA 仅基于上方筛选条件计算<br/>
            <code>GPA = max(0, (成绩 − 50) ÷ 10)</code>，封顶 5.0<br/>
            60→1.0 · 70→2.0 · 80→3.0 · 90→4.0 · 100→5.0
          </template>
          <el-icon class="hint-icon"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!filteredList.length" description="没有符合条件的成绩" />
      <div v-else>
        <div v-for="(rows, semKey) in groupedBySem" :key="semKey" class="sem-block">
          <div class="sem-head">
            <h3>{{ semKey }}</h3>
            <span class="sem-sum">{{ rows.length }} 门 · {{ semCredits(rows).toFixed(1) }} 学分 · 平均 GPA {{ semGpa(rows).toFixed(2) }}</span>
          </div>
          <div class="table-scroll">
            <el-table :data="rows" stripe size="default">
              <el-table-column prop="courseCode" label="课程代码" width="110" />
              <el-table-column prop="courseName" label="课程名称" min-width="200" />
              <el-table-column prop="credits" label="学分" width="70" align="right" />
              <el-table-column prop="hours" label="学时" width="70" align="right" />
              <el-table-column label="平时" width="60" align="right">
                <template #default="{ row }">{{ row.usual || "—" }}</template>
              </el-table-column>
              <el-table-column label="期中" width="60" align="right">
                <template #default="{ row }">{{ row.midterm || "—" }}</template>
              </el-table-column>
              <el-table-column label="期末" width="60" align="right">
                <template #default="{ row }">{{ row.final || "—" }}</template>
              </el-table-column>
              <el-table-column label="总成绩" width="80" align="right">
                <template #default="{ row }">
                  <span :style="{ color: scoreColor(row.scoreNum), fontWeight: 600 }">{{ row.score }}</span>
                </template>
              </el-table-column>
              <el-table-column label="绩点" width="70" align="right">
                <template #default="{ row }">
                  <span :style="{ color: gpaColor(row.gpa) }">{{ row.gpa?.toFixed(1) ?? "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="性质" width="80">
                <template #default="{ row }">
                  <el-tag v-if="row.courseAttr" size="small" :type="attrTagType(row.courseAttr)" effect="plain">
                    {{ row.courseAttr }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="examType" label="考试" width="100" />
            </el-table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { InfoFilled } from "@element-plus/icons-vue";

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
  gpa?: number;
  courseAttr?: string;
  examType?: string;
  remark?: string;
}

const props = defineProps<{ data: any; loading?: boolean }>();
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);
const semester = ref<string>("");
const attrFilter = ref<string[]>([]);
const keyword = ref<string>("");

watch(() => props.data, (v) => { parsed.value = v?.parsed ?? null; }, { immediate: true });

/** 数据里出现过的全部课程性质（含空字符串过滤）— 动态生成 */
const attrOptions = computed<string[]>(() => {
  if (!parsed.value) return [];
  const s = new Set<string>();
  for (const g of parsed.value.list as GradeRow[]) {
    if (g.courseAttr) s.add(g.courseAttr);
  }
  return Array.from(s).sort();
});

/** 应用了筛选条件后的列表 */
const filteredList = computed<GradeRow[]>(() => {
  if (!parsed.value) return [];
  const kw = keyword.value.trim().toLowerCase();
  return (parsed.value.list as GradeRow[]).filter((g) => {
    if (attrFilter.value.length && !attrFilter.value.includes(g.courseAttr ?? "")) return false;
    if (kw) {
      const hit =
        g.courseName.toLowerCase().includes(kw) ||
        (g.courseCode ?? "").toLowerCase().includes(kw) ||
        (g.examType ?? "").toLowerCase().includes(kw);
      if (!hit) return false;
    }
    return true;
  });
});

const groupedBySem = computed(() => {
  const m: Record<string, GradeRow[]> = {};
  const list = filteredList.value;
  const semesters = Array.from(new Set(list.map((g) => g.semester))).sort().reverse();
  for (const s of semesters) m[s] = [];
  for (const g of list) (m[g.semester || "未知学期"] ??= []).push(g);
  return m;
});

function semCredits(rows: GradeRow[]) {
  return rows.reduce((s, g) => s + (Number.isFinite(g.credits) ? (g.credits as number) : 0), 0);
}
function semGpa(rows: GradeRow[]) {
  let sum = 0, cred = 0;
  for (const g of rows) {
    if (typeof g.gpa === "number" && typeof g.credits === "number") {
      sum += g.gpa * g.credits; cred += g.credits;
    }
  }
  return cred ? sum / cred : 0;
}

const avgGpa = computed(() => {
  return semGpa(filteredList.value);
});

const totalCredits = computed(() => {
  return semCredits(filteredList.value);
});

function scoreColor(n: number | null) {
  if (n === null) return "#1f2937";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "#1f2937";
  return "#dc2626";
}
function gpaColor(g?: number) {
  if (g === undefined) return "#9ca3af";
  if (g >= 4.0) return "#16a34a";  // ≥ 90 分
  if (g >= 1.0) return "#1f2937";  // ≥ 60 分
  return "#dc2626";                 // 不及格
}

function attrTagType(attr?: string): "success" | "warning" | "info" | "primary" | "danger" {
  if (!attr) return "info";
  if (/必修/.test(attr)) return "danger";
  if (/限选|限定选修/.test(attr)) return "warning";
  if (/任选|公选|通识/.test(attr)) return "success";
  if (/选修/.test(attr)) return "primary";
  return "info";
}

async function reload() {
  loading.value = true;
  try {
    const tk = sessionStorage.getItem("cpu-jwxt-token") ?? "";
    const u = new URL("/api/jwxt/grades", window.location.origin);
    if (semester.value) u.searchParams.set("semester", semester.value);
    const resp = await fetch(u, { headers: { "X-Jwxt-Token": tk } });
    const body = await resp.json();
    if (body.code === 0) parsed.value = body.data.parsed;
  } finally { loading.value = false; }
}
</script>

<style scoped>
.grades-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.ctrl-left {
  display: grid;
  grid-template-columns: minmax(130px, 150px) minmax(170px, 220px) minmax(150px, 190px);
  gap: 10px;
  align-items: end;
  min-width: 0;
}
.ctrl-right { display: flex; gap: 8px; align-items: center; }
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
.lbl { font-size: 12px; color: #6b7280; }
.stat { font-size: 13px; color: #6b7280; }
.stat b { color: var(--cpu-primary); font-size: 15px; }
.hint-icon { color: #6b7280; cursor: help; margin-left: 4px; font-size: 14px; }
code { background: rgba(255,255,255,0.12); padding: 1px 4px; border-radius: 3px; }

.sem-block { margin-bottom: 20px; }
.sem-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0 0 8px;
}
.sem-head h3 { margin: 0; font-size: 15px; color: var(--cpu-primary); font-weight: 600; }
.sem-sum { font-size: 12px; color: #9ca3af; }
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-scroll :deep(.el-table) {
  min-width: 1000px;
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
    gap: 6px;
    line-height: 1.6;
    flex-wrap: wrap;
  }

  .sem-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  :deep(.el-table) {
    font-size: 12px;
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
