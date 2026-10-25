<template>
  <section class="th-group">
    <div class="th-group-head">
      <div>
        <h2 class="th-h2">任命洞主或核心管理员</h2>
        <p class="th-sub">按药大拾间的登录名（学校账号即学号）添加，对方需要先登录过一次。</p>
      </div>
    </div>
    <form class="th-appoint" @submit.prevent="appoint">
      <el-input v-model="form.username" placeholder="学号或用户名" class="th-appoint-name" />
      <el-checkbox v-model="form.isHost">洞主</el-checkbox>
      <el-checkbox v-model="form.isAdmin">核心管理员</el-checkbox>
      <el-input v-if="form.isHost" v-model="form.hostCode" maxlength="2" placeholder="编号（留空自动）" class="th-appoint-code" />
      <el-button type="primary" native-type="submit" :disabled="!form.username.trim() || (!form.isHost && !form.isAdmin)" :loading="saving">添加</el-button>
    </form>
  </section>

  <section class="th-group th-group--flush">
    <div class="th-group-head">
      <h2 class="th-h2">树洞人员</h2>
      <span class="th-muted">洞主编号决定宣泄室虚拟 ID 的前两位，不要随意改动</span>
    </div>
    <div v-if="!staff.length" class="th-empty"><p>还没有任何人员。</p></div>
    <div v-else class="th-table-wrap">
      <table class="th-table th-staff-table">
        <thead>
          <tr><th>账号</th><th>身份</th><th>编号</th><th>状态</th><th>排班</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="row in staff" :key="row.id">
            <td>
              <div>{{ row.user.nickname || "—" }}</div>
              <div class="th-muted">{{ row.user.username }}</div>
            </td>
            <td>
              <em v-if="row.isHost" class="th-chip is-brand">洞主</em>
              <em v-if="row.isAdmin" class="th-chip is-violet">核心管理员</em>
            </td>
            <td>{{ row.hostCode || "—" }}</td>
            <td>
              <em v-if="!row.enabled" class="th-chip">已停用</em>
              <span v-else-if="row.isHost"><span class="th-dot" :class="{ 'is-on': row.online }" /> {{ row.online ? "在岗" : "离岗" }}</span>
              <span v-else>在任</span>
            </td>
            <td class="is-wrap">
              <span v-if="!row.shifts.length" class="th-muted">未排班</span>
              <span v-else class="th-muted">{{ row.shifts.map(shiftText).join("；") }}</span>
            </td>
            <td>
              <div class="th-actions">
                <el-button size="small" text @click="openEdit(row)">编辑</el-button>
                <el-button v-if="row.isHost" size="small" text @click="openShifts(row)">排班</el-button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <el-dialog v-model="editOpen" :title="`编辑 ${editing?.user.nickname || ''}`" width="min(92vw, 420px)" append-to-body>
    <form v-if="editing" class="th-form" @submit.prevent="saveEdit">
      <el-checkbox v-model="edit.isHost">洞主</el-checkbox>
      <el-checkbox v-model="edit.isAdmin">核心管理员</el-checkbox>
      <div v-if="edit.isHost" class="th-field">
        <label for="th-edit-code">洞主编号</label>
        <el-input id="th-edit-code" v-model="edit.hostCode" maxlength="2" placeholder="01–99" />
      </div>
      <div class="th-field">
        <label for="th-edit-intro">对来访者展示的简介</label>
        <el-input id="th-edit-intro" v-model="edit.intro" maxlength="80" show-word-limit />
      </div>
      <el-checkbox v-model="edit.enabled">在任（取消即停用账号，停用后不能再看任何会话）</el-checkbox>
    </form>
    <template #footer>
      <el-button @click="editOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="shiftsOpen" :title="`${editing?.name || ''} 的排班`" width="min(94vw, 520px)" append-to-body>
    <p class="th-sub">北京时间，每周重复。同一天的时段不能重叠，也不能跨过零点。</p>
    <div class="th-shift-rows">
      <div v-for="(shift, index) in shiftDraft" :key="index" class="th-shift-row">
        <el-select v-model="shift.weekday" class="th-shift-day">
          <el-option v-for="(label, day) in WEEKDAYS" :key="day" :label="label" :value="day + 1" />
        </el-select>
        <el-time-select v-model="shift.start" start="00:00" step="00:30" end="23:30" placeholder="开始" class="th-shift-time" />
        <span>–</span>
        <el-time-select v-model="shift.end" start="00:30" step="00:30" end="24:00" placeholder="结束" class="th-shift-time" />
        <el-button text type="danger" @click="shiftDraft.splice(index, 1)">删除</el-button>
      </div>
    </div>
    <el-button size="small" @click="shiftDraft.push({ weekday: 1, start: '19:00', end: '21:00' })">添加时段</el-button>
    <template #footer>
      <el-button @click="shiftsOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveShifts">保存排班</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { treeholeApi, type TreeholeStaffRow } from "@/api/treehole";
