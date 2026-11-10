<template>
  <div class="cp" :class="{ 'is-wide': isWide }">
    <div class="cp-main">
      <nav class="cp-tabs" role="tablist" aria-label="今天吃什么">
        <button v-for="item in tabs" :key="item.value" type="button" role="tab" :aria-selected="tab === item.value" :class="{ 'is-active': tab === item.value }" @click="tab = item.value">
          {{ item.label }}<em v-if="item.count">{{ item.count }}</em>
        </button>
      </nav>

      <!-- 筛选：抽签和列表共用 -->
      <section v-if="tab !== 'corrections'" class="cp-card cp-filters" aria-label="筛选">
        <button v-if="!isWide" type="button" class="cp-filter-toggle" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
          <span>筛选{{ activeFilterCount ? ` · ${activeFilterCount} 项` : "" }}</span>
          <small>能抽 {{ result.candidates.length }} 家</small>
          <i aria-hidden="true">{{ filtersOpen ? "收起" : "展开" }}</i>
        </button>
        <template v-if="isWide || filtersOpen">
        <div class="cp-row">
          <span class="cp-label">食堂</span>
          <div class="cp-chips">
            <button v-for="item in catalog.canteens" :key="item.id" type="button" class="cp-chip" :class="{ 'is-on': filters.canteens.includes(item.id) }" :aria-pressed="filters.canteens.includes(item.id)" @click="toggle(filters.canteens, item.id)">{{ item.name }}</button>
          </div>
        </div>
        <div class="cp-row">
          <span class="cp-label">楼层</span>
          <div class="cp-chips">
            <button v-for="level in levels" :key="level" type="button" class="cp-chip" :class="{ 'is-on': filters.levels.includes(level) }" :aria-pressed="filters.levels.includes(level)" @click="toggle(filters.levels, level)">{{ level }} 楼</button>
          </div>
        </div>
        <div class="cp-row">
          <span class="cp-label">品类</span>
          <div class="cp-chips">
            <button v-for="item in CANTEEN_CATEGORIES" :key="item.id" type="button" class="cp-chip" :class="{ 'is-on': filters.categories.includes(item.id) }" :aria-pressed="filters.categories.includes(item.id)" @click="toggle(filters.categories, item.id)">{{ item.name }}</button>
          </div>
        </div>
        <div class="cp-row cp-row--tools">
          <input v-model="filters.query" class="cp-search" type="search" maxlength="40" placeholder="搜店名、品类或“2.2”" aria-label="搜索门店" />
          <select v-model.number="filters.minRating" class="cp-select" aria-label="评分">
            <option :value="0">评分不限</option>
            <option v-for="value in MIN_RATINGS.slice(1)" :key="value" :value="value">{{ value }} 分以上</option>
          </select>
          <select v-model.number="filters.avoidDays" class="cp-select" aria-label="避开最近吃过">
            <option :value="0">不避开吃过的</option>
            <option :value="1">避开今天吃过的</option>
            <option :value="3">避开 3 天内吃过的</option>
            <option :value="7">避开一周内吃过的</option>
          </select>
          <label class="cp-check"><input v-model="filters.preferRated" type="checkbox" />高分店更容易抽中</label>
        </div>
        <p class="cp-scope">
          <span>符合条件 <b>{{ result.matched.length }}</b> 家，能抽 <b>{{ result.candidates.length }}</b> 家</span>
          <span v-if="result.excludedCount">· 不想吃 {{ result.excludedCount }} 家</span>
          <span v-if="result.recentCount">· 最近吃过 {{ result.recentCount }} 家</span>
          <button v-if="hasFilters" type="button" class="cp-link" @click="clearFilters">清空筛选</button>
          <button v-if="state.excluded.length" type="button" class="cp-link" @click="state.excluded = []">恢复全部 {{ state.excluded.length }} 家不想吃的</button>
        </p>
        </template>
      </section>

      <!-- 抽一家 -->
      <template v-if="tab === 'draw'">
        <section class="cp-card cp-draw" :class="{ 'has-result': drawn || rolling }" aria-live="polite">
          <template v-if="rolling || drawn">
            <span class="cp-draw-kicker">{{ rolling ? "正在抽…" : "今天就吃" }}</span>
            <h2 class="cp-draw-name" :class="{ 'is-rolling': rolling }">{{ rolling ? rollingName : drawn!.name }}</h2>
            <template v-if="drawn && !rolling">
              <p class="cp-draw-where">{{ drawn.canteenName }} · {{ drawn.floorCode }} {{ drawn.floorLabel }} · {{ drawn.tags.map(categoryName).join("、") }}</p>
              <p class="cp-draw-score">
                <template v-if="ratings[drawn.id]?.count"><b>★ {{ ratings[drawn.id]!.average.toFixed(1) }}</b> {{ ratings[drawn.id]!.count }} 人评分</template>
                <template v-else>还没有人评分</template>
                <span v-if="mine[drawn.id]"> · 我给过 {{ mine[drawn.id] }} 星</span>
              </p>
              <div class="cp-draw-actions">
                <button type="button" class="cp-btn is-primary" :disabled="eatenToday(drawn.id)" @click="eat(drawn)">{{ eatenToday(drawn.id) ? "已记下" : "就吃这家" }}</button>
                <button type="button" class="cp-btn" :disabled="result.candidates.length < 2" @click="draw">换一家</button>
                <button type="button" class="cp-btn" @click="rejectDrawn">不想吃这家</button>
                <button v-if="!isWide" type="button" class="cp-btn" @click="openDetail(drawn.id)">看评价</button>
              </div>
            </template>
          </template>
          <template v-else-if="result.candidates.length">
            <h2 class="cp-draw-title">选择困难？交给运气。</h2>
            <p class="cp-draw-sub">从 {{ result.candidates.length }} 家里随机抽一家：每个食堂机会相等，最近抽到的先不重复{{ filters.preferRated ? "，高分店概率更高" : "" }}。</p>
            <button type="button" class="cp-btn is-primary is-big" @click="draw">帮我选一家</button>
          </template>
          <template v-else>
            <h2 class="cp-draw-title">没有能抽的店</h2>
            <p class="cp-draw-sub">{{ emptyReason }}</p>
            <div class="cp-draw-actions">
              <button v-if="hasFilters" type="button" class="cp-btn" @click="clearFilters">清空筛选</button>
              <button v-if="result.excludedCount" type="button" class="cp-btn" @click="state.excluded = []">恢复不想吃的店</button>
              <button v-if="result.recentCount" type="button" class="cp-btn" @click="filters.avoidDays = 0">不避开吃过的</button>
            </div>
          </template>
        </section>

        <section v-if="recentMeals.length" class="cp-card cp-history">
          <header><h3>最近吃过</h3><button type="button" class="cp-link" @click="state.history = []">清空</button></header>
          <ul>
            <li v-for="meal in recentMeals" :key="`${meal.id}-${meal.at}`">
              <button type="button" @click="openDetail(meal.shop.id)"><b>{{ meal.shop.name }}</b><small>{{ meal.day }}</small></button>
            </li>
          </ul>
        </section>
      </template>

      <!-- 全部门店 -->
      <section v-else-if="tab === 'list'" class="cp-card cp-list">
        <header class="cp-list-head">
          <h3>{{ result.matched.length }} 家门店</h3>
          <select v-model="sort" class="cp-select" aria-label="排序">
            <option value="location">按位置</option>
            <option value="rating">评分最高</option>
            <option value="count">评价最多</option>
          </select>
        </header>
        <template v-if="sort === 'location'">
          <div v-for="group in groups" :key="group.code" class="cp-group">
            <h4>{{ group.canteenName }} {{ group.label }}<small>{{ group.code }}</small></h4>
            <p v-if="!group.total" class="cp-group-empty">还没有收录门店。<button type="button" class="cp-link" @click="openCorrection(null, group.code)">知道有哪些店？去补充</button></p>
            <ul v-else>
              <li v-for="shop in group.shops" :key="shop.id"><ShopRow :shop="shop" /></li>
            </ul>
          </div>
        </template>
        <ul v-else>
          <li v-for="shop in sortedShops" :key="shop.id"><ShopRow :shop="shop" show-where /></li>
        </ul>
        <p v-if="!result.matched.length" class="cp-group-empty">没有符合条件的门店。</p>
        <p class="cp-list-foot">少了哪家店或信息不对？<button type="button" class="cp-link" @click="openCorrection(null)">提交纠错</button></p>
      </section>

      <!-- 纠错 -->
      <section v-else class="cp-card cp-corrections">
        <header class="cp-list-head">
          <div>
            <h3>门店纠错</h3>
            <p>新增、删除、改名、换位置都可以提。超过 5 位同学认为正确就生效：新增的店直接加进列表，其他修改由 AI 核对后改好。</p>
          </div>
          <button type="button" class="cp-btn is-primary" @click="openCorrection(null)">补充或纠正</button>
        </header>
        <CorrectionList show-shop :reload-key="correctionKey" @loaded="openCorrectionCount = $event" @catalog-may-change="expectCatalogChange" />
      </section>
    </div>

    <!-- 门店详情：宽屏在右侧，窄屏在底部抽屉 -->
    <aside v-if="isWide" class="cp-side">
      <div class="cp-card cp-side-card">
        <ShopDetail
          v-if="selectedShop"
          :shop="selectedShop"
          :rating="ratings[selectedShop.id]"
          :excluded="state.excluded.includes(selectedShop.id)"
          :correction-key="correctionKey"
          @rated="onRated"
          @toggle-exclude="toggleExcluded"
          @correct="openCorrection"
          @catalog-may-change="expectCatalogChange"
        />
        <div v-else class="cp-side-empty">
          <p v-if="missingShop">这家店已经不在目录里了，可能撤店或改名。</p>
          <p v-else>抽一家，或在“全部门店”里点一家店，这里显示评分、评价和纠错。</p>
        </div>
      </div>
    </aside>
    <el-drawer v-else v-model="drawerOpen" direction="btt" size="80%" :with-header="false" class="cp-drawer" :style="drawerStyle" append-to-body>
      <div class="cp-drawer-body" @focusin="revealFocused">
        <button type="button" class="cp-drawer-close" aria-label="关闭" @click="drawerOpen = false">×</button>
        <ShopDetail
          v-if="selectedShop"
          :shop="selectedShop"
          :rating="ratings[selectedShop.id]"
          :excluded="state.excluded.includes(selectedShop.id)"
          :correction-key="correctionKey"
          @rated="onRated"
          @toggle-exclude="toggleExcluded"
          @correct="openCorrection"
          @catalog-may-change="expectCatalogChange"
        />
        <p v-else class="cp-side-empty">这家店已经不在目录里了，可能撤店或改名。</p>
      </div>
    </el-drawer>

    <CorrectionDialog v-model="correctionOpen" :shop="correctionShop" :floor-code="correctionFloor" @submitted="onCorrectionSubmitted" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { toolsApi } from "@/api/tools";
