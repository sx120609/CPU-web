<template>
  <div class="seller-page" v-loading="loading">
    <header class="seller-head">
      <div>
        <span>SELLER CENTER</span>
        <h1>卖家中心</h1>
        <p>管理商品、交付订单、待结算余额和收款资料。</p>
      </div>
      <div class="head-actions">
        <el-button @click="$router.push('/market')">返回商城</el-button>
        <el-button type="primary" @click="$router.push('/market/publish')">发布商品</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <template #default><el-button size="small" @click="load">重新加载</el-button></template>
    </el-alert>

    <section class="finance-card">
      <div class="balance-main">
        <small>可结算金额</small>
        <strong>¥{{ money(data.balance.availableCents) }}</strong>
        <p>由平台管理员线下结算，暂不支持自动提现。</p>
      </div>
      <div class="balance-grid">
        <article><span>交易中</span><b>¥{{ money(data.balance.pendingCents) }}</b><small>{{ data.stats.pendingDeliveryOrders }} 笔待交付</small></article>
        <article><span>冻结中</span><b>¥{{ money(data.balance.frozenCents) }}</b><small>退款、纠纷或暂缓结算</small></article>
        <article><span>累计结算</span><b>¥{{ money(data.balance.settledCents) }}</b><small>管理员已登记打款</small></article>
        <article><span>累计佣金</span><b>¥{{ money(data.balance.commissionCents) }}</b><small>当前比例 {{ formatRate(data.config.commissionRate) }}</small></article>
      </div>
    </section>

    <section class="stats-grid">
      <article><b>{{ data.stats.activeListings }}</b><span>进行中的发布</span></article>
      <article><b>{{ data.stats.reservedListings }}</b><span>预订或洽谈</span></article>
      <article><b>{{ data.stats.soldListings }}</b><span>已成交或求到</span></article>
      <article><b>{{ data.stats.pendingDeliveryOrders }}</b><span>待交付订单</span></article>
      <article><b>{{ data.stats.pendingSettlementOrders }}</b><span>待结算订单</span></article>
    </section>

    <section class="workspace cpu-card">
      <el-tabs v-model="tab">
        <el-tab-pane label="订单管理" name="orders">
          <div class="toolbar">
            <el-segmented v-model="orderFilter" :options="orderFilters" />
            <span>共 {{ filteredOrders.length }} 笔</span>
          </div>
          <div v-if="filteredOrders.length" class="order-list">
            <article v-for="order in filteredOrders" :key="order.id" class="order-card">
              <header>
                <span>{{ order.outTradeNo }}</span>
                <el-tag :type="orderStatusType(order.status)" effect="plain">{{ orderStatus(order.status) }}</el-tag>
              </header>
              <div class="order-body">
                <router-link :to="{ name: 'market-item', params: { id: order.itemId } }" class="order-cover">
                  <img v-if="order.item?.images?.[0]?.url" :src="order.item.images[0].url" alt="" />
                  <span v-else>📦</span>
                </router-link>
                <div class="order-copy">
                  <strong>{{ order.item?.title || `商品 #${order.itemId}` }}</strong>
                  <span>买家：{{ order.buyer?.nickname || (order.buyer?.id ? `用户 #${order.buyer.id}` : '—') }}</span>
                  <span v-if="order.deliveryType === 'digital'">线上发货 · {{ order.digitalDeliveredAt ? '已自动发放' : '待买家付款' }}</span>
                  <span v-if="order.meetupLocation">交付：{{ order.meetupLocation }}</span>
                  <small>{{ fmtDate(order.createdAt) }}</small>
                </div>
                <div class="amount-breakdown">
                  <span>成交 ¥{{ order.amount }}</span>
                  <span>佣金 -¥{{ order.platformFee }}</span>
                  <b>预计结算 ¥{{ order.sellerAmount }}</b>
                </div>
              </div>
              <footer>
                <el-button v-if="order.conversation?.id" size="small" @click="openConversation(order.conversation.id)">联系买家</el-button>
                <el-button v-if="order.deliveryType !== 'digital' && ['paid','delivering'].includes(order.status)" size="small" @click="openMeetup(order)">交付安排</el-button>
                <el-button v-if="order.deliveryType !== 'digital' && ['paid','delivering'].includes(order.status) && !order.sellerConfirmedAt" size="small" type="success" @click="confirmDelivered(order)">确认已交付</el-button>
              </footer>
            </article>
          </div>
          <el-empty v-else description="当前筛选下没有订单" />
        </el-tab-pane>

        <el-tab-pane label="商品管理" name="items">
          <div class="toolbar"><span>共 {{ data.items.length }} 件商品</span><el-button type="primary" size="small" @click="$router.push('/market/publish')">发布商品</el-button></div>
          <div v-if="data.items.length" class="item-grid">
            <article v-for="item in data.items" :key="item.id">
              <div class="item-cover"><img v-if="item.cover" :src="item.cover" alt="" /><span v-else>📦</span></div>
              <div class="item-copy"><strong>{{ item.title }}</strong><b>{{ item.listingType==='wanted'?'预算 ':'' }}¥{{ item.price }}</b><span>{{ itemStatus(item) }} · {{ item.viewCount }} 浏览 · {{ item.offerCount }} 意向</span></div>
              <el-button size="small" @click="$router.push({ name: 'market-edit', params: { id: item.id } })">管理</el-button>
            </article>
          </div>
          <el-empty v-else description="还没有发布商品" />
        </el-tab-pane>

        <el-tab-pane label="资金明细" name="funds">
          <div class="fund-summary">
            <span>累计成交 <b>¥{{ money(data.balance.grossCents) }}</b></span>
            <span>累计佣金 <b>¥{{ money(data.balance.commissionCents) }}</b></span>
            <span>累计结算 <b>¥{{ money(data.balance.settledCents) }}</b></span>
          </div>
          <el-table :data="data.timeline" stripe>
            <el-table-column label="时间" width="170"><template #default="{ row }">{{ fmtDate(row.occurredAt) }}</template></el-table-column>
            <el-table-column label="事项" min-width="220"><template #default="{ row }"><b>{{ timelineType(row.type) }}</b><small>{{ row.title }} · 订单 #{{ row.orderId }}</small></template></el-table-column>
            <el-table-column label="金额" width="130"><template #default="{ row }"><span :class="{ negative: row.amountCents < 0 }">{{ row.amountCents < 0 ? '-' : '+' }}¥{{ row.amount }}</span></template></el-table-column>
            <el-table-column label="平台佣金" width="120"><template #default="{ row }">¥{{ row.platformFee }}</template></el-table-column>
            <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag effect="plain" :type="orderStatusType(row.status)">{{ fundStatus(row.status) }}</el-tag></template></el-table-column>
            <el-table-column prop="reference" label="结算流水" min-width="150" />
          </el-table>
          <el-empty v-if="!data.timeline.length" description="暂无资金记录" />
        </el-tab-pane>

        <el-tab-pane label="收款设置" name="payout">
          <div class="payout-panel">
            <div>
              <h2>卖家收款资料</h2>
              <p>管理员完成线下打款时使用。账号与姓名在服务器加密保存，普通页面只显示掩码。</p>
              <el-alert v-if="data.payoutProfile" type="success" :closable="false" :title="`${payoutMethod(data.payoutProfile.method)} · ${data.payoutProfile.accountMasked} · ${data.payoutProfile.realNameMasked}`" />
            </div>
            <el-form label-position="top">
              <el-form-item label="收款方式"><el-select v-model="payout.method"><el-option label="支付宝" value="alipay" /><el-option label="微信支付" value="wxpay" /><el-option label="银行卡" value="bank" /></el-select></el-form-item>
              <el-form-item label="收款账号"><el-input v-model="payout.account" autocomplete="off" /></el-form-item>
              <el-form-item label="真实姓名"><el-input v-model="payout.realName" autocomplete="off" /></el-form-item>
              <el-button type="primary" :loading="savingPayout" @click="savePayout">加密保存</el-button>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="meetupOpen" title="设置交付安排" width="460px">
      <el-form label-position="top">
        <el-form-item label="交付时间"><el-date-picker v-model="meetup.time" type="datetime" placeholder="选择交付时间" style="width:100%" /></el-form-item>
        <el-form-item label="交付地点"><el-input v-model="meetup.location" maxlength="120" placeholder="例如：南校区中心楼大厅" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="meetup.note" type="textarea" :rows="3" maxlength="500" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="meetupOpen=false">取消</el-button><el-button type="primary" :loading="acting" @click="saveMeetup">保存并通知买家</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MarketOrder, type MarketSellerDashboard } from "@/api/market";

