<template>
  <div class="sponsor-pane">
    <section class="stats-grid" v-loading="overviewLoading">
      <div class="stat"><b>¥{{ overview.totalAmount || "0.00" }}</b><span>累计赞助</span></div>
      <div class="stat"><b>{{ overview.sponsorCount || 0 }}</b><span>赞助人数</span></div>
      <div class="stat"><b>¥{{ overview.todayAmount || "0.00" }}</b><span>今日赞助</span></div>
      <div class="stat"><b>¥{{ overview.monthAmount || "0.00" }}</b><span>本月赞助</span></div>
      <div class="stat"><b>{{ overview.pendingOrders || 0 }}</b><span>待支付订单</span></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h3 class="section-title">赞助配置</h3>
          <p class="section-desc">控制个人中心文案、金额按钮、最低最高金额和鸣谢墙。</p>
        </div>
        <el-button type="primary" :loading="savingConfig" :disabled="savingConfig" @click="saveConfig">保存配置</el-button>
      </div>
      <div class="config-grid" v-loading="configLoading">
        <label class="field">
          <span>标题</span>
          <el-input v-model="config.title" maxlength="40" />
        </label>
        <label class="field">
          <span>预设金额</span>
          <el-input v-model="presetAmountsText" placeholder="5,10,20,50" />
        </label>
        <label class="field field--wide">
          <span>说明文案</span>
          <el-input v-model="config.description" type="textarea" :rows="2" maxlength="300" />
        </label>
        <label class="field">
          <span>最低金额</span>
          <el-input v-model="config.minAmount" />
        </label>
        <label class="field">
          <span>最高金额</span>
          <el-input v-model="config.maxAmount" />
        </label>
        <label class="field field--switch">
          <span>启用鸣谢墙</span>
          <el-switch v-model="config.wallEnabled" />
        </label>
        <label class="field field--switch">
          <span>允许留言</span>
          <el-switch v-model="config.allowMessage" />
        </label>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h3 class="section-title">赞助订单</h3>
          <p class="section-desc">可查询订单、修改展示方式、关闭待支付订单，或在对账后手动修复状态。</p>
        </div>
        <el-button :loading="ordersLoading" :disabled="ordersLoading" @click="reloadOrders">刷新</el-button>
      </div>
      <div class="filters">
        <el-input v-model="filters.q" clearable placeholder="订单号 / 用户 / 流水号" @keyup.enter="reloadOrders" />
        <el-select v-model="filters.status">
          <el-option label="全部状态" value="all" />
          <el-option label="待支付" value="pending" />
          <el-option label="已支付" value="paid" />
          <el-option label="已关闭" value="closed" />
        </el-select>
        <el-button type="primary" :loading="ordersLoading" :disabled="ordersLoading" @click="reloadOrders">查询</el-button>
      </div>
      <el-table :data="orders" v-loading="ordersLoading" border size="small" class="interactive-table">
        <el-table-column prop="outTradeNo" label="订单号" min-width="190" show-overflow-tooltip />
        <el-table-column label="用户" min-width="130">
          <template #default="{ row }">{{ row.user?.nickname || "-" }} <span class="muted">{{ row.user?.username }}</span></template>
        </el-table-column>
        <el-table-column label="金额" width="90">
          <template #default="{ row }">¥{{ row.amount }}</template>
        </el-table-column>
        <el-table-column prop="payType" label="方式" width="90" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="展示" width="120">
          <template #default="{ row }">
            <el-select v-model="row.displayMode" size="small" :disabled="isOrderBusy(row)" @change="saveOrder(row, { displayMode: row.displayMode })">
              <el-option label="公开" value="public" />
              <el-option label="匿名" value="anonymous" />
              <el-option label="隐藏" value="hidden" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="留言" min-width="150" show-overflow-tooltip />
        <el-table-column label="时间" min-width="150">
          <template #default="{ row }">{{ row.paidAt ? fmtDate(row.paidAt) : fmtDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" text size="small" :loading="isOrderBusy(row)" :disabled="isOrderBusy(row)" @click="saveOrder(row, { status: 'closed' })">关闭</el-button>
            <el-button v-if="row.status !== 'paid'" text size="small" type="warning" :loading="isOrderBusy(row)" :disabled="isOrderBusy(row)" @click="markPaid(row)">标记已付</el-button>
            <el-button text size="small" :disabled="isOrderBusy(row)" @click="editMessage(row)">改留言</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="record-list">
        <article v-for="row in orders" :key="row.id" class="record-card">
          <div class="record-head">
            <div>
              <b>{{ row.outTradeNo }}</b>
              <span>{{ row.user?.nickname || "-" }} <span class="muted">{{ row.user?.username }}</span></span>
            </div>
            <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </div>
          <div class="record-meta">
            <span>金额：¥{{ row.amount }}</span>
            <span>方式：{{ row.payType || "—" }}</span>
            <span>展示：{{ row.displayMode }}</span>
            <span>留言：{{ row.message || "—" }}</span>
            <span>时间：{{ row.paidAt ? fmtDate(row.paidAt) : fmtDate(row.createdAt) }}</span>
          </div>
          <div class="record-actions">
            <el-select v-model="row.displayMode" size="small" :disabled="isOrderBusy(row)" @change="saveOrder(row, { displayMode: row.displayMode })">
              <el-option label="公开" value="public" />
              <el-option label="匿名" value="anonymous" />
              <el-option label="隐藏" value="hidden" />
            </el-select>
            <el-button v-if="row.status === 'pending'" text size="small" :loading="isOrderBusy(row)" :disabled="isOrderBusy(row)" @click="saveOrder(row, { status: 'closed' })">关闭</el-button>
            <el-button v-if="row.status !== 'paid'" text size="small" type="warning" :loading="isOrderBusy(row)" :disabled="isOrderBusy(row)" @click="markPaid(row)">标记已付</el-button>
            <el-button text size="small" :disabled="isOrderBusy(row)" @click="editMessage(row)">改留言</el-button>
          </div>
        </article>
        <el-empty v-if="!ordersLoading && !orders.length" description="暂无订单" />
      </div>
      <el-pagination
        v-if="ordersTotal > filters.size"
        layout="prev, pager, next, total"
        :page-size="filters.size"
        :total="ordersTotal"
        v-model:current-page="filters.page"
        @current-change="reloadOrders"
      />
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h3 class="section-title">回调日志</h3>
          <p class="section-desc">记录易支付通知原始参数、验签结果和处理结果，方便排查到账问题。</p>
        </div>
        <el-button @click="reloadLogs">刷新</el-button>
      </div>
      <el-table :data="logs" v-loading="logsLoading" border size="small">
        <el-table-column prop="createdAt" label="时间" min-width="150">
          <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="outTradeNo" label="订单号" min-width="180" show-overflow-tooltip />
        <el-table-column label="验签" width="80">
          <template #default="{ row }"><el-tag size="small" :type="row.signOk ? 'success' : 'danger'">{{ row.signOk ? "通过" : "失败" }}</el-tag></template>
        </el-table-column>
        <el-table-column label="处理" width="80">
          <template #default="{ row }"><el-tag size="small" :type="row.handled ? 'success' : 'info'">{{ row.handled ? "已处理" : "未处理" }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="result" label="结果" min-width="130" />
        <el-table-column prop="rawPayload" label="原始参数" min-width="260" show-overflow-tooltip />
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type SponsorConfig } from "@/api/admin";
import { fmtDate } from "@/utils/format";

