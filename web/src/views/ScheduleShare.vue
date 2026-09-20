<template>
  <main class="shared-schedule-page">
    <header class="shared-head">
      <div>
        <p class="eyebrow">共享课表</p>
        <h1>{{ share?.owner || "共享课表" }}</h1>
        <p v-if="share">{{ share.semester }} · {{ share.courseCount }} 门课程</p>
      </div>
      <div class="head-actions">
        <el-select v-if="share" v-model="week" size="small" aria-label="选择周次">
          <el-option v-for="item in weeks" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-button @click="$router.push('/schedule')">我的课表</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :closable="false" :title="error" />
    <div v-else-if="loading" class="loading-state"><el-skeleton :rows="8" animated /></div>
    <section v-else-if="share" class="schedule-sheet">
      <div class="week-title"><strong>第 {{ week }} 周</strong><span>{{ weekRange }}</span><span v-if="adjustmentSummary">{{ adjustmentSummary }}</span></div>
      <div class="schedule-grid">
        <div class="grid-head corner" style="grid-column: 1; grid-row: 1">节次</div>
        <div v-for="day in 7" :key="day" class="grid-head" :style="{ gridColumn: day + 1, gridRow: 1 }" :class="{ today: dayDates[day - 1] === today }">
          <b>{{ dayNames[day - 1] }}</b><small>{{ dayDates[day - 1]?.slice(5) || "--" }}</small>
        </div>
        <template v-for="slot in slots" :key="`slot-${slot.no}`">
          <div class="slot-axis" :style="{ gridColumn: 1, gridRow: slot.no + 1 }"><b>{{ slot.no }}</b><small>{{ slot.start }}</small><small>{{ slot.end }}</small></div>
          <div v-for="day in 7" :key="`${slot.no}-${day}`" class="grid-cell" :style="{ gridColumn: day + 1, gridRow: slot.no + 1 }" :class="{ today: dayDates[day - 1] === today }" />
        </template>
        <article v-for="block in blocks" :key="`${block.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`" class="course-block" :style="blockStyle(block)">
          <strong>{{ block.course.name }}</strong>
          <span v-if="block.course.location">@{{ block.course.location }}</span>
          <em>{{ block.course.slotNote || block.course.weeks }}</em>
        </article>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { scheduleShareApi, type ScheduleShare } from "@/api/scheduleShares";
import { createScheduleViewModelHelpers } from "@/views/schedule/viewModels";
import { normalizeCalendarWeekDays, shortDate, todayKey } from "@/views/schedule/calendar";
import { smallSlots } from "@/views/schedule/slots";

const route = useRoute();
const share = ref<ScheduleShare | null>(null);
const week = ref("1");
const loading = ref(true);
const error = ref("");
const today = todayKey();
const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const emptyEdits = { hidden: [], custom: [] };
const helpers = createScheduleViewModelHelpers({
  calendar: () => share.value?.calendar || null,
  parsed: () => share.value?.schedule || null,
  weeks: () => weeks.value,
  scheduleEdits: () => emptyEdits,
  activeDay: () => 1,
  currentWeekValue: () => week.value,
  scheduleForWeek: () => share.value?.schedule || null,
  allKnownScheduleSources: () => share.value?.schedule ? [share.value.schedule] : [],
});
const weeks = computed(() => (share.value?.calendar.weeks || []).map((item) => ({ value: String(item.week), label: `第 ${item.week} 周` })));
const weekInfo = computed(() => share.value?.calendar.weeks.find((item) => item.week === Number(week.value)) || null);
const dayDates = computed(() => normalizeCalendarWeekDays(weekInfo.value?.days || []));
const blocks = computed(() => helpers.weekCourseBlocksFor(Number(week.value), share.value?.schedule || null));
const weekRange = computed(() => weekInfo.value ? `${shortDate(weekInfo.value.monday)} - ${shortDate(weekInfo.value.sunday)}` : "");
const adjustmentSummary = computed(() => {
  const items = (share.value?.calendar.adjustments || []).filter((item) => dayDates.value.includes(item.date));
  return items.map((item) => item.kind === "off" ? `${item.date.slice(5)} 放假` : `${item.date.slice(5)} 上 ${item.source?.slice(5) || "指定日期"} 的课`).join(" · ");
});
const slots = computed(() => {
  const configured = share.value?.calendar.periods;
  return configured?.length
    ? configured.map((item) => ({ no: item.id, start: item.start, end: item.end }))
    : smallSlots;
});

