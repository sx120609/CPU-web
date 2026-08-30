<template>
  <div class="grades-pane">
    <div class="ctrl-bar" v-if="parsed">
      <div class="ctrl-left">
        <label class="filter-field compact">
          <span class="lbl">学期</span>
          <el-select
            v-model="semesterFilter"
            size="small"
            multiple
            clearable
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="1"
            placeholder="全部学期（可多选）"
          >
            <el-option v-for="s in parsed.semesters" :key="s.value" :value="s.value" :label="s.label" />
          </el-select>
        </label>
        <label class="filter-field wide">
          <span class="lbl">性质</span>
          <el-select v-model="attrFilter" size="small" multiple collapse-tags collapse-tags-tooltip placeholder="全部">
            <el-option v-for="a in attrOptions" :key="a" :value="a" :label="a" />
          </el-select>
        </label>
        <label class="filter-field keyword-filter">
          <span class="lbl">关键词</span>
          <el-input v-model="keyword" size="small" placeholder="课程名 / 代码" clearable />
        </label>
      </div>
      <div class="ctrl-right">
        <AcademicDataSourceBadge :source="parsed.source" />
        <span class="stat desktop-stat"><AppIcon name="course" /> 显示 {{ filteredList.length }} / {{ parsed.list.length }} 门</span>
        <span class="stat desktop-stat">· 统计 {{ statList.length }} 门</span>
        <span class="stat desktop-stat" v-if="statCredits">· {{ statCredits.toFixed(1) }} 学分</span>
        <span class="stat desktop-stat" v-if="statList.length && statCredits">
          · 加权 GPA <b>{{ statGpa.toFixed(2) }}</b> / 5.0
        </span>
        <span class="stat mobile-stat">{{ compactStatsText }}</span>
        <el-tooltip placement="top">
          <template #content>
            GPA 按学校电子证明成绩单的汇总口径统计：只统计通过成绩，并按课程取一条有效记录后按学分加权<br/>
            <code>GPA = max(0, (成绩 − 50) ÷ 10)</code>，封顶 5.0；0–59 分不计入学分分母<br/>
            60→1.0 · 70→2.0 · 80→3.0 · 90→4.0 · 100→5.0<br/>
            补考及格成绩如实显示，绩点按 1.0 计算；同一学期同一课程代码的重复记录只保留一条<br/>
            明细行绩点与汇总均采用学校电子成绩单口径
          </template>
          <el-icon class="hint-icon"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
    </div>

    <div class="gpa-tool" v-if="parsed">
      <div class="calc-head">
        <div class="calc-title">
          <b>自定义 GPA</b>
          <span>{{ selectionSummaryText }}</span>
        </div>
        <div class="calc-mode-switch" role="group" aria-label="GPA 统计口径">
          <button
            v-for="mode in statModeOptions"
            :key="mode.value"
            type="button"
            class="calc-mode-btn"
            :class="{ active: statMode === mode.value }"
            :aria-pressed="statMode === mode.value"
            :disabled="mode.value !== 'all' && !selectedCourseKeys.length"
            @click="statMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
      <div class="calc-controls">
        <label class="filter-field course-picker">
          <span class="lbl">选择课程</span>
          <el-select
            v-model="selectedCourseKeys"
            size="small"
            multiple
            filterable
            clearable
            collapse-tags
            collapse-tags-tooltip
            placeholder="搜索课程名 / 代码"
            :disabled="!filteredList.length"
            @change="activateSelectionMode"
          >
            <el-option v-for="course in courseOptions" :key="course.key" :value="course.key" :label="course.label">
              <div class="course-option">
                <span>{{ course.name }}</span>
                <small>{{ course.meta }}</small>
              </div>
            </el-option>
          </el-select>
        </label>
        <div class="quick-actions">
          <el-button size="small" :icon="Check" :disabled="!parsed.list.length" @click="selectAllCourses">全选</el-button>
          <el-button size="small" :icon="Filter" :disabled="!filteredList.length" @click="selectFilteredCourses">筛选内全选</el-button>
          <el-button size="small" :icon="Switch" :disabled="!filteredList.length" @click="invertFilteredCourses">反选</el-button>
          <el-button size="small" :icon="Close" :disabled="!selectedCourseKeys.length" @click="clearSelection">清空</el-button>
        </div>
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
      <el-empty v-if="!loading && !filteredList.length" description="没有符合条件的成绩" />
      <div v-else>
        <div v-for="(rows, semKey) in groupedBySem" :key="semKey" class="sem-block">
          <div class="sem-head">
            <h3>{{ semKey }}</h3>
            <span class="sem-sum">{{ semCount(rows) }} 门 · {{ semCredits(rows).toFixed(1) }} 学分 · 加权 GPA {{ semGpa(rows).toFixed(2) }}</span>
          </div>
          <div class="mobile-grade-list">
            <article v-for="row in rows" :key="`${row.semester}-${row.courseCode || row.courseName}`" class="grade-card">
              <div class="grade-card-top">
                <el-checkbox :model-value="isCourseSelected(row)" @change="(checked) => toggleCourse(row, checked)">
                  选择
                </el-checkbox>
                <el-tag v-if="row.courseAttr" class="grade-tag" size="small" :type="attrTagType(row.courseAttr)" effect="plain">
                  {{ row.courseAttr }}
                </el-tag>
              </div>
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
            </article>
          </div>
          <div class="table-scroll">
            <el-table :data="rows" stripe size="default">
              <el-table-column label="选择" width="64" align="center" fixed>
                <template #default="{ row }">
                  <el-checkbox
                    :model-value="isCourseSelected(row)"
                    :aria-label="`选择 ${row.courseName}`"
                    @change="(checked) => toggleCourse(row, checked)"
                  />
                </template>
              </el-table-column>
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
import AppIcon from "@/components/common/AppIcon.vue";
import AcademicDataSourceBadge from "@/components/jwxt/AcademicDataSourceBadge.vue";
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { Check, Close, Filter, InfoFilled, Switch } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { useJwxtStore } from "@/stores/jwxt";
import { collapseTranscriptGrades, transcriptGradePoint, transcriptGradeStats } from "@/utils/jwxtGradeStats";

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
  statKey?: string;
}

