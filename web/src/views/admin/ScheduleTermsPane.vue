<template>
  <section class="schedule-terms-pane" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>课表校历与调休</h2>
        <p>节次时间全校统一，只配置一次；第一周、总周数和放假/补班日期按教务学期维护。可一键获取公开放假/补班数据，管理员确认并保存后生效；学校具体调课安排以教务通知为准。</p>
      </div>
      <el-button type="primary" @click="addTerm">新增学期</el-button>
    </div>

    <section class="shared-periods">
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
    </section>

    <div class="term-layout">
      <aside class="term-list">
        <button
          v-for="item in terms"
          :key="item.semester"
          type="button"
          :class="{ active: item.semester === selectedSemester }"
          @click="selectTerm(item.semester)"
        >
          <strong>{{ item.semester }}</strong>
          <small>v{{ item.version }} · {{ item.weekCount }} 周</small>
        </button>
        <el-empty v-if="!terms.length && !loading" description="还没有配置学期" />
      </aside>

      <div v-if="draft" class="term-editor">
        <div class="form-grid">
          <label><span>学期 ID</span><el-input v-model="draft.semester" :disabled="Boolean(existingTerm)" placeholder="例如 2026-2027-1" /></label>
          <label><span>第一周周一</span><el-date-picker v-model="draft.semesterStartMonday" type="date" value-format="YYYY-MM-DD" /></label>
          <label><span>总周数</span><el-input-number v-model="draft.weekCount" :min="1" :max="64" /></label>
          <label><span>时区</span><el-input v-model="draft.timezone" /></label>
          <label class="wide"><span>备注</span><el-input v-model="draft.note" maxlength="500" /></label>
        </div>

        <div class="section-head"><h3>调休 / 放假</h3><div class="period-actions"><el-button size="small" type="primary" plain :loading="importing" @click="previewHolidays">一键导入公开假期</el-button><el-button size="small" @click="addAdjustment">增加日期</el-button></div></div>
        <p class="import-hint">按当前学期日期获取，预览确认后加入草稿，保存配置后生效。同日期已有配置会保留。</p>
        <div class="adjustment-list">
          <div v-for="(item, index) in draft.adjustments" :key="`${item.date}-${index}`" class="adjustment-row">
            <el-date-picker v-model="item.date" type="date" value-format="YYYY-MM-DD" />
            <el-select v-model="item.kind" class="kind-select"><el-option label="放假" value="off" /><el-option label="调课" value="swap" /></el-select>
            <el-date-picker v-if="item.kind === 'swap'" v-model="item.source" type="date" value-format="YYYY-MM-DD" placeholder="上哪天的课" />
            <el-input v-model="item.note" maxlength="80" placeholder="例如 国庆节" />
            <el-button text type="danger" @click="draft.adjustments.splice(index, 1)">删除</el-button>
          </div>
          <el-empty v-if="!draft.adjustments.length" description="暂无调休日期" :image-size="52" />
        </div>

        <div class="save-bar"><span v-if="existingTerm">当前版本 v{{ existingTerm.version }}</span><span v-else>新学期配置</span><el-button type="primary" :loading="saving" @click="save">保存配置</el-button></div>
      </div>
      <el-empty v-else description="选择一个学期开始编辑" />
    </div>
    <el-dialog v-model="previewVisible" title="确认公开放假 / 调休数据" width="min(960px, 95vw)" :close-on-click-modal="false">
      <p>{{ previewRange }} · 已选 {{ selectedImports.length }} 条</p>
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
        <template #empty>该学期范围内暂无公开放假 / 补班数据</template>
      </el-table>
      <template #footer><el-button @click="previewVisible = false">取消</el-button><el-button type="primary" :disabled="!selectedImports.length" @click="confirmImport">确认加入草稿</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
