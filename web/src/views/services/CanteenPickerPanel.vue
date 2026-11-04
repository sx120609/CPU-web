<template>
  <section class="cp-tool">
    <div class="cp-intro">
      <div>
        <span class="cp-eyebrow">药大拾间 · 干饭决定器</span>
        <h2>别纠结了，让随机替你决定这一顿。</h2>
        <p>按食堂、楼层和品类筛选，提前去掉不想吃的店，再随机抽一家。登录后可以给门店打分，也能看到其他人的公开评价。</p>
      </div>
      <div class="cp-stats">
        <span><strong>{{ TOTAL_SHOPS }}</strong> 家门店</span>
        <span><strong>{{ CATEGORIES.length }}</strong> 个品类</span>
        <span><strong>{{ FLOOR_COUNT }}</strong> 个楼层</span>
      </div>
    </div>

    <p v-if="emptyFloorNote" class="cp-data-note">{{ emptyFloorNote }}</p>

    <div class="cp-layout">
      <div class="cp-column">
        <section class="cp-card">
          <header class="cp-card-head">
            <div>
              <span class="cp-step">第一步</span>
              <h2>圈定范围</h2>
            </div>
            <span class="cp-count">{{ candidates.length }} 家可选</span>
          </header>

          <div class="cp-filter">
            <span class="cp-filter-label">食堂</span>
            <div class="cp-chips">
              <button
                v-for="option in canteenOptions"
                :key="option.value"
                type="button"
                class="cp-chip"
                :class="{ 'is-active': canteen === option.value }"
                :aria-pressed="canteen === option.value"
                @click="selectCanteen(option.value)"
              >{{ option.label }}</button>
            </div>
          </div>

          <div class="cp-filter">
            <span class="cp-filter-label">楼层（可多选）</span>
            <div class="cp-chips">
              <button
                v-for="option in floorOptions"
                :key="option.value"
                type="button"
                class="cp-chip"
                :class="{ 'is-active': isFloorActive(option.value) }"
                :aria-pressed="isFloorActive(option.value)"
                @click="toggleFloor(option.value)"
              >{{ option.label }}</button>
            </div>
          </div>

          <div class="cp-filter">
            <span class="cp-filter-label">品类（可多选）</span>
            <div class="cp-chips">
              <button
                v-for="option in categoryOptions"
                :key="option.value"
                type="button"
                class="cp-chip"
                :class="{ 'is-active': isCategoryActive(option.value) }"
                :aria-pressed="isCategoryActive(option.value)"
                @click="toggleCategory(option.value)"
              >{{ option.label }}</button>
            </div>
          </div>

          <p class="cp-scope">{{ scopeLabel }} · {{ candidates.length }} 家可选</p>
        </section>

        <details class="cp-card cp-exclude">
          <summary class="cp-exclude-summary">
            <span>
              <span class="cp-step">第二步 · 可选</span>
              <strong>去掉不想吃的店</strong>
            </span>
            <span class="cp-exclude-badge">{{ excluded.size ? `已排除 ${excluded.size} 家` : "未排除" }}</span>
            <span class="cp-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="cp-exclude-body">
            <p>勾选后，这些店不会进入随机结果。排除设置与上方筛选互相独立。</p>
            <div v-for="canteenGroup in CANTEENS" :key="canteenGroup.id" class="cp-exclude-group">
              <h3>{{ canteenGroup.name }}</h3>
              <details v-for="floorItem in canteenGroup.floors" :key="floorItem.code" class="cp-floor">
                <summary>
                  <span class="cp-floor-code">{{ floorItem.code }}</span>
                  <span>{{ floorItem.label }}</span>
                  <span class="cp-floor-count">{{ floorItem.shops.length ? `${floorExcludedCount(floorItem)} / ${floorItem.shops.length}` : "待补充" }}</span>
                  <span aria-hidden="true">⌄</span>
                </summary>
                <div v-if="floorItem.shops.length" class="cp-shop-grid">
                  <label v-for="shop in floorItem.shops" :key="shop.id" class="cp-shop-check">
                    <input
                      type="checkbox"
                      :checked="excluded.has(shop.id)"
                      @change="toggleExcluded(shop.id)"
                    />
                    <span>{{ shop.name }}</span>
                  </label>
                </div>
                <p v-else class="cp-floor-empty">该楼层暂未录入门店数据。</p>
              </details>
            </div>
            <button type="button" class="cp-text-button" :disabled="!excluded.size" @click="restoreExcluded">恢复全部店铺</button>
          </div>
        </details>
      </div>

      <div class="cp-column">
        <section class="cp-card cp-draw">
          <span class="cp-step">第三步</span>
          <h2>今天就去这家</h2>
          <p>{{ drawHint }}</p>
          <button type="button" class="cp-draw-button" :disabled="!candidates.length" @click="draw">
            <span>{{ selected ? "再抽一家" : "帮我选一家" }}</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>

        <section v-if="selected" class="cp-result">
          <div class="cp-result-top"><span>今天就吃</span><span class="cp-result-stamp">就它了</span></div>
          <div class="cp-result-name-row">
            <h2>{{ selected.name }}</h2>
            <span class="cp-result-code">{{ selected.floorCode }}</span>
          </div>
          <p class="cp-result-meta">{{ selected.canteenName }} · {{ selected.floorCode }} {{ selected.floorLabel }}</p>
          <div class="cp-tags">
            <span v-for="tag in selected.tags" :key="tag">{{ categoryName(tag) }}</span>
          </div>
          <p class="cp-result-note">从 {{ lastCandidateCount }} 家候选中随机选出 · 已排除 {{ excluded.size }} 家</p>
        </section>
        <section v-else class="cp-card cp-result-placeholder">
          <span class="cp-question">?</span>
          <h2>{{ emptyTitle }}</h2>
          <p>{{ emptyText }}</p>
        </section>

        <section v-if="selected" class="cp-card cp-reviews">
          <header class="cp-review-head">
            <div>
              <span class="cp-step">公开评价 · 所有人可见</span>
              <h2>大家怎么说</h2>
            </div>
            <span class="cp-review-shop">{{ selected.floorCode }} · {{ selected.name }}</span>
          </header>
          <p class="cp-review-hint">{{ reviewLoading ? "正在加载公开评价…" : review ? "评分与评论由所有访问者共同提供。" : "暂时无法加载评价。" }}</p>

          <template v-if="review">
            <div class="cp-review-summary">
              <strong>{{ review.count ? review.average.toFixed(1) : "—" }}</strong>
              <div>
                <div class="cp-stars" aria-hidden="true">
                  <span>★★★★★</span>
                  <i :style="{ width: `${review.count ? Math.max(0, Math.min(100, review.average / 5 * 100)) : 0}%` }">★★★★★</i>
                </div>
                <small>{{ review.count }} 人评分 · 平均分</small>
              </div>
            </div>

            <div class="cp-review-list">
              <article v-for="(entry, index) in review.entries" :key="`${entry.nickname}-${index}`" class="cp-review-item">
                <header>
                  <strong>{{ entry.nickname || "匿名" }}</strong>
                  <span v-if="entry.me" class="cp-me">我</span>
                  <span class="cp-review-stars">{{ starText(entry.rating) }}</span>
                  <time>{{ formatReviewTime(entry.updatedAt) }}</time>
                </header>
                <p v-if="entry.comment">{{ entry.comment }}</p>
              </article>
              <p v-if="!review.entries.length" class="cp-review-empty">还没有公开评价，来当第一个分享的人。</p>
            </div>

            <div class="cp-review-form">
              <h3>给它打个分</h3>
              <div class="cp-rating-input" role="group" aria-label="我的评分">
                <button
                  v-for="n in 5"
                  :key="n"
                  type="button"
                  :aria-label="`${n} 星`"
                  :aria-pressed="rating === n"
                  :class="{ 'is-filled': n <= rating }"
                  :disabled="!loggedIn || reviewSubmitting"
                  @click="setRating(n)"
                >★</button>
              </div>
              <textarea
                v-model="comment"
                maxlength="200"
                rows="3"
                placeholder="例如：分量很足 / 微辣 / 排队有点久……"
                :disabled="!loggedIn || reviewSubmitting"
                @input="markReviewTouched"
              ></textarea>
              <div class="cp-form-footer">
                <button
                  type="button"
                  class="cp-submit"
                  :disabled="!loggedIn || !rating || reviewSubmitting"
                  @click="submitReview"
                >{{ review.me ? "更新我的评价" : "提交评分" }}</button>
                <span>{{ comment.length }} / 200</span>
              </div>
              <p v-if="!loggedIn" class="cp-login-hint">
                登录后才能提交评分和公开短评。
                <router-link :to="{ path: '/login', query: { redirect: route.fullPath } }">去登录</router-link>
              </p>
              <p v-if="reviewStatus" class="cp-review-status" role="status">{{ reviewStatus }}</p>
            </div>
          </template>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { getToken, hasAuthPresence } from "@/api/request";