function blockStyle(block: { day: number; startSlot: number; endSlot: number }) {
  return { gridColumn: `${block.day + 1}`, gridRow: `${block.startSlot + 1} / ${block.endSlot + 2}` };
}
onMounted(async () => {
  try {
    share.value = await scheduleShareApi.get(String(route.params.code || "").toUpperCase());
    week.value = String(share.value.calendar.currentWeek || share.value.calendar.weeks[0]?.week || 1);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "共享课表加载失败";
  } finally { loading.value = false; }
});
</script>

<style scoped>
.head-actions .el-select { width: 120px; }
.shared-schedule-page{min-height:100vh;padding:28px max(16px,4vw) 48px;background:var(--cpu-bg);color:var(--cpu-text)}.shared-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;max-width:1180px;margin:0 auto 20px}.eyebrow{margin:0 0 5px;color:var(--cpu-primary);font-size:12px;font-weight:700;letter-spacing:.04em}.shared-head h1{margin:0;font-size:28px}.shared-head p:last-child{margin:7px 0 0;color:var(--cpu-text-secondary)}.head-actions{display:flex;align-items:center;gap:8px}.schedule-sheet{max-width:1180px;margin:0 auto;padding:16px;border:1px solid var(--cpu-border);border-radius:12px;background:var(--cpu-card);box-shadow:var(--cpu-shadow-sm)}.week-title{display:flex;align-items:center;gap:14px;margin:0 0 12px;color:var(--cpu-text-secondary);font-size:13px}.week-title strong{color:var(--cpu-text);font-size:16px}.schedule-grid{position:relative;display:grid;grid-template-columns:54px repeat(7,minmax(72px,1fr));grid-template-rows:40px repeat(11,minmax(52px,1fr));overflow:auto;border-top:1px solid var(--cpu-border);border-left:1px solid var(--cpu-border)}.grid-head,.slot-axis,.grid-cell{min-width:0;border-right:1px solid var(--cpu-border);border-bottom:1px solid var(--cpu-border)}.grid-head{display:flex;align-items:center;justify-content:center;gap:3px;flex-direction:column;background:var(--cpu-surface-soft);font-size:12px}.grid-head small,.slot-axis small{color:var(--cpu-text-secondary);font-size:10px}.grid-head.today{background:color-mix(in srgb, var(--cpu-primary) 14%, var(--cpu-card))}.slot-axis{z-index:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;background:var(--cpu-surface-soft);color:var(--cpu-text-secondary);font-size:11px}.grid-cell.today{background:color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-card))}.course-block{z-index:2;display:flex;min-width:0;margin:3px;padding:6px;border-radius:7px;background:color-mix(in srgb, var(--cpu-primary) 18%, var(--cpu-card));color:var(--cpu-text);box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--cpu-primary) 30%, transparent);flex-direction:column;overflow:hidden}.course-block strong,.course-block span,.course-block em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.course-block strong{font-size:12px}.course-block span,.course-block em{margin-top:3px;font-size:10px;font-style:normal}.course-block em{color:var(--cpu-text-secondary)}.loading-state{max-width:720px;margin:80px auto}@media(max-width:680px){.shared-head{align-items:flex-start;flex-direction:column}.head-actions{width:100%}.head-actions .el-select{flex:1}.shared-head h1{font-size:24px}.schedule-sheet{padding:8px}.week-title{flex-wrap:wrap}.schedule-grid{grid-template-columns:46px repeat(7,74px)}}
</style>