const importRows = ref<ImportRow[]>([]);
const selectedImports = computed(() => importRows.value.filter((row) => row.selected && !row.conflict));
let importTarget: Draft | null = null;
let importStart = "";
let importWeeks = 0;
async function previewHolidays() {
  const target = draft.value;
  if (!target?.semesterStartMonday) return ElMessage.warning("请先填写第一周周一和总周数");
  importing.value = true;
  const start = target.semesterStartMonday;
  const weeks = target.weekCount;
  try {
    const result = await adminApi.previewScheduleHolidays(start, weeks);
    if (draft.value !== target || target.semesterStartMonday !== start || target.weekCount !== weeks) return ElMessage.warning("学期已变更，请重新获取假期数据");
    importTarget = target; importStart = start; importWeeks = weeks;
    previewRange.value = `${result.startDate} 至 ${result.endDate}`;
    previewSources.value = result.sources;
    const existingDates = new Set(target.adjustments.map((row) => row.date));
    importRows.value = result.adjustments.map((row) => ({ ...row, conflict: existingDates.has(row.date), selected: !existingDates.has(row.date) }));
    previewVisible.value = true;
  } catch { /* request layer shows the error */ } finally { importing.value = false; }
}
function confirmImport() {
  const target = draft.value;
  if (!target || target !== importTarget || target.semesterStartMonday !== importStart || target.weekCount !== importWeeks) return ElMessage.warning("学期已变更，请重新获取假期数据");
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
.import-hint{font-size:13px;color:var(--cpu-text-secondary);line-height:1.7;overflow-wrap:anywhere}.import-hint a{color:var(--cpu-primary);margin-right:8px}.section-head{gap:10px;flex-wrap:wrap}.period-actions{flex-wrap:wrap}

.schedule-terms-pane{display:flex;flex-direction:column;gap:18px}.shared-periods{padding:16px;border:1px solid var(--cpu-border-soft);border-radius:8px;background:var(--cpu-card)}.shared-periods .section-head{margin:0 0 12px}.shared-periods small{color:var(--cpu-text-muted);font-size:12px}.period-actions{display:flex;gap:8px}.shared-periods .hint{margin:12px 0 0;color:var(--cpu-text-secondary);font-size:12px}.pane-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.pane-head h2{margin:0;font-size:20px}.pane-head p{margin:6px 0 0;color:var(--cpu-text-secondary);font-size:13px}.term-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px}.term-list{display:flex;flex-direction:column;gap:6px}.term-list button{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:12px;border:1px solid var(--cpu-border-soft);border-radius:8px;background:var(--cpu-card);color:inherit;text-align:left;cursor:pointer}.term-list button.active{border-color:var(--cpu-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--cpu-primary) 12%,transparent)}.term-list small{color:var(--cpu-text-muted)}.term-editor{min-width:0}.form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.form-grid label{display:flex;flex-direction:column;gap:6px}.form-grid label>span{font-size:12px;color:var(--cpu-text-secondary)}.form-grid .wide{grid-column:span 2}.section-head{display:flex;align-items:center;justify-content:space-between;margin:24px 0 10px}.section-head h3{margin:0;font-size:15px}.period-grid,.adjustment-list{display:flex;flex-direction:column;gap:8px}.period-row,.adjustment-row{display:grid;grid-template-columns:72px 150px 150px minmax(120px,1fr) auto;align-items:center;gap:8px}.adjustment-row{grid-template-columns:150px 100px 150px minmax(120px,1fr) auto}.period-row b{font-size:13px}.save-bar{display:flex;align-items:center;justify-content:space-between;margin-top:24px;padding-top:14px;border-top:1px solid var(--cpu-border-soft);color:var(--cpu-text-secondary);font-size:12px}@media(max-width:800px){.term-layout{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr 1fr}.form-grid .wide{grid-column:span 2}.period-row,.adjustment-row{grid-template-columns:1fr 1fr}.period-row b{grid-column:1/-1}.period-row .el-button,.adjustment-row .el-button{justify-self:end}}@media(max-width:520px){.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.adjustment-row{grid-template-columns:1fr}.adjustment-row .el-button{justify-self:start}}
</style>