import { toolsApi } from "@/api/tools";
import type { CanteenReviews } from "@/api/tools";
import {
  ALL_SHOPS,
  CANTEENS,
  CATEGORIES,
  EMPTY_FLOORS,
  FLOOR_COUNT,
  FLOOR_LEVELS,
  TOTAL_SHOPS,
  categoryName,
  type CanteenShop,
} from "@/data/canteenPicker";

const route = useRoute();
const canteen = ref("all");
const levels = ref(new Set<string>());
const categories = ref(new Set<string>());
const excluded = ref(new Set<string>());
const selected = ref<CanteenShop | null>(null);
const lastCandidateCount = ref(0);
const review = ref<CanteenReviews | null>(null);
const reviewLoading = ref(false);
const reviewSubmitting = ref(false);
const rating = ref(0);
const comment = ref("");
const reviewTouched = ref(false);
const reviewStatus = ref("");
const loggedIn = computed(() => Boolean(getToken()) || hasAuthPresence());

const canteenOptions = [
  { value: "all", label: "不限" },
  ...CANTEENS.map((item) => ({ value: item.id, label: item.name })),
];
const floorOptions = [
  { value: "all", label: "不限" },
  ...FLOOR_LEVELS.map((item) => ({ value: String(item), label: `${item} 楼` })),
];
const categoryOptions = [
  { value: "all", label: "不限" },
  ...CATEGORIES.map((item) => ({ value: item.id, label: item.name })),
];