import {
  BASE_CANTEEN_INDEX,
  CANTEEN_CATEGORIES,
  canteenCategoryName as categoryName,
  indexCanteens,
  type CanteenCatalogIndex,
  type CanteenShop,
} from "@/data/canteenPicker";
import {
  MIN_RATINGS,
  STORAGE_KEY,
  addMeal,
  defaultFilters,
  filterShops,
  pickShop,
  relativeDay,
  restoreState,
  secureRandom,
  type PickerState,
  type RatingMap,
} from "./canteen/picker";
import ShopDetail from "./canteen/ShopDetail.vue";
import CorrectionList from "./canteen/CorrectionList.vue";
import CorrectionDialog from "./canteen/CorrectionDialog.vue";

const route = useRoute();
const router = useRouter();

/* ---------- 目录和评分 ---------- */

const catalog = shallowRef<CanteenCatalogIndex>(BASE_CANTEEN_INDEX);
const catalogVersion = ref("");
const ratings = ref<RatingMap>({});
const mine = ref<Record<string, number>>({});
const categoryIds = CANTEEN_CATEGORIES.map((item) => item.id as string);

async function loadCatalog(announce = false) {
  try {
    const data = await toolsApi.canteenCatalog();
    const changed = catalogVersion.value && data.version !== catalogVersion.value;
    catalog.value = data.canteens ? indexCanteens(data.canteens) : BASE_CANTEEN_INDEX;
    catalogVersion.value = data.version;
    if (changed && announce) ElMessage.info("门店信息刚刚更新了");
  } catch {
    // 目录接口失败时继续用内置目录。
  }
}

