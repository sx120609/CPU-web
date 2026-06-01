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
          · 加权 GPA <b>{{ avgGpa.toFixed(2) }}</b> / 5.0
        </span>
        <el-tooltip placement="top">
          <template #content>
            筛选后的 GPA 仅基于上方筛选条件计算，并按课程学分加权平均<br/>
            <code>GPA = max(0, (成绩 − 50) ÷ 10)</code>，封顶 5.0<br/>
            60→1.0 · 70→2.0 · 80→3.0 · 90→4.0 · 100→5.0<br/>
            等级成绩：优秀/优 4.5 · 良好/良 3.5 · 中等/中 2.5 · 及格/合格 1.5 · 不及格/不合格 0
          </template>
          <el-icon class="hint-icon"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
    </div>

    <div class="service-reco">
      <div>
        <span class="reco-kicker">服务推荐</span>
        <b>成绩证明办理</b>
        <p>需要开具成绩相关证明时，可前往学校电子证明平台办理。</p>
      </div>
      <a
        class="reco-link"
        href="https://dzpzstu.cpu.edu.cn/student/"
        target="_blank"
        rel="noopener noreferrer"
      >
        前往办理
      </a>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!filteredList.length" description="没有符合条件的成绩" />
      <div v-else>
        <div v-for="(rows, semKey) in groupedBySem" :key="semKey" class="sem-block">
          <div class="sem-head">
            <h3>{{ semKey }}</h3>
            <span class="sem-sum">{{ rows.length }} 门 · {{ semCredits(rows).toFixed(1) }} 学分 · 加权 GPA {{ semGpa(rows).toFixed(2) }}</span>
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
                <span class="score-pill" :style="{ color: scoreColor(row.scoreNum) }">总评 {{ row.score || "—" }}</span>
                <span class="score-pill" :style="{ color: gpaColor(row.gpa) }">GPA {{ row.gpa?.toFixed(1) ?? "—" }}</span>
              </div>
              <div class="grade-detail">
                <span>平时 {{ row.usual || "—" }}</span>
                <span>期中 {{ row.midterm || "—" }}</span>
                <span>期末 {{ row.final || "—" }}</span>
              </div>
              <el-tag v-if="row.courseAttr" class="grade-tag" size="small" :type="attrTagType(row.courseAttr)" effect="plain">
                {{ row.courseAttr }}
              </el-tag>
            </article>
          </div>
          <div class="table-scroll">
            <el-table :data="rows" stripe size="default">
              <el-table-column v-if="!isMobile" prop="courseCode" label="课程代码" width="110" />
              <el-table-column prop="courseName" label="课程名称" min-width="200" />
              <el-table-column label="总成绩" width="88" align="right">
                <template #default="{ row }">
                  <span :style="{ color: scoreColor(row.scoreNum), fontWeight: 600 }">{{ row.score || "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="绩点" width="70" align="right">
                <template #default="{ row }">
                  <span :style="{ color: gpaColor(row.gpa) }">{{ row.gpa?.toFixed(1) ?? "—" }}</span>
                </template>
              </el-table-column>
              <el-table-column v-if="!isMobile" prop="credits" label="学分" width="70" align="right" />
              <el-table-column v-if="!isMobile" prop="hours" label="学时" width="70" align="right" />
              <el-table-column label="平时" width="60" align="right">
                <template #default="{ row }">{{ row.usual || "—" }}</template>
              </el-table-column>
              <el-table-column label="期中" width="60" align="right">
                <template #default="{ row }">{{ row.midterm || "—" }}</template>
              </el-table-column>
              <el-table-column label="期末" width="60" align="right">
                <template #default="{ row }">{{ row.final || "—" }}</template>
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
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

watch(() => props.data, (v) => { parsed.value = normalizeParsedGrades(v?.parsed ?? null); }, { immediate: true });
watch(() => props.loading, (v) => { loading.value = Boolean(v); }, { immediate: true });

function scoreToGpa(score?: string): number | undefined {
  const raw = String(score ?? "").trim();
  if (!raw) return undefined;
  const level = raw.replace(/\s+/g, "");
  const levelMap: Record<string, number> = {
    优秀: 4.5,
    优: 4.5,
    良好: 3.5,
    良: 3.5,
    中等: 2.5,
    中: 2.5,
    及格: 1.5,
    合格: 1.5,
    通过: 1.5,
    不及格: 0,
    不合格: 0,
    不通过: 0,
    未通过: 0,
  };
  if (Object.prototype.hasOwnProperty.call(levelMap, level)) return levelMap[level];

  const scoreNum = parseFloat(raw);
  if (!Number.isFinite(scoreNum)) return undefined;
  if (scoreNum < 60) return 0;
  const gpa = (scoreNum - 50) / 10;
  return Math.min(5, Math.max(0, Math.round(gpa * 100) / 100));
}

function normalizeGradeRow(row: GradeRow): GradeRow {
  const gpa = typeof row.gpa === "number" ? row.gpa : Number(row.gpa);
  if (Number.isFinite(gpa)) return { ...row, gpa };
  return { ...row, gpa: scoreToGpa(row.score) };
}

function normalizeParsedGrades(data: any) {
  if (!data || !Array.isArray(data.list)) return data;
  return { ...data, list: (data.list as GradeRow[]).map(normalizeGradeRow) };
}

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
  for (const s of Object.keys(m)) {
    m[s] = sortRowsByPublishedScore(m[s]);
  }
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

function hasPublishedScore(row: GradeRow) {
  return Boolean(String(row.score ?? "").trim());
}

function sortRowsByPublishedScore(rows: GradeRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Number(hasPublishedScore(b.row)) - Number(hasPublishedScore(a.row)) || a.index - b.index)
    .map(({ row }) => row);
}

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
    if (body.code === 0) parsed.value = normalizeParsedGrades(body.data.parsed);
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
.lbl { font-size: 12px; color: #6b7280; }
.stat { font-size: 13px; color: #6b7280; }
.stat b { color: var(--cpu-primary); font-size: 15px; }
.hint-icon { color: #6b7280; cursor: help; margin-left: 4px; font-size: 14px; }
code { background: rgba(255,255,255,0.12); padding: 1px 4px; border-radius: 3px; }

.service-reco {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid #d8eee9;
  border-radius: 8px;
  background: #f5fbf9;
}

.service-reco b {
  display: block;
  margin-top: 2px;
  color: #172033;
  font-size: 14px;
}

.service-reco p {
  margin: 3px 0 0;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
}

.reco-kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 600;
}

.reco-link {
  flex: 0 0 auto;
  border: 1px solid var(--cpu-primary);
  border-radius: 8px;
  padding: 7px 12px;
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.reco-link:hover {
  background: var(--cpu-primary);
  color: #fff;
}

.sem-block { margin-bottom: 20px; }
.sem-block:last-child { margin-bottom: 0; }
.sem-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0 0 8px;
}
.sem-head h3 { margin: 0; font-size: 15px; color: var(--cpu-primary); font-weight: 600; }
.sem-sum { font-size: 12px; color: #9ca3af; }
.table-scroll {
  display: none;
}
.table-scroll :deep(.el-table) {
  min-width: 1000px;
}
.mobile-grade-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.grade-card {
  position: relative;
  padding: 14px;
  border: 1px solid #eef0f4;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.grade-main {
  min-width: 0;
}

.course-title {
  padding-right: 72px;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
}

.course-sub,
.grade-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 7px;
  color: #6b7280;
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
  border-radius: 6px;
  background: #f9fafb;
  padding: 7px 8px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
}

.grade-tag {
  position: absolute;
  top: 12px;
  right: 12px;
  max-width: 84px;
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
    width: 100%;
    gap: 6px;
    line-height: 1.6;
    flex-wrap: wrap;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    background: #f5f7fb;
    white-space: nowrap;
  }

  .service-reco {
    padding: 14px;
    align-items: stretch;
    flex-direction: column;
    border-radius: 12px;
  }

  .reco-link {
    text-align: center;
  }

  .sem-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .mobile-grade-list {
    grid-template-columns: 1fr;
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

@media (max-width: 380px) {
  .score-badges {
    grid-template-columns: 1fr;
  }

  .course-title {
    padding-right: 0;
  }

  .grade-tag {
    position: static;
    margin-top: 10px;
    max-width: none;
  }
}
</style>
