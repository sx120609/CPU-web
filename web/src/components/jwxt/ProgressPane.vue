<template>
  <div class="progress-pane" v-loading="loading">
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
            必修 {{ parsed.totals.earnedMust.toFixed(1) }} / {{ mustRequiredFinal.toFixed(1) }}
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
    <div v-if="parsed?.summary?.length" class="summary">
      <div v-for="s in parsed.summary" :key="s.name" class="summary-card">
        <div class="card-title">{{ s.name }}</div>
        <div class="card-stat">
          <span class="big">{{ (s.earnedMust + s.earnedOpt).toFixed(1) }}</span>
          <template v-if="cardRequired(s) > 0">
            <span class="sep">/</span>
            <span class="goal">{{ cardRequired(s).toFixed(1) }}</span>
          </template>
          <span class="lbl">学分</span>
        </div>
        <el-progress
          v-if="cardRequired(s) > 0"
          :percentage="percent(s.earnedMust + s.earnedOpt, cardRequired(s))"
          :status="progressStatus(s.earnedMust + s.earnedOpt, cardRequired(s))"
          :stroke-width="6"
        />
        <div v-else class="card-note">暂无要求学分数据</div>
        <div class="card-detail">
          <span v-if="s.requiredMust > 0">必修 {{ s.earnedMust }}/{{ s.requiredMust }}</span>
          <span v-else-if="s.earnedMust > 0">必修 {{ s.earnedMust }}</span>
          <span v-if="s.requiredOpt > 0">选修 {{ s.earnedOpt }}/{{ s.requiredOpt }}</span>
          <span v-else-if="s.earnedOpt > 0">选修 {{ s.earnedOpt }}</span>
          <span v-if="(s.leftMust + s.leftOpt) > 0" class="left-warn">还差 {{ (s.leftMust + s.leftOpt).toFixed(1) }}</span>
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
      <el-table :data="parsed.uncompleted" stripe size="small" max-height="500">
        <el-table-column prop="semester" label="学期" width="120" />
        <el-table-column prop="courseCode" label="课程编号" width="120" />
        <el-table-column prop="courseName" label="课程名称" min-width="200" />
        <el-table-column prop="credits" label="学分" width="70" align="right" />
        <el-table-column prop="hours" label="学时" width="70" align="right" />
        <el-table-column prop="attr" label="性质" width="80" />
        <el-table-column label="成绩" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.score === '未通过'" type="info" size="small">未通过</el-tag>
            <el-tag v-else-if="row.score" type="danger" size="small">{{ row.score }}</el-tag>
            <span v-else class="cpu-muted">未修</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 已完成必修课程 -->
    <el-card v-if="parsed?.completed?.length" class="block" shadow="never">
      <template #header>
        <div class="block-head">
          <h3 class="title ok">✅ 已完成必修课程</h3>
          <span class="cnt">{{ parsed.completed.length }} 门 · {{ totalCompletedCredits.toFixed(1) }} 学分</span>
        </div>
      </template>
      <el-table :data="parsed.completed" stripe size="small" max-height="500">
        <el-table-column prop="semester" label="学期" width="120" />
        <el-table-column prop="courseCode" label="课程编号" width="120" />
        <el-table-column prop="courseName" label="课程名称" min-width="200" />
        <el-table-column prop="credits" label="学分" width="70" align="right" />
        <el-table-column prop="hours" label="学时" width="70" align="right" />
        <el-table-column prop="attr" label="性质" width="80" />
        <el-table-column label="成绩" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: scoreColor(row.score) }">{{ row.score }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-empty v-if="parsed && !parsed.summary?.length && !parsed.completed?.length" description="没有学业完成数据" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";

const props = defineProps<{ data: any; loading?: boolean }>();
const parsed = ref<any>(props.data?.parsed ?? null);
const loading = ref(props.loading ?? false);

watch(() => props.data, (v) => { parsed.value = v?.parsed ?? null; }, { immediate: true });

const totalEarned = computed(() => {
  if (!parsed.value) return 0;
  const t = parsed.value.totals;
  return (t.earnedMust ?? 0) + (t.earnedOpt ?? 0);
});

/** 必修要求总学分 —— 学校汇总表通常填 0，但我们有「已完成 + 未完成必修」两个完整表，自己加 */
const mustRequiredDerived = computed(() => {
  return totalCompletedCredits.value + totalUncompletedCredits.value;
});

const totalRequired = computed(() => {
  if (!parsed.value) return 0;
  const t = parsed.value.totals;
  const reqMust = (t.requiredMust ?? 0) || mustRequiredDerived.value; // 学校填了用学校，没填就用衍生
  return reqMust + (t.requiredOpt ?? 0);
});

const totalLeft = computed(() => {
  if (!parsed.value) return 0;
  const t = parsed.value.totals;
  // 必修未获得：用未完成必修学分（最准）
  const leftMust = totalUncompletedCredits.value > 0 ? totalUncompletedCredits.value : (t.leftMust ?? 0);
  return leftMust + (t.leftOpt ?? 0);
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

function percent(earned: number, required: number): number {
  if (required <= 0) return earned > 0 ? 100 : 0;
  return Math.min(100, Math.round((earned / required) * 100));
}

/** 单卡片的"要求总学分"
 *  优先用学校汇总值；若学校没填且 left=0，意味着学校认定已修满，要求 = earned；
 *  若学校没填但 left>0，要求 = earned + left
 */
function cardRequired(s: any): number {
  const reqFromSchool = (s.requiredMust ?? 0) + (s.requiredOpt ?? 0);
  if (reqFromSchool > 0) return reqFromSchool;
  const left = (s.leftMust ?? 0) + (s.leftOpt ?? 0);
  const earned = (s.earnedMust ?? 0) + (s.earnedOpt ?? 0);
  if (left > 0) return earned + left;
  return 0; // 没有要求数据，且 left=0，前端按"已修满 / 无强制"展示
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
  if (!Number.isFinite(n)) return "#9ca3af";
  if (n >= 85) return "#16a34a";
  if (n >= 60) return "#1f2937";
  return "#dc2626";
}
</script>

<style scoped>
.progress-pane { display: flex; flex-direction: column; gap: 16px; }

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
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.summary-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 14px 16px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.summary-card:hover { border-color: var(--cpu-primary); box-shadow: 0 4px 12px rgba(22, 135, 118, 0.08); }

.card-title { font-size: 13px; color: #6b7280; font-weight: 500; }
.card-stat {
  margin: 8px 0 10px;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.big { font-size: 24px; font-weight: 700; color: var(--cpu-primary); line-height: 1; }
.sep { font-size: 16px; color: #9ca3af; margin: 0 2px; }
.goal { font-size: 16px; color: #6b7280; }
.lbl { font-size: 12px; color: #9ca3af; margin-left: 2px; }
.card-note { font-size: 11px; color: #9ca3af; padding: 4px 0; font-style: italic; }
.card-done {
  font-size: 12px;
  color: #16a34a;
  padding: 4px 0;
  font-weight: 500;
}

.card-detail {
  margin-top: 8px;
  font-size: 11px;
  color: #6b7280;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.card-detail .left-warn {
  color: #b45309;
  background: #fef3c7;
  padding: 1px 6px;
  border-radius: 4px;
}

.block { border-radius: 12px; border: 1px solid #eef0f4; }
.block-head { display: flex; justify-content: space-between; align-items: baseline; }
.title { margin: 0; font-size: 15px; font-weight: 600; }
.title.warn { color: #b45309; }
.title.ok { color: #16a34a; }
.cnt { font-size: 12px; color: #9ca3af; }
.cpu-muted { color: #9ca3af; }
</style>
