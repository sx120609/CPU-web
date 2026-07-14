<template>
  <div class="lost-admin">
    <div class="toolbar">
      <el-input v-model="filters.q" clearable placeholder="搜索物品、地点或发布者" @keyup.enter="load"><template #prefix><el-icon><Search /></el-icon></template></el-input>
      <el-select v-model="filters.status" clearable placeholder="全部状态" @change="load"><el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select>
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      <input ref="importInput" class="import-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="readImportFile" />
      <el-button :icon="Upload" @click="importInput?.click()">导入 Excel</el-button>
    </div>
    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="信息" min-width="240"><template #default="{ row }"><div class="item-cell"><img v-if="row.cover" :src="row.cover" alt="" /><span v-else>{{ row.kind === 'found' ? '拾' : '寻' }}</span><div><strong>{{ row.itemName }}</strong><small>{{ row.kind === 'found' ? '我捡到了' : '我丢了' }} · {{ row.campus }} / {{ row.location }}</small></div></div></template></el-table-column>
      <el-table-column label="发布者" width="120"><template #default="{ row }">{{ row.publisher.nickname }}</template></el-table-column>
      <el-table-column label="时间" width="150"><template #default="{ row }">{{ row.happenedAt ? dayjs(row.happenedAt).format('YYYY-MM-DD HH:mm') : '待补充' }}</template></el-table-column>
      <el-table-column label="认领" width="80"><template #default="{ row }">{{ row.claimCount }}</template></el-table-column>
      <el-table-column label="状态" width="120"><template #default="{ row }"><el-select :model-value="row.status" size="small" @change="(status) => update(row, { status })"><el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></template></el-table-column>
      <el-table-column label="置顶" width="80"><template #default="{ row }"><el-switch :model-value="row.pinned" @change="(pinned) => update(row, { pinned: Boolean(pinned) })" /></template></el-table-column>
      <el-table-column label="操作" width="170" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openItem(row.id)">查看</el-button><el-button link @click="openTopic(row.topicId)">论坛帖</el-button><el-button v-if="row.status !== 'hidden'" link type="danger" @click="takeDown(row)">下架</el-button><el-button v-else link type="success" @click="update(row, { status: 'active' })">恢复</el-button></template></el-table-column>
    </el-table>
    <div class="summary">共 {{ items.length }} 条；审核中 {{ reviewingCount }} 条，等待认领 {{ activeCount }} 条。</div>

    <el-dialog v-model="importOpen" title="批量导入失物招领" width="min(1040px, 94vw)" destroy-on-close>
      <el-alert :title="`已识别 ${importRows.length} 条有效记录${importErrors.length ? `，${importErrors.length} 条需修正` : ''}`" :type="importErrors.length ? 'warning' : 'success'" :closable="false" show-icon />
      <el-scrollbar v-if="importErrors.length" max-height="132px" class="import-errors"><p v-for="message in importErrors" :key="message">{{ message }}</p></el-scrollbar>
      <el-table :data="importRows.slice(0, 20)" max-height="400" stripe class="import-preview">
        <el-table-column prop="rowNumber" label="行" width="60" />
        <el-table-column label="类型" width="94"><template #default="{ row }">{{ row.kind === 'found' ? '我捡到了' : '我丢了' }}</template></el-table-column>
        <el-table-column prop="itemName" label="物品名称" min-width="140" />
        <el-table-column prop="campus" label="校区" width="110" />
        <el-table-column prop="location" label="具体地点" min-width="150" />
        <el-table-column prop="publisherDepartment" label="发布部门" min-width="130" />
        <el-table-column label="认领状态" width="100"><template #default="{ row }">{{ importStatusLabel(row.status) }}</template></el-table-column>
      </el-table>
      <p v-if="importRows.length > 20" class="import-more">仅预览前 20 条，本次将提交全部 {{ importRows.length }} 条有效记录。</p>
      <template #footer>
        <el-button @click="importOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!importRows.length || importErrors.length > 0" :loading="importing" @click="submitImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Search, Upload } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { lostFoundApi, type LostFoundInput, type LostFoundItem, type LostFoundStatus } from "@/api/lostFound";

