<template>
  <section class="sd">
    <header class="sd-head">
      <div class="sd-title">
        <h2>{{ shop.name }}</h2>
        <p>{{ shop.canteenName }} · {{ shop.floorCode }} {{ shop.floorLabel }}</p>
        <div class="sd-tags"><span v-for="tag in shop.tags" :key="tag">{{ categoryName(tag) }}</span></div>
      </div>
      <div class="sd-score" :aria-label="rating?.count ? `平均 ${rating.average} 分，${rating.count} 人评分` : '还没有评分'">
        <strong :class="{ 'is-empty': !rating?.count }">{{ rating?.count ? rating.average.toFixed(1) : "—" }}</strong>
        <small>{{ rating?.count ? `${rating.count} 人评分` : "暂无评分" }}</small>
      </div>
    </header>

    <div v-if="review?.count" class="sd-bars" aria-hidden="true">
      <div v-for="star in [5, 4, 3, 2, 1]" :key="star" class="sd-bar">
        <span>{{ star }}</span>
        <i><b :style="{ width: `${(review.histogram[star - 1] / review.count) * 100}%` }"></b></i>
        <em>{{ review.histogram[star - 1] }}</em>
      </div>
    </div>

    <div class="sd-actions">
      <button type="button" class="sd-act" :class="{ 'is-on': excluded }" @click="emit('toggle-exclude', shop.id)">{{ excluded ? "已设为不想吃" : "不想吃" }}</button>
      <button type="button" class="sd-act" @click="share">分享</button>
      <button type="button" class="sd-act" @click="emit('correct', shop)">纠错</button>
    </div>

    <nav class="sd-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="tab === 'reviews'" :class="{ 'is-active': tab === 'reviews' }" @click="tab = 'reviews'">评价 {{ review?.count || "" }}</button>
      <button type="button" role="tab" :aria-selected="tab === 'corrections'" :class="{ 'is-active': tab === 'corrections' }" @click="tab = 'corrections'">纠错{{ openCorrections ? ` ${openCorrections}` : "" }}</button>
    </nav>

    <div v-show="tab === 'reviews'">
      <div class="sd-form">
        <div class="sd-stars" role="radiogroup" aria-label="我的评分">
          <button
            v-for="n in 5"
            :key="n"
            type="button"
            role="radio"
            :aria-label="`${n} 星`"
            :aria-checked="myRating === n"
            :class="{ 'is-on': n <= myRating }"
            :disabled="!loggedIn || submitting"
            @click="setRating(n)"
          >★</button>
          <span class="sd-hint">{{ loggedIn ? ratingHint : "" }}</span>
        </div>
        <template v-if="loggedIn">
          <textarea v-model="comment" rows="2" maxlength="200" placeholder="说点什么（选填）：分量、口味、排队……" :disabled="submitting" @input="touched = true"></textarea>
          <div class="sd-form-foot">
            <span>{{ [...comment].length }}/200 · 短评公开显示昵称</span>
            <button v-if="review?.me" type="button" class="sd-link is-danger" :disabled="submitting" @click="removeMine">删除我的评价</button>
            <button type="button" class="sd-submit" :disabled="!myRating || submitting" @click="submit">{{ review?.me ? "更新" : "提交" }}</button>
          </div>
        </template>
        <p v-else class="sd-login">
          <router-link :to="{ path: '/login', query: { redirect: route.fullPath } }">登录</router-link>后可以打分和写短评
        </p>
      </div>

      <p v-if="loading && !review" class="sd-empty" role="status">正在加载评价…</p>
      <p v-else-if="loadError" class="sd-empty" role="status">{{ loadError }} <button type="button" class="sd-link" @click="load(0)">重试</button></p>
      <p v-else-if="review && !review.entries.length" class="sd-empty">还没有人评价，来当第一个。</p>
      <article v-for="entry in review?.entries || []" :key="entry.id" class="sd-review">
        <header>
          <strong>{{ entry.nickname || "同学" }}</strong>
          <span v-if="entry.me" class="sd-me">我</span>
          <span class="sd-review-stars" :aria-label="`${entry.rating} 星`">{{ "★".repeat(entry.rating) }}<i>{{ "★".repeat(5 - entry.rating) }}</i></span>
          <time>{{ formatTime(entry.updatedAt) }}</time>
          <button v-if="review?.canModerate && !entry.me" type="button" class="sd-link is-danger" @click="removeEntry(entry.id)">删除</button>
        </header>
        <p v-if="entry.comment">{{ entry.comment }}</p>
      </article>
      <button v-if="review?.hasMore" type="button" class="sd-more" :disabled="loading" @click="load(review.entries.length)">{{ loading ? "加载中…" : "更多评价" }}</button>
    </div>

    <div v-show="tab === 'corrections'">
      <CorrectionList :shop-id="shop.id" :reload-key="correctionKey" @loaded="openCorrections = $event" @catalog-may-change="emit('catalog-may-change')" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { toolsApi, type CanteenReviews } from "@/api/tools";
