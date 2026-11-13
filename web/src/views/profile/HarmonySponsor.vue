<template>
  <main class="pk-page pk-page--narrow hs-page" :aria-busy="loading || busy">
    <header class="pk-head">
      <router-link class="pk-back" to="/profile"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>我的</router-link>
      <div class="pk-title">
        <span class="pk-tile" style="--tone: #e11d48" aria-hidden="true"><el-icon><Present /></el-icon></span>
        <div class="pk-title-copy">
          <h1>{{ options?.title || "支持拾间" }}</h1>
          <p>已赞助 ¥{{ sponsoredAmount }}</p>
        </div>
      </div>
    </header>

    <section v-if="loading" class="pk-card hs-state" role="status">正在加载…</section>

    <section v-else-if="loadError" class="pk-card hs-state" role="alert">
      <p>{{ loadError }}</p>
      <button data-cpu-button="primary" type="button" class="hs-primary" @click="load">重试</button>
    </section>

    <template v-else-if="options">
      <section v-if="result" class="pk-card hs-result" role="status">
        <span class="hs-result-mark" aria-hidden="true"><el-icon><Check /></el-icon></span>
        <div>
          <h2 class="pk-h2">谢谢你的支持</h2>
          <p class="pk-muted">
            已为“{{ result.categoryTitle }}”赞助 ¥{{ result.amount }}<template v-if="result.points > 0">，获得 {{ result.points }} 个 AI 点数</template>。VIP 已开通。
          </p>
        </div>
      </section>

      <section v-if="pendingNotice" class="pk-card hs-state" role="alert">
        <p>{{ pendingNotice }}</p>
        <button data-cpu-button="primary" type="button" class="hs-primary" :disabled="busy" @click="retryDelivery">
          {{ busy ? "正在确认…" : "重新确认" }}
        </button>
      </section>

      <section v-if="unavailableText" class="pk-card hs-state" role="status">
        <p>{{ unavailableText }}</p>
      </section>

      <template v-else>
        <section class="pk-card" aria-labelledby="hs-amount-title">
          <h2 id="hs-amount-title" class="pk-h2">选择金额</h2>
          <p v-if="options.description" class="pk-muted hs-description">{{ options.description }}</p>
          <div class="hs-tiers" role="radiogroup" aria-labelledby="hs-amount-title">
            <button
              v-for="tier in tiers"
              :key="tier.productId"
              data-cpu-button="surface"
              type="button"
              role="radio"
              class="hs-tier"
              :class="{ 'is-on': tier.productId === productId }"
              :aria-checked="tier.productId === productId"
              :disabled="busy"
              @click="productId = tier.productId"
            >
              <b>{{ tier.price }}</b>
              <small v-if="tier.assistantPoints > 0">{{ tier.assistantPoints }} AI 点数</small>
            </button>
          </div>
          <p class="pk-muted hs-benefit">赞助后开通 VIP，并按金额获得 AI 点数。</p>
        </section>

        <section v-if="acceptingCategories.length > 1" class="pk-card" aria-labelledby="hs-category-title">
          <h2 id="hs-category-title" class="pk-h2">支持什么</h2>
          <div class="hs-categories" role="radiogroup" aria-labelledby="hs-category-title">
            <button
              v-for="category in acceptingCategories"
              :key="category.id"
              data-cpu-button="surface"
              type="button"
              role="radio"
              class="hs-category"
              :class="{ 'is-on': category.id === categoryId }"
              :aria-checked="category.id === categoryId"
              :disabled="busy"
              @click="categoryId = category.id"
            >
              <b>{{ category.title }}</b>
              <small v-if="category.description">{{ category.description }}</small>
              <small v-if="category.goalAmount">已筹 ¥{{ category.raisedAmount }} / ¥{{ category.goalAmount }}</small>
            </button>
          </div>
        </section>

        <section class="pk-card" aria-labelledby="hs-wall-title">
          <h2 id="hs-wall-title" class="pk-h2">赞助墙上怎么显示</h2>
          <div class="hs-modes" role="radiogroup" aria-labelledby="hs-wall-title">
            <button
              v-for="mode in displayModes"
              :key="mode.value"
              data-cpu-button="surface"
              type="button"
              role="radio"
              class="hs-mode"
              :class="{ 'is-on': mode.value === displayMode }"
              :aria-checked="mode.value === displayMode"
              :disabled="busy"
              @click="displayMode = mode.value"
            >{{ mode.label }}</button>
          </div>
          <label v-if="options.allowMessage && displayMode !== 'hidden'" class="hs-message">
            <span>留言（可不填）</span>
            <input v-model.trim="message" type="text" maxlength="80" placeholder="想说的一句话" :disabled="busy" />
          </label>
        </section>

        <div class="hs-action">
          <button data-cpu-button="primary" type="button" class="hs-primary hs-buy" :disabled="busy || !selectedTier" @click="buy">
            {{ busy ? busyText : selectedTier ? `赞助 ${selectedTier.price}` : "赞助" }}
          </button>
        </div>
      </template>

      <section v-if="orders.length" class="pk-card pk-card--flush" aria-labelledby="hs-orders-title">
        <h2 id="hs-orders-title" class="pk-h2 hs-list-title">我的赞助记录</h2>
        <ul class="pk-rows">
          <li v-for="order in orders" :key="order.id" class="pk-row hs-order">
            <span class="pk-row-copy">
              <b>{{ order.categoryTitle }}</b>
              <small>{{ formatDateTime(order.paidAt || order.createdAt) }}<template v-if="order.status === 'refunded'"> · 已退款</template></small>
            </span>
            <span class="hs-order-amount">¥{{ order.amount }}</span>
          </li>
        </ul>
      </section>

      <section v-if="options.wallEnabled && wall.length" class="pk-card pk-card--flush" aria-labelledby="hs-wall-list-title">
        <h2 id="hs-wall-list-title" class="pk-h2 hs-list-title">赞助墙</h2>
        <ul class="pk-rows">
          <li v-for="item in wall" :key="item.id" class="pk-row hs-order">
            <span class="pk-row-copy">
              <b>{{ item.anonymous || !item.user ? "匿名同学" : item.user.nickname }}</b>
              <small>{{ item.message || item.categoryTitle }}</small>
            </span>
            <span class="hs-order-amount">¥{{ item.amount }}</span>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { ArrowLeft, Check, Present } from "@element-plus/icons-vue";
