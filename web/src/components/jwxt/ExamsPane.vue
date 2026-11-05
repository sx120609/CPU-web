<template>
  <div class="exams-pane">
    <div class="ctrl-bar">
      <div class="ctrl-left">
        <label class="filter-field">
          <span class="lbl">学期</span>
          <el-select v-model="semester" size="small" placeholder="选择学期" @change="reload()">
            <el-option v-for="s in semesterOptions" :key="s" :value="s" :label="s" />
          </el-select>
        </label>
        <label class="filter-field compact">
          <span class="lbl">类型</span>
          <el-select v-model="type" size="small" clearable placeholder="全部" @change="reload()">
            <el-option label="期初" value="1" />
            <el-option label="期中" value="2" />
            <el-option label="期末" value="3" />
          </el-select>
        </label>
      </div>
      <div class="ctrl-right" v-if="parsed">
        <span class="stat">{{ parsed.list?.length ?? 0 }} 场考试<template v-if="upcomingPlans.length"> · 待考 {{ upcomingPlans.length }} 场</template></span>
        <el-button v-if="upcomingPlans.length" size="small" :icon="Calendar" @click="exportExams(upcomingPlans)">导入日历</el-button>
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
          <el-button size="small" :loading="loading" @click="reload(!semester)">重试</el-button>
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
            <a v-if="academicPortals?.undergraduate" :href="academicPortals.undergraduate" target="_blank" rel="noopener noreferrer">
              去学校教务系统原站
            </a>
            查看是否有数据
          </li>
        </ul>
      </div>
      <el-empty v-else-if="!loading && !parsed" description="暂无考试安排数据" />
      <template v-else>
        <section v-if="nextPlan" class="exam-next" :class="`is-${nextPlan.urgency}`" aria-live="polite">
          <b>{{ nextHeadline }}</b>
          <span>{{ nextDetail }}</span>
        </section>
        <div class="exam-list">
          <button
            v-for="(plan, i) in plans"
            :key="`${i}-${plan.exam.courseName}-${plan.exam.examTime}`"
            type="button"
            class="exam-card"
            :class="`is-${plan.urgency}`"
            :aria-label="`${plan.exam.courseName}，${examCountdownLabel(plan)}，查看详情`"
            @click="openDetail(plan)"
          >
            <span class="exam-date" aria-hidden="true">
              <template v-if="plan.time">
                <small>{{ monthOf(plan.time) }} 月</small>
                <b>{{ dayOf(plan.time) }}</b>
                <small>{{ examWeekday(plan.time) }}</small>
              </template>
              <b v-else>?</b>
            </span>
            <span class="exam-body">
              <span class="exam-title-row">
                <span class="cname">{{ plan.exam.courseName }}</span>
                <span class="exam-countdown">{{ examCountdownLabel(plan) }}</span>
              </span>
              <span class="exam-meta">
                <span v-if="plan.time && examClockText(plan.time)"><AppIcon name="clock" /> {{ examClockText(plan.time) }}</span>
                <span v-else-if="!plan.time && plan.exam.examTime"><AppIcon name="clock" /> {{ plan.exam.examTime }}</span>
                <span v-if="plan.exam.location"><AppIcon name="pin" /> {{ plan.exam.location }}</span>
              </span>
              <span v-if="plan.exam.examType || plan.exam.seat" class="exam-tags">
                <span v-if="plan.exam.examType" class="exam-type">{{ plan.exam.examType }}</span>
                <span v-if="plan.exam.seat">座位号 {{ plan.exam.seat }}</span>
              </span>
            </span>
          </button>
        </div>
      </template>
    </div>

    <component
      :is="compact ? ElDrawer : ElDialog"
      v-model="detailOpen"
      v-bind="compact ? { direction: 'btt', size: 'auto' } : { width: 400, alignCenter: true }"
      title="考试详情"
      :class="compact ? 'exam-detail-sheet cpu-sheet-above-native-bar' : 'exam-detail-dialog'"
      append-to-body
    >
      <template v-if="detail">
        <div class="exam-detail-head" :class="`is-${detail.urgency}`">
          <b>{{ detail.exam.courseName }}</b>
          <span class="exam-countdown" :class="`is-${detail.urgency}`">{{ examCountdownLabel(detail) }}</span>
        </div>
        <dl class="exam-detail-list">
          <div v-for="row in detailRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
        <div class="exam-detail-actions">
          <el-button v-if="detail.time && detail.urgency !== 'ended'" type="primary" :icon="Calendar" @click="exportExams([detail])">导入日历</el-button>
          <el-button @click="detailOpen = false">关闭</el-button>
        </div>
      </template>
    </component>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { ref, computed, watch, onBeforeUnmount, onMounted } from "vue";