type StatMode = "all" | "only" | "exclude";

const statModeOptions: Array<{ value: StatMode; label: string }> = [
  { value: "all", label: "全部" },
  { value: "only", label: "仅选中" },
  { value: "exclude", label: "排除选中" },
];

const props = defineProps<{ data: any; loading?: boolean }>();
const jwxt = useJwxtStore();
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);
const semesterFilter = ref<string[]>([]);
const attrFilter = ref<string[]>([]);
const keyword = ref<string>("");
const statMode = ref<StatMode>("all");
const selectedCourseKeys = ref<string[]>([]);
const loadError = ref("");
let loadSeq = 0;
let disposed = false;

const isMobile = ref(false);
let mql: MediaQueryList | null = null;
function onMqlChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches;
}
onMounted(() => {
  disposed = false;
  if (typeof window === "undefined" || !window.matchMedia) return;
  mql = window.matchMedia("(max-width: 760px)");
  isMobile.value = mql.matches;
  mql.addEventListener?.("change", onMqlChange);
});
onBeforeUnmount(() => {
  disposed = true;
  loadSeq += 1;
  loading.value = false;
  mql?.removeEventListener?.("change", onMqlChange);
  mql = null;
});

watch(() => props.data, (v) => {
  parsed.value = normalizeParsedGrades(v?.parsed ?? null);
  if (v?.parsed) loadError.value = "";
}, { immediate: true });
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
  return { ...row, gpa: transcriptGradePoint(row) ?? scoreToGpa(row.score) };
}

function normalizeParsedGrades(data: any) {
  if (!data || !Array.isArray(data.list)) return data;
  // 学校成绩页偶尔会返回同一学期、同一课程代码的重复行。列表展示与
  // 电子成绩单统计使用同一去重口径，避免重复行仍出现在页面中；不同
  // 学期或不同课程代码的同名课程仍分别保留。
  const displayRows = collapseTranscriptGrades(data.list as GradeRow[]);
  return {
    ...data,
    list: displayRows.map((row, index) => {
      const normalized = normalizeGradeRow(row);
      return { ...normalized, statKey: makeCourseKey(normalized, index) };
    }),
  };
}

function makeCourseKey(row: GradeRow, index: number) {
  return [
    row.semester ?? "",
    row.courseCode ?? "",
    row.courseName ?? "",
    row.score ?? "",
    row.credits ?? "",
    row.examType ?? "",
    index,
  ].join("||");
}

function courseKey(row: GradeRow) {
  return row.statKey || [
    row.semester ?? "",
    row.courseCode ?? "",
    row.courseName ?? "",
    row.score ?? "",
    row.credits ?? "",
    row.examType ?? "",
  ].join("||");
}

function orderedKeys(rows: GradeRow[] = parsed.value?.list ?? []) {
  return rows.map(courseKey);
}

function commitSelection(keys: string[]) {
  const known = new Set(orderedKeys());
  selectedCourseKeys.value = Array.from(new Set(keys)).filter((key) => known.has(key));
}