const scopedShops = computed(() =>
  ALL_SHOPS.filter(
    (shop) =>
      (canteen.value === "all" || shop.canteenId === canteen.value) &&
      (levels.value.size === 0 || levels.value.has(String(shop.level))),
  ),
);
const filteredShops = computed(() =>
  scopedShops.value.filter(
    (shop) => categories.value.size === 0 || shop.tags.some((tag) => categories.value.has(tag)),
  ),
);
const candidates = computed(() =>
  filteredShops.value.filter((shop) => !excluded.value.has(shop.id)),
);

const selectedFloorLevels = computed(() =>
  FLOOR_LEVELS.filter((level) => levels.value.has(String(level))),
);
const selectedCategoryNames = computed(() =>
  CATEGORIES.filter((item) => categories.value.has(item.id)).map((item) => item.name),
);
const scopeLabel = computed(() => {
  const canteenLabel =
    canteen.value === "all"
      ? "全部食堂"
      : CANTEENS.find((item) => item.id === canteen.value)?.name || "全部食堂";
  const floorLabel = selectedFloorLevels.value.length
    ? selectedFloorLevels.value.map((level) => `${level} 楼`).join(" / ")
    : "全部楼层";
  const categoryLabel = selectedCategoryNames.value.length
    ? selectedCategoryNames.value.join(" / ")
    : "全部品类";
  return `${canteenLabel} · ${floorLabel} · ${categoryLabel}`;
});