async function loadSummary() {
  try {
    const data = await toolsApi.canteenSummary();
    ratings.value = data.shops;
    mine.value = data.mine;
    if (catalogVersion.value && data.version !== catalogVersion.value) await loadCatalog(true);
  } catch {
    // 评分加载失败不影响抽签。
  }
}

/* ---------- 本机记住的设置 ---------- */

function readStorage() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
const state = reactive<PickerState>(restoreState(readStorage(), BASE_CANTEEN_INDEX.shops, categoryIds));
const filters = state.filters;
watch(state, () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 隐私模式等情况下不保存 */ }
}, { deep: true });

const levels = computed(() => [...new Set(catalog.value.shops.map((shop) => shop.level))].sort((a, b) => a - b));
const result = computed(() => filterShops(catalog.value.shops, state, ratings.value, categoryName));
const filtersOpen = ref(false);
const activeFilterCount = computed(() => [filters.canteens.length, filters.levels.length, filters.categories.length, filters.query.trim(), filters.minRating, filters.avoidDays, filters.preferRated, state.excluded.length].filter(Boolean).length);
const hasFilters = computed(() => Boolean(filters.canteens.length || filters.levels.length || filters.categories.length || filters.query.trim() || filters.minRating || filters.avoidDays));

function toggle<T>(list: T[], value: T) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
}

