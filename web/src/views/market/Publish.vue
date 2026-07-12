<template>
  <div class="publish-page">
    <header class="page-head">
      <div><span>校园商城</span><h1>{{ editingId ? '编辑商品' : '发布商品' }}</h1><p>信息越完整，越容易快速成交。商品发布者必须完成校园统一认证。</p></div>
      <el-button @click="$router.push('/market')">返回商城</el-button>
    </header>

    <el-form label-position="top" class="publish-form cpu-card" v-loading="loading">
      <section>
        <h2>基本信息</h2>
        <div class="two-cols">
          <el-form-item label="发布类型"><el-segmented v-model="form.listingType" :options="[{label:'出售',value:'sell'},{label:'求购',value:'wanted'}]" block /></el-form-item>
          <el-form-item label="商品品类"><el-select v-model="form.category"><el-option v-for="item in categories" :key="item.slug" :label="`${item.icon} ${item.name}`" :value="item.slug" /></el-select></el-form-item>
        </div>
        <el-form-item label="商品标题" required><el-input v-model="form.title" maxlength="120" show-word-limit placeholder="品牌 / 型号 / 关键信息" /></el-form-item>
        <el-form-item label="商品描述" required><el-input v-model="form.description" type="textarea" :rows="8" maxlength="20000" show-word-limit placeholder="介绍购买时间、使用情况、配件、瑕疵和交易要求，请勿公开填写敏感个人信息。" /></el-form-item>
      </section>

      <section>
        <h2>商品图片 <el-tag size="small" :type="requiresImage?'danger':'info'">{{ requiresImage?'必填':'选填' }}</el-tag></h2>
        <p class="section-note">{{ requiresImage?'该品类出售时至少需要 1 张图片。':'此发布类型可不上传图片；如有封面、预览或实物图，建议添加。' }} 最多 9 张，第一张作为商城主图。</p>
        <div class="image-grid">
          <div v-for="(url,index) in form.images" :key="url" class="image-cell">
            <img :src="url" alt="商品图片" /><span v-if="index===0">主图</span><button type="button" @click="form.images.splice(index,1)">×</button>
          </div>
          <label v-if="form.images.length<9" class="upload-cell" :class="{ disabled: uploading }">
            <input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" />
            <el-icon :class="{ 'is-loading': uploading }"><Loading v-if="uploading" /><Plus v-else /></el-icon>
            <b>{{ uploading ? `上传中 ${uploadProgress}%` : '添加图片' }}</b>
          </label>
        </div>
      </section>

      <section v-if="isDigital && form.listingType === 'sell'">
        <h2>线上交付</h2>
        <p class="section-note">买家付款成功后，系统自动在订单内展示此内容。商品详情页和未付款订单不会看到。</p>
        <el-form-item label="交付内容" :required="!hasExistingDigitalDelivery">
          <el-input v-model="form.digitalDelivery" type="textarea" :rows="6" maxlength="10000" show-word-limit :placeholder="hasExistingDigitalDelivery ? '已保存交付内容；留空表示保持不变' : '填写下载链接、提取码和使用说明。请确保链接长期有效。'" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon title="交付内容在服务器加密保存，仅向已付款买家、卖家本人和商城管理员开放。" />
      </section>

      <section>
        <h2>价格与成色</h2>
        <div class="three-cols">
          <el-form-item label="售价（元）" required><el-input-number v-model="form.price" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
          <el-form-item label="原价（可选）"><el-input-number v-model="form.originalPrice" :min="0" :max="999999" :precision="2" :step="10" controls-position="right" /></el-form-item>
          <el-form-item label="商品成色"><el-select v-model="form.condition"><el-option v-for="item in conditions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        </div>
        <el-checkbox v-model="form.negotiable">接受买家议价</el-checkbox>
      </section>

      <section v-if="!isDigital">
        <h2>交付信息</h2>
        <div class="three-cols">
          <el-form-item label="交付方式"><el-select v-model="form.tradeMode"><el-option label="校园面交" value="meetup" /><el-option label="邮寄" value="shipping" /><el-option label="面交或邮寄" value="both" /></el-select></el-form-item>
          <el-form-item label="校区"><el-input v-model="form.campus" maxlength="40" placeholder="填写所在校区" /></el-form-item>
          <el-form-item label="推荐地点"><el-input v-model="form.location" maxlength="100" placeholder="建议填写公共区域" /></el-form-item>
        </div>
      </section>

      <el-alert type="warning" :closable="false" show-icon title="禁止发布违法违规物品、账号、处方药、考试作弊资料、危险品、侵权文件或来源不明商品。" />
      <footer class="form-actions">
        <el-button :loading="submitting" @click="submit(true)">保存草稿</el-button>
        <el-button type="primary" :loading="submitting" @click="submit(false)">{{ editingId ? '保存并上架' : '发布商品' }}</el-button>
      </footer>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Loading, Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { marketApi, type MarketCategory, type MarketCategoryOption, type MarketCondition, type MarketItemInput, type MarketListingType, type MarketTradeMode } from "@/api/market";
import { uploadApi } from "@/api/topic";
import { isAndroidNativeApp } from "@/utils/clientInfo";

