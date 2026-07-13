<template>
  <div class="lost-admin">
    <div class="toolbar">
      <el-input v-model="filters.q" clearable placeholder="搜索物品、地点或发布者" @keyup.enter="load"><template #prefix><el-icon><Search /></el-icon></template></el-input>
      <el-select v-model="filters.status" clearable placeholder="全部状态" @change="load"><el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select>
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
    </div>
    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="信息" min-width="240"><template #default="{ row }"><div class="item-cell"><img v-if="row.cover" :src="row.cover" alt="" /><span v-else>{{ row.kind === 'found' ? '拾' : '寻' }}</span><div><strong>{{ row.itemName }}</strong><small>{{ row.kind === 'found' ? '我捡到了' : '我丢了' }} · {{ row.campus }} / {{ row.location }}</small></div></div></template></el-table-column>
      <el-table-column label="发布者" width="120"><template #default="{ row }">{{ row.publisher.nickname }}</template></el-table-column>
      <el-table-column label="时间" width="150"><template #default="{ row }">{{ dayjs(row.happenedAt).format('YYYY-MM-DD HH:mm') }}</template></el-table-column>
      <el-table-column label="认领" width="80"><template #default="{ row }">{{ row.claimCount }}</template></el-table-column>
      <el-table-column label="状态" width="120"><template #default="{ row }"><el-select :model-value="row.status" size="small" @change="(status) => update(row, { status })"><el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></template></el-table-column>
      <el-table-column label="置顶" width="80"><template #default="{ row }"><el-switch :model-value="row.pinned" @change="(pinned) => update(row, { pinned: Boolean(pinned) })" /></template></el-table-column>
      <el-table-column label="操作" width="170" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openItem(row.id)">查看</el-button><el-button link @click="openTopic(row.topicId)">论坛帖</el-button><el-button v-if="row.status !== 'hidden'" link type="danger" @click="takeDown(row)">下架</el-button><el-button v-else link type="success" @click="update(row, { status: 'active' })">恢复</el-button></template></el-table-column>
    </el-table>
    <div class="summary">共 {{ items.length }} 条；审核中 {{ reviewingCount }} 条，等待认领 {{ activeCount }} 条。</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import dayjs from "dayjs";
import { lostFoundApi, type LostFoundItem, type LostFoundStatus } from "@/api/lostFound";

const router = useRouter();
const loading = ref(false);
const items = ref<LostFoundItem[]>([]);
const filters = reactive({ q: "", status: "" });
const statusOptions: Array<{ label: string; value: LostFoundStatus }> = [
  { label: "审核中", value: "reviewing" }, { label: "等待认领", value: "active" }, { label: "已认领", value: "claimed" }, { label: "已关闭", value: "closed" }, { label: "已下架", value: "hidden" },
];
const reviewingCount = computed(() => items.value.filter((item) => item.status === "reviewing").length);
const activeCount = computed(() => items.value.filter((item) => item.status === "active").length);
onMounted(load);
async function load() { loading.value = true; try { items.value = await lostFoundApi.adminItems({ q: filters.q || undefined, status: filters.status || undefined }, { suppressErrorMessage: true }); } catch { items.value = []; } finally { loading.value = false; } }
async function update(item: any, patch: { status?: LostFoundStatus; pinned?: boolean; note?: string }) { const updated = await lostFoundApi.adminUpdate(Number(item.id), patch); Object.assign(item, updated); ElMessage.success("已更新"); }
async function takeDown(item: any) { const { value } = await ElMessageBox.prompt("可填写下架原因，发布者会收到站内消息。", "下架失物信息", { inputPlaceholder: "异常内容 / 信息失效 / 隐私风险等", confirmButtonText: "确认下架", type: "warning" }); await update(item, { status: "hidden", note: value || "信息已由管理人员下架" }); }
function openItem(id: number) { router.push({ path: "/lost-found", query: { item: String(id) } }); }
function openTopic(id: number) { router.push(`/forum/topic/${id}`); }
</script>

<style scoped>
.lost-admin{display:flex;flex-direction:column;gap:14px}.toolbar{display:grid;grid-template-columns:minmax(240px,1fr) 180px auto;gap:10px}.item-cell{display:flex;align-items:center;gap:10px}.item-cell>img,.item-cell>span{width:46px;height:46px;flex:none;border-radius:8px;object-fit:cover}.item-cell>span{display:grid;place-items:center;color:#0f8f7b;background:#dff8ee;font:700 22px serif}.item-cell div{min-width:0;display:flex;flex-direction:column;gap:4px}.item-cell strong,.item-cell small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-cell small,.summary{color:var(--cpu-text-muted);font-size:11px}.summary{text-align:right}@media(max-width:700px){.toolbar{grid-template-columns:1fr 1fr}.toolbar .el-input{grid-column:1/-1}.lost-admin :deep(.el-table){font-size:12px}}
</style>