function clearFilters() {
  Object.assign(filters, { ...defaultFilters(), preferRated: filters.preferRated });
}

function toggleExcluded(id: string) {
  toggle(state.excluded, id);
}

const emptyReason = computed(() => {
  if (!result.value.matched.length) return hasFilters.value ? "当前筛选下没有门店，放宽一点试试。" : "门店目录还没有加载出来。";
  const parts = [];
  if (result.value.excludedCount) parts.push(`${result.value.excludedCount} 家设成了不想吃`);
  if (result.value.recentCount) parts.push(`${result.value.recentCount} 家最近吃过`);
  return `符合条件的店里，${parts.join("，")}。`;
});

/* ---------- 抽签 ---------- */

const tab = ref<"draw" | "list" | "corrections">("draw");
const drawnId = ref<string | null>(null);
const drawn = computed(() => (drawnId.value ? catalog.value.find(drawnId.value) ?? null : null));
const rolling = ref(false);
const rollingName = ref("");
let rollTimer: ReturnType<typeof setTimeout> | null = null;
/** 这次打开页面以来抽到的店，最近的在前。 */
const recentDraws: string[] = [];

function prefersReducedMotion() {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function draw() {
  const pool = result.value.candidates;
  const picked = pickShop(pool, ratings.value, filters.preferRated, recentDraws);
  if (!picked) return;
  recentDraws.unshift(picked.id);
  recentDraws.splice(5);
  if (rollTimer) clearTimeout(rollTimer);
  const finish = () => {
    rolling.value = false;
    drawnId.value = picked.id;
    selectedId.value = picked.id;
  };
  if (prefersReducedMotion() || pool.length < 2) return finish();
  rolling.value = true;
  let frame = 0;
  const frames = 14;
  const tick = () => {
    frame += 1;
    if (frame >= frames) return finish();
    rollingName.value = pool[Math.floor(secureRandom() * pool.length)].name;
    rollTimer = setTimeout(tick, 40 + frame * frame * 1.2);
  };
  tick();
}

function rejectDrawn() {
  if (!drawn.value) return;
  if (!state.excluded.includes(drawn.value.id)) state.excluded.push(drawn.value.id);
  if (result.value.candidates.length) draw();
  else drawnId.value = null;
}

function eatenToday(id: string) {
  const today = new Date().toDateString();
  return state.history.some((item) => item.id === id && new Date(item.at).toDateString() === today);
}

function eat(shop: CanteenShop) {
  state.history = addMeal(state.history, shop.id);
  ElMessage.success({ message: `记下了，${shop.name}`, duration: 1500 });
}

const recentMeals = computed(() =>
  state.history
    .map((item) => ({ ...item, shop: catalog.value.find(item.id), day: relativeDay(item.at) }))
    .filter((item): item is typeof item & { shop: CanteenShop } => Boolean(item.shop))
    .slice(0, 8),
);

/* ---------- 列表 ---------- */

const sort = ref<"location" | "rating" | "count">("location");
const groups = computed(() => {
  const matched = new Set(result.value.matched.map((shop) => shop.id));
  const narrowed = Boolean(filters.categories.length || filters.query.trim() || filters.minRating);
  return catalog.value.canteens.flatMap((canteen) =>
    canteen.floors
      .filter((floor) => (!filters.canteens.length || filters.canteens.includes(canteen.id)) && (!filters.levels.length || filters.levels.includes(floor.level)))
      .map((floor) => ({
        code: floor.code,
        label: floor.label,
        canteenName: canteen.name,
        total: floor.shops.length,
        shops: floor.shops.filter((shop) => matched.has(shop.id)),
      }))
      .filter((group) => group.shops.length || (!group.total && !narrowed)),
  );
});
const sortedShops = computed(() => {
  const score = (shop: CanteenShop) => ratings.value[shop.id];
  return [...result.value.matched].sort((a, b) => sort.value === "rating"
    ? (score(b)?.count ? score(b)!.average : 0) - (score(a)?.count ? score(a)!.average : 0) || (score(b)?.count ?? 0) - (score(a)?.count ?? 0)
    : (score(b)?.count ?? 0) - (score(a)?.count ?? 0) || (score(b)?.average ?? 0) - (score(a)?.average ?? 0));
});

const ShopRow = defineComponent({
  props: { shop: { type: Object as () => CanteenShop, required: true }, showWhere: Boolean },
  setup(props) {
    return () => {
      const shop = props.shop;
      const rating = ratings.value[shop.id];
      const excluded = state.excluded.includes(shop.id);
      return h("div", { class: ["cp-shop", { "is-excluded": excluded, "is-selected": selectedId.value === shop.id }] }, [
        h("button", { type: "button", class: "cp-shop-main", onClick: () => openDetail(shop.id) }, [
          h("span", { class: "cp-shop-name" }, [
            shop.name,
            props.showWhere ? h("small", `${shop.canteenName} ${shop.floorCode}`) : null,
          ]),
          h("span", { class: "cp-shop-tags" }, shop.tags.map(categoryName).join(" · ")),
          h("span", { class: "cp-shop-score" }, rating?.count ? [h("b", `★ ${rating.average.toFixed(1)}`), ` ${rating.count}`] : "—"),
        ]),
        h("button", {
          type: "button",
          class: "cp-shop-toggle",
          "aria-pressed": excluded,
          title: excluded ? "恢复，让它参加抽签" : "不想吃，抽签时跳过",
          onClick: () => toggleExcluded(shop.id),
        }, excluded ? "恢复" : "不想吃"),
      ]);
    };
  },
});

/* ---------- 详情 ---------- */

const isWide = ref(false);
let wideQuery: MediaQueryList | null = null;
const updateWide = () => { isWide.value = Boolean(wideQuery?.matches); };
const selectedId = ref<string | null>(null);
const selectedShop = computed(() => (selectedId.value ? catalog.value.find(selectedId.value) ?? null : null));
const missingShop = computed(() => Boolean(selectedId.value && !selectedShop.value));
const drawerOpen = ref(false);

/* 手机键盘弹出时，可见区域变矮；抽屉跟着抬到键盘上方并缩短，输入框滚进可见范围。 */
const keyboardInset = ref(0);
const drawerStyle = computed(() => keyboardInset.value > 0
  ? { bottom: `${keyboardInset.value}px`, maxHeight: `calc(100% - ${keyboardInset.value}px - 12px)` }
  : undefined);
function updateKeyboardInset() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const covered = window.innerHeight - viewport.height - viewport.offsetTop;
  keyboardInset.value = covered > 80 ? Math.round(covered) : 0;
}
function revealFocused(event: FocusEvent) {
  const target = event.target as HTMLElement | null;
  if (!target || !/^(TEXTAREA|INPUT)$/.test(target.tagName)) return;
  // 等键盘把可见区域缩完再滚。
  for (const delay of [120, 360]) setTimeout(() => target.scrollIntoView({ block: "nearest" }), delay);
}