import { paymentsApi, type HarmonySponsorOptions, type SponsorWallItem } from "@/api/payments";
import { useAuthStore } from "@/stores/auth";
import { HARMONY_IAP_CODE, harmonyIapErrorText, harmonyIapRequest } from "@/utils/harmonyIap";

/**
 * 鸿蒙 App 的应用内赞助页：固定档位，付款走华为应用内支付（IAP Kit）。
 * 页面上不出现支付方式的名字或图标（IAP Kit 接入规范），也不出现别的应用市场。
 *
 * 一笔购买的顺序：收银台付款 → 把 purchaseData 交给服务端验签记账 → 服务端成功后向 IAP Kit 确认发货。
 * 中途断掉的（已付款没确认发货）下次打开页面时从 IAP Kit 查出来补交，服务端对同一笔订单只记一次。
 */
type DisplayMode = "public" | "anonymous" | "hidden";

const auth = useAuthStore();
const loading = ref(true);
const loadError = ref("");
const options = ref<HarmonySponsorOptions | null>(null);
/** IAP Kit 返回的展示价格；查不到时用服务端的档位金额。 */
const localPrices = ref<Record<string, string>>({});
/** IAP Kit 查到的商品 ID；null 表示没查成，按服务端的档位全部显示。 */
const availableIds = ref<string[] | null>(null);
const environmentError = ref("");
const productId = ref("");
const categoryId = ref("");
const displayMode = ref<DisplayMode>("public");
const message = ref("");
const busy = ref(false);
const busyText = ref("");
const result = ref<{ amount: string; categoryTitle: string; points: number } | null>(null);
const pendingNotice = ref("");
const orders = ref<any[]>([]);
const wall = ref<SponsorWallItem[]>([]);

const displayModes: { value: DisplayMode; label: string }[] = [
  { value: "public", label: "显示昵称" },
  { value: "anonymous", label: "匿名" },
  { value: "hidden", label: "不上墙" },
];

const sponsoredAmount = computed(() => Number(auth.user?.sponsorAmount ?? 0).toFixed(2));
const acceptingCategories = computed(() => (options.value?.categories ?? []).filter((category) => category.accepting));
const tiers = computed(() => (options.value?.products ?? [])
  .filter((product) => availableIds.value === null || availableIds.value.includes(product.productId))
  .map((product) => ({ ...product, price: localPrices.value[product.productId] || `¥${Number(product.amount)}` })));