import { ElDialog, ElDrawer, ElMessage } from "element-plus";
import { Calendar } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { useJwxtStore } from "@/stores/jwxt";
import { useAcademicPortals } from "@/utils/academicSystem";
import { useFormFactor } from "@/utils/formFactor";
import { saveWeekIcs } from "@/views/schedule/icsExport";
import {
  buildExamIcs,
  examClockText,
  examCountdownLabel,
  examIcsFileName,
  examWeekday,
  planExams,
  type ExamLike,
  type ExamPlan,
  type ExamTimeRange,
} from "./examSchedule";

const props = defineProps<{ data: any; loading?: boolean }>();
const jwxt = useJwxtStore();
const academicPortals = useAcademicPortals();
const formFactor = useFormFactor();
const compact = computed(() => formFactor.value.compact);

// 倒计时跟着时间走：每分钟重算一次，过了开考时间的考试会自己变成“已结束”。
const now = ref(new Date());
const clock = window.setInterval(() => { now.value = new Date(); }, 60_000);
onBeforeUnmount(() => window.clearInterval(clock));

const plans = computed(() => planExams<ExamLike>(parsed.value?.list ?? [], now.value));
const upcomingPlans = computed(() => plans.value.filter((plan) => plan.time && plan.urgency !== "ended"));
const nextPlan = computed(() => upcomingPlans.value[0] ?? null);
const nextHeadline = computed(() => {
  const plan = nextPlan.value;
  if (!plan?.time) return "";
  const name = `《${plan.exam.courseName}》`;
  if (plan.urgency === "today") return plan.time.start ? `今天 ${plan.time.start} 考${name}` : `今天考${name}`;
  if (plan.daysLeft === 1) return `明天考${name}`;
  return `距离${name}还有 ${plan.daysLeft} 天`;
});
const nextDetail = computed(() => {
  const plan = nextPlan.value;
  if (!plan?.time) return "";
  return [
    `${monthOf(plan.time)} 月 ${dayOf(plan.time)} 日 ${examWeekday(plan.time)} ${examClockText(plan.time)}`.trim(),
    plan.exam.location,
    plan.exam.seat ? `座位号 ${plan.exam.seat}` : "",
  ].filter(Boolean).join(" · ");
});

function monthOf(time: ExamTimeRange) {
  return Number(time.date.slice(5, 7));
}
function dayOf(time: ExamTimeRange) {
  return Number(time.date.slice(8, 10));
}

const detailOpen = ref(false);
const detail = ref<ExamPlan<ExamLike> | null>(null);
function openDetail(plan: ExamPlan<ExamLike>) {
  detail.value = plan;
  detailOpen.value = true;
}
const detailRows = computed(() => {
  const plan = detail.value;
  if (!plan) return [];
  const exam = plan.exam;
  const rows = [
    { label: "考试日期", value: plan.time ? `${plan.time.date}（${examWeekday(plan.time)}）` : "" },
    { label: "考试时间", value: plan.time ? examClockText(plan.time) : exam.examTime ?? "" },
    { label: "考试地点", value: exam.location ?? "" },
    { label: "座位号", value: exam.seat ?? "" },
    { label: "考试性质", value: exam.examType ?? "" },
    { label: "考试场次", value: exam.examName && exam.examName !== exam.examType ? exam.examName : "" },
    { label: "课程代码", value: exam.courseCode ?? "" },
  ];
  return rows.filter((row) => String(row.value).trim());
});

async function exportExams(list: ExamPlan<ExamLike>[]) {
  const exams = list.map((plan) => plan.exam);
  const { content, count } = buildExamIcs(exams);
  if (!count) {
    ElMessage.info("这些考试还没有具体日期，暂时不能导入");
    return;
  }
  const result = await saveWeekIcs(content, examIcsFileName(exams));
  if (result === "downloaded") {
    ElMessage.success(count > 1 ? `已导出 ${count} 场考试的日历文件，用日历应用打开即可导入` : "已导出日历文件，用日历应用打开即可导入");
  }
}
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

// 没有从外面拿到数据时自己取一次：不带学期，教务返回当前学期和学期列表。
onMounted(() => {
  if (!parsed.value && !props.loading) void reload(true);
});