function openDetail(id: string) {
  selectedId.value = id;
  if (!isWide.value) drawerOpen.value = true;
}

// 门店改名或换楼层后，选中的店、不想吃和吃过的记录都跟着新 id 走。
watch(catalog, (index) => {
  const current = (id: string) => index.find(id)?.id ?? id;
  const excluded = [...new Set(state.excluded.map(current))];
  if (excluded.join() !== state.excluded.join()) state.excluded = excluded;
  if (state.history.some((item) => current(item.id) !== item.id)) state.history = state.history.map((item) => ({ ...item, id: current(item.id) }));
  if (selectedShop.value && selectedShop.value.id !== selectedId.value) selectedId.value = selectedShop.value.id;
  if (drawn.value && drawn.value.id !== drawnId.value) drawnId.value = drawn.value.id;
});

watch(selectedId, (id) => {
  const query = { ...route.query };
  if (id) query.shop = id;
  else delete query.shop;
  if (query.shop !== route.query.shop) void router.replace({ query });
});

function onRated(payload: { shopId: string; average: number; count: number; mine: number | null }) {
  ratings.value = { ...ratings.value, [payload.shopId]: payload.count ? { average: payload.average, count: payload.count } : undefined };
  const next = { ...mine.value };
  if (payload.mine) next[payload.shopId] = payload.mine;
  else delete next[payload.shopId];
  mine.value = next;
}