const router = useRouter();
const tab = ref("orders");
const orderFilter = ref("active");
const loading = ref(false);
const error = ref("");
const acting = ref(false);
const savingPayout = ref(false);
const meetupOpen = ref(false);
const selectedOrder = ref<MarketOrder | null>(null);
const meetup = reactive<{ time: Date | null; location: string; note: string }>({ time: null, location: "", note: "" });
const payout = reactive({ method: "alipay" as "alipay" | "wxpay" | "bank", account: "", realName: "" });
const data = reactive<MarketSellerDashboard>({
  config: { commissionBps: 500, commissionRate: 5, updatedAt: "" },
  stats: { activeListings: 0, reservedListings: 0, soldListings: 0, pendingDeliveryOrders: 0, pendingSettlementOrders: 0 },
  balance: { grossCents: 0, commissionCents: 0, pendingCents: 0, frozenCents: 0, availableCents: 0, settledCents: 0 },
  items: [], orders: [], settlements: [], timeline: [], payoutProfile: null,
});
const orderFilters = [{ label: "进行中", value: "active" }, { label: "待付款", value: "pending_payment" }, { label: "已完成", value: "completed" }, { label: "售后/纠纷", value: "after_sale" }, { label: "全部", value: "all" }];
const filteredOrders = computed(() => data.orders.filter((order) => {
  if (orderFilter.value === "all") return true;
  if (orderFilter.value === "active") return ["paid", "delivering"].includes(order.status);
  if (orderFilter.value === "after_sale") return ["refund_pending", "refunded", "disputed"].includes(order.status);
  return order.status === orderFilter.value;
}));