import { useAuthStore } from "@/stores/auth";
import { canteenCategoryName as categoryName, type CanteenShop } from "@/data/canteenPicker";
import type { ShopRating } from "./picker";
import CorrectionList from "./CorrectionList.vue";

const props = defineProps<{ shop: CanteenShop; rating?: ShopRating; excluded: boolean; correctionKey?: number }>();
const emit = defineEmits<{
  (e: "rated", payload: { shopId: string; average: number; count: number; mine: number | null }): void;
  (e: "toggle-exclude", shopId: string): void;
  (e: "correct", shop: CanteenShop): void;
  (e: "catalog-may-change"): void;
}>();

const route = useRoute();
const auth = useAuthStore();
const loggedIn = computed(() => auth.isLoggedIn);
const tab = ref<"reviews" | "corrections">("reviews");
const review = ref<CanteenReviews | null>(null);
const loading = ref(false);
const loadError = ref("");
const submitting = ref(false);
const myRating = ref(0);
const comment = ref("");
const touched = ref(false);
const openCorrections = ref(0);
let requestId = 0;

const ratingHint = computed(() => ["点星星打分", "踩雷了", "一般般", "还可以", "挺好吃", "强烈推荐"][myRating.value]);

async function load(offset: number) {
  const shopId = props.shop.id;
  const current = ++requestId;
  loading.value = true;
  loadError.value = "";
  try {
    const data = await toolsApi.canteenReviews(shopId, offset);
    if (current !== requestId) return;
    if (offset && review.value) review.value = { ...data, entries: [...review.value.entries, ...data.entries] };
    else review.value = data;
    if (!touched.value) {
      myRating.value = data.me?.rating ?? 0;
      comment.value = data.me?.comment ?? "";
    }
  } catch (err) {
    if (current === requestId) loadError.value = err instanceof Error ? err.message : "评价加载失败";
  } finally {
    if (current === requestId) loading.value = false;
  }
}

watch(() => props.shop.id, () => {
  review.value = null;
  touched.value = false;
  myRating.value = 0;
  comment.value = "";
  openCorrections.value = 0;
  void load(0);
}, { immediate: true });

function setRating(value: number) {
  myRating.value = value;
  touched.value = true;
}

async function submit() {
  if (!myRating.value) return;
  submitting.value = true;
  try {
    const result = await toolsApi.submitCanteenReview({ shopId: props.shop.id, rating: myRating.value, comment: comment.value.trim() });
    touched.value = false;
    emit("rated", { shopId: props.shop.id, average: result.average, count: result.count, mine: result.me.rating });
    ElMessage.success("已保存");
    await load(0);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "提交失败");
  } finally {
    submitting.value = false;
  }
}