async function reload(initial = false) {
  if (!semester.value && !initial) {
    loadError.value = "";
    return;
  }
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const params = semester.value ? { semester: semester.value, type: type.value || undefined } : undefined;
    const result = await jwxt.withSessionRetry(() => jwxtApi.exams(params, { silent: true }));
    if (seq === loadSeq) {
      parsed.value = result.parsed;
      if (!semester.value && result.parsed?.currentSemester) semester.value = result.parsed.currentSemester;
    }
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
.lbl { font-size: var(--cpu-fs-xs); color: var(--cpu-text-secondary); }
.stat { font-size: var(--cpu-fs-s); color: var(--cpu-primary); font-weight: 500; }

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

.ctrl-right { display: flex; align-items: center; gap: 10px; }

/* 紧急程度：今天和 3 天内红，7 天内琥珀，更远绿，考完灰。 */
.exam-next,
.exam-card,
.exam-detail-head {
  --exam-ink: var(--cpu-hue-green-ink);
  --exam-soft: var(--cpu-hue-green-bg);
}
.is-today,
.is-urgent { --exam-ink: var(--cpu-danger); --exam-soft: var(--cpu-danger-soft); }
.is-soon { --exam-ink: var(--cpu-hue-amber-ink); --exam-soft: var(--cpu-hue-amber-bg); }
.is-ended,
.is-unknown { --exam-ink: var(--cpu-text-muted); --exam-soft: var(--cpu-surface-subtle); }

.exam-next {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
  padding: 10px 14px;
  border-radius: var(--cpu-radius-m);
  background: var(--exam-soft);
}
.exam-next b { font-size: var(--cpu-fs-m); font-weight: 600; color: var(--exam-ink); }
.exam-next span { font-size: var(--cpu-fs-xs); color: var(--cpu-text-secondary); }

.exam-list { display: flex; flex-direction: column; gap: 8px; }
.exam-card {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-card);
  align-items: center;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s;
}
.exam-card:hover { border-color: var(--cpu-border); }
.exam-card:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 1px; }
.exam-date {
  flex: 0 0 auto;
  width: 48px;
  padding: 5px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-surface-subtle);
  line-height: 1.2;
}
.exam-date b { font-size: var(--cpu-fs-xl); font-weight: 700; color: var(--exam-ink); font-variant-numeric: tabular-nums; }
.exam-date small { font-size: var(--cpu-fs-xs); color: var(--cpu-text-secondary); }
.exam-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.exam-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--cpu-fs-m);
  font-weight: 600;
  color: var(--cpu-text);
}
.exam-countdown {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: var(--cpu-radius-pill);
  background: var(--exam-soft);
  color: var(--exam-ink);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
}
.exam-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  font-size: var(--cpu-fs-s);
  color: var(--cpu-text-secondary);
}
.exam-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.exam-type {
  padding: 0 6px;
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
}
.exam-card.is-ended .cname,
.exam-card.is-ended .exam-meta { color: var(--cpu-text-muted); }
.exam-card.is-ended .exam-type { background: var(--cpu-surface-subtle); color: var(--cpu-text-muted); }

.exam-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-left: 10px;
  border-left: 3px solid var(--exam-ink);
}
.exam-detail-head b { font-size: var(--cpu-fs-l); font-weight: 600; color: var(--cpu-text); }
.exam-detail-head.is-ended,
.exam-detail-head.is-unknown { --exam-ink: var(--cpu-border); }
.exam-detail-list { margin: 14px 0 0; display: flex; flex-direction: column; gap: 10px; }
.exam-detail-list > div { display: grid; grid-template-columns: 72px 1fr; gap: 10px; font-size: var(--cpu-fs-m); }
.exam-detail-list dt { color: var(--cpu-text-secondary); }
.exam-detail-list dd { margin: 0; color: var(--cpu-text); overflow-wrap: anywhere; }
.exam-detail-actions { display: flex; gap: 10px; margin-top: 18px; }
.exam-detail-actions .el-button { flex: 1; margin: 0; }

.empty-card {
  background: var(--cpu-surface-subtle);
  border: 1px dashed var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  padding: 32px 24px;
  text-align: center;
  color: var(--cpu-text-secondary);
}
.empty-card h3 { margin: 12px 0 6px; font-size: var(--cpu-fs-l); color: var(--cpu-text); }
.empty-card p { margin: 0 0 8px; font-size: var(--cpu-fs-s); }
.empty-card ul {
  text-align: left;
  display: inline-block;
  margin: 0 auto;
  padding-left: 20px;
  font-size: var(--cpu-fs-s);
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
    justify-content: space-between;
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