const selectedTier = computed(() => tiers.value.find((tier) => tier.productId === productId.value) ?? null);
const unavailableText = computed(() => {
  if (!options.value?.enabled) return "赞助暂未开放。";
  if (environmentError.value) return environmentError.value;
  if (!tiers.value.length) return "赞助暂未开放。";
  return "";
});

function formatDateTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function serverMessage(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  return response?.status && response.status < 500 ? response.data?.message || "" : "";
}

async function loadLists() {
  const [orderList, wallList] = await Promise.allSettled([
    paymentsApi.harmonySponsorOrders({ suppressErrorMessage: true }),
    paymentsApi.sponsorWall({ suppressErrorMessage: true }),
  ]);
  if (orderList.status === "fulfilled") orders.value = orderList.value.list ?? [];
  if (wallList.status === "fulfilled") wall.value = (wallList.value.list ?? []).slice(0, 12);
}

/**
 * 把一笔已付款的购买交给服务端，成功后确认发货。返回服务端的订单；
 * 抛错表示没记上（网络断了或被拒），这笔购买留在 IAP Kit 里等下次补交。
 */
async function deliver(purchaseData: string, withForm: boolean) {
  const response = await paymentsApi.submitHarmonySponsorPurchase({
    purchaseData,
    ...(withForm ? {
      categoryId: categoryId.value || undefined,
      displayMode: displayMode.value,
      message: displayMode.value === "hidden" ? undefined : message.value || undefined,
    } : {}),
  });
  // 确认发货失败不算失败：赞助已经记上，下次打开页面会再确认一次。
  await harmonyIapRequest("finish", { purchaseToken: response.finish.purchaseToken, purchaseOrderId: response.finish.purchaseOrderId });
  return response;
}

/** 补交已付款但没确认发货的购买。返回新记上的那些订单。 */
async function recover(withForm: boolean) {
  const reply = await harmonyIapRequest("unfinished");
  const created: { amount: string; categoryTitle: string; points: number }[] = [];
  let failed = false;
  for (const purchaseData of reply.ok ? reply.purchaseDataList ?? [] : []) {
    try {
      const response = await deliver(purchaseData, withForm);
      if (response.created) {
        created.push({ amount: response.order.amount, categoryTitle: response.order.categoryTitle, points: response.order.assistantPointsAwarded ?? 0 });
      }
    } catch (error) {
      // 不属于这个账号、已退款的订单服务端会明确拒绝，不用再提示；其余的留着下次再试。
      if (!serverMessage(error)) failed = true;
    }
  }
  pendingNotice.value = failed ? "有一笔已付款的赞助还没确认，请检查网络后重新确认。" : "";
  return created;
}

async function finishSuccess(order: { amount: string; categoryTitle: string; points: number }) {
  result.value = order;
  message.value = "";
  await Promise.allSettled([auth.fetchMe(), loadLists()]);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const [loaded, environment] = await Promise.all([
      paymentsApi.harmonySponsorOptions({ suppressErrorMessage: true }),
      harmonyIapRequest("environment"),
    ]);
    options.value = loaded;
    environmentError.value = environment.ok ? "" : harmonyIapErrorText(environment, "应用内购买暂时不可用，请稍后再试。") || "应用内购买暂时不可用，请稍后再试。";
    categoryId.value = (loaded.categories.find((category) => category.accepting && category.featured)
      ?? loaded.categories.find((category) => category.accepting))?.id ?? "";
    if (loaded.enabled && environment.ok) {
      const products = await harmonyIapRequest("products", { productIds: loaded.products.map((product) => product.productId) });
      if (products.ok && products.products) {
        availableIds.value = products.products.map((product) => product.id);
        localPrices.value = Object.fromEntries(products.products.filter((product) => product.localPrice).map((product) => [product.id, product.localPrice]));
      } else {
        availableIds.value = null;
      }
    }
    productId.value = tiers.value[1]?.productId ?? tiers.value[0]?.productId ?? "";
  } catch (error) {
    loadError.value = serverMessage(error) || "加载失败，请检查网络后重试。";
    loading.value = false;
    return;
  }
  loading.value = false;
  void loadLists();
  if (environmentError.value) return;
  const recovered = await recover(false);
  if (recovered.length) await finishSuccess(recovered[recovered.length - 1]);
}