const overview = ref<any>({});
const overviewLoading = ref(false);
const configLoading = ref(false);
const savingConfig = ref(false);
const ordersLoading = ref(false);
const logsLoading = ref(false);
const orderBusyId = ref<number | null>(null);
const orders = ref<any[]>([]);
const logs = ref<any[]>([]);
const ordersTotal = ref(0);
const presetAmountsText = ref("");
const config = reactive<SponsorConfig>({
  title: "赞助本站",
  description: "",
  presetAmounts: [5, 10, 20, 50],
  minAmount: "1.00",
  maxAmount: "9999.00",
  wallEnabled: true,
  allowMessage: true,
});
const filters = reactive({ q: "", status: "all", page: 1, size: 20 });
let sponsorOrdersSeq = 0;

onMounted(async () => {
  await Promise.all([reloadOverview(), reloadConfig(), reloadOrders(), reloadLogs()]);
});

async function reloadOverview() {
  overviewLoading.value = true;
  try { overview.value = await adminApi.sponsorOverview(); }
  finally { overviewLoading.value = false; }
}

async function reloadConfig() {
  configLoading.value = true;
  try {
    Object.assign(config, await adminApi.sponsorConfig());
    presetAmountsText.value = config.presetAmounts.join(",");
  } finally { configLoading.value = false; }
}

async function saveConfig() {
  if (savingConfig.value) return;
  savingConfig.value = true;
  try {
    const amounts = presetAmountsText.value.split(/[,，\s]+/).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
    Object.assign(config, await adminApi.updateSponsorConfig({ ...config, presetAmounts: amounts }));
    presetAmountsText.value = config.presetAmounts.join(",");
    ElMessage.success("赞助配置已保存");
  } finally { savingConfig.value = false; }
}