/* ---------- 纠错 ---------- */

const correctionOpen = ref(false);
const correctionShop = ref<CanteenShop | null>(null);
const correctionFloor = ref("");
const correctionKey = ref(0);
const openCorrectionCount = ref(0);

function openCorrection(shop: CanteenShop | null, floorCode = "") {
  correctionShop.value = shop;
  correctionFloor.value = floorCode;
  correctionOpen.value = true;
}

function onCorrectionSubmitted() {
  correctionKey.value += 1;
}

const tabs = computed(() => [
  { value: "draw" as const, label: "抽一家", count: 0 },
  { value: "list" as const, label: "全部门店", count: catalog.value.shops.length },
  { value: "corrections" as const, label: "纠错", count: openCorrectionCount.value },
]);

// 过票后 AI 一般几秒内改完；之后几次检查目录版本，改好了就热更新。
const followUps: ReturnType<typeof setTimeout>[] = [];
function expectCatalogChange() {
  for (const delay of [4000, 12000, 30000]) followUps.push(setTimeout(() => {
    void loadSummary();
    correctionKey.value += 1;
  }, delay));
}

/* ---------- 生命周期 ---------- */

let pollTimer: ReturnType<typeof setInterval> | null = null;
const onVisible = () => { if (document.visibilityState === "visible") void loadSummary(); };

onMounted(async () => {
  try {
    wideQuery = matchMedia("(min-width: 1000px)");
    updateWide();
    wideQuery.addEventListener("change", updateWide);
  } catch { /* 老浏览器按窄屏处理 */ }
  window.visualViewport?.addEventListener("resize", updateKeyboardInset);
  window.visualViewport?.addEventListener("scroll", updateKeyboardInset);
  await loadCatalog();
  await loadSummary();
  const shared = typeof route.query.shop === "string" ? route.query.shop : "";
  if (shared && catalog.value.find(shared)) openDetail(catalog.value.find(shared)!.id);
  // 投票数也在这里更新。
  void toolsApi.canteenCorrections().then((data) => {
    openCorrectionCount.value = data.entries.filter((item) => item.status === "voting").length;
  }).catch(() => undefined);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible") void loadSummary(); }, 60_000);
  document.addEventListener("visibilitychange", onVisible);
});

onBeforeUnmount(() => {
  wideQuery?.removeEventListener("change", updateWide);
  window.visualViewport?.removeEventListener("resize", updateKeyboardInset);
  window.visualViewport?.removeEventListener("scroll", updateKeyboardInset);
  if (rollTimer) clearTimeout(rollTimer);
  if (pollTimer) clearInterval(pollTimer);
  followUps.forEach(clearTimeout);
  document.removeEventListener("visibilitychange", onVisible);
});
</script>