onMounted(load);
async function load() {
  loading.value = true; error.value = "";
  try { Object.assign(data, await marketApi.sellerDashboard({ suppressErrorMessage: true })); }
  catch (reason) { error.value = requestMessage(reason) || "卖家中心加载失败"; }
  finally { loading.value = false; }
}
function requestMessage(error: unknown) { return (error as any)?.response?.data?.message || (error instanceof Error ? error.message : ""); }
function money(cents: number) { return (Number(cents || 0) / 100).toFixed(2); }
function formatRate(rate: number) { return `${Number(rate || 0).toFixed(2).replace(/\.00$/, "")}%`; }
function fmtDate(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }
function orderStatus(status: string) { return ({ pending_payment: "待付款", paid: "已付款", delivering: "交付中", completed: "已完成", cancelled: "已取消", refund_pending: "退款处理中", refunded: "已退款", disputed: "纠纷处理中" } as Record<string,string>)[status] || status; }
function orderStatusType(status: string) { if (["completed", "settled"].includes(status)) return "success"; if (["disputed", "refund_pending", "refunded"].includes(status)) return "danger"; if (["pending_payment", "available"].includes(status)) return "warning"; return "info"; }
function fundStatus(status: string) { return ({ paid: "交易中", delivering: "交易中", completed: "待结算", available: "可结算", held: "暂缓", settled: "已结算", refund_pending: "退款中", refunded: "已退款", disputed: "冻结" } as Record<string,string>)[status] || orderStatus(status); }
function itemStatus(item: { status: string; listingType: string }) { if (item.listingType === "wanted") return ({ active: "求购中", reserved: "洽谈中", sold: "已求到", draft: "草稿", reviewing: "审核中", withdrawn: "已结束", hidden: "已隐藏" } as Record<string,string>)[item.status] || item.status; return ({ active: "在售", reserved: "已预订", sold: "已售出", draft: "草稿", reviewing: "审核中", withdrawn: "已下架", hidden: "已隐藏" } as Record<string,string>)[item.status] || item.status; }
function timelineType(type: string) { return ({ payment: "买家付款", settlement: "结算记录", refunded: "订单退款" } as Record<string,string>)[type] || type; }
function payoutMethod(method: string) { return ({ alipay: "支付宝", wxpay: "微信支付", bank: "银行卡" } as Record<string,string>)[method] || method; }
function openConversation(id: number) { router.push({ name: "market-messages", query: { conversation: String(id) } }); }
function openMeetup(order: MarketOrder) { selectedOrder.value = order; meetup.time = order.meetupTime ? new Date(order.meetupTime) : null; meetup.location = order.meetupLocation || ""; meetup.note = ""; meetupOpen.value = true; }
async function saveMeetup() {
  if (!selectedOrder.value) return;
  if (!meetup.location.trim()) return ElMessage.warning("请填写交付地点");
  acting.value = true;
  try {
    await marketApi.updateOrder(selectedOrder.value.id, { action: "set_meetup", meetupTime: meetup.time?.toISOString(), meetupLocation: meetup.location.trim(), note: meetup.note.trim() });
    meetupOpen.value = false; ElMessage.success("交付安排已通知买家"); await load();
  } finally { acting.value = false; }
}
async function confirmDelivered(order: MarketOrder) {
  await ElMessageBox.confirm("确认已经完成商品交付？买家也确认后，订单金额会进入待结算。", "确认已交付", { type: "warning" });
  await marketApi.updateOrder(order.id, { action: "seller_confirm" });
  ElMessage.success("已确认交付"); await load();
}
async function savePayout() {
  if (!payout.account.trim() || !payout.realName.trim()) return ElMessage.warning("请填写完整收款资料");
  savingPayout.value = true;
  try { data.payoutProfile = await marketApi.savePayoutProfile(payout); payout.account = ""; payout.realName = ""; ElMessage.success("收款资料已加密保存"); }
  finally { savingPayout.value = false; }
}
</script>

