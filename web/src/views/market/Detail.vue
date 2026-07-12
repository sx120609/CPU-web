<template>
  <div class="detail-page" v-loading="loading">
    <template v-if="item">
      <nav class="crumb"><router-link to="/market">商城</router-link><span>/</span><span>{{ categoryLabel(item.category) }}</span><span>/</span><b>{{ item.title }}</b></nav>
      <section class="product-card cpu-card">
        <div class="gallery">
          <div class="main-image"><img v-if="activeImage" :src="activeImage" :alt="item.title" /><div v-else>📦</div></div>
          <div v-if="item.images.length>1" class="thumb-list"><button v-for="image in item.images" :key="image.id" :class="{active:activeImage===image.url}" @click="activeImage=image.url"><img :src="image.url" alt="商品缩略图" /></button></div>
        </div>
        <div class="product-info">
          <div class="status-line"><span>{{ item.listingType==='wanted'?'求购':'出售' }}</span><em :class="`status-${item.status}`">{{ statusLabel(item.status,item.listingType) }}</em></div>
          <h1>{{ item.title }}</h1>
          <div class="price-box"><span v-if="item.listingType==='wanted'">预算</span><strong><small>¥</small>{{ item.price }}</strong><del v-if="item.listingType==='sell'&&item.originalPrice">原价 ¥{{ item.originalPrice }}</del><i v-if="item.negotiable">可议价</i></div>
          <dl>
            <div><dt>{{ item.listingType==='wanted'?'期望成色':'商品成色' }}</dt><dd>{{ conditionLabel(item.condition) }}</dd></div>
            <div><dt>{{ item.listingType==='wanted'?'期望交付':'交付方式' }}</dt><dd>{{ tradeModeLabel(item.tradeMode) }}</dd></div>
            <div><dt>所在校区</dt><dd>{{ item.campus || '与卖家协商' }}</dd></div>
            <div><dt>推荐地点</dt><dd>{{ item.location || '与卖家协商' }}</dd></div>
            <div><dt>发布时间</dt><dd>{{ fmtRelative(item.createdAt) }}</dd></div>
            <div><dt>浏览 / 收藏</dt><dd>{{ item.viewCount }} / {{ item.favoriteCount }}</dd></div>
          </dl>
          <div v-if="!item.mine" class="buy-actions">
            <el-button v-if="item.listingType==='sell'" :disabled="!auth.isLoggedIn" @click="startConversation">联系卖家</el-button>
            <el-button v-if="item.listingType==='sell'" type="primary" :disabled="!auth.isLoggedIn || item.status!=='active'" @click="offerOpen=true">{{ item.negotiable?'出价购买':'立即购买' }}</el-button>
            <el-button v-else type="primary" :disabled="!auth.isLoggedIn || item.status!=='active'" @click="startConversation">我有这个，联系求购者</el-button>
            <el-button circle :icon="item.favorited?StarFilled:Star" @click="favorite" />
          </div>
          <div v-else class="buy-actions"><el-button type="primary" @click="$router.push({name:'market-edit',params:{id:item.id}})">编辑{{ item.listingType==='wanted'?'求购':'商品' }}</el-button><el-button @click="$router.push({name:'market-mine',query:{tab:'selling'}})">管理{{ item.listingType==='wanted'?'响应':'购买意向' }}</el-button><el-button type="danger" plain @click="withdraw">{{ item.listingType==='wanted'?'结束求购':'下架' }}</el-button></div>
          <p v-if="!auth.isLoggedIn" class="login-tip">登录校园账号后即可联系、收藏和参与交易。</p>
          <div class="payment-note"><b>{{ item.listingType==='wanted'?'求购说明':'平台交易' }}</b><span>{{ item.listingType==='wanted'?'如果你有符合要求的商品，请先联系求购者沟通成色、价格与交付方式。':'卖家接受购买意向后，通过本站配置的易支付完成付款；订单、退款与结算全程留痕。' }}</span></div>
        </div>
      </section>

      <section class="content-grid">
        <article class="description-card cpu-card"><h2>{{ item.listingType==='wanted'?'求购详情':'商品详情' }}</h2><div class="description">{{ item.description }}</div><div class="public-actions"><el-button v-if="item.topicId" plain @click="$router.push(`/forum/topic/${item.topicId}`)">公开问答 {{ item.topic?.replyCount||0 }}</el-button><el-button plain @click="share">分享{{ item.listingType==='wanted'?'求购':'商品' }}</el-button><el-button v-if="!item.mine&&auth.isLoggedIn" text type="danger" @click="reportOpen=true">举报信息</el-button></div></article>
        <aside class="seller-card cpu-card"><div class="seller-head"><UserAvatar :size="52" :src="item.seller.avatar" :name="item.seller.nickname" /><div><strong>{{ item.seller.nickname||`用户 #${item.seller.id}` }}</strong><span>✓ 校园统一认证</span></div></div><div class="seller-stats"><div><b>{{ Number(item.sellerRating||0).toFixed(1) }}</b><span>交易评分</span></div><div><b>{{ item.sellerReviewCount||0 }}</b><span>收到评价</span></div><div><b>{{ item.listingType==='wanted'?item.favoriteCount:item.offerCount }}</b><span>{{ item.listingType==='wanted'?'收藏关注':'购买意向' }}</span></div></div><p>{{ item.listingType==='wanted'?'沟通时请描述商品实际状况，确认价格与交付方式后再交易。':'建议在校园公共区域见面，确认商品状况后再完成交付确认。' }}</p></aside>
      </section>

      <section v-if="related.length" class="related"><header><h2>{{ item.listingType==='wanted'?'同类求购':'同类商品' }}</h2><router-link to="/market">查看更多</router-link></header><div class="related-grid"><article v-for="row in related" :key="row.id" @click="$router.push({name:'market-item',params:{id:row.id}})"><div><img v-if="row.cover" :src="row.cover" :alt="row.title" /><span v-else>📦</span></div><h3>{{ row.title }}</h3><strong>{{ row.listingType==='wanted'?'预算 ':'' }}¥{{ row.price }}</strong></article></div></section>
    </template>
    <el-empty v-else-if="!loading" description="商品不存在或已被下架"><el-button @click="$router.push('/market')">返回商城</el-button></el-empty>

    <el-dialog v-model="offerOpen" :title="item?.negotiable?'提交购买出价':'确认购买意向'" width="460px">
      <el-form label-position="top"><el-form-item label="购买价格"><el-input-number v-model="offer.price" :disabled="!item?.negotiable" :min="0.01" :max="999999" :precision="2" /></el-form-item><el-form-item label="给卖家留言"><el-input v-model="offer.message" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="可说明希望的交付时间和地点" /></el-form-item></el-form>
      <el-alert type="info" :closable="false" title="卖家接受后将生成待支付订单，请在 15 分钟内通过易支付完成付款。" />
      <template #footer><el-button @click="offerOpen=false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitOffer">提交意向</el-button></template>
    </el-dialog>

    <el-dialog v-model="messageOpen" :title="item?.listingType==='wanted'?'联系求购者':'联系卖家'" width="460px"><el-input v-model="firstMessage" type="textarea" :rows="5" maxlength="1000" show-word-limit :placeholder="item?.listingType==='wanted'?'说明你能提供的商品、成色和价格':'询问商品细节或交付方式'" /><template #footer><el-button @click="messageOpen=false">取消</el-button><el-button type="primary" :loading="submitting" @click="sendFirstMessage">发送</el-button></template></el-dialog>
    <el-dialog v-model="reportOpen" title="举报商品" width="460px"><el-select v-model="report.reason" placeholder="选择原因" style="width:100%"><el-option v-for="reason in reportReasons" :key="reason" :label="reason" :value="reason" /></el-select><el-input v-model="report.detail" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="补充说明" style="margin-top:12px" /><template #footer><el-button @click="reportOpen=false">取消</el-button><el-button type="danger" :loading="submitting" @click="submitReport">提交举报</el-button></template></el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Star, StarFilled } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { marketApi, type MarketItem } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";