const router = useRouter();
const loading = ref(false);
const items = ref<LostFoundItem[]>([]);
const filters = reactive({ q: "", status: "" });
const statusOptions: Array<{ label: string; value: LostFoundStatus }> = [
  { label: "审核中", value: "reviewing" }, { label: "等待认领", value: "active" }, { label: "已认领", value: "claimed" }, { label: "已关闭", value: "closed" }, { label: "已下架", value: "hidden" },
];
const reviewingCount = computed(() => items.value.filter((item) => item.status === "reviewing").length);
const activeCount = computed(() => items.value.filter((item) => item.status === "active").length);
const importInput = ref<HTMLInputElement>();
const importOpen = ref(false);
const importing = ref(false);
type ImportRow = LostFoundInput & { status: "active" | "claimed" | "closed"; rowNumber: number };
const importRows = ref<ImportRow[]>([]);
const importErrors = ref<string[]>([]);

const REQUIRED_HEADERS = ["信息发布类型", "物品名称"];

function valueAt(row: Record<string, unknown>, header: string) {
  return String(row[header] ?? "").trim();
}

function normalizeDate(value: string, field: string, required: boolean) {
  if (!value) return required ? `${field}不能为空` : "";
  const normalized = value.replace(/[./年]/g, "-").replace(/[月]/g, "-").replace(/[日]/g, "").replace(/\s+/g, " ").trim();
  const parsed = dayjs(normalized);
  return parsed.isValid() ? parsed.format("YYYY-MM-DDTHH:mm:ss") : `${field}格式无效`;
}

function importStatusLabel(status: ImportRow["status"]) {
  return status === "active" ? "未认领" : status === "claimed" ? "已认领" : "已过期";
}

async function readImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return ElMessage.warning("表格文件不能超过 5MB");
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("未找到工作表");
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = matrix.findIndex((cells) => {
      const headers = cells.map((cell) => String(cell).trim());
      return REQUIRED_HEADERS.every((header) => headers.includes(header));
    });
    if (headerIndex < 0) throw new Error("未找到模板表头，请使用失物招领信息表中的字段名称");
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: headerIndex, defval: "", raw: false });
    const rows: ImportRow[] = [];
    const errors: string[] = [];
    records.forEach((record, index) => {
      if (!Object.values(record).some((value) => String(value).trim())) return;
      const rowNumber = headerIndex + index + 2;
      const kindLabel = valueAt(record, "信息发布类型");
      const statusLabel = valueAt(record, "认领状态");
      const kind = kindLabel === "我捡到了" ? "found" : kindLabel === "我丢了" ? "lost" : null;
      const status = !statusLabel || statusLabel === "未认领" ? "active" : statusLabel === "已认领" ? "claimed" : statusLabel === "已过期" ? "closed" : null;
      const happenedAt = normalizeDate(valueAt(record, "丢失/捡到时间"), "丢失/捡到时间", false);
      const publishedAt = normalizeDate(valueAt(record, "信息发布日期"), "信息发布日期", false);
      const claimDeadline = normalizeDate(valueAt(record, "认领期限"), "认领期限", false);
      const required = [
        ["物品名称", valueAt(record, "物品名称")],
      ].filter(([, value]) => !value).map(([field]) => `${field}不能为空`);
      if (!kind) required.push("信息发布类型应为“我捡到了”或“我丢了”");
      if (!status) required.push("认领状态应为“未认领”“已认领”或“已过期”");
      if (happenedAt.includes("无效")) required.push(happenedAt);
      if (publishedAt.includes("无效")) required.push(publishedAt);
      if (claimDeadline.includes("无效")) required.push(claimDeadline);
      if (required.length) {
        errors.push(`第 ${rowNumber} 行：${required.join("；")}`);
        return;
      }
      rows.push({
        rowNumber,
        kind: kind!,
        itemName: valueAt(record, "物品名称"),
        campus: valueAt(record, "校区"),
        location: valueAt(record, "丢失具体地点"),
        happenedAt: happenedAt || null,
        storageLocation: valueAt(record, "失物存放点位"),
        description: valueAt(record, "物品详细描述"),
        contact: valueAt(record, "联系方式"),
        publisherDepartment: valueAt(record, "信息发布部门"),
        publishedAt: publishedAt || undefined,
        claimDeadline: claimDeadline || null,
        status: status!,
        remark: valueAt(record, "备注"),
        images: [],
      });
    });
    importRows.value = rows;
    importErrors.value = errors;
    if (!rows.length && !errors.length) throw new Error("表格中没有可导入的数据行");
    importOpen.value = true;
  } catch (error) {
    ElMessage.error((error as Error).message || "表格读取失败");
  }
}

