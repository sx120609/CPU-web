<template>
  <div class="market-admin" v-loading="loading">
    <div class="pane-head"><div><h2>商城运营</h2><p>商品品类、平台支付、退款、举报与卖家结算集中处理。支付沿用系统易支付配置。</p></div><el-button @click="load">刷新</el-button></div>
    <section class="commission-card">
      <div><h3>平台佣金</h3><p>新订单生成时按当前比例锁定佣金；修改比例不会追溯改变历史订单。</p></div>
      <div class="commission-form"><el-input-number v-model="commissionRate" :min="0" :max="50" :precision="2" :step="0.5" /><span>%</span><el-button type="primary" :loading="savingConfig" @click="saveConfig">保存比例</el-button></div>
    </section>
    <section class="category-card">
      <header><div><h3>商品品类</h3><p>品类会实时同步到商城首页和发布页面；“电子资料”类型使用付款后线上发货。</p></div><el-button type="primary" size="small" @click="openCategory()">新增品类</el-button></header>
      <el-table :data="categories" size="small">
        <el-table-column label="品类" min-width="180"><template #default="{row}"><b>{{row.icon}} {{row.name}}</b><small>{{row.slug}}</small></template></el-table-column>
        <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="交付" width="105"><template #default="{row}"><el-tag :type="row.fulfillmentType==='digital'?'success':'info'">{{row.fulfillmentType==='digital'?'线上发货':'实体交付'}}</el-tag></template></el-table-column>
        <el-table-column label="图片" width="90"><template #default="{row}">{{row.imageRequired?'出售必填':'选填'}}</template></el-table-column>
        <el-table-column prop="itemCount" label="商品数" width="80" />
        <el-table-column prop="sort" label="排序" width="70" />
        <el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.enabled?'success':'info'">{{row.enabled?'启用':'停用'}}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="145"><template #default="{row}"><el-button link type="primary" @click="openCategory(row)">编辑</el-button><el-button link type="danger" @click="removeCategory(row)">删除</el-button></template></el-table-column>
      </el-table>
    </section>
    <div class="summary">
      <article><b>{{ overview.counts?.active || 0 }}</b><span>在售</span></article><article><b>{{ overview.counts?.reserved || 0 }}</b><span>已预订</span></article><article><b>{{ overview.counts?.sold || 0 }}</b><span>已售</span></article><article><b>{{ pendingReports }}</b><span>待处理举报</span></article><article><b>{{ pendingRefunds }}</b><span>待处理退款</span></article><article><b>{{ availableSettlements }}</b><span>待结算</span></article>
    </div>
    <el-alert type="info" :closable="false" show-icon title="支付说明">买家通过易支付付款，异步签名回调确认到账；退款需在易支付商户后台完成后，将退款单号登记在这里，平台才会恢复商品与订单状态。</el-alert>
    <el-tabs v-model="tab">
      <el-tab-pane label="退款处理" name="refunds">
        <el-table :data="overview.refunds || []" stripe>
          <el-table-column label="订单/商品" min-width="220"><template #default="{row}"><b>#{{row.orderId}} {{row.order?.item?.title}}</b><small>{{row.order?.buyer?.nickname}} → {{row.order?.seller?.nickname}}</small></template></el-table-column>
          <el-table-column prop="amount" label="金额" width="100"><template #default="{row}">¥{{row.amount}}</template></el-table-column>
          <el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100"><template #default="{row}"><el-tag :type="statusType(row.status)">{{statusLabel(row.status)}}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="290"><template #default="{row}"><el-button v-if="row.status==='pending'" size="small" @click="handleRefund(row,'approved')">批准</el-button><el-button v-if="['pending','approved'].includes(row.status)" size="small" type="success" @click="completeRefund(row)">登记已退款</el-button><el-button v-if="['pending','approved'].includes(row.status)" size="small" type="danger" plain @click="handleRefund(row,'rejected')">拒绝</el-button></template></el-table-column>
        </el-table>
        <el-empty v-if="!overview.refunds?.length" description="暂无退款申请" />
      </el-tab-pane>
      <el-tab-pane label="卖家结算" name="settlements">
        <el-table :data="overview.settlements || []" stripe>
          <el-table-column label="订单/商品" min-width="220"><template #default="{row}"><b>#{{row.orderId}} {{row.order?.item?.title}}</b><small>卖家：{{row.seller?.nickname || `用户 #${row.seller?.id}`}}</small></template></el-table-column>
          <el-table-column label="成交/佣金/应结" width="180"><template #default="{row}"><b>¥{{row.order?.amount}}</b><small>佣金 ¥{{row.order?.platformFee}} · 应结 ¥{{row.amount}}</small></template></el-table-column>
          <el-table-column prop="status" label="状态" width="100"><template #default="{row}"><el-tag :type="statusType(row.status)">{{statusLabel(row.status)}}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="300"><template #default="{row}"><el-button size="small" @click="showPayout(row)">收款资料</el-button><el-button v-if="row.status==='available'" size="small" @click="updateSettlement(row,'held')">暂缓</el-button><el-button v-if="row.status!=='settled'" size="small" type="success" @click="settle(row)">登记已结算</el-button></template></el-table-column>
        </el-table>
        <el-empty v-if="!overview.settlements?.length" description="暂无结算单" />
      </el-tab-pane>
      <el-tab-pane label="商品举报" name="reports">
        <el-table :data="overview.reports || []" stripe>
          <el-table-column label="商品" min-width="220"><template #default="{row}"><router-link :to="{name:'market-item',params:{id:row.itemId}}">{{row.item?.title}}</router-link><small>举报人：{{row.reporter?.nickname || `用户 #${row.reporter?.id}`}}</small></template></el-table-column>
          <el-table-column prop="reason" label="原因" width="140" /><el-table-column prop="detail" label="详情" min-width="180" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100"><template #default="{row}"><el-tag :type="statusType(row.status)">{{statusLabel(row.status)}}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="260"><template #default="{row}"><el-button v-if="row.status==='pending'" size="small" type="danger" @click="handleReport(row,true)">下架并处理</el-button><el-button v-if="row.status==='pending'" size="small" @click="handleReport(row,false)">驳回</el-button></template></el-table-column>
        </el-table>
        <el-empty v-if="!overview.reports?.length" description="暂无商品举报" />
      </el-tab-pane>
      <el-tab-pane label="全部订单" name="orders">
        <el-table :data="overview.orders || []" stripe>
          <el-table-column prop="outTradeNo" label="平台订单号" min-width="210" /><el-table-column label="商品" min-width="200"><template #default="{row}">{{row.item?.title}}</template></el-table-column><el-table-column label="买家/卖家" min-width="170"><template #default="{row}">{{row.buyer?.nickname}} / {{row.seller?.nickname}}</template></el-table-column><el-table-column label="金额明细" width="170"><template #default="{row}"><b>¥{{row.amount}}</b><small>佣金 ¥{{row.platformFee}} · 卖家 ¥{{row.sellerAmount}}</small></template></el-table-column><el-table-column prop="payType" label="通道" width="90" /><el-table-column prop="status" label="状态" width="110"><template #default="{row}"><el-tag :type="statusType(row.status)">{{statusLabel(row.status)}}</el-tag></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="payoutOpen" title="卖家收款资料" width="440px"><el-descriptions v-if="payoutProfile" :column="1" border><el-descriptions-item label="方式">{{payoutProfile.method}}</el-descriptions-item><el-descriptions-item label="真实姓名">{{payoutProfile.realName}}</el-descriptions-item><el-descriptions-item label="账号">{{payoutProfile.account}}</el-descriptions-item><el-descriptions-item label="认证">{{payoutProfile.verified?'已认证':'未认证'}}</el-descriptions-item></el-descriptions><el-alert type="warning" :closable="false" title="敏感信息仅用于本次结算，请勿复制或另作他用。" /></el-dialog>
    <el-dialog v-model="categoryOpen" :title="editingCategoryId ? '编辑品类' : '新增品类'" width="500px">
      <el-form label-position="top">
        <div class="category-form-grid"><el-form-item label="图标"><el-input v-model="categoryForm.icon" maxlength="12" /></el-form-item><el-form-item label="品类名称"><el-input v-model="categoryForm.name" maxlength="30" /></el-form-item></div>
        <el-form-item label="品类标识"><el-input v-model="categoryForm.slug" :disabled="Boolean(editingCategoryId)" maxlength="40" placeholder="仅小写字母、数字、下划线或短横线" /></el-form-item>
        <el-form-item label="品类说明"><el-input v-model="categoryForm.description" maxlength="120" /></el-form-item>
        <div class="category-form-grid"><el-form-item label="交付类型"><el-select v-model="categoryForm.fulfillmentType"><el-option label="实体交付" value="physical" /><el-option label="线上发货" value="digital" /></el-select></el-form-item><el-form-item label="排序"><el-input-number v-model="categoryForm.sort" :min="0" :max="9999" /></el-form-item></div>
        <el-switch v-model="categoryForm.imageRequired" active-text="出售时图片必填" inactive-text="图片选填" />
        <el-switch v-model="categoryForm.enabled" active-text="启用品类" inactive-text="停用品类" />
      </el-form>
      <template #footer><el-button @click="categoryOpen=false">取消</el-button><el-button type="primary" :loading="savingCategory" @click="saveCategory">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MarketCategoryOption } from "@/api/market";