const route=useRoute(),router=useRouter(),auth=useAuthStore();
const item=ref<MarketItem|null>(null),related=ref<MarketItem[]>([]),loading=ref(false),submitting=ref(false),activeImage=ref('');
const offerOpen=ref(false),messageOpen=ref(false),reportOpen=ref(false),firstMessage=ref('');
const offer=reactive({price:0,message:''}),report=reactive({reason:'',detail:''});
const reportReasons=['疑似诈骗','禁售或违规物品','商品信息虚假','盗用图片','恶意引流','其他'];
const categories=ref<Record<string,string>>({});
onMounted(load);watch(()=>route.params.id,load);
async function load(){const id=Number(route.params.id);if(!id)return;loading.value=true;try{const [nextItem,meta]=await Promise.all([marketApi.item(id,{suppressErrorMessage:true}),marketApi.meta({suppressErrorMessage:true})]);item.value=nextItem;categories.value=Object.fromEntries(meta.categories.map(category=>[category.slug,category.name]));activeImage.value=item.value.cover;offer.price=Number(item.value.price);const result=await marketApi.items({category:item.value.category,listingType:item.value.listingType,size:5},{suppressErrorMessage:true});related.value=result.list.filter(row=>row.id!==id).slice(0,4);}catch{item.value=null;}finally{loading.value=false;}}
async function favorite(){if(!item.value)return;if(!auth.isLoggedIn)return router.push({name:'login',query:{redirect:route.fullPath}});const result=await marketApi.favorite(item.value.id);item.value.favorited=result.favorited;item.value.favoriteCount=result.favoriteCount;}
function startConversation(){if(!auth.isLoggedIn)return router.push({name:'login',query:{redirect:route.fullPath}});messageOpen.value=true;}
async function sendFirstMessage(){if(!item.value||!firstMessage.value.trim())return ElMessage.warning('请输入消息');submitting.value=true;try{const conversation=await marketApi.createConversation(item.value.id,firstMessage.value.trim());messageOpen.value=false;router.push({name:'market-messages',query:{conversation:conversation.id}});}finally{submitting.value=false;}}
async function submitOffer(){if(!item.value)return;submitting.value=true;try{await marketApi.createOffer(item.value.id,offer);offerOpen.value=false;ElMessage.success('购买意向已发送，等待卖家确认');router.push({name:'market-mine',query:{tab:'offers'}});}finally{submitting.value=false;}}
async function withdraw(){if(!item.value)return;const wanted=item.value.listingType==='wanted';await ElMessageBox.confirm(wanted?'结束后该求购将不再出现在商城列表，确定继续？':'下架后商品将不再出现在商城列表，确定继续？',wanted?'结束求购':'下架商品',{type:'warning'});await marketApi.removeItem(item.value.id);ElMessage.success(wanted?'求购已结束':'商品已下架');router.replace('/market/mine?tab=selling');}
async function submitReport(){if(!item.value||!report.reason)return ElMessage.warning('请选择举报原因');submitting.value=true;try{await marketApi.report(item.value.id,report);reportOpen.value=false;ElMessage.success('举报已提交');}finally{submitting.value=false;}}
async function share(){await navigator.clipboard.writeText(location.href).catch(()=>null);ElMessage.success('商品链接已复制');}
function categoryLabel(v:string){return categories.value[v]||v}function conditionLabel(v:string){return({new:'全新',like_new:'近全新',good:'使用良好',fair:'有使用痕迹',wanted:'求购'} as Record<string,string>)[v]||v}function tradeModeLabel(v:string){return({meetup:'校园面交',shipping:'邮寄',both:'面交或邮寄',online:'线上发货'} as Record<string,string>)[v]||v}function statusLabel(v:string,listingType:string){if(listingType==='wanted')return({draft:'草稿',reviewing:'审核中',active:'求购中',reserved:'洽谈中',sold:'已求到',withdrawn:'已结束',hidden:'已隐藏'} as Record<string,string>)[v]||v;return({draft:'草稿',reviewing:'审核中',active:'在售',reserved:'已预订',sold:'已售出',withdrawn:'已下架',hidden:'已隐藏'} as Record<string,string>)[v]||v}
</script>

