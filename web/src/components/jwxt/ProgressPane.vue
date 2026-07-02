<template>
  <div class="progress-pane" v-loading="loading">
    <div class="data-note">
      以下信息整理自教务系统，最终请以学校和学院通知为准。
    </div>

    <!-- 总览大卡 -->
    <div v-if="parsed" class="overall">
      <div class="overall-main">
        <div class="big-num">{{ totalEarned.toFixed(1) }}</div>
        <div class="big-lbl">已获得学分</div>
      </div>
      <div class="overall-bar-wrap">
        <div class="overall-bar-info">
          <span>已获得 <b>{{ totalEarned.toFixed(1) }}</b></span>
          <span v-if="totalRequired > 0">已要求 <b>{{ totalRequired.toFixed(1) }}</b></span>
          <span v-if="totalLeft > 0" class="warn">未获得 <b>{{ totalLeft.toFixed(1) }}</b></span>
          <span v-if="totalRequired > 0">· 进度 <b>{{ overallPercent }}%</b></span>
        </div>
        <el-progress
          v-if="totalRequired > 0"
          :percentage="overallPercent"
          :status="overallStatus"
          :stroke-width="10"
          :show-text="false"
        />
        <div class="overall-detail">
          <span class="dim-pill must">
            必修 {{ earnedMustFinal.toFixed(1) }} / {{ mustRequiredFinal.toFixed(1) }}
          </span>
          <span class="dim-pill opt">
            选修 {{ parsed.totals.earnedOpt.toFixed(1) }}<span v-if="parsed.totals.requiredOpt > 0"> / {{ parsed.totals.requiredOpt.toFixed(1) }}</span>
          </span>
          <span v-if="parsed.uncompleted?.length" class="dim-pill warn-pill">
            待修必修 {{ parsed.uncompleted.length }} 门 · {{ totalUncompletedCredits.toFixed(1) }} 学分
          </span>
        </div>
      </div>
    </div>

    <!-- 课程体系学分卡片 -->
    <div v-if="summaryCards.length" class="summary">
      <div v-for="s in summaryCards" :key="s.name" class="summary-card">
        <div class="card-title">{{ s.name }}</div>
        <div class="card-stat">
          <span class="big">{{ s.earned.toFixed(1) }}</span>
          <template v-if="s.required > 0">
            <span class="sep">/</span>
            <span class="goal">{{ s.required.toFixed(1) }}</span>
          </template>
          <span class="lbl">学分</span>
        </div>
        <el-progress
          v-if="s.required > 0"
          :percentage="percent(s.earned, s.required)"
          :status="progressStatus(s.earned, s.required)"
          :stroke-width="6"
        />
        <div v-else class="card-note">暂无要求学分数据</div>
        <div class="card-detail">
          <span v-if="s.required > 0">{{ s.kind }} {{ s.earned.toFixed(1) }}/{{ s.required.toFixed(1) }}</span>
          <span v-else>{{ s.kind }} {{ s.earned.toFixed(1) }}</span>
          <span v-if="s.extra">{{ s.extra }}</span>
          <span v-if="s.left > 0" class="left-warn">还差 {{ s.left.toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <!-- 未完成必修课程（最关键的） -->
    <el-card v-if="parsed?.uncompleted?.length" class="block" shadow="never">
      <template #header>
        <div class="block-head">
          <h3 class="title warn">🚧 未完成必修课程</h3>
          <span class="cnt">{{ parsed.uncompleted.length }} 门 · {{ totalUncompletedCredits.toFixed(1) }} 学分</span>
        </div>
      </template>
      <div class="course-card-list">
        <article v-for="row in parsed.uncompleted" :key="`todo-${row.courseCode || row.courseName}-${row.semester}`" class="course-card">
          <div class="course-card-head">
            <div>
              <b>{{ row.courseName }}</b>
              <span>{{ row.semester || "未知学期" }}<template v-if="row.courseCode"> · {{ row.courseCode }}</template></span>
            </div>
            <el-tag v-if="row.score === '未通过'" type="info" size="small">未通过</el-tag>
            <el-tag v-else-if="row.score" type="danger" size="small">{{ row.score }}</el-tag>
            <span v-else class="cpu-muted">未修</span>
          </div>
          <div class="course-card-meta">
            <span v-if="row.credits">{{ row.credits }} 学分</span>
            <span v-if="row.hours">{{ row.hours }} 学时</span>
            <span v-if="row.attr">{{ row.attr }}</span>
          </div>
        </article>
      </div>
      <div class="table-scroll">
        <el-table :data="parsed.uncompleted" stripe size="small" max-height="500">
          <el-table-column prop="semester" label="学期" width="120" />
          <el-table-column v-if="!isMobile" prop="courseCode" label="课程编号" width="120" />
          <el-table-column prop="courseName" label="课程名称" min-width="200" />
          <el-table-column v-if="!isMobile" prop="credits" label="学分" width="70" align="right" />
          <el-table-column v-if="!isMobile" prop="hours" label="学时" width="70" align="right" />
          <el-table-column prop="attr" label="性质" width="80" />
          <el-table-column label="成绩" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.score === '未通过'" type="info" size="small">未通过</el-tag>
              <el-tag v-else-if="row.score" type="danger" size="small">{{ row.score }}</el-tag>
              <span v-else class="cpu-muted">未修</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 已完成必修课程 -->
    <el-card v-if="parsed?.completed?.length" class="block" shadow="never">
      <template #header>
        <div class="block-head">
          <h3 class="title ok">✅ 已完成必修课程</h3>
          <span class="cnt">{{ parsed.completed.length }} 门 · {{ totalCompletedCredits.toFixed(1) }} 学分</span>
        </div>
      </template>
      <div class="course-card-list">
        <article v-for="row in parsed.completed" :key="`done-${row.courseCode || row.courseName}-${row.semester}`" class="course-card">
          <div class="course-card-head">
            <div>
              <b>{{ row.courseName }}</b>
              <span>{{ row.semester || "未知学期" }}<template v-if="row.courseCode"> · {{ row.courseCode }}</template></span>
            </div>
            <strong :style="{ color: scoreColor(row.score) }">{{ row.score || "—" }}</strong>
          </div>
          <div class="course-card-meta">
            <span v-if="row.credits">{{ row.credits }} 学分</span>
            <span v-if="row.hours">{{ row.hours }} 学时</span>
            <span v-if="row.attr">{{ row.attr }}</span>
          </div>
        </article>
      </div>
      <div class="table-scroll">
        <el-table :data="parsed.completed" stripe size="small" max-height="500">
          <el-table-column prop="semester" label="学期" width="120" />
          <el-table-column v-if="!isMobile" prop="courseCode" label="课程编号" width="120" />
          <el-table-column prop="courseName" label="课程名称" min-width="200" />
          <el-table-column v-if="!isMobile" prop="credits" label="学分" width="70" align="right" />
          <el-table-column v-if="!isMobile" prop="hours" label="学时" width="70" align="right" />
          <el-table-column prop="attr" label="性质" width="80" />
          <el-table-column label="成绩" width="80" align="right">
            <template #default="{ row }">
              <span :style="{ color: scoreColor(row.score) }">{{ row.score }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-empty v-if="parsed && !parsed.summary?.length && !parsed.completed?.length" description="没有学业完成数据" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{ data: any; loading?: boolean }>();
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);

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

watch(() => props.data, (v) => { parsed.value = v?.parsed ?? null; }, { immediate: true });
watch(() => props.loading, (v) => { loading.value = Boolean(v); }, { immediate: true });

const totalEarned = computed(() => {
  if (!parsed.value) return 0;
  return earnedMustFinal.value + earnedOptFinal.value;
});

/** 必修要求总学分 —— 学校汇总表通常填 0，但我们有「已完成 + 未完成必修」两个完整表，自己加 */
const mustRequiredDerived = computed(() => {
  return totalCompletedCredits.value + totalUncompletedCredits.value;
});

/** 必修已获学分 —— 学校汇总表可能漏算，优先使用「已完成必修课程」明细合计 */
const earnedMustFinal = computed(() => {
  if (!parsed.value) return 0;
  return totalCompletedCredits.value > 0 ? totalCompletedCredits.value : (parsed.value.totals.earnedMust ?? 0);
});

/** 选修已获学分 —— 学业完成页没有选修明细，使用课程体系汇总表的选修已获合计 */
const earnedOptFinal = computed(() => {
  if (!parsed.value) return 0;
  return (parsed.value.summary ?? []).reduce((sum: number, s: any) => sum + (s.earnedOpt ?? 0), 0);
});

const totalRequired = computed(() => {
  if (!parsed.value) return 0;
  const t = parsed.value.totals;
  const reqMust = (t.requiredMust ?? 0) || mustRequiredDerived.value; // 学校填了用学校，没填就用衍生
  return reqMust + (t.requiredOpt ?? 0);
});

const totalLeft = computed(() => {
  return Math.max(0, totalRequired.value - totalEarned.value);
});

const mustRequiredFinal = computed(() => {
  const t = parsed.value?.totals;
  return (t?.requiredMust && t.requiredMust > 0) ? t.requiredMust : mustRequiredDerived.value;
});

const overallPercent = computed(() => {
  if (totalRequired.value <= 0) return 0;
  return Math.min(100, Math.round((totalEarned.value / totalRequired.value) * 100));
});

const overallStatus = computed<"success" | "warning" | "exception" | "">(() => {
  if (totalRequired.value <= 0) return "";
  const p = totalEarned.value / totalRequired.value;
  if (p >= 1) return "success";
  if (p >= 0.5) return "warning";
  return "exception";
});

const totalUncompletedCredits = computed(() => {
  return (parsed.value?.uncompleted ?? []).reduce((s: number, c: any) => s + (c.credits ?? 0), 0);
});
const totalCompletedCredits = computed(() => {
  return (parsed.value?.completed ?? []).reduce((s: number, c: any) => s + (c.credits ?? 0), 0);
});

const summaryCards = computed(() => {
  if (!parsed.value) return [];
  const mustLeft = Math.max(0, mustRequiredFinal.value - earnedMustFinal.value);
  const cards = [{
    name: "必修课程",
    kind: "必修",
    earned: earnedMustFinal.value,
    required: mustRequiredFinal.value,
    left: mustLeft,
    extra: parsed.value.uncompleted?.length ? `待修 ${parsed.value.uncompleted.length} 门` : "",
  }];

  for (const row of parsed.value.summary ?? []) {
    const earned = row.earnedOpt ?? 0;
    const required = (row.requiredOpt ?? 0) || ((row.leftOpt ?? 0) > 0 ? earned + (row.leftOpt ?? 0) : 0);
    if (!/选修/.test(row.name) && required <= 0 && earned <= 0) continue;
    if (required <= 0 && earned <= 0) continue;
    cards.push({
      name: row.name,
      kind: "选修",
      earned,
      required,
      left: Math.max(0, required - earned),
      extra: "",
    });
  }

  return cards;
});

function percent(earned: number, required: number): number {
  if (required <= 0) return earned > 0 ? 100 : 0;
  return Math.min(100, Math.round((earned / required) * 100));
}

function progressStatus(earned: number, required: number): "success" | "warning" | "exception" | "" {
  if (required <= 0 && earned > 0) return "success";
  if (required <= 0) return "";
  const p = earned / required;
  if (p >= 1) return "success";
  if (p >= 0.5) return "warning";
  return "exception";
}

function scoreColor(s: string) {
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return "var(--cpu-text-muted)";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "var(--cpu-text)";
  return "#dc2626";
}
</script>

<style scoped>
.progress-pane { display: flex; flex-direction: column; gap: 16px; }

.data-note {
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: var(--cpu-warn);
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 12px;
}

/* 顶部总览大卡 */
.overall {
  display: flex;
  gap: 24px;
  padding: 24px 28px;
  border-radius: 16px;
  background: linear-gradient(135deg, #168776 0%, #2da391 60%, #0f6557 100%);
  color: #fff;
  position: relative;
  overflow: hidden;
}
.overall::after {
  content: "";
  position: absolute;
  right: -50px;
  top: -50px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 40%, rgba(232, 163, 23, 0.45), transparent 60%);
  pointer-events: none;
}
.overall-main {
  text-align: center;
  min-width: 140px;
  border-right: 1px solid rgba(255,255,255,0.2);
  padding-right: 20px;
  z-index: 1;
}
.big-num { font-size: 40px; font-weight: 700; line-height: 1; }
.big-lbl { font-size: 13px; opacity: 0.85; margin-top: 6px; }

.overall-bar-wrap { flex: 1; min-width: 0; z-index: 1; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
.overall-bar-info {
  display: flex;
  gap: 18px;
  font-size: 13px;
  align-items: baseline;
  flex-wrap: wrap;
}
.overall-bar-info b { font-size: 16px; font-weight: 600; margin: 0 2px; }
.overall-bar-info .warn { color: #fef3c7; }
.overall-bar-info .warn b { color: #fde68a; }

.overall-detail { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.dim-pill {
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 14px;
  padding: 3px 12px;
  font-size: 12px;
}
.dim-pill.warn-pill {
  background: rgba(232, 163, 23, 0.25);
  border-color: rgba(232, 163, 23, 0.5);
  color: #fef3c7;
}

/* 课程体系卡片 */
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 12px;
}
.summary-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 14px 16px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.summary-card:hover { border-color: var(--cpu-primary); box-shadow: 0 4px 12px rgba(22, 135, 118, 0.08); }

.card-title { font-size: 13px; color: var(--cpu-text-secondary); font-weight: 500; }
.card-stat {
  margin: 8px 0 10px;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.big { font-size: 24px; font-weight: 700; color: var(--cpu-primary); line-height: 1; }
.sep { font-size: 16px; color: var(--cpu-text-muted); margin: 0 2px; }
.goal { font-size: 16px; color: var(--cpu-text-secondary); }
.lbl { font-size: 12px; color: var(--cpu-text-muted); margin-left: 2px; }
.card-note { font-size: 11px; color: var(--cpu-text-muted); padding: 4px 0; font-style: italic; }
.card-done {
  font-size: 12px;
  color: #16a34a;
  padding: 4px 0;
  font-weight: 500;
}

.card-detail {
  margin-top: 8px;
  font-size: 11px;
  color: var(--cpu-text-secondary);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.card-detail .left-warn {
  color: var(--cpu-warn);
  background: rgba(245, 158, 11, 0.16);
  padding: 1px 6px;
  border-radius: 4px;
}

.block { border-radius: 12px; border: 1px solid var(--cpu-border-soft); }
.block-head { display: flex; justify-content: space-between; align-items: baseline; }
.title { margin: 0; font-size: 15px; font-weight: 600; }
.title.warn { color: #b45309; }
.title.ok { color: #16a34a; }
.cnt { font-size: 12px; color: var(--cpu-text-muted); }
.cpu-muted { color: var(--cpu-text-muted); }
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.table-scroll :deep(.el-table) {
  min-width: 760px;
}
.course-card-list { display: none; }

.course-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
  padding: 12px;
}

.course-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.course-card-head b {
  display: block;
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.45;
}

.course-card-head span {
  display: block;
  margin-top: 3px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.course-card-head strong {
  flex-shrink: 0;
  font-size: 15px;
}

.course-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 10px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

@media (max-width: 760px) {
  .progress-pane {
    gap: 12px;
  }

  .overall {
    border-radius: 12px;
    padding: 18px 16px;
    flex-direction: column;
    gap: 14px;
  }

  .overall-main {
    min-width: 0;
    text-align: left;
    border-right: none;
    border-bottom: 1px solid rgba(255,255,255,0.2);
    padding-right: 0;
    padding-bottom: 12px;
  }

  .big-num {
    font-size: 34px;
  }

  .overall-bar-info {
    gap: 8px;
    line-height: 1.6;
  }

  .summary {
    grid-template-columns: 1fr;
  }

  .block-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  :deep(.el-card__header),
  :deep(.el-card__body) {
    padding: 12px;
  }

  .table-scroll { display: none; }

  .course-card-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
}
</style>
