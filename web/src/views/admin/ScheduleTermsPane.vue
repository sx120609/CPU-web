<template>
  <section class="schedule-terms-pane" v-loading="loading">
    <div class="pane-head">
      <div>
        <span class="eyebrow">教学安排管理</span><h2>课表校历</h2>
        <p>维护学期周历与放假调课安排，让每一天的课表准确同步。</p>
      </div>
      <el-button type="primary" @click="addTerm">新增学期</el-button>
    </div>


    <div class="term-layout">
      <aside class="term-list">
        <div class="list-heading">学期列表 <span>{{ terms.length }}</span></div>
        <button
          v-for="item in terms"
          :key="item.semester"
          type="button"
          :class="{ active: item.semester === selectedSemester }"
          :aria-pressed="item.semester === selectedSemester"
          @click="selectTerm(item.semester)"
        >
          <strong>{{ item.semester }}</strong>
          <small>{{ item.semesterStartMonday }} 开始 · {{ item.weekCount }} 周</small>
        </button>
        <el-empty v-if="!terms.length && !loading" description="还没有配置学期" />
      </aside>

      <div v-if="draft" class="term-editor">
        <section class="editor-card">
        <div class="section-head"><div><h3>学期设置</h3><small>设置教学周的起点与范围</small></div><el-tag type="info" effect="plain">{{ existingTerm ? `已发布 · v${existingTerm.version}` : "新学期" }}</el-tag></div>
        <div class="form-grid">
          <label><span>学期 ID</span><el-input v-model="draft.semester" :disabled="Boolean(existingTerm)" placeholder="例如 2026-2027-1" /></label>
          <label><span>第一周周一</span><el-date-picker v-model="draft.semesterStartMonday" type="date" value-format="YYYY-MM-DD" /></label>
          <label><span>总周数</span><el-input-number v-model="draft.weekCount" :min="1" :max="64" /></label>
          <label><span>时区</span><el-input v-model="draft.timezone" /></label>
          <label class="wide"><span>备注</span><el-input v-model="draft.note" maxlength="500" /></label>
        </div>

        </section>
        <section class="editor-card">
        <div class="section-head"><div><h3>放假与调课 <el-tag size="small" type="info">{{ draft.adjustments.length }} 条</el-tag></h3><small>学校具体调课安排以教务通知为准</small></div><el-button @click="addAdjustment">手动添加日期</el-button></div>
        <div class="import-box"><div class="import-title">公开假期导入</div>
        <div class="academic-year-picker"><span>导入学年</span><el-input-number v-model="academicYear" :min="2000" :max="2100" :precision="0" aria-label="学年起始年份" /><span>{{ academicYear }} 年 9 月 ～ {{ academicYear + 1 }} 年 7 月</span><el-button type="primary" :loading="importing" @click="previewHolidays">获取并预览</el-button></div>
        <p class="import-hint">一次获取整学年数据，确认后加入当前配置草稿，保存后生效。同日期已有配置会保留；缺失年份可稍后重新导入补齐。</p></div>
        <div class="adjustment-list">
          <div v-for="(item, index) in draft.adjustments" :key="index" class="adjustment-row">
            <label><span>生效日期</span><el-date-picker v-model="item.date" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" /></label>
            <label><span>当天安排</span><el-select v-model="item.kind" class="kind-select"><el-option label="放假" value="off" /><el-option label="调课" value="swap" /></el-select></label>
            <label><span>课程来源</span><el-date-picker v-if="item.kind === 'swap'" v-model="item.source" type="date" value-format="YYYY-MM-DD" placeholder="上哪天的课" /><span v-else class="off-label">当天停课</span></label>
            <label><span>备注</span><el-input v-model="item.note" maxlength="80" placeholder="例如 国庆节" /></label>
            <el-button text type="danger" @click="draft.adjustments.splice(index, 1)">删除</el-button>
          </div>
          <el-empty v-if="!draft.adjustments.length" description="暂无特殊安排，可导入公开假期或手动添加" :image-size="52" />
        </div>

        </section>
        <div class="save-bar"><span v-if="existingTerm">当前版本 v{{ existingTerm.version }}</span><span v-else>新学期配置</span><el-button type="primary" :loading="saving" @click="save">保存并生效</el-button></div>
      </div>
      <el-empty v-else description="选择一个学期开始编辑" />
    </div>
    <details class="shared-periods"><summary><span>全校节次时间 <small>{{ periods.length }} 节 · 所有学期共用</small></span><span class="summary-action">展开 / 收起</span></summary>
      <div class="section-head">
        <div><h3>节次时间</h3><small>全校统一，改一次对所有学期生效</small></div>
        <div class="period-actions">
          <el-button size="small" @click="addPeriod">增加节次</el-button>
          <el-button size="small" type="primary" :loading="savingPeriods" @click="savePeriods">保存节次时间</el-button>
        </div>
      </div>
      <div class="period-grid">
        <div v-for="(period, index) in periods" :key="period.id" class="period-row">
          <b>第{{ index + 1 }}节</b>
          <el-time-picker v-model="period.start" format="HH:mm" value-format="HH:mm" placeholder="开始" />
          <el-time-picker v-model="period.end" format="HH:mm" value-format="HH:mm" placeholder="结束" />
          <el-button text type="danger" @click="periods.splice(index, 1)">删除</el-button>
        </div>
      </div>
      <p class="hint">节次时间单独保存，对所有学期立即生效；保存学期配置时也会一并写入。</p>
    </details>

    <el-dialog v-model="previewVisible" title="确认公开放假 / 调休数据" width="min(960px, 95vw)" :close-on-click-modal="false">
      <p>{{ previewRange }} · 已选 {{ selectedImports.length }} 条</p>
      <el-alert v-for="warning in previewWarnings" :key="warning" :title="warning" type="warning" :closable="false" show-icon />
      <el-checkbox v-if="previewWarnings.length" v-model="acknowledgeMissingYears">我已知晓缺失年份，本次仅导入已获取的数据</el-checkbox>
      <p class="import-hint">请按学校通知核对并勾选。补班须填写“上哪天的课”；已有日期不可重复导入。取消不会修改草稿。</p>
      <p class="import-hint">来源：<a v-for="url in previewSources" :key="url" :href="url" target="_blank" rel="noopener noreferrer">{{ url }} </a></p>
      <el-table :data="importRows" max-height="420">
        <el-table-column label="导入" width="65"><template #default="{ row }"><el-checkbox v-model="row.selected" :disabled="row.conflict" aria-label="选择导入日期" /></template></el-table-column>
        <el-table-column prop="date" label="日期" width="115" />
        <el-table-column label="安排" width="100"><template #default="{ row }">{{ row.kind === 'off' ? '放假' : '补班 / 调课' }}</template></el-table-column>
        <el-table-column prop="note" label="节日" min-width="150" />
        <el-table-column label="确认课程" min-width="230"><template #default="{ row }">
          <el-tag v-if="row.conflict" type="info">已有配置，保留原设置</el-tag>
          <el-date-picker v-else-if="row.kind === 'swap'" v-model="row.source" type="date" value-format="YYYY-MM-DD" placeholder="必填：上哪天的课" />
          <span v-else>当天停课</span>
        </template></el-table-column>
        <template #empty>该学年范围内暂无公开放假 / 补班数据</template>
      </el-table>
      <template #footer><el-button @click="previewVisible = false">取消</el-button><el-button type="primary" :disabled="!selectedImports.length || (previewWarnings.length > 0 && !acknowledgeMissingYears)" @click="confirmImport">确认加入草稿</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type ScheduleTermConfig } from "@/api/admin";