async function reloadOrders() {
  const seq = ++sponsorOrdersSeq;
  ordersLoading.value = true;
  try {
    const r = await adminApi.sponsorOrders(filters);
    if (seq === sponsorOrdersSeq) {
      orders.value = r.list;
      ordersTotal.value = r.total;
    }
  } finally {
    if (seq === sponsorOrdersSeq) ordersLoading.value = false;
  }
}

async function reloadLogs() {
  logsLoading.value = true;
  try { logs.value = (await adminApi.sponsorLogs({ page: 1, size: 20 })).list; }
  finally { logsLoading.value = false; }
}

function statusText(status: string) {
  if (status === "paid") return "已支付";
  if (status === "closed") return "已关闭";
  return "待支付";
}

function statusType(status: string) {
  if (status === "paid") return "success";
  if (status === "closed") return "info";
  return "warning";
}

async function saveOrder(row: any, patch: Record<string, unknown>) {
  await runOrderAction(row, async () => {
    try {
      const updated = await adminApi.updateSponsorOrder(row.id, patch as any);
      Object.assign(row, updated);
      await reloadOverview();
      ElMessage.success("订单已更新");
    } catch (error) {
      await reloadOrders().catch(() => undefined);
      throw error;
    }
  });
}

function isOrderBusy(row: any) {
  return orderBusyId.value === row.id;
}

async function runOrderAction(row: any, action: () => Promise<void>) {
  if (orderBusyId.value !== null) return;
  orderBusyId.value = row.id;
  try {
    await action();
  } finally {
    orderBusyId.value = null;
  }
}

async function markPaid(row: any) {
  await runOrderAction(row, async () => {
    const snapshot = { ...row };
    const confirmed = await ElMessageBox.confirm(
      `确认将订单 ${row.outTradeNo} 标记为已支付？这会累计用户赞助金额。`,
      "手动修复订单",
      { type: "warning" }
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    try {
      const updated = await adminApi.updateSponsorOrder(row.id, { status: "paid" });
      Object.assign(row, updated);
      await reloadOverview();
      ElMessage.success("订单已更新");
    } catch (error) {
      Object.assign(row, snapshot);
      throw error;
    }
  });
}

async function editMessage(row: any) {
  await runOrderAction(row, async () => {
    let value: string | null = null;
    try {
      ({ value } = await ElMessageBox.prompt("修改赞助留言", "赞助留言", {
        inputValue: row.message || "",
        inputType: "textarea",
        inputValidator: (v) => String(v || "").length <= 80 || "最多 80 字",
      }));
    } catch {
      return;
    }
    const snapshot = { ...row };
    try {
      const updated = await adminApi.updateSponsorOrder(row.id, { message: value || "" });
      Object.assign(row, updated);
      await reloadOverview();
      ElMessage.success("订单已更新");
    } catch (error) {
      Object.assign(row, snapshot);
      throw error;
    }
  });
}
</script>

<style scoped>
.sponsor-pane { display: flex; flex-direction: column; gap: 14px; }
.stats-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.stat { padding: 14px; border: 1px solid #e7edf5; border-radius: 8px; background: #fff; }
.stat b { display: block; color: var(--cpu-primary); font-size: 22px; }
.stat span { display: block; margin-top: 4px; color: #6b7280; font-size: 12px; }
.panel { display: flex; flex-direction: column; gap: 14px; padding: 16px; border: 1px solid #e7edf5; border-radius: 8px; background: #fff; }
.panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.section-title { margin: 0; font-size: 16px; color: #111827; }
.section-desc { margin: 5px 0 0; color: #667085; font-size: 13px; line-height: 1.6; }
.config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; color: #6b7280; font-size: 12px; }
.field--wide { grid-column: 1 / -1; }
.field--switch { align-items: center; flex-direction: row; justify-content: space-between; padding: 8px 0; }
.filters { display: grid; grid-template-columns: minmax(0, 1fr) 140px 90px; gap: 8px; }
.muted { color: #9ca3af; font-size: 12px; }
.interactive-table { display: block; }
.record-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
}
.record-card {
  border: 1px solid #e7edf5;
  border-radius: 14px;
  padding: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.record-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.record-head b {
  display: block;
  color: #111827;
  font-size: 14px;
}
.record-head span {
  display: block;
  margin-top: 2px;
  color: #6b7280;
  font-size: 12px;
}
.record-tag-stack {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.record-meta {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.record-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 12px;
}
.record-actions :deep(.el-select) {
  min-width: 120px;
}
.record-list :deep(.el-empty) {
  grid-column: 1 / -1;
}

@media (max-width: 900px) {
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .config-grid,
  .filters { grid-template-columns: 1fr; }
  .field--wide { grid-column: auto; }
  .panel-head { flex-direction: column; }
  .interactive-table { display: none; }
  .record-list { display: grid; grid-template-columns: 1fr; gap: 10px; }
}
</style>