<style scoped>
.detail-page{display:flex;flex-direction:column;gap:17px}.crumb{display:flex;gap:8px;align-items:center;color:var(--cpu-text-secondary);font-size:12px}.crumb a{color:var(--cpu-primary);text-decoration:none}.crumb b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.product-card{display:grid;grid-template-columns:minmax(360px,1fr) minmax(370px,.9fr);gap:34px;padding:26px}.main-image{aspect-ratio:1.12/1;display:grid;place-items:center;overflow:hidden;border-radius:14px;background:var(--cpu-surface-soft);font-size:70px}.main-image img{width:100%;height:100%;object-fit:contain}.thumb-list{display:flex;gap:8px;margin-top:10px;overflow-x:auto}.thumb-list button{width:66px;height:58px;padding:0;overflow:hidden;border:2px solid transparent;border-radius:8px;background:none}.thumb-list button.active{border-color:var(--cpu-primary)}.thumb-list img{width:100%;height:100%;object-fit:cover}.status-line{display:flex;gap:7px}.status-line span,.status-line em{padding:4px 7px;border-radius:5px;color:#0f766e;background:#ecfdf5;font-size:10px;font-style:normal}.status-line em{color:#475569;background:#e2e8f0}.status-line .status-active{color:#047857;background:#d1fae5}.status-line .status-reserved{color:#b45309;background:#fef3c7}.product-info h1{margin:13px 0;font-size:25px;line-height:1.4}.price-box{display:flex;align-items:baseline;gap:10px;padding:15px;border-radius:11px;background:linear-gradient(90deg,#fff1f2,#fff)}.price-box strong{color:#ef4444;font-size:32px}.price-box small{font-size:14px}.price-box del{color:#94a3b8;font-size:12px}.price-box i{padding:3px 7px;border-radius:5px;color:#b45309;background:#fef3c7;font-size:10px;font-style:normal}.product-info dl{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:16px 0}.product-info dl div{display:flex;gap:12px;padding:9px 3px;border-bottom:1px dashed var(--cpu-border-soft);font-size:12px}.product-info dt{color:var(--cpu-text-secondary)}.product-info dd{margin:0;font-weight:600}.buy-actions{display:flex;gap:9px}.buy-actions .el-button:nth-child(2){flex:1}.login-tip{color:#b45309;font-size:11px}.payment-note{display:flex;gap:9px;margin-top:14px;padding:10px;border-radius:9px;color:#0f766e;background:#ecfdf5;font-size:10px}.payment-note span{color:#3f6f67;line-height:1.5}.content-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:17px}.description-card,.seller-card{padding:22px}.description-card h2{margin:0 0 16px;font-size:18px}.description{min-height:160px;white-space:pre-wrap;line-height:1.8;font-size:14px}.public-actions{display:flex;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--cpu-border-soft)}.seller-head{display:flex;align-items:center;gap:12px}.seller-head div{display:flex;flex-direction:column;gap:5px}.seller-head span{color:#0f766e;font-size:10px}.seller-stats{display:grid;grid-template-columns:repeat(3,1fr);margin:18px 0}.seller-stats div{display:flex;align-items:center;flex-direction:column;border-right:1px solid var(--cpu-border-soft)}.seller-stats div:last-child{border:0}.seller-stats b{font-size:18px}.seller-stats span{color:var(--cpu-text-secondary);font-size:9px}.seller-card p{margin:0;padding:10px;border-radius:8px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:10px;line-height:1.6}.related header{display:flex;align-items:center;justify-content:space-between}.related header a{color:var(--cpu-primary);font-size:12px}.related-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.related-grid article{padding:10px;border:1px solid var(--cpu-border-soft);border-radius:12px;background:var(--cpu-card);cursor:pointer}.related-grid article>div{height:130px;display:grid;place-items:center;overflow:hidden;border-radius:8px;background:var(--cpu-surface-soft);font-size:40px}.related-grid img{width:100%;height:100%;object-fit:cover}.related-grid h3{height:36px;margin:8px 0 3px;overflow:hidden;font-size:12px}.related-grid strong{color:#ef4444}@media(max-width:850px){.product-card{grid-template-columns:1fr;padding:16px}.content-grid{grid-template-columns:1fr}.related-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.main-image{aspect-ratio:1}.product-info dl{grid-template-columns:1fr}.buy-actions{position:sticky;bottom:8px;z-index:5;padding:8px;border-radius:10px;background:var(--cpu-card);box-shadow:0 6px 24px rgba(0,0,0,.16)}.product-info h1{font-size:21px}.price-box strong{font-size:28px}}
.status-line span{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.status-line em{color:var(--cpu-text-secondary);background:var(--cpu-surface-soft)}.status-line .status-active{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.price-box{background:linear-gradient(90deg,var(--cpu-primary-soft),var(--cpu-card))}.payment-note{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.payment-note span{color:var(--cpu-text-secondary)}
:global(html[data-theme="dark"]) .price-box{box-shadow:inset 0 0 0 1px var(--cpu-border-soft)}
:global(html[data-theme="dark"]) .status-line .status-reserved,:global(html[data-theme="dark"]) .price-box i{color:#fbbf24;background:rgba(245,158,11,.16)}
</style>