async function removeMine() {
  try {
    await ElMessageBox.confirm("删除你对这家店的评分和短评？", "删除评价", { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" });
  } catch {
    return;
  }
  submitting.value = true;
  try {
    const result = await toolsApi.deleteMyCanteenReview(props.shop.id);
    touched.value = false;
    emit("rated", { shopId: props.shop.id, average: result.average, count: result.count, mine: null });
    await load(0);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "删除失败");
  } finally {
    submitting.value = false;
  }
}

async function removeEntry(id: string) {
  try {
    await ElMessageBox.confirm("以管理员身份删除这条评价？", "删除评价", { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" });
    await toolsApi.deleteCanteenReview(id);
    await load(0);
    if (review.value) emit("rated", { shopId: props.shop.id, average: review.value.average, count: review.value.count, mine: review.value.me?.rating ?? null });
  } catch (err) {
    if (err instanceof Error) ElMessage.error(err.message);
  }
}

async function share() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("shop", props.shop.id);
  const text = `${props.shop.name}（${props.shop.canteenName}${props.shop.floorLabel}）`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: text, url: url.toString() });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url.toString()}`);
    ElMessage.success("链接已复制");
  } catch (err) {
    if ((err as DOMException)?.name !== "AbortError") ElMessage.error("复制失败，请手动复制地址栏");
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
</script>

<style scoped>
.sd { display: grid; gap: 12px; }
.sd-head { display: flex; align-items: flex-start; gap: 12px; }
.sd-title { flex: 1; min-width: 0; }
.sd-title h2 { margin: 0; font-size: var(--cpu-fs-xl); line-height: 1.3; overflow-wrap: anywhere; }
.sd-title p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.sd-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.sd-tags span { padding: 1px 6px; border-radius: var(--cpu-radius-s); background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.sd-score { display: grid; justify-items: end; flex-shrink: 0; }
.sd-score strong { color: var(--cpu-hue-amber-ink); font-size: var(--cpu-fs-xxl); line-height: 1; font-variant-numeric: tabular-nums; }
.sd-score strong.is-empty { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xl); font-weight: 400; }
.sd-score small { margin-top: 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.sd-bars { display: grid; gap: 3px; }
.sd-bar { display: grid; grid-template-columns: 12px 1fr 24px; align-items: center; gap: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.sd-bar i { height: 6px; border-radius: 999px; background: var(--cpu-surface-subtle); overflow: hidden; }
.sd-bar b { display: block; height: 100%; background: #e0a400; }
.sd-bar em { font-style: normal; text-align: right; font-variant-numeric: tabular-nums; }
.sd-actions { display: flex; gap: 6px; }
.sd-act { height: 28px; padding: 0 12px; border: 1px solid var(--cpu-border); border-radius: 999px; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }
@media (hover: hover) { .sd-act:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); } }
.sd-act.is-on { border-color: var(--cpu-text-muted); background: var(--cpu-surface-subtle); color: var(--cpu-text); }
.sd-tabs { display: flex; gap: 16px; border-bottom: 1px solid var(--cpu-border-soft); }
.sd-tabs button { margin-bottom: -1px; padding: 6px 0; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-m); }
.sd-tabs button.is-active { border-bottom-color: var(--cpu-primary); color: var(--cpu-text); font-weight: 600; }
.sd-form { display: grid; gap: 6px; padding: 10px 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.sd-stars { display: flex; align-items: center; gap: 2px; }
.sd-stars button { padding: 0 2px; border: 0; background: none; color: var(--cpu-border); cursor: pointer; font-size: 24px; line-height: 1; }
.sd-stars button.is-on { color: #e0a400; }
.sd-stars button:disabled { cursor: default; }
.sd-hint { margin-left: 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.sd-form textarea { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid var(--cpu-border); border-radius: var(--cpu-radius-s); background: var(--cpu-surface); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-s); resize: vertical; }
.sd-form textarea:focus { outline: 2px solid var(--cpu-primary); outline-offset: -1px; }
.sd-form-foot { display: flex; align-items: center; gap: 10px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.sd-form-foot > span { flex: 1; }
.sd-submit { height: 28px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--cpu-primary); color: var(--cpu-on-primary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); font-weight: 600; }
.sd-submit:disabled { background: var(--cpu-surface-subtle); color: var(--cpu-text-muted); cursor: not-allowed; }
.sd-login { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.sd-login a { color: var(--cpu-primary); }
.sd-empty { margin: 0; padding: 8px 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.sd-review { padding: 8px 0; border-top: 1px solid var(--cpu-border-soft); }
.sd-review header { display: flex; align-items: center; gap: 6px; font-size: var(--cpu-fs-s); }
.sd-me { padding: 0 4px; border-radius: 4px; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-xs); }
.sd-review-stars { color: #e0a400; font-size: var(--cpu-fs-xs); letter-spacing: 1px; }
.sd-review-stars i { color: var(--cpu-border); font-style: normal; }
.sd-review time { margin-left: auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.sd-review p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; }
.sd-link { padding: 0; border: 0; background: none; color: var(--cpu-primary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); }
.sd-link.is-danger { color: var(--cpu-danger); }
.sd-more { justify-self: center; height: 28px; padding: 0 14px; border: 1px solid var(--cpu-border); border-radius: 999px; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }
@media (pointer: coarse) {
  .sd-form textarea { font-size: 16px; }
}
</style>