const loading = ref(false); const tab = ref("refunds"); const overview = reactive<any>({ counts:{}, reports:[], refunds:[], settlements:[], orders:[] }); const payoutOpen=ref(false); const payoutProfile=ref<any>(null); const commissionRate=ref(5); const savingConfig=ref(false);
const categories=ref<MarketCategoryOption[]>([]);const categoryOpen=ref(false);const editingCategoryId=ref(0);const savingCategory=ref(false);const categoryForm=reactive({slug:'',name:'',icon:'📦',description:'',fulfillmentType:'physical' as 'physical'|'digital',imageRequired:true,enabled:true,sort:0});
const pendingReports=computed(()=>overview.reports.filter((row:any)=>row.status==='pending').length); const pendingRefunds=computed(()=>overview.refunds.filter((row:any)=>['pending','approved'].includes(row.status)).length); const availableSettlements=computed(()=>overview.settlements.filter((row:any)=>row.status==='available').length);
const labels:Record<string,string>={pending:'待处理',approved:'已批准',completed:'已退款',rejected:'已拒绝',failed:'失败',available:'待结算',held:'暂缓',settled:'已结算',pending_payment:'待支付',paid:'已支付',delivering:'交付中',disputed:'争议中',refunded:'已退款',cancelled:'已取消',resolved:'已处理'};
function statusLabel(status:string){return labels[status]||status} function statusType(status:string){if(['completed','settled','resolved'].includes(status))return 'success';if(['rejected','failed','disputed'].includes(status))return 'danger';if(['pending','pending_payment','available'].includes(status))return 'warning';return 'info'}
async function load(){loading.value=true;try{const [nextOverview,config,nextCategories]=await Promise.all([marketApi.adminOverview({suppressErrorMessage:true}),marketApi.adminConfig({suppressErrorMessage:true}),marketApi.adminCategories({suppressErrorMessage:true})]);Object.assign(overview,nextOverview);commissionRate.value=config.commissionRate;categories.value=nextCategories}catch(error){ElMessage.error(error instanceof Error?error.message:'商城运营数据加载失败')}finally{loading.value=false}}
async function saveConfig(){savingConfig.value=true;try{const config=await marketApi.adminUpdateConfig(commissionRate.value);commissionRate.value=config.commissionRate;ElMessage.success(`平台佣金已设置为 ${config.commissionRate}%`)}finally{savingConfig.value=false}}
function openCategory(row?:any){editingCategoryId.value=row?.id||0;const last=categories.value[categories.value.length-1];Object.assign(categoryForm,row?{slug:row.slug,name:row.name,icon:row.icon,description:row.description,fulfillmentType:row.fulfillmentType,imageRequired:row.imageRequired,enabled:row.enabled,sort:row.sort}:{slug:'',name:'',icon:'📦',description:'',fulfillmentType:'physical',imageRequired:true,enabled:true,sort:(last?.sort||0)+10});categoryOpen.value=true}
async function saveCategory(){if(!categoryForm.name.trim()||!categoryForm.slug.trim())return ElMessage.warning('请填写品类名称和标识');savingCategory.value=true;try{if(editingCategoryId.value){await marketApi.adminUpdateCategory(editingCategoryId.value,{name:categoryForm.name.trim(),icon:categoryForm.icon.trim()||'📦',description:categoryForm.description.trim(),fulfillmentType:categoryForm.fulfillmentType,imageRequired:categoryForm.imageRequired,enabled:categoryForm.enabled,sort:categoryForm.sort})}else{await marketApi.adminCreateCategory({...categoryForm,slug:categoryForm.slug.trim(),name:categoryForm.name.trim(),icon:categoryForm.icon.trim()||'📦',description:categoryForm.description.trim()})}categoryOpen.value=false;ElMessage.success('商品品类已保存');await load()}finally{savingCategory.value=false}}
async function removeCategory(row:any){if(row.itemCount)return ElMessage.warning(`该品类已有 ${row.itemCount} 件商品，请编辑并停用`);await ElMessageBox.confirm('删除后不可恢复，确认继续？','删除品类',{type:'warning'});await marketApi.adminDeleteCategory(row.id);ElMessage.success('品类已删除');await load()}
async function handleRefund(row:any,status:'approved'|'rejected'){const {value}=await ElMessageBox.prompt(status==='approved'?'批准备注（可选）':'拒绝原因','处理退款',{inputValue:'',confirmButtonText:'确认'});await marketApi.adminHandleRefund(row.id,{status,note:value});ElMessage.success('退款状态已更新');await load()}
async function completeRefund(row:any){const {value}=await ElMessageBox.prompt('请先在易支付商户后台完成退款，再填写支付平台退款单号','登记已退款',{inputPattern:/\S+/,inputErrorMessage:'必须填写退款单号',confirmButtonText:'确认已退款'});await marketApi.adminHandleRefund(row.id,{status:'completed',providerRefundNo:value,note:'已在易支付商户后台完成退款'});ElMessage.success('退款完成并已恢复订单状态');await load()}
async function handleReport(row:any,hideItem:boolean){const action=hideItem?'resolved':'rejected';const {value}=await ElMessageBox.prompt(hideItem?'填写下架处理说明':'填写驳回说明','处理商品举报',{inputValue:'',confirmButtonText:'确认'});await marketApi.adminHandleReport(row.id,{status:action,note:value,hideItem});ElMessage.success('举报已处理');await load()}
async function showPayout(row:any){await ElMessageBox.confirm('即将解密显示卖家敏感收款资料，仅可用于本次结算。','安全确认',{type:'warning'});payoutProfile.value=await marketApi.adminPayoutProfile(row.id);payoutOpen.value=true}
async function updateSettlement(row:any,status:'available'|'held'|'settled',reference='',note=''){await marketApi.adminHandleSettlement(row.id,{status,reference,note});ElMessage.success('结算状态已更新');await load()}
async function settle(row:any){const {value}=await ElMessageBox.prompt('完成转账后填写银行/支付平台流水号','登记已结算',{inputPattern:/\S+/,inputErrorMessage:'必须填写流水号',confirmButtonText:'确认已打款'});await updateSettlement(row,'settled',value,'管理员确认已向卖家打款')}
onMounted(load);
</script>