function pruneSelection() {
  commitSelection(selectedCourseKeys.value);
  if (!selectedCourseKeys.value.length && statMode.value !== "all") statMode.value = "all";
}

watch(() => parsed.value?.list, pruneSelection);

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
    if (semesterFilter.value.length && !semesterFilter.value.includes(g.semester ?? "")) return false;
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

const filteredKeySet = computed(() => new Set(filteredList.value.map(courseKey)));
const selectedFilteredCount = computed(() => selectedCourseKeys.value.filter((key) => filteredKeySet.value.has(key)).length);
const hiddenSelectedCount = computed(() => Math.max(0, selectedCourseKeys.value.length - selectedFilteredCount.value));
const selectionSummaryText = computed(() => {
  if (!selectedCourseKeys.value.length) return "未选择课程";
  if (!hiddenSelectedCount.value) return `已选 ${selectedFilteredCount.value} 门`;
  return `当前筛选内 ${selectedFilteredCount.value} 门，另有 ${hiddenSelectedCount.value} 门隐藏`;
});

const statSourceList = computed<GradeRow[]>(() => {
  const list = filteredList.value;
  if (statMode.value === "all") return list;
  const selected = new Set(selectedCourseKeys.value);
  if (statMode.value === "only") return list.filter((row) => selected.has(courseKey(row)));
  return list.filter((row) => !selected.has(courseKey(row)));
});

const statSummary = computed(() => transcriptGradeStats(statSourceList.value));
const statList = computed<GradeRow[]>(() => statSummary.value.rows);

const courseOptions = computed(() => {
  const selectable = filteredKeySet.value;
  const selected = new Set(selectedCourseKeys.value);
  return ((parsed.value?.list ?? []) as GradeRow[]).filter((row) => {
    const key = courseKey(row);
    return selectable.has(key) || selected.has(key);
  }).map((row) => {
    const meta = [
      row.semester || "未知学期",
      row.courseCode || "",
      typeof row.credits === "number" ? `${row.credits} 学分` : "",
      row.score ? `成绩 ${row.score}` : "",
    ].filter(Boolean).join(" · ");
    return {
      key: courseKey(row),
      label: `${row.courseName} · ${meta}`,
      name: row.courseName,
      meta,
    };
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
  return transcriptGradeStats(rows).credits;
}
function semGpa(rows: GradeRow[]) {
  return transcriptGradeStats(rows).gpa;
}
function semCount(rows: GradeRow[]) {
  return transcriptGradeStats(rows).rows.length;
}

const statGpa = computed(() => {
  return statSummary.value.gpa;
});

const statCredits = computed(() => {
  return statSummary.value.credits;
});

const compactStatsText = computed(() => {
  const parts = [`${filteredList.value.length}/${parsed.value?.list?.length ?? 0} 门`];
  if (statCredits.value) parts.push(`${statCredits.value.toFixed(1)} 学分`);
  if (statList.value.length && statCredits.value) parts.push(`GPA ${statGpa.value.toFixed(2)}`);
  return parts.join(" · ");
});

function activateSelectionMode() {
  if (selectedCourseKeys.value.length && statMode.value === "all") statMode.value = "only";
  if (!selectedCourseKeys.value.length && statMode.value !== "all") statMode.value = "all";
}

function selectAllCourses() {
  commitSelection(orderedKeys());
  activateSelectionMode();
}

function selectFilteredCourses() {
  commitSelection(orderedKeys(filteredList.value));
  activateSelectionMode();
}

function invertFilteredCourses() {
  const selected = new Set(selectedCourseKeys.value);
  for (const key of filteredKeySet.value) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
  }
  commitSelection(orderedKeys().filter((key) => selected.has(key)));
  activateSelectionMode();
}

function clearSelection() {
  selectedCourseKeys.value = [];
  statMode.value = "all";
}

function isCourseSelected(row: unknown) {
  return selectedCourseKeys.value.includes(courseKey(row as GradeRow));
}

function toggleCourse(row: unknown, checked: string | number | boolean) {
  const grade = row as GradeRow;
  const key = courseKey(grade);
  const next = new Set(selectedCourseKeys.value);
  if (Boolean(checked)) next.add(key);
  else next.delete(key);
  commitSelection(orderedKeys().filter((item) => next.has(item)));
  activateSelectionMode();
}

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
  if (n === null) return "var(--cpu-text)";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "var(--cpu-text)";
  return "#dc2626";
}
function gpaColor(g?: number) {
  if (g === undefined) return "var(--cpu-text-muted)";
  if (g >= 4.0) return "#16a34a";  // ≥ 90 分
  if (g >= 1.0) return "var(--cpu-text)";  // ≥ 60 分
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
  if (disposed) return;
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await jwxt.withSessionRetry(() => jwxtApi.grades(undefined, { silent: true }));
    if (!disposed && seq === loadSeq) parsed.value = normalizeParsedGrades(result.parsed);
  } catch (error) {
    if (!disposed && seq === loadSeq) loadError.value = requestMessage(error) || "成绩加载失败，请稍后重试";
  } finally {
    if (!disposed && seq === loadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
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
.lbl { font-size: 12px; color: var(--cpu-text-secondary); }
.stat { font-size: 13px; color: var(--cpu-text-secondary); }
.stat b { color: var(--cpu-primary); font-size: 15px; }
.mobile-stat { display: none; }
.hint-icon { color: var(--cpu-text-secondary); cursor: help; margin-left: 4px; font-size: 14px; }
code { background: rgba(255,255,255,0.12); padding: 1px 4px; border-radius: 3px; }

.gpa-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
}

.calc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.calc-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.calc-title b {
  color: var(--cpu-text);
  font-size: 14px;
}

.calc-title span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.calc-mode-switch {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(72px, 1fr));
  gap: 2px;
  flex: 0 0 auto;
  padding: 3px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
}

.calc-mode-btn {
  min-width: 0;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.calc-mode-btn:hover:not(:disabled) {
  color: var(--cpu-primary);
}

.calc-mode-btn.active {
  background: var(--cpu-card);
  color: var(--cpu-primary);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}

.calc-mode-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--cpu-primary) 45%, transparent);
  outline-offset: 2px;
}