async function retryDelivery() {
  if (busy.value) return;
  busy.value = true;
  busyText.value = "正在确认…";
  try {
    const recovered = await recover(false);
    if (recovered.length) await finishSuccess(recovered[recovered.length - 1]);
  } finally {
    busy.value = false;
  }
}

async function buy() {
  const tier = selectedTier.value;
  if (!tier || !options.value || busy.value) return;
  busy.value = true;
  busyText.value = "正在打开收银台…";
  result.value = null;
  try {
    const reply = await harmonyIapRequest("purchase", { productId: tier.productId, developerPayload: options.value.developerPayload }, 0);
    busyText.value = "正在确认…";
    if (!reply.ok || !reply.purchaseData) {
      // “已拥有”“系统错误”可能是上一笔付了款没确认：查一遍补上。
      if (reply.code === HARMONY_IAP_CODE.productOwned || reply.code === HARMONY_IAP_CODE.systemError) {
        const recovered = await recover(true);
        if (recovered.length) {
          await finishSuccess(recovered[recovered.length - 1]);
          return;
        }
      }
      const text = harmonyIapErrorText(reply, "没有完成购买，请稍后再试");
      if (text) ElMessage.warning(text);
      return;
    }
    try {
      const response = await deliver(reply.purchaseData, true);
      await finishSuccess({ amount: response.order.amount, categoryTitle: response.order.categoryTitle, points: response.order.assistantPointsAwarded ?? 0 });
    } catch (error) {
      const text = serverMessage(error);
      if (text) ElMessage.error(text);
      else pendingNotice.value = "付款已完成，但赞助还没确认。请检查网络后重新确认，不会重复扣款。";
    }
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.hs-state { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; color: var(--cpu-text-secondary); font-size: 14px; }
.hs-state p { margin: 0; }
.hs-description { margin: 6px 0 0; white-space: pre-line; }
.hs-benefit { margin: 12px 0 0; }

.hs-tiers { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; margin-top: 12px; }
.hs-tier,
.hs-category,
.hs-mode {
  border: 1.5px solid var(--cpu-border);
  border-radius: 12px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  cursor: pointer;
}
.hs-tier { display: flex; min-height: 64px; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 8px 6px; }
.hs-tier b { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hs-tier small { color: var(--cpu-text-secondary); font-size: 12px; }
.hs-tier.is-on,
.hs-category.is-on,
.hs-mode.is-on { border-color: var(--cpu-primary); background: color-mix(in srgb, var(--cpu-primary) 8%, var(--cpu-card)); }
.hs-tier:disabled,
.hs-category:disabled,
.hs-mode:disabled { cursor: default; opacity: .6; }

.hs-categories { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.hs-category { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; text-align: left; }
.hs-category b { font-size: 14px; font-weight: 600; }
.hs-category small { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }

.hs-modes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.hs-mode { min-height: 36px; padding: 0 14px; font-size: 14px; }
.hs-message { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; color: var(--cpu-text-secondary); font-size: 13px; }
.hs-message input {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border);
  border-radius: 10px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  font-size: 14px;
}
.hs-message input:focus-visible { border-color: var(--cpu-primary); outline: 2px solid color-mix(in srgb, var(--cpu-primary) 30%, transparent); }

/* 金额、类别、显示方式加起来超过一屏：按钮贴在底部，不用滚到最下面才能点。 */
.hs-action {
  position: sticky;
  z-index: 2;
  bottom: calc(var(--cpu-harmony-bottom-clearance, var(--layout-mobile-tabbar-reserve, 0px)) + 10px);
  display: flex;
}
.hs-buy { box-shadow: 0 6px 18px color-mix(in srgb, var(--cpu-primary) 28%, transparent); }
.hs-primary { min-height: 42px; padding: 0 20px; border-radius: 12px !important; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.hs-primary:disabled { cursor: default; opacity: .5; }
.hs-buy { flex: 1 1 auto; min-height: 46px; font-size: 16px; }

.hs-result { display: flex; align-items: flex-start; gap: 12px; }
.hs-result p { margin: 4px 0 0; }
.hs-result-mark { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--cpu-success); color: #fff; font-size: 18px; }

.hs-list-title { padding: 14px 14px 6px; }
.hs-order { min-height: 56px; }
.hs-order .pk-row-copy small { color: var(--cpu-text-secondary); font-size: 12px; }
.hs-order-amount { flex: 0 0 auto; color: var(--cpu-text); font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