<style scoped>
.seller-page{display:flex;flex-direction:column;gap:18px}.seller-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.seller-head span{color:var(--cpu-primary);font-size:11px;letter-spacing:.14em}.seller-head h1{margin:5px 0;font-size:28px}.seller-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.head-actions{display:flex;gap:8px}.finance-card{display:grid;grid-template-columns:280px 1fr;gap:22px;padding:24px;border-radius:18px;color:#fff;background:linear-gradient(125deg,#0f766e,#168c78 58%,#2563eb);box-shadow:0 16px 38px rgba(15,118,110,.18)}.balance-main{display:flex;flex-direction:column;justify-content:center;padding-right:22px;border-right:1px solid rgba(255,255,255,.2)}.balance-main small{opacity:.76}.balance-main strong{margin:7px 0;font-size:36px}.balance-main p{margin:0;font-size:11px;opacity:.76}.balance-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.balance-grid article{display:flex;flex-direction:column;justify-content:center;padding:13px;border-radius:12px;background:rgba(255,255,255,.1)}.balance-grid span,.balance-grid small{font-size:10px;opacity:.78}.balance-grid b{margin:7px 0;font-size:19px}.stats-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.stats-grid article{display:flex;flex-direction:column;padding:16px;border:1px solid var(--cpu-border-soft);border-radius:13px;background:var(--cpu-card)}.stats-grid b{font-size:25px;color:var(--cpu-primary)}.stats-grid span{margin-top:5px;color:var(--cpu-text-secondary);font-size:11px}.workspace{padding:10px 18px 20px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;color:var(--cpu-text-secondary);font-size:12px}.order-list{display:flex;flex-direction:column;gap:12px}.order-card{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:13px}.order-card>header{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;background:var(--cpu-surface-soft);color:var(--cpu-text-secondary);font-size:10px}.order-body{display:grid;grid-template-columns:78px minmax(0,1fr) 180px;gap:13px;align-items:center;padding:14px}.order-cover{width:78px;height:72px;display:grid;place-items:center;overflow:hidden;border-radius:9px;background:var(--cpu-surface-soft);font-size:28px}.order-cover img{width:100%;height:100%;object-fit:cover}.order-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.order-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.order-copy span,.order-copy small{color:var(--cpu-text-secondary);font-size:11px}.amount-breakdown{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:11px}.amount-breakdown span{color:var(--cpu-text-secondary)}.amount-breakdown b{color:var(--cpu-primary)}.order-card>footer{display:flex;justify-content:flex-end;gap:7px;padding:9px 13px;border-top:1px solid var(--cpu-border-soft)}.item-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.item-grid article{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px;border:1px solid var(--cpu-border-soft);border-radius:12px}.item-cover{width:72px;height:66px;display:grid;place-items:center;overflow:hidden;border-radius:8px;background:var(--cpu-surface-soft);font-size:25px}.item-cover img{width:100%;height:100%;object-fit:cover}.item-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.item-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-copy b{color:#ef4444}.item-copy span{color:var(--cpu-text-secondary);font-size:10px}.fund-summary{display:flex;gap:28px;padding:14px;margin-bottom:12px;border-radius:11px;background:var(--cpu-surface-soft);font-size:12px}.fund-summary b{margin-left:5px;color:var(--cpu-primary)}.el-table small{display:block;margin-top:4px;color:var(--cpu-text-secondary)}.negative{color:#dc2626}.payout-panel{display:grid;grid-template-columns:1fr 420px;gap:32px;max-width:900px;padding:12px}.payout-panel h2{margin-top:0}.payout-panel p{color:var(--cpu-text-secondary);font-size:12px;line-height:1.7}.payout-panel .el-alert{margin-top:14px}
@media(max-width:1000px){.finance-card{grid-template-columns:1fr}.balance-main{padding-right:0;padding-bottom:18px;border-right:0;border-bottom:1px solid rgba(255,255,255,.2)}.balance-grid{grid-template-columns:repeat(2,1fr)}.stats-grid{grid-template-columns:repeat(3,1fr)}.payout-panel{grid-template-columns:1fr}}
@media(max-width:700px){.seller-head{align-items:flex-start;flex-direction:column}.head-actions{width:100%}.head-actions .el-button{flex:1}.finance-card{padding:18px}.balance-grid{grid-template-columns:1fr 1fr}.stats-grid{grid-template-columns:1fr 1fr}.workspace{padding:8px 10px 16px}.toolbar{align-items:flex-start;flex-direction:column}.order-body{grid-template-columns:68px minmax(0,1fr)}.order-cover{width:68px;height:62px}.amount-breakdown{grid-column:1/-1;align-items:flex-start;padding-top:9px;border-top:1px dashed var(--cpu-border-soft)}.item-grid{grid-template-columns:1fr}.fund-summary{flex-direction:column;gap:8px}.payout-panel{padding:4px}.order-card>footer{flex-wrap:wrap}}
</style>