import { minuteText, parseMinute, shiftText, WEEKDAYS } from "../shared";

defineProps<{ coreAdmin: boolean }>();

const staff = ref<TreeholeStaffRow[]>([]);
const saving = ref(false);
const form = reactive({ username: "", isHost: true, isAdmin: false, hostCode: "" });
const editOpen = ref(false);
const shiftsOpen = ref(false);
const editing = ref<TreeholeStaffRow | null>(null);
const edit = reactive({ isHost: false, isAdmin: false, hostCode: "", intro: "", enabled: true });
const shiftDraft = ref<Array<{ weekday: number; start: string; end: string }>>([]);

async function load() {
  staff.value = await treeholeApi.staff();
}

async function appoint() {
  saving.value = true;
  try {
    await treeholeApi.appointStaff({ username: form.username.trim(), isHost: form.isHost, isAdmin: form.isAdmin, hostCode: form.hostCode.trim() });
    ElMessage.success("已添加");
    Object.assign(form, { username: "", isHost: true, isAdmin: false, hostCode: "" });
    await load();
  } finally {
    saving.value = false;
  }
}

function openEdit(row: TreeholeStaffRow) {
  editing.value = row;
  Object.assign(edit, { isHost: row.isHost, isAdmin: row.isAdmin, hostCode: row.hostCode || "", intro: row.intro, enabled: row.enabled });
  editOpen.value = true;
}

async function saveEdit() {
  if (!editing.value) return;
  saving.value = true;
  try {
    await treeholeApi.updateStaff(editing.value.id, { ...edit, hostCode: edit.hostCode.trim(), intro: edit.intro.trim() });
    editOpen.value = false;
    ElMessage.success("已保存");
    await load();
  } finally {
    saving.value = false;
  }
}

function openShifts(row: TreeholeStaffRow) {
  editing.value = row;
  shiftDraft.value = row.shifts.map((shift) => ({ weekday: shift.weekday, start: minuteText(shift.startMinute), end: minuteText(shift.endMinute) }));
  shiftsOpen.value = true;
}

async function saveShifts() {
  if (!editing.value) return;
  const shifts = [];
  for (const draft of shiftDraft.value) {
    const startMinute = parseMinute(draft.start || "");
    const endMinute = parseMinute(draft.end || "");
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      ElMessage.warning(`${WEEKDAYS[draft.weekday - 1]} 的时段不完整或开始晚于结束`);
      return;
    }
    shifts.push({ weekday: draft.weekday, startMinute, endMinute });
  }
  saving.value = true;
  try {
    await treeholeApi.saveShifts(editing.value.id, shifts);
    shiftsOpen.value = false;
    ElMessage.success("排班已保存");
    await load();
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.th-appoint { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.th-appoint-name { width: 200px; }
.th-appoint-code { width: 130px; }
.th-shift-rows { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.th-shift-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.th-shift-day { width: 90px; }
.th-shift-time { width: 110px; }

/* 手机上表格改成一人一张卡片 */
@media (max-width: 640px) {
  .th-appoint-name { width: 100%; }
  .th-staff-table thead { display: none; }
  .th-staff-table tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 12px;
    padding: 12px 14px;
    border-top: 1px solid var(--cpu-border-soft);
  }
  .th-staff-table tbody tr:first-child { border-top: 0; }
  .th-staff-table td { padding: 0; border: 0; white-space: normal; }
  .th-staff-table td.is-wrap { grid-column: 1 / -1; min-width: 0; }
  .th-staff-table td:nth-child(3)::before { content: "编号 "; color: var(--cpu-text-muted); }
  .th-staff-table td:last-child { grid-column: 1 / -1; }
}
</style>