type Draft = Omit<ScheduleTermConfig, "version" | "updatedAt">;
type Period = ScheduleTermConfig["periods"][number];
const terms = ref<ScheduleTermConfig[]>([]);
/// 全校统一的节次时间，和学期分开编辑。
const periods = ref<Period[]>([]);
const selectedSemester = ref("");
const draft = ref<Draft | null>(null);
const loading = ref(false);
const saving = ref(false);
const savingPeriods = ref(false);
type ImportRow = ScheduleTermConfig["adjustments"][number] & { selected: boolean; conflict: boolean };
const importing = ref(false);
const previewVisible = ref(false);
const previewSources = ref<string[]>([]);
const previewRange = ref("");
const previewWarnings = ref<string[]>([]);
const acknowledgeMissingYears = ref(false);
const now = new Date();
const academicYear = ref(now.getFullYear() - (now.getMonth() < 8 ? 1 : 0));
watch(() => [draft.value?.semesterStartMonday, draft.value?.semester] as const, ([date]) => {
  const semesterYear = Number(draft.value?.semester.match(/^(\d{4})-\d{4}-[12]$/)?.[1]);
  if (semesterYear) academicYear.value = semesterYear;
  else if (date) academicYear.value = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 8 ? 1 : 0);
});
const importRows = ref<ImportRow[]>([]);
const selectedImports = computed(() => importRows.value.filter((row) => row.selected && !row.conflict));
let importTarget: Draft | null = null;
let importYear = 0;
async function previewHolidays() {
  const target = draft.value;
  if (!target) return;
  if (!Number.isInteger(academicYear.value)) return ElMessage.warning("请选择导入学年");
  importing.value = true;
  const year = academicYear.value;
  try {
    const result = await adminApi.previewScheduleHolidays(year);
    if (draft.value !== target || academicYear.value !== year) return ElMessage.warning("学期已变更，请重新获取假期数据");
    importTarget = target; importYear = year;
    previewWarnings.value = result.warnings;
    acknowledgeMissingYears.value = false;
    previewRange.value = `${result.startDate} 至 ${result.endDate}`;
    previewSources.value = result.sources;
    const existingDates = new Set(target.adjustments.map((row) => row.date));
    importRows.value = result.adjustments.map((row) => ({ ...row, conflict: existingDates.has(row.date), selected: !existingDates.has(row.date) }));
    previewVisible.value = true;
  } catch { /* request layer shows the error */ } finally { importing.value = false; }
}
function confirmImport() {
  const target = draft.value;
  if (!target || target !== importTarget || academicYear.value !== importYear) return ElMessage.warning("学期已变更，请重新获取假期数据");
  if (previewWarnings.value.length && !acknowledgeMissingYears.value) return ElMessage.warning("请先确认缺失年份提示");
  const dates = new Set(target.adjustments.map((row) => row.date));
  const sources = new Set(target.adjustments.filter((row) => row.kind === "swap").map((row) => row.source));
  const rows = selectedImports.value.filter((row) => !dates.has(row.date));
  if (!rows.length) return ElMessage.warning("请选择要导入的日期");
  if (rows.length + target.adjustments.length > 200) return ElMessage.warning("一个学期最多配置 200 条调休");
  for (const row of rows) {
    if (row.kind !== "swap") continue;
    if (!row.source || row.source === row.date) return ElMessage.warning(`${row.date} 请填写有效的课程来源日期`);
    if (sources.has(row.source)) return ElMessage.warning(`${row.source} 已被调到其他日期`);
    sources.add(row.source);
  }
  target.adjustments = [...target.adjustments, ...rows.map(({ selected, conflict, ...row }) => ({ ...row }))].sort((a, b) => a.date.localeCompare(b.date));
  previewVisible.value = false;
  ElMessage.success(`已加入 ${rows.length} 条，请保存配置使其生效`);
}
const existingTerm = computed(() => terms.value.find((item) => item.semester === selectedSemester.value) || null);