const emptyFloorNote = computed(() =>
  EMPTY_FLOORS.length
    ? `${EMPTY_FLOORS.map((item) => `${item.canteenName} ${item.code}`).join("、")} 暂未提供门店，保留为空楼层。`
    : "",
);

const emptyFloor = computed(() =>
  EMPTY_FLOORS.find(
    (item) =>
      (canteen.value === "all" || canteen.value === item.canteenId) &&
      (levels.value.size === 0 || levels.value.has(String(item.level))),
  ),
);
const emptyState = computed(() => {
  if (!scopedShops.value.length) {
    if (emptyFloor.value) {
      return {
        title: `${emptyFloor.value.canteenName} ${emptyFloor.value.code} 待补充`,
        text: `${emptyFloor.value.canteenName} ${emptyFloor.value.label}还没有录入门店数据，先换一个楼层吧。`,
      };
    }
    return { title: "这个范围暂无门店", text: "换一个楼层或食堂试试。" };
  }
  if (!filteredShops.value.length) return { title: "这些品类暂无门店", text: "换几个品类或放宽筛选。" };
  return { title: "店铺都被排除了", text: "恢复一些店铺，或换一个筛选范围。" };
});
const emptyTitle = computed(() => (candidates.value.length ? "答案还在路上" : emptyState.value.title));
const emptyText = computed(() =>
  candidates.value.length
    ? `当前有 ${candidates.value.length} 家候选，点下面的按钮交给运气。`
    : emptyState.value.text,
);
const drawHint = computed(() =>
  candidates.value.length
    ? `${scopeLabel.value}，从 ${candidates.value.length} 家店里随机选择。`
    : emptyState.value.text,
);

function selectCanteen(value: string) {
  canteen.value = value;
  resetResult();
}
function isFloorActive(value: string) {
  return value === "all" ? levels.value.size === 0 : levels.value.has(value);
}
function toggleFloor(value: string) {
  if (value === "all") {
    levels.value = new Set();
  } else {
    const next = new Set(levels.value);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    levels.value = next;
  }
  resetResult();
}
function isCategoryActive(value: string) {
  return value === "all" ? categories.value.size === 0 : categories.value.has(value);
}
function toggleCategory(value: string) {
  if (value === "all") {
    categories.value = new Set();
  } else {
    const next = new Set(categories.value);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    categories.value = next;
  }
  resetResult();
}
function resetResult() {
  selected.value = null;
  review.value = null;
  reviewStatus.value = "";
}
function toggleExcluded(id: string) {
  const next = new Set(excluded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  excluded.value = next;
  resetResult();
}
function restoreExcluded() {
  excluded.value = new Set();
  resetResult();
}
function floorExcludedCount(floorItem: (typeof CANTEENS)[number]["floors"][number]) {
  return floorItem.shops.reduce((total, shop) => total + (excluded.value.has(shop.id) ? 1 : 0), 0);
}

function randomIndex(length: number) {
  if (length <= 1) return 0;
  try {
    const values = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / length) * length;
    let value = 0;
    do {
      crypto.getRandomValues(values);
      value = values[0];
    } while (value >= limit);
    return value % length;
  } catch {
    return Math.floor(Math.random() * length);
  }
}

async function draw() {
  if (!candidates.value.length) return;
  let pool = candidates.value;
  if (pool.length > 1 && selected.value) {
    const withoutLast = pool.filter((shop) => shop.id !== selected.value!.id);
    if (withoutLast.length) pool = withoutLast;
  }
  const shop = pool[randomIndex(pool.length)];
  selected.value = shop;
  lastCandidateCount.value = candidates.value.length;
  rating.value = 0;
  comment.value = "";
  reviewTouched.value = false;
  reviewStatus.value = "";
  await loadReviews(shop);
}

function starText(value: number) {
  const stars = Math.max(0, Math.min(5, Number(value) || 0));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}
function formatReviewTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadReviews(shop: CanteenShop) {
  reviewLoading.value = true;
  review.value = null;
  reviewStatus.value = "";
  try {
    const data = await toolsApi.canteenReviews(shop.id);
    if (selected.value?.id !== shop.id) return;
    review.value = data;
    if (!reviewTouched.value && data.me) {
      rating.value = data.me.rating;
      comment.value = data.me.comment;
    }
  } catch (error) {
    if (selected.value?.id !== shop.id) return;
    reviewStatus.value = error instanceof Error ? error.message : "评价加载失败";
  } finally {
    if (selected.value?.id === shop.id) reviewLoading.value = false;
  }
}

function markReviewTouched() {
  reviewTouched.value = true;
}

function setRating(value: number) {
  rating.value = value;
  reviewTouched.value = true;
}

async function submitReview() {
  const shop = selected.value;
  if (!shop || !loggedIn.value || !rating.value || reviewSubmitting.value) return;
  reviewSubmitting.value = true;
  reviewStatus.value = "正在提交…";
  try {
    await toolsApi.submitCanteenReview({
      shopId: shop.id,
      rating: rating.value,
      comment: comment.value.trim().slice(0, 200),
    });
    reviewTouched.value = false;
    const data = await toolsApi.canteenReviews(shop.id);
    if (selected.value?.id === shop.id) {
      review.value = data;
      if (data.me) {
        rating.value = data.me.rating;
        comment.value = data.me.comment;
      }
    }
    reviewStatus.value = "已提交，感谢分享。";
  } catch (error) {
    reviewStatus.value = error instanceof Error ? error.message : "提交失败，请稍后重试";
  } finally {
    reviewSubmitting.value = false;
  }
}
</script>

