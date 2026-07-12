<template>
  <div class="market-page">
    <section class="market-hero">
      <div>
        <span class="eyebrow">药大拾间 · MARKET</span>
        <h1>校园商城</h1>
        <p>实体好物与电子资料一站选购，支持站内沟通、平台支付、线上或线下交付。</p>
      </div>
      <div class="hero-actions">
        <el-button v-if="auth.isLoggedIn" @click="$router.push({ name: 'market-mine' })">我的订单</el-button>
        <el-button v-if="auth.isLoggedIn" @click="$router.push({ name: 'market-seller' })">卖家中心</el-button>
        <el-button v-if="auth.isLoggedIn" type="primary" @click="$router.push({ name: 'market-publish' })">
          <el-icon><Plus /></el-icon> 发布商品
        </el-button>
        <el-button v-else type="primary" @click="$router.push({ name: 'login', query: { redirect: '/market' } })">登录后交易</el-button>
      </div>
    </section>

    <section class="search-bar cpu-card">
      <el-input v-model="filters.q" clearable size="large" placeholder="搜索商品、教材、课程代码或地点" @keyup.enter="search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button type="primary" size="large" @click="search">搜索</el-button>
    </section>

    <section class="category-strip" aria-label="商品分类">
      <button
        v-for="category in categories"
        :key="category.slug"
        type="button"
        :class="{ active: filters.category === category.slug }"
        @click="selectCategory(category.slug)"
      >
        <span>{{ category.icon }}</span>
        <b>{{ category.name }}</b>
      </button>
    </section>

    <section class="market-body">
      <aside class="filter-panel cpu-card">
        <div class="filter-title"><strong>筛选商品</strong><button type="button" @click="resetFilters">重置</button></div>
        <label>发布类型</label>
        <el-segmented v-model="filters.listingType" :options="listingOptions" block />
        <label>价格区间</label>
        <div class="price-range">
          <el-input-number v-model="filters.minPrice" :min="0" :controls="false" placeholder="最低" />
          <span>—</span>
          <el-input-number v-model="filters.maxPrice" :min="0" :controls="false" placeholder="最高" />
        </div>
        <label>成色</label>
        <el-select v-model="filters.condition" clearable placeholder="全部成色">
          <el-option v-for="item in conditionOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <label>交付方式</label>
        <el-select v-model="filters.tradeMode" clearable placeholder="全部方式">
          <el-option label="校园面交" value="meetup" />
          <el-option label="邮寄" value="shipping" />
          <el-option label="面交或邮寄" value="both" />
          <el-option label="线上发货" value="online" />
        </el-select>
        <label>校区</label>
        <el-input v-model="filters.campus" clearable placeholder="输入校区" />
        <el-button type="primary" plain @click="search">应用筛选</el-button>
        <div class="trust-note">
          <b>校园交易保障</b>
          <span>统一认证账号 · 易支付验签 · 订单留痕 · 举报处理</span>
        </div>
      </aside>

      <main class="goods-area">
        <div class="goods-toolbar">
          <div>
            <h2>{{ activeCategoryLabel }}</h2>
            <span>{{ total }} 件商品</span>
          </div>
          <el-select v-model="filters.sort" class="sort-select" @change="search">
            <el-option label="最新发布" value="new" />
            <el-option label="人气优先" value="popular" />
            <el-option label="价格从低到高" value="price_asc" />
            <el-option label="价格从高到低" value="price_desc" />
          </el-select>
        </div>

        <div v-if="loading" class="goods-grid">
          <article v-for="i in 8" :key="i" class="goods-card skeleton-card"><el-skeleton animated><template #template><el-skeleton-item variant="image" class="skeleton-image" /><el-skeleton-item variant="h3" /><el-skeleton-item variant="text" /></template></el-skeleton></article>
        </div>
        <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error"><template #default><el-button size="small" @click="load">重试</el-button></template></el-alert>
        <div v-else-if="items.length" class="goods-grid">
          <article v-for="item in items" :key="item.id" class="goods-card" @click="$router.push({ name: 'market-item', params: { id: item.id } })">
            <div class="cover-wrap">
              <img v-if="item.cover" :src="item.cover" :alt="item.title" loading="lazy" />
              <div v-else class="cover-empty">{{ categoryIcon(item.category) }}</div>
              <span v-if="item.listingType === 'wanted'" class="wanted-badge">求购</span>
              <span v-if="item.status === 'reserved'" class="status-badge">{{ item.listingType==='wanted'?'洽谈中':'已预订' }}</span>
              <button v-if="auth.isLoggedIn" type="button" class="favorite-btn" :class="{ active: item.favorited }" @click.stop="toggleFavorite(item)">
                <el-icon><StarFilled v-if="item.favorited" /><Star v-else /></el-icon>
              </button>
            </div>
            <div class="goods-copy">
              <h3>{{ item.title }}</h3>
              <div class="price-line">
                <span v-if="item.listingType==='wanted'" class="budget-prefix">预算</span>
                <strong><small>¥</small>{{ item.price }}</strong>
                <del v-if="item.originalPrice">¥{{ item.originalPrice }}</del>
                <em v-if="item.negotiable">可议价</em>
              </div>
              <div class="item-tags">
                <span>{{ conditionLabel(item.condition) }}</span>
                <span>{{ tradeModeLabel(item.tradeMode) }}</span>
                <span v-if="item.campus">{{ item.campus }}</span>
              </div>
              <div class="seller-line">
                <UserAvatar :size="25" :src="item.seller?.avatar" :name="item.seller?.nickname" />
                <span>{{ item.seller?.nickname || `用户 #${item.seller?.id}` }}</span>
                <i>已认证</i>
                <time>{{ fmtRelative(item.createdAt) }}</time>
              </div>
            </div>
          </article>
        </div>
        <el-empty v-else description="没有找到符合条件的商品"><el-button type="primary" plain @click="resetFilters">清空筛选</el-button></el-empty>

        <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" background @current-change="load" />
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Plus, Search, Star, StarFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { marketApi, type MarketCategoryOption, type MarketItem } from "@/api/market";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";