<style scoped>
.market-admin{padding:4px}.pane-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.pane-head h2{margin:0 0 6px}.pane-head p{margin:0;color:#728096}.commission-card{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 18px;border:1px solid #cde9e2;border-radius:13px;background:#f0fdfa}.commission-card h3{margin:0 0 5px}.commission-card p{margin:0;color:#64748b;font-size:12px}.commission-form{display:flex;align-items:center;gap:8px}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:16px 0}.summary article{display:flex;flex-direction:column;padding:16px;background:#f6f8fb;border:1px solid #e6ebf2;border-radius:12px}.summary b{font-size:26px;color:#108773}.summary span{color:#6f7c90}.el-alert{margin-bottom:14px}.el-table small{display:block;color:#8491a5;margin-top:4px}.el-table b{display:block}.el-table a{color:#168c78;text-decoration:none}@media(max-width:1000px){.summary{grid-template-columns:repeat(3,1fr)}}@media(max-width:600px){.summary{grid-template-columns:repeat(2,1fr)}.pane-head,.commission-card{align-items:flex-start;flex-direction:column;gap:12px}.pane-head p{font-size:12px}.commission-form{width:100%;flex-wrap:wrap}}
.category-card{margin:16px 0;padding:16px 18px;border:1px solid #e1e8ef;border-radius:13px;background:#fff}.category-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}.category-card h3{margin:0 0 5px}.category-card p{margin:0;color:#64748b;font-size:12px}.category-form-grid{display:grid;grid-template-columns:1fr 2fr;gap:14px}
@media(max-width:600px){.category-card>header{flex-direction:column}.category-form-grid{grid-template-columns:1fr}}
.commission-card{border-color:var(--cpu-border-soft);background:var(--cpu-primary-soft)}.commission-card p,.category-card p,.pane-head p{color:var(--cpu-text-secondary)}.summary article{border-color:var(--cpu-border-soft);background:var(--cpu-surface-soft)}.summary span,.el-table small{color:var(--cpu-text-secondary)}.category-card{border-color:var(--cpu-border-soft);background:var(--cpu-card)}.category-card .el-switch+.el-switch{margin-left:18px}
:global(html[data-theme="dark"]) .commission-card{box-shadow:inset 0 0 0 1px rgba(45,212,191,.05)}
.commission-card{border-color:var(--cpu-border-soft)!important;background:var(--cpu-primary-soft)!important}.category-card{border-color:var(--cpu-border-soft)!important;background:var(--cpu-card)!important}
</style>