<style scoped>
.cp { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; color: var(--cpu-text); }
.cp.is-wide { grid-template-columns: minmax(0, 1fr) 360px; align-items: start; }
.cp-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
.cp-card { min-width: 0; padding: 14px 16px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-l); background: var(--cpu-card); }

.cp-tabs { display: flex; gap: 4px; padding: 3px; border-radius: 999px; background: var(--cpu-surface-subtle); justify-self: start; }
.cp-tabs button { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-m); }
.cp-tabs button.is-active { background: var(--cpu-card); color: var(--cpu-text); font-weight: 600; }
.cp-tabs em { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-style: normal; font-variant-numeric: tabular-nums; }

.cp-filters { display: grid; gap: 8px; }
.cp-filter-toggle { display: flex; align-items: center; gap: 8px; width: 100%; padding: 0; border: 0; background: none; color: var(--cpu-text); cursor: pointer; font: inherit; font-size: var(--cpu-fs-m); text-align: left; }
.cp-filter-toggle span { font-weight: 600; }
.cp-filter-toggle small { flex: 1; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cp-filter-toggle i { color: var(--cpu-primary); font-size: var(--cpu-fs-s); font-style: normal; }
.cp-row { display: flex; align-items: flex-start; gap: 10px; }
.cp-label { flex-shrink: 0; width: 28px; padding-top: 5px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-chip { height: 28px; padding: 0 10px; border: 1px solid var(--cpu-border-soft); border-radius: 999px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }
@media (hover: hover) { .cp-chip:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); } }
.cp-chip.is-on { border-color: var(--cpu-primary); background: var(--cpu-primary); color: var(--cpu-on-primary); }
.cp-row--tools { flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 4px; }
.cp-search { flex: 1 1 180px; min-width: 0; height: 30px; padding: 0 10px; border: 1px solid var(--cpu-border); border-radius: var(--cpu-radius-m); background: var(--cpu-surface); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-s); }
.cp-select { height: 30px; padding: 0 6px; border: 1px solid var(--cpu-border); border-radius: var(--cpu-radius-m); background: var(--cpu-surface); color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-s); }
.cp-search:focus, .cp-select:focus { outline: 2px solid var(--cpu-primary); outline-offset: -1px; }
.cp-check { display: inline-flex; align-items: center; gap: 4px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); cursor: pointer; }
.cp-check input { accent-color: var(--cpu-primary); }
.cp-scope { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 2px 0 0; padding-top: 8px; border-top: 1px solid var(--cpu-border-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.cp-scope b { color: var(--cpu-text); font-variant-numeric: tabular-nums; }
.cp-link { padding: 0; border: 0; background: none; color: var(--cpu-primary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }

.cp-draw { display: grid; justify-items: center; gap: 8px; padding: 28px 16px; text-align: center; }
.cp-draw-title { margin: 0; font-size: var(--cpu-fs-xl); }
.cp-draw-sub { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.cp-draw-kicker { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); letter-spacing: .1em; }
.cp-draw-name { margin: 0; font-size: 32px; line-height: 1.2; overflow-wrap: anywhere; }
.cp-draw-name.is-rolling { color: var(--cpu-text-muted); }
.cp-draw-where { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.cp-draw-score { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cp-draw-score b { color: var(--cpu-hue-amber-ink); }
.cp-draw-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 8px; }
.cp-btn { flex-shrink: 0; height: 32px; padding: 0 14px; white-space: nowrap; border: 1px solid var(--cpu-border); border-radius: 999px; background: var(--cpu-card); color: var(--cpu-text); cursor: pointer; font: inherit; font-size: var(--cpu-fs-m); }
@media (hover: hover) {
  .cp-btn:not(.is-primary):hover:not(:disabled) { border-color: var(--cpu-primary); color: var(--cpu-primary); }
}
.cp-btn:disabled { color: var(--cpu-text-muted); cursor: not-allowed; }
.cp-btn.is-primary { border-color: var(--cpu-primary); background: var(--cpu-primary); color: var(--cpu-on-primary); font-weight: 600; }
.cp-btn.is-primary:hover:not(:disabled) { background: var(--cpu-primary-dark); color: var(--cpu-on-primary); }
.cp-btn.is-primary:disabled { border-color: var(--cpu-border-soft); background: var(--cpu-surface-subtle); color: var(--cpu-text-muted); }
.cp-btn.is-big { height: 40px; margin-top: 8px; padding: 0 28px; font-size: var(--cpu-fs-l); }

.cp-history header, .cp-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cp-history h3, .cp-list-head h3 { margin: 0; font-size: var(--cpu-fs-m); }
.cp-list-head > div { min-width: 0; }
.cp-list-head p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; }
.cp-history ul { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.cp-history li button { display: inline-flex; align-items: baseline; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--cpu-border-soft); border-radius: 999px; background: var(--cpu-surface-soft); color: var(--cpu-text); cursor: pointer; font: inherit; font-size: var(--cpu-fs-s); }
.cp-history small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

.cp-list ul { margin: 0; padding: 0; list-style: none; }
.cp-list > ul { margin-top: 8px; }
.cp-group { margin-top: 12px; }
.cp-group h4 { display: flex; align-items: baseline; gap: 6px; margin: 0 0 4px; font-size: var(--cpu-fs-s); }
.cp-group h4 small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-weight: 400; }
.cp-group-empty { margin: 4px 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cp-list-foot { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--cpu-border-soft); color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cp-list :deep(.cp-shop) { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--cpu-border-soft); }
.cp-list :deep(.cp-shop.is-selected) { background: var(--cpu-primary-soft); }
.cp-list :deep(.cp-shop-main) { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name score" "tags score"; flex: 1; min-width: 0; padding: 8px 4px; border: 0; background: none; color: inherit; cursor: pointer; font: inherit; text-align: left; }
.cp-list :deep(.cp-shop-name) { grid-area: name; overflow: hidden; font-size: var(--cpu-fs-m); text-overflow: ellipsis; white-space: nowrap; }
.cp-list :deep(.cp-shop-name small) { margin-left: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.cp-list :deep(.cp-shop-tags) { grid-area: tags; margin-top: 2px; overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.cp-list :deep(.cp-shop-score) { grid-area: score; align-self: center; padding-left: 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-variant-numeric: tabular-nums; }
.cp-list :deep(.cp-shop-score b) { color: var(--cpu-hue-amber-ink); font-size: var(--cpu-fs-s); }
.cp-list :deep(.cp-shop-toggle) { flex-shrink: 0; height: 24px; padding: 0 8px; border: 1px solid var(--cpu-border-soft); border-radius: 999px; background: transparent; color: var(--cpu-text-muted); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); }
@media (hover: hover) { .cp-list :deep(.cp-shop-toggle:hover) { border-color: var(--cpu-text-muted); color: var(--cpu-text); } }
.cp-list :deep(.cp-shop.is-excluded .cp-shop-main) { opacity: .45; }
.cp-list :deep(.cp-shop.is-excluded .cp-shop-name) { text-decoration: line-through; }
.cp-list :deep(.cp-shop.is-excluded .cp-shop-toggle) { border-color: var(--cpu-primary); color: var(--cpu-primary); }

.cp-corrections { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.cp-corrections .cp-list-head { align-items: flex-start; }

.cp-side { position: sticky; top: 76px; min-width: 0; }
.cp-side-card { max-height: calc(100vh - 96px); overflow-y: auto; }
.cp-side-empty { margin: 0; padding: 24px 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); line-height: 1.7; text-align: center; }
.cp-side-empty p { margin: 0; }
.cp-drawer-body { position: relative; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); }
.cp-drawer-close { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); cursor: pointer; font-size: 20px; line-height: 1; }
.cp-drawer-body :deep(.sd-head) { padding-right: 36px; }

@media (max-width: 560px) {
  .cp-card { padding: 12px; }
  .cp-row { flex-direction: column; gap: 4px; }
  .cp-label { padding-top: 0; }
  .cp-row--tools { flex-direction: row; }
  .cp-draw-name { font-size: 28px; }
}
/* iOS 输入框字号小于 16px 时聚焦会把整页放大。 */
@media (pointer: coarse) {
  .cp-search { font-size: 16px; }
}
</style>

<style>
/* 抽屉挂在 body 上，不在本组件的作用域里。 */
.cp-drawer .el-drawer__body { overflow-y: auto; overscroll-behavior: contain; }
</style>