const auth = useAuthStore();
const items = ref<MarketItem[]>([]);
const loading = ref(false);
const error = ref("");
const total = ref(0);
const page = ref(1);
const pageSize = 24;
let requestSeq = 0;

const categories = ref<Array<MarketCategoryOption & { slug: string }>>([{ id: 0, slug: "", name: "全部商品", icon: "🛍️", description: "", fulfillmentType: "physical", imageRequired: false, enabled: true, sort: 0 }]);
const listingOptions = [{ label: "全部", value: "" }, { label: "出售", value: "sell" }, { label: "求购", value: "wanted" }];
const conditionOptions = [{ label: "全新", value: "new" }, { label: "近全新", value: "like_new" }, { label: "使用良好", value: "good" }, { label: "有使用痕迹", value: "fair" }];
const filters = reactive({ q: "", category: "", listingType: "", condition: "", tradeMode: "", campus: "", minPrice: undefined as number | undefined, maxPrice: undefined as number | undefined, sort: "new" as "new" | "popular" | "price_asc" | "price_desc" });
const activeCategoryLabel = computed(() => categories.value.find((item) => item.slug === filters.category)?.name || "全部商品");

onMounted(async () => {
  try {
    const meta = await marketApi.meta({ suppressErrorMessage: true });
    categories.value = [categories.value[0], ...meta.categories];
  } catch { /* 商品列表仍可独立加载 */ }
  await load();
});

