<template>
  <section class="th-group th-group--flush">
    <div class="th-group-head">
      <h2 class="th-h2">操作日志</h2>
      <el-select v-model="action" size="small" clearable placeholder="全部操作" class="th-filter" @change="reload">
        <el-option v-for="item in ACTION_GROUPS" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
    </div>
    <div v-if="!list.length" class="th-empty"><p>还没有日志。</p></div>
    <div v-else class="th-table-wrap">
      <table class="th-table">
        <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>详情</th></tr></thead>
        <tbody>
          <tr v-for="row in list" :key="row.id">
            <td>{{ timeText(row.createdAt) }}</td>
            <td>{{ row.actorLabel }}</td>
            <td>{{ actionLabel(row.action) }}</td>
            <td>{{ targetText(row) }}</td>
            <td class="is-wrap th-muted">{{ detailText(row.detail) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="total > 50" class="th-pager">
      <el-pagination v-model:current-page="page" layout="prev, pager, next" :page-size="50" :total="total" small @current-change="load" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { treeholeApi, type TreeholeAuditRow } from "@/api/treehole";
import { timeText } from "../shared";

const ACTION_LABELS: Record<string, string> = {
  "session.view": "查阅会话",
  "case.view": "查看工单",
  "case.note": "追加工单备注",
  "case.status": "修改工单状态",
  "crisis.report": "上报高危转介",
  "reveal.request": "提交溯源申请",
  "reveal.approve": "同意溯源",
  "reveal.approve.final": "同意溯源（已批准）",
  "reveal.reject": "不同意溯源",
  "reveal.view": "查看实名信息",
  "staff.appoint": "任命人员",
  "staff.update": "修改人员",
  "staff.shifts": "修改排班",
  "room.create": "建成宣泄室",
  "room.view": "查阅宣泄室",
  "room.close": "关闭宣泄室",
  "room.member.remove": "移出群成员",
  "room.message.recall": "撤回群消息",
  "room.application.approve": "通过入群申请",
  "room.application.reject": "拒绝入群申请",
  "config.update": "修改树洞设置",
};

const ACTION_GROUPS = [
  { value: "session", label: "会话查阅" },
  { value: "reveal", label: "实名溯源" },
  { value: "case", label: "工单" },
  { value: "crisis", label: "高危上报" },
  { value: "staff", label: "人员与排班" },
  { value: "room", label: "宣泄室" },
  { value: "config", label: "设置" },
];

const list = ref<TreeholeAuditRow[]>([]);
const total = ref(0);
const page = ref(1);
const action = ref("");

function actionLabel(value: string) {
  return ACTION_LABELS[value] ?? value;
}

function targetText(row: TreeholeAuditRow) {
  const type = { session: "会话", case: "工单", staff: "人员", room: "宣泄室", config: "设置" }[row.targetType] ?? row.targetType;
  return row.targetId ? `${type} #${row.targetId}` : type;
}

function detailText(detail: Record<string, unknown>) {
  const parts = Object.entries(detail || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(",") : typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  return parts.join("；");
}

async function load() {
  const result = await treeholeApi.audit({ page: page.value, ...(action.value ? { action: action.value } : {}) });
  list.value = result.list;
  total.value = result.total;
}

function reload() {
  page.value = 1;
  void load();
}

onMounted(load);
</script>

<style scoped>
.th-filter { width: 130px; }
.th-pager { display: flex; justify-content: center; padding: 8px; border-top: 1px solid var(--cpu-border-soft); }
</style>