.calc-mode-btn:disabled {
  color: var(--cpu-text-muted);
  cursor: not-allowed;
}

.calc-controls {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.quick-actions :deep(.el-button) {
  margin-left: 0;
}

.course-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.course-option span {
  min-width: 0;
  overflow: hidden;
  color: var(--cpu-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-option small {
  flex: 0 0 auto;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.service-reco {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(20, 143, 123, 0.26);
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.08);
}

.service-reco b {
  display: block;
  margin-top: 2px;
  color: var(--cpu-text);
  font-size: 14px;
}

.service-reco p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
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
  min-width: 1060px;
}
.mobile-grade-list { display: none; }

.grade-card {
  position: relative;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.grade-main {
  min-width: 0;
}

.grade-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.grade-card-top :deep(.el-checkbox) {
  height: auto;
}

.grade-card-top :deep(.el-checkbox__label) {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.course-title {
  color: var(--cpu-text);
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
  border-radius: 6px;
  background: var(--cpu-surface-subtle);
  padding: 7px 8px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
}

.grade-tag {
  flex: 0 1 auto;
  max-width: 112px;
}

@media (max-width: 760px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .ctrl-left {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .ctrl-left .wide {
    grid-column: auto;
  }

  .ctrl-left .keyword-filter {
    grid-column: 1 / -1;
  }

  .filter-field {
    gap: 3px;
  }

  .ctrl-right {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
    line-height: 1.4;
  }

  .desktop-stat {
    display: none;
  }

  .mobile-stat {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    padding: 0;
    background: transparent;
    white-space: nowrap;
  }

  .gpa-tool {
    gap: 8px;
    padding: 10px;
    background: var(--cpu-surface-subtle);
  }

  .calc-head,
  .calc-controls {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .course-picker {
    display: none;
  }

  .calc-head {
    flex-direction: column;
  }

  .calc-mode-switch {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }

  .calc-mode-btn {
    height: 34px;
    padding-inline: 4px;
    font-size: 13px;
  }

  .quick-actions {
    justify-content: flex-start;
  }

  .quick-actions :deep(.el-button) {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .service-reco {
    padding: 9px 11px;
    align-items: center;
    flex-direction: row;
    border-radius: 10px;
  }

  .service-reco .reco-kicker,
  .service-reco p {
    display: none;
  }

  .service-reco b {
    margin: 0;
    font-size: 13px;
  }

  .reco-link {
    border: 0;
    padding: 4px 0;
    text-align: center;
  }

  .sem-head {
    align-items: baseline;
    flex-direction: row;
    gap: 8px;
  }

  .sem-sum {
    text-align: right;
  }

  .table-scroll { display: none; }

  .mobile-grade-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

@media (max-width: 430px) {
  .grade-card {
    padding: 12px;
    border-radius: 10px;
  }
}

@media (max-width: 380px) {
  .ctrl-left {
    grid-template-columns: 1fr;
  }
  .ctrl-left .keyword-filter {
    grid-column: auto;
  }
  .score-badges {
    grid-template-columns: 1fr;
  }
  .grade-tag {
    max-width: none;
  }
}
</style>