async function load() {
  const seq = ++requestSeq;
  loading.value = true;
  error.value = "";
  try {
    const result = await marketApi.items({ page: page.value, size: pageSize, ...filters }, { suppressErrorMessage: true });
    if (seq !== requestSeq) return;
    items.value = result.list;
    total.value = result.total;
  } catch (reason) {
    if (seq !== requestSeq) return;
    items.value = [];
    error.value = reason instanceof Error ? reason.message : "商品加载失败";
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function search() { page.value = 1; void load(); }
function selectCategory(value: string) { filters.category = value; search(); }
function resetFilters() { Object.assign(filters, { q: "", category: "", listingType: "", condition: "", tradeMode: "", campus: "", minPrice: undefined, maxPrice: undefined, sort: "new" }); search(); }
async function toggleFavorite(item: MarketItem) {
  try {
    const result = await marketApi.favorite(item.id);
    item.favorited = result.favorited;
    item.favoriteCount = result.favoriteCount;
  } catch { ElMessage.error("收藏操作失败"); }
}
function conditionLabel(value: string) { return ({ new: "全新", like_new: "近全新", good: "使用良好", fair: "有使用痕迹", wanted: "求购" } as Record<string, string>)[value] || value; }
function tradeModeLabel(value: string) { return ({ meetup: "校园面交", shipping: "邮寄", both: "面交/邮寄", online: "线上发货" } as Record<string, string>)[value] || value; }
function categoryIcon(value: string) { return categories.value.find((item) => item.slug === value)?.icon || "📦"; }
</script>

<style scoped>
.market-page{display:flex;flex-direction:column;gap:18px}.market-hero{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:30px 34px;border-radius:18px;color:#fff;background:linear-gradient(125deg,#0f766e,#16977f 55%,#2563eb)}.market-hero:after{content:"";position:absolute;right:-70px;top:-110px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,.11)}.market-hero>div{position:relative;z-index:1}.eyebrow{font-size:11px;letter-spacing:.16em;opacity:.8}.market-hero h1{margin:7px 0;font-size:30px}.market-hero p{margin:0;opacity:.88}.hero-actions{display:flex;gap:10px}.search-bar{display:flex;gap:10px;padding:14px}.search-bar .el-input{flex:1}.category-strip{display:grid;grid-template-columns:repeat(9,1fr);gap:9px}.category-strip button{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;padding:12px 7px;border:1px solid var(--cpu-border-soft);border-radius:12px;color:var(--cpu-text);background:var(--cpu-card);cursor:pointer}.category-strip button:hover,.category-strip button.active{color:var(--cpu-primary);border-color:var(--cpu-primary);background:var(--cpu-primary-soft)}.category-strip span{font-size:19px}.category-strip b{font-size:12px;white-space:nowrap}.market-body{display:grid;grid-template-columns:230px minmax(0,1fr);gap:18px}.filter-panel{align-self:start;position:sticky;top:82px;display:flex;flex-direction:column;gap:10px;padding:17px}.filter-title{display:flex;justify-content:space-between;margin-bottom:4px}.filter-title button{border:0;color:var(--cpu-primary);background:none;cursor:pointer}.filter-panel label{margin-top:5px;color:var(--cpu-text-secondary);font-size:12px}.price-range{display:flex;align-items:center;gap:5px}.price-range .el-input-number{width:86px}.trust-note{display:flex;flex-direction:column;gap:5px;margin-top:8px;padding:11px;border-radius:10px;color:#0f766e;background:#ecfdf5}.trust-note b{font-size:12px}.trust-note span{font-size:10px;line-height:1.5}.goods-area{min-width:0}.goods-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.goods-toolbar h2{display:inline;margin:0 9px 0 0;font-size:20px}.goods-toolbar span{color:var(--cpu-text-secondary);font-size:12px}.sort-select{width:150px}.goods-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.goods-card{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-card);cursor:pointer;transition:.18s}.goods-card:hover{transform:translateY(-3px);border-color:rgba(22,135,118,.45);box-shadow:0 12px 28px rgba(15,23,42,.09)}.cover-wrap{position:relative;aspect-ratio:1.18/1;overflow:hidden;background:var(--cpu-surface-soft)}.cover-wrap img{width:100%;height:100%;object-fit:cover;transition:transform .25s}.goods-card:hover img{transform:scale(1.035)}.cover-empty{height:100%;display:grid;place-items:center;font-size:54px}.wanted-badge,.status-badge{position:absolute;left:9px;top:9px;padding:4px 8px;border-radius:7px;color:#fff;background:#f59e0b;font-size:10px;font-weight:700}.status-badge{background:#64748b}.wanted-badge+.status-badge{top:38px}.favorite-btn{position:absolute;right:9px;top:9px;width:32px;height:32px;border:0;border-radius:50%;color:#64748b;background:rgba(255,255,255,.88);cursor:pointer}.favorite-btn.active{color:#ef4444}.goods-copy{padding:12px}.goods-copy h3{height:40px;margin:0;font-size:14px;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.price-line{display:flex;align-items:baseline;gap:7px;margin:8px 0}.price-line strong{color:#ef4444;font-size:23px}.price-line small{font-size:12px}.price-line del{color:#94a3b8;font-size:11px}.price-line em{padding:2px 5px;border-radius:4px;color:#b45309;background:#fef3c7;font-size:9px;font-style:normal}.item-tags{display:flex;gap:5px;overflow:hidden}.item-tags span{flex:0 0 auto;padding:3px 6px;border-radius:5px;color:var(--cpu-text-secondary);background:var(--cpu-surface-soft);font-size:9px}.seller-line{display:flex;align-items:center;gap:6px;margin-top:11px;color:var(--cpu-text-secondary);font-size:10px}.seller-line i{padding:1px 4px;border-radius:4px;color:#0f766e;background:#ecfdf5;font-style:normal}.seller-line time{margin-left:auto}.skeleton-card{padding-bottom:12px}.skeleton-image{width:100%;height:180px;margin-bottom:12px}.el-pagination{justify-content:center;margin-top:22px}
@media(max-width:1200px){.category-strip{grid-template-columns:repeat(5,1fr)}.goods-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:850px){.market-hero{align-items:flex-start;flex-direction:column;padding:24px}.market-hero h1{font-size:25px}.hero-actions{width:100%}.hero-actions .el-button{flex:1}.category-strip{display:flex;overflow-x:auto}.category-strip button{flex:0 0 105px}.market-body{grid-template-columns:1fr}.filter-panel{position:static;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.filter-title,.filter-panel .trust-note,.filter-panel>.el-button{grid-column:1/-1}.goods-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.market-page{gap:13px}.search-bar{padding:10px}.search-bar>.el-button{display:none}.filter-panel{padding:13px}.goods-grid{gap:9px}.goods-card{border-radius:11px}.goods-copy{padding:9px}.goods-copy h3{font-size:13px}.price-line strong{font-size:20px}.seller-line i{display:none}.goods-toolbar h2{font-size:18px}.sort-select{width:130px}}
.budget-prefix{padding:2px 5px;border-radius:4px;color:#0f766e;background:#ecfdf5;font-size:9px;font-weight:700}
.trust-note,.seller-line i,.budget-prefix{color:var(--cpu-primary);background:var(--cpu-primary-soft)}.favorite-btn{color:var(--cpu-text-secondary);background:var(--cpu-card);box-shadow:0 2px 9px rgba(15,23,42,.12)}
:global(html[data-theme="dark"]) .goods-card:hover{box-shadow:0 12px 28px rgba(0,0,0,.34)}
:global(html[data-theme="dark"]) .price-line em{color:#fbbf24;background:rgba(245,158,11,.16)}
</style>