function clone(item: ScheduleTermConfig): Draft {
  return JSON.parse(JSON.stringify({ ...item, version: undefined, updatedAt: undefined }));
}
function defaultPeriods(): Period[] {
  return Array.from({ length: 11 }, (_, index) => ({ id: index + 1, name: `第${index + 1}节`, start: "08:00", end: "08:45" }));
}
function defaultDraft(semester = "") : Draft {
  return { semester, semesterStartMonday: "", weekCount: 18, timezone: "Asia/Shanghai", note: "", periods: [], adjustments: [] };
}
async function load() {
  loading.value = true;
  try {
    const [list, shared] = await Promise.all([
      adminApi.scheduleTerms({ cacheTtlMs: 0 }),
      adminApi.schedulePeriods({ cacheTtlMs: 0 }),
    ]);
    terms.value = list;
    periods.value = shared.length ? JSON.parse(JSON.stringify(shared)) : defaultPeriods();
    if (!selectedSemester.value && terms.value[0]) selectTerm(terms.value[0].semester);
  } catch { /* request layer shows the error */ } finally { loading.value = false; }
}
function selectTerm(value: string) {
  selectedSemester.value = value;
  const item = terms.value.find((term) => term.semester === value);
  draft.value = item ? clone(item) : defaultDraft(value);
}
function addTerm() { selectedSemester.value = ""; draft.value = defaultDraft(); }
function addPeriod() {
  const last = periods.value.at(-1);
  periods.value.push({ id: periods.value.length + 1, name: `第${periods.value.length + 1}节`, start: last?.end || "08:00", end: "08:45" });
}
function addAdjustment() { draft.value?.adjustments.push({ date: draft.value.semesterStartMonday, kind: "off", note: "" }); }
async function savePeriods() {
  if (!periods.value.length) return ElMessage.warning("请至少配置一节课的时间");
  savingPeriods.value = true;
  try {
    const saved = await adminApi.saveSchedulePeriods(periods.value);
    periods.value = JSON.parse(JSON.stringify(saved));
    terms.value = terms.value.map((item) => ({ ...item, periods: saved }));
    ElMessage.success("节次时间已保存，对所有学期生效");
  } catch { /* request layer shows the error */ } finally { savingPeriods.value = false; }
}
async function save() {
  if (!draft.value) return;
  if (!draft.value.semester.trim()) return ElMessage.warning("请填写学期 ID");
  if (!draft.value.semesterStartMonday) return ElMessage.warning("请填写第一周周一");
  if (!periods.value.length) return ElMessage.warning("请至少配置一节课的时间");
  saving.value = true;
  try {
    const { semester: _semester, ...payload } = draft.value;
    const saved = await adminApi.saveScheduleTerm(draft.value.semester.trim(), { ...payload, periods: periods.value });
    const index = terms.value.findIndex((item) => item.semester === saved.semester);
    if (index >= 0) terms.value[index] = saved; else terms.value.unshift(saved);
    // 节次时间是全校一份，列表里每个学期回显的都是同一份。
    terms.value = terms.value.map((item) => ({ ...item, periods: saved.periods }));
    periods.value = JSON.parse(JSON.stringify(saved.periods));
    selectedSemester.value = saved.semester;
    draft.value = clone(saved);
    ElMessage.success(`已保存 ${saved.semester}，当前版本 v${saved.version}`);
  } catch { /* request layer shows the error */ } finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.schedule-terms-pane{display:flex;flex-direction:column;gap:24px;color:var(--cpu-text-primary)}
.pane-head,.section-head,.save-bar,summary{display:flex;align-items:center;justify-content:space-between;gap:16px}
.pane-head{padding:8px 0 4px}.eyebrow{font-size:12px;color:var(--cpu-primary);font-weight:600;letter-spacing:2px}.pane-head h2{margin:8px 0;font-size:26px;letter-spacing:-.6px}.pane-head p,.hint,.import-hint{font-size:13px;line-height:1.8;color:var(--cpu-text-secondary);margin:8px 0 0}
.term-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;align-items:start}.term-list{display:flex;flex-direction:column;gap:10px}.list-heading{display:flex;justify-content:space-between;padding:4px 4px 8px;font-size:13px;color:var(--cpu-text-secondary)}
.term-list button{display:flex;flex-direction:column;gap:10px;text-align:left;padding:18px 16px;border:1px solid var(--cpu-border-soft);border-radius:12px;background:var(--cpu-card);color:inherit;cursor:pointer;transition:background .15s,border-color .15s}.term-list button:hover{border-color:var(--cpu-primary)}.term-list button.active{border-color:var(--cpu-primary);background:color-mix(in srgb,var(--cpu-primary) 7%,var(--cpu-card))}.term-list button:focus-visible,summary:focus-visible{outline:2px solid var(--cpu-primary);outline-offset:3px}.term-list strong{font-size:15px}.term-list small,.section-head small,summary small{font-size:12px;color:var(--cpu-text-secondary);line-height:1.7}
.term-editor{min-width:0;display:flex;flex-direction:column;gap:18px}.editor-card,.shared-periods{padding:24px;border:1px solid var(--cpu-border-soft);border-radius:16px;background:var(--cpu-card)}.section-head{margin:0 0 20px;flex-wrap:wrap}.section-head h3{font-size:16px;margin:0 0 5px}.section-head h3 .el-tag{margin-left:6px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.form-grid label,.adjustment-row label{display:flex;flex-direction:column;gap:8px;min-width:0}.form-grid label>span,.adjustment-row label>span{font-size:12px;color:var(--cpu-text-secondary)}.form-grid .wide{grid-column:1/-1}
.form-grid :deep(.el-date-editor),.form-grid :deep(.el-input-number),.adjustment-row :deep(.el-date-editor),.period-row :deep(.el-date-editor){width:100%;min-width:0}.import-box{padding:18px;border:1px solid color-mix(in srgb,var(--cpu-primary) 18%,var(--cpu-border-soft));border-radius:12px;background:color-mix(in srgb,var(--cpu-primary) 4%,var(--cpu-card));margin-bottom:20px}.import-title{font-size:14px;font-weight:600;margin-bottom:12px}.academic-year-picker{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px}.academic-year-picker>.el-button{margin-left:auto}.import-hint{overflow-wrap:anywhere}.import-hint a{color:var(--cpu-primary);margin-right:8px}
.adjustment-list{display:flex;flex-direction:column;gap:12px}.adjustment-row{display:grid;grid-template-columns:minmax(130px,1fr) 100px minmax(130px,1fr) minmax(100px,1fr) auto;gap:12px;align-items:end;border-bottom:1px solid var(--cpu-border-soft);padding-bottom:14px}.off-label{display:flex;align-items:center;height:32px}.save-bar{padding:16px 20px;background:var(--cpu-card);border:1px solid var(--cpu-border-soft);border-radius:12px;font-size:12px;color:var(--cpu-text-secondary)}
summary{cursor:pointer;list-style:none;font-size:15px;font-weight:600}summary::-webkit-details-marker{display:none}summary small{margin-left:12px;font-weight:400}.summary-action{font-size:12px;color:var(--cpu-primary);white-space:nowrap}.shared-periods[open] summary{padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid var(--cpu-border-soft)}.period-actions{display:flex;gap:8px;flex-wrap:wrap}.period-actions .el-button+.el-button{margin-left:0}.period-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.period-row{display:grid;grid-template-columns:52px minmax(0,1fr) minmax(0,1fr) auto;align-items:center;gap:8px;padding:10px;background:var(--cpu-bg);border-radius:8px}.period-row b{font-size:12px}
@media(max-width:1200px){.adjustment-row{grid-template-columns:repeat(2,minmax(0,1fr))}.adjustment-row>.el-button{justify-self:end;grid-column:1/-1}}
@media(max-width:800px){.term-layout{grid-template-columns:1fr}.term-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.list-heading{grid-column:1/-1}.period-grid{grid-template-columns:1fr}.editor-card,.shared-periods{padding:18px}.pane-head h2{font-size:23px}}
@media(max-width:520px){.form-grid{grid-template-columns:1fr}.term-list{grid-template-columns:1fr}.adjustment-row{grid-template-columns:1fr}.academic-year-picker>.el-button{margin-left:0;width:100%}.pane-head{align-items:flex-start}.pane-head>.el-button{margin-top:24px}.period-row{grid-template-columns:44px minmax(0,1fr) minmax(0,1fr)}.period-row>.el-button{grid-column:1/-1;justify-self:end}summary small{display:block;margin:4px 0 0}}
</style>