const route = useRoute();
const router = useRouter();
const editingId = Number(route.params.id || 0);
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const categories = ref<MarketCategoryOption[]>([]);
const hasExistingDigitalDelivery = ref(false);
const conditions = [{label:'全新',value:'new'},{label:'近全新',value:'like_new'},{label:'使用良好',value:'good'},{label:'有使用痕迹',value:'fair'}];
const form = reactive<{listingType:MarketListingType;title:string;description:string;category:MarketCategory;price:number;originalPrice:number|undefined;negotiable:boolean;condition:MarketCondition;tradeMode:MarketTradeMode;campus:string;location:string;images:string[];digitalDelivery:string}>({ listingType:'sell',title:'',description:'',category:'other',price:0,originalPrice:undefined,negotiable:false,condition:'good',tradeMode:'meetup',campus:'',location:'',images:[],digitalDelivery:'' });
const selectedCategory = computed(() => categories.value.find((item) => item.slug === form.category));
const isDigital = computed(() => selectedCategory.value?.fulfillmentType === 'digital');
const requiresImage = computed(() => form.listingType === 'sell' && Boolean(selectedCategory.value?.imageRequired));
watch(isDigital, (value) => { if (value) form.tradeMode = 'online'; else if (form.tradeMode === 'online') form.tradeMode = 'meetup'; });

onMounted(async()=>{loading.value=true;try{const meta=await marketApi.meta({suppressErrorMessage:true});categories.value=meta.categories;if(!categories.value.some(item=>item.slug===form.category)&&categories.value.length)form.category=categories.value[0].slug;if(!editingId)return;const item=await marketApi.item(editingId);if(!item.mine){ElMessage.error('无权编辑该商品');return router.replace('/market');}hasExistingDigitalDelivery.value=item.hasDigitalDelivery;Object.assign(form,{listingType:item.listingType,title:item.title,description:item.description,category:item.category,price:Number(item.price),originalPrice:item.originalPrice?Number(item.originalPrice):undefined,negotiable:item.negotiable,condition:item.condition,tradeMode:item.tradeMode,campus:item.campus,location:item.location,images:item.images.map(i=>i.url)});}finally{loading.value=false;}});

async function uploadImages(event:Event){const input=event.target as HTMLInputElement;const files=Array.from(input.files||[]).slice(0,9-form.images.length);if(!files.length)return;uploading.value=true;try{for(let i=0;i<files.length;i++){const file=files[i];const result=await uploadApi.media(file,file.name,{forceProxy:isAndroidNativeApp(),onProgress:s=>{uploadProgress.value=Math.round(((i+s.percent/100)/files.length)*100);}});form.images.push(result.url);}}catch(e){ElMessage.error(e instanceof Error?e.message:'图片上传失败');}finally{uploading.value=false;uploadProgress.value=0;input.value='';}}
function validate(draft=false){if(form.title.trim().length<2){ElMessage.warning('请填写商品标题');return false;}if(!form.description.trim()){ElMessage.warning('请填写商品描述');return false;}if(form.price<0){ElMessage.warning('价格不能小于 0');return false;}if(!draft&&requiresImage.value&&!form.images.length){ElMessage.warning('该品类出售时至少需要上传一张图片');return false;}if(!draft&&isDigital.value&&form.listingType==='sell'&&!form.digitalDelivery.trim()&&!hasExistingDigitalDelivery.value){ElMessage.warning('请填写电子资料的线上交付内容');return false;}return true;}
async function submit(draft:boolean){if(!validate(draft)||submitting.value)return;submitting.value=true;try{const payload:MarketItemInput={...form,price:form.price,originalPrice:form.originalPrice,draft};const item=editingId?await marketApi.updateItem(editingId,{...payload,status:draft?'draft':'active'}):await marketApi.createItem(payload);ElMessage.success(draft?'草稿已保存':item.status==='reviewing'?'商品已提交审核':'商品已发布');router.replace({name:'market-item',params:{id:item.id}});}finally{submitting.value=false;}}
</script>

<style scoped>
.publish-page{max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head{display:flex;justify-content:space-between;align-items:flex-end}.page-head span{color:var(--cpu-primary);font-size:11px;letter-spacing:.12em}.page-head h1{margin:5px 0;font-size:28px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.publish-form{padding:26px}.publish-form section+section{margin-top:28px;padding-top:23px;border-top:1px solid var(--cpu-border-soft)}.publish-form h2{margin:0 0 15px;font-size:17px}.section-note{margin:-8px 0 13px;color:var(--cpu-text-secondary);font-size:11px}.two-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.three-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.image-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;border-radius:11px;overflow:hidden;background:var(--cpu-surface-soft)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell span{position:absolute;left:6px;bottom:6px;padding:2px 5px;border-radius:4px;color:#fff;background:#168776;font-size:9px}.image-cell button{position:absolute;right:5px;top:5px;width:24px;height:24px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.68);cursor:pointer}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);cursor:pointer}.upload-cell input{display:none}.upload-cell .el-icon{font-size:24px}.upload-cell b{font-size:11px}.form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:20px;border-top:1px solid var(--cpu-border-soft)}@media(max-width:700px){.page-head{align-items:flex-start;flex-direction:column;gap:12px}.publish-form{padding:16px}.two-cols,.three-cols{grid-template-columns:1fr}.image-grid{grid-template-columns:repeat(3,1fr)}.form-actions .el-button{flex:1}}
</style>