<style scoped>
.cp-tool { display: grid; gap: 16px; color: var(--cpu-text); }
.cp-intro {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}
.cp-eyebrow, .cp-step { color: var(--cpu-primary); font-size: var(--cpu-fs-xs); font-weight: 750; letter-spacing: .08em; }
.cp-intro h2 { margin: 7px 0 8px; font-size: clamp(22px, 3vw, 32px); line-height: 1.2; }
.cp-intro p { max-width: 680px; margin: 0; color: var(--cpu-text-secondary); line-height: 1.75; }
.cp-stats { display: flex; flex-wrap: wrap; gap: 8px; }
.cp-stats span { display: inline-flex; align-items: baseline; gap: 4px; padding: 7px 10px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); white-space: nowrap; }
.cp-stats strong { color: var(--cpu-text); font-size: var(--cpu-fs-s); }
.cp-data-note { margin: 0; padding: 9px 12px; border: 1px dashed color-mix(in srgb, #d97706 35%, var(--cpu-border-soft)); border-radius: 10px; color: #b45309; background: color-mix(in srgb, #fef3c7 30%, transparent); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cp-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); gap: 16px; align-items: start; }
.cp-column { display: grid; gap: 16px; min-width: 0; }
.cp-card, .cp-result-placeholder { min-width: 0; padding: 20px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-l); background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.cp-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cp-card-head h2, .cp-draw h2, .cp-review-head h2 { margin: 4px 0 0; font-size: var(--cpu-fs-l); }
.cp-count { padding: 6px 10px; border-radius: 999px; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-xs); font-weight: 750; white-space: nowrap; }
.cp-filter { margin-top: 18px; }
.cp-filter-label { display: block; margin-bottom: 8px; color: var(--cpu-text); font-size: var(--cpu-fs-xs); font-weight: 700; }
.cp-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.cp-chip { padding: 7px 11px; border: 1px solid var(--cpu-border-soft); border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); font-weight: 650; }
.cp-chip:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); }
.cp-chip.is-active { border-color: var(--cpu-primary); background: var(--cpu-primary); color: #fff; }
.cp-scope { margin: 18px 0 0; padding-top: 14px; border-top: 1px dashed var(--cpu-border-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.cp-exclude { padding: 0; overflow: hidden; }
.cp-exclude-summary { display: flex; align-items: center; gap: 10px; padding: 18px 20px; list-style: none; cursor: pointer; }
.cp-exclude-summary::-webkit-details-marker { display: none; }
.cp-exclude-summary > span:first-child { display: grid; gap: 2px; flex: 1; }
.cp-exclude-summary strong { font-size: var(--cpu-fs-l); }
.cp-exclude-badge { padding: 5px 8px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.cp-chevron { color: var(--cpu-text-secondary); transition: transform .2s ease; }
.cp-exclude[open] .cp-chevron { transform: rotate(180deg); }
.cp-exclude-body { padding: 0 20px 20px; border-top: 1px dashed var(--cpu-border-soft); }
.cp-exclude-body > p { margin: 14px 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cp-exclude-group { padding-top: 10px; }
.cp-exclude-group h3 { margin: 0 0 8px; font-size: var(--cpu-fs-s); }
.cp-floor { margin: 7px 0; border: 1px solid var(--cpu-border-soft); border-radius: 10px; background: var(--cpu-surface-subtle); }
.cp-floor summary { display: flex; align-items: center; gap: 7px; min-height: 38px; padding: 7px 10px; list-style: none; cursor: pointer; font-size: var(--cpu-fs-xs); }
.cp-floor summary::-webkit-details-marker { display: none; }
.cp-floor-code { padding: 2px 5px; border-radius: 4px; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700; }
.cp-floor-count { margin-left: auto; color: var(--cpu-text-secondary); }
.cp-shop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 2px 8px; padding: 4px 10px 10px; border-top: 1px dashed var(--cpu-border-soft); }
.cp-shop-check { display: flex; align-items: flex-start; gap: 5px; padding: 4px; color: var(--cpu-text); font-size: var(--cpu-fs-xs); line-height: 1.4; cursor: pointer; }
.cp-shop-check input { margin-top: 2px; accent-color: var(--cpu-primary); }
.cp-floor-empty { margin: 0; padding: 10px; border-top: 1px dashed var(--cpu-border-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.cp-text-button { margin-top: 12px; padding: 0; border: 0; background: transparent; color: var(--cpu-primary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); font-weight: 650; }
.cp-text-button:disabled { color: var(--cpu-text-secondary); cursor: not-allowed; }
.cp-draw { background: linear-gradient(145deg, var(--cpu-card), var(--cpu-primary-soft)); }
.cp-draw p { min-height: 40px; margin: 10px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }
.cp-draw-button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 52px; margin-top: 18px; padding: 10px 18px; border: 0; border-radius: 12px; background: var(--cpu-primary); color: #fff; cursor: pointer; font: inherit; font-size: var(--cpu-fs-l); font-weight: 750; }
.cp-draw-button:hover:not(:disabled) { background: var(--cpu-primary-dark); }
.cp-draw-button:disabled { background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); cursor: not-allowed; }
.cp-result { padding: 22px; border-radius: var(--cpu-radius-l); background: linear-gradient(145deg, #125e40, #0b3f2b); color: #fff; box-shadow: 0 16px 34px rgba(11, 63, 43, .22); }
.cp-result-top, .cp-result-name-row, .cp-result-meta, .cp-tags { position: relative; z-index: 1; }
.cp-result-top { display: flex; align-items: center; justify-content: space-between; color: rgba(255,255,255,.72); font-size: var(--cpu-fs-xs); font-weight: 700; letter-spacing: .12em; }
.cp-result-stamp { padding: 4px 7px; border: 1px solid rgba(255,255,255,.35); border-radius: 5px; letter-spacing: .08em; transform: rotate(-4deg); }
.cp-result-name-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 14px; }
.cp-result h2 { min-width: 0; margin: 0; font-size: clamp(34px, 5.5vw, 54px); line-height: 1.03; letter-spacing: -.04em; overflow-wrap: anywhere; }
.cp-result-code { padding: 5px 8px; border: 1px solid rgba(255,255,255,.25); border-radius: 6px; background: rgba(255,255,255,.1); font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; }
.cp-result-meta { margin: 11px 0 0; color: rgba(255,255,255,.88); font-size: var(--cpu-fs-s); font-weight: 650; }
.cp-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.cp-tags span { padding: 4px 7px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; background: rgba(255,255,255,.08); color: rgba(255,255,255,.78); font-size: 10px; }
.cp-result-note { position: relative; z-index: 1; margin: 20px 0 0; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.16); color: rgba(255,255,255,.6); font-size: 10px; }
.cp-result-placeholder { display: grid; place-items: center; min-height: 210px; text-align: center; border-style: dashed; }
.cp-question { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 50%; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 20px; }
.cp-result-placeholder h2 { margin: 8px 0 4px; font-size: var(--cpu-fs-l); }
.cp-result-placeholder p { max-width: 280px; margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cp-review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.cp-review-shop { max-width: 180px; padding: 5px 8px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-review-hint { margin: 12px 0 0; padding-top: 12px; border-top: 1px dashed var(--cpu-border-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cp-review-summary { display: flex; align-items: center; gap: 16px; margin-top: 14px; padding: 12px; border-radius: 12px; background: var(--cpu-surface-subtle); }
.cp-review-summary > strong { color: var(--cpu-primary); font-size: 34px; line-height: 1; }
.cp-review-summary small { display: block; margin-top: 5px; color: var(--cpu-text-secondary); font-size: 10px; }
.cp-stars { position: relative; display: inline-block; color: #d6d3d1; font-size: 17px; letter-spacing: 2px; line-height: 1; white-space: nowrap; }
.cp-stars i { position: absolute; inset: 0 auto 0 0; overflow: hidden; color: #d97706; font-style: normal; white-space: nowrap; }
.cp-review-list { margin-top: 8px; }
.cp-review-item { padding: 11px 0; border-top: 1px dashed var(--cpu-border-soft); }
.cp-review-item header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.cp-review-item header strong { font-size: var(--cpu-fs-xs); }
.cp-me { padding: 1px 4px; border-radius: 3px; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: 9px; }
.cp-review-stars { color: #d97706; font-size: 11px; letter-spacing: 1px; }
.cp-review-item time { margin-left: auto; color: var(--cpu-text-secondary); font-size: 10px; }
.cp-review-item p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; overflow-wrap: anywhere; }
.cp-review-empty { margin: 0; padding: 12px 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cp-review-form { margin-top: 10px; padding-top: 14px; border-top: 1px solid var(--cpu-border-soft); }
.cp-review-form h3 { margin: 0; font-size: var(--cpu-fs-s); }
.cp-rating-input { display: flex; gap: 2px; margin-top: 6px; }
.cp-rating-input button { padding: 0 2px; border: 0; background: transparent; color: #d6d3d1; cursor: pointer; font-size: 28px; line-height: 1; }
.cp-rating-input button.is-filled { color: #d97706; }
.cp-rating-input button:disabled { cursor: not-allowed; opacity: .7; }
.cp-review-form textarea { display: block; width: 100%; margin-top: 10px; padding: 9px 10px; border: 1px solid var(--cpu-border-soft); border-radius: 9px; background: var(--cpu-surface-subtle); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-xs); resize: vertical; }
.cp-review-form textarea:focus { outline: 2px solid var(--cpu-primary); outline-offset: 1px; }
.cp-form-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; color: var(--cpu-text-secondary); font-size: 10px; }
.cp-submit { padding: 7px 13px; border: 0; border-radius: 999px; background: var(--cpu-primary); color: #fff; cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); font-weight: 700; }
.cp-submit:disabled { background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); cursor: not-allowed; }
.cp-login-hint, .cp-review-status { margin: 8px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.7; }
.cp-login-hint a { color: var(--cpu-primary); font-weight: 650; }
.cp-review-status { color: var(--cpu-primary); }
@media (max-width: 900px) {
  .cp-intro { display: block; }
  .cp-stats { margin-top: 14px; }
  .cp-layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .cp-card, .cp-result, .cp-result-placeholder { padding: 16px; }
  .cp-intro { padding: 18px; }
  .cp-chip { padding: 7px 9px; }
  .cp-review-summary > strong { font-size: 30px; }
}
</style>