async function submitImport() {
  if (!importRows.value.length || importErrors.value.length || importing.value) return;
  importing.value = true;
  try {
    const result = await lostFoundApi.adminImport(importRows.value.map(({ rowNumber: _rowNumber, ...item }) => item));
    importOpen.value = false;
    await load();
    const skipped = result.skipped.length ? `，跳过 ${result.skipped.length} 条重复记录` : "";
    await ElMessageBox.alert(`成功导入 ${result.imported.length} 条${skipped}。`, "导入完成", { type: "success" });
  } finally {
    importing.value = false;
  }
}

onMounted(load);
async function load() { loading.value = true; try { items.value = await lostFoundApi.adminItems({ q: filters.q || undefined, status: filters.status || undefined }, { suppressErrorMessage: true }); } catch { items.value = []; } finally { loading.value = false; } }
async function update(item: any, patch: { status?: LostFoundStatus; pinned?: boolean; note?: string }) { const updated = await lostFoundApi.adminUpdate(Number(item.id), patch); Object.assign(item, updated); ElMessage.success("已更新"); }
async function takeDown(item: any) { const { value } = await ElMessageBox.prompt("可填写下架原因，发布者会收到站内消息。", "下架失物信息", { inputPlaceholder: "异常内容 / 信息失效 / 隐私风险等", confirmButtonText: "确认下架", type: "warning" }); await update(item, { status: "hidden", note: value || "信息已由管理人员下架" }); }
function openItem(id: number) { router.push({ path: "/lost-found", query: { item: String(id) } }); }
function openTopic(id: number) { router.push(`/forum/topic/${id}`); }
</script>

<style scoped>
.lost-admin{display:flex;flex-direction:column;gap:14px}.toolbar{display:grid;grid-template-columns:minmax(240px,1fr) 180px auto;gap:10px}.item-cell{display:flex;align-items:center;gap:10px}.item-cell>img,.item-cell>span{width:46px;height:46px;flex:none;border-radius:8px;object-fit:cover}.item-cell>span{display:grid;place-items:center;color:#0f8f7b;background:#dff8ee;font:700 22px serif}.item-cell div{min-width:0;display:flex;flex-direction:column;gap:4px}.item-cell strong,.item-cell small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-cell small,.summary{color:var(--cpu-text-muted);font-size:11px}.summary{text-align:right}@media(max-width:700px){.toolbar{grid-template-columns:1fr 1fr}.toolbar .el-input{grid-column:1/-1}.lost-admin :deep(.el-table){font-size:12px}}
.import-input{display:none}.import-errors{margin-top:12px;padding:0 12px;border:1px solid var(--cpu-border-soft);border-radius:6px;background:var(--cpu-surface-subtle)}.import-errors p{margin:7px 0;color:var(--el-color-warning-dark-2);font-size:12px}.import-preview{margin-top:14px}.import-more{margin:10px 0 0;color:var(--cpu-text-muted);font-size:12px}
</style>
