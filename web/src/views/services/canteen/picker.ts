import type { CanteenShop } from "@/data/canteenPicker";

export type ShopRating = { average: number; count: number };
export type RatingMap = Record<string, ShopRating | undefined>;
export type MealRecord = { id: string; at: number };

export interface PickerFilters {
  canteens: string[];
  levels: number[];
  categories: string[];
  query: string;
  /** 0 表示不限；只看评分不低于它、且有人评过的店。 */
  minRating: number;
  /** 避开多少天内记为“就吃这家”的店，0 表示不避开。 */
  avoidDays: number;
  /** 抽签时让高分店更容易被抽中。 */
  preferRated: boolean;
}

export interface PickerState {
  filters: PickerFilters;
  excluded: string[];
  history: MealRecord[];
}

export const STORAGE_KEY = "cpu-canteen-picker-v2";
export const HISTORY_LIMIT = 30;
export const MIN_RATINGS = [0, 3.5, 4, 4.5];
export const AVOID_DAYS = [0, 1, 3, 7];
const DAY = 24 * 60 * 60 * 1000;

export function defaultFilters(): PickerFilters {
  return { canteens: [], levels: [], categories: [], query: "", minRating: 0, avoidDays: 0, preferRated: false };
}

export function defaultState(): PickerState {
  return { filters: defaultFilters(), excluded: [], history: [] };
}

function stringList(value: unknown, allowed: Set<string>) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))] : [];
}

const shopIdPattern = /^\d+\.\d+::.{1,60}$/u;

/**
 * 读回本机保存的设置，丢掉非法值。门店可能是纠错后新增或改名的，内置目录里没有，
 * 所以门店 id 只检查格式，不要求在 shops 里。
 */
export function restoreState(raw: string | null | undefined, shops: CanteenShop[], categories: string[], now = Date.now()): PickerState {
  const state = defaultState();
  if (!raw) return state;
  let data: any;
  try { data = JSON.parse(raw); } catch { return state; }
  if (!data || typeof data !== "object") return state;
  const canteenIds = new Set(shops.map((shop) => shop.canteenId));
  const levels = new Set(shops.map((shop) => shop.level));
  const f = data.filters && typeof data.filters === "object" ? data.filters : {};
  state.filters = {
    canteens: stringList(f.canteens, canteenIds),
    levels: Array.isArray(f.levels) ? [...new Set(f.levels.filter((item: unknown) => typeof item === "number" && levels.has(item)))] as number[] : [],
    categories: stringList(f.categories, new Set(categories)),
    query: typeof f.query === "string" ? f.query.slice(0, 40) : "",
    minRating: MIN_RATINGS.includes(f.minRating) ? f.minRating : 0,
    avoidDays: AVOID_DAYS.includes(f.avoidDays) ? f.avoidDays : 0,
    preferRated: f.preferRated === true,
  };
  const validShopId = (value: unknown): value is string => typeof value === "string" && shopIdPattern.test(value);
  state.excluded = Array.isArray(data.excluded) ? [...new Set(data.excluded.filter(validShopId))].slice(0, 300) as string[] : [];
  state.history = Array.isArray(data.history)
    ? data.history
        .filter((item: any) => item && validShopId(item.id) && Number.isFinite(item.at) && item.at <= now + DAY && item.at > now - 60 * DAY)
        .map((item: any) => ({ id: item.id as string, at: item.at as number }))
        .sort((a: MealRecord, b: MealRecord) => b.at - a.at)
        .slice(0, HISTORY_LIMIT)
    : [];
  return state;
}

export function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** 店名、食堂、楼层编号都能搜，例如“二食堂”“2.2”“牛肉”。 */
export function matchesQuery(shop: CanteenShop, query: string, categoryName: (id: string) => string) {
  const q = normalizeQuery(query);
  if (!q) return true;
  const haystack = [shop.name, shop.canteenName, shop.floorCode, `${shop.canteenName}${shop.floorLabel}`, ...shop.tags.map(categoryName)]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, "");
  return haystack.includes(q);
}

export function recentlyEaten(history: MealRecord[], days: number, now = Date.now()) {
  if (!days) return new Set<string>();
  // “今天”按自然日算，其余按天数往前推。
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = start.getTime() - (days - 1) * DAY;
  return new Set(history.filter((item) => item.at >= since).map((item) => item.id));
}

export type ShopFilterResult = {
  /** 满足食堂、楼层、品类、搜索和评分条件的店。 */
  matched: CanteenShop[];
  /** 再去掉“不想吃”和最近吃过的，能参加抽签的店。 */
  candidates: CanteenShop[];
  excludedCount: number;
  recentCount: number;
};

export function filterShops(
  shops: CanteenShop[],
  state: PickerState,
  ratings: RatingMap,
  categoryName: (id: string) => string,
  now = Date.now(),
): ShopFilterResult {
  const { filters } = state;
  const excluded = new Set(state.excluded);
  const recent = recentlyEaten(state.history, filters.avoidDays, now);
  const matched = shops.filter((shop) => {
    if (filters.canteens.length && !filters.canteens.includes(shop.canteenId)) return false;
    if (filters.levels.length && !filters.levels.includes(shop.level)) return false;
    if (filters.categories.length && !shop.tags.some((tag) => filters.categories.includes(tag))) return false;
    if (filters.minRating) {
      const rating = ratings[shop.id];
      if (!rating?.count || rating.average < filters.minRating) return false;
    }
    return matchesQuery(shop, filters.query, categoryName);
  });
  let excludedCount = 0;
  let recentCount = 0;
  const candidates = matched.filter((shop) => {
    if (excluded.has(shop.id)) { excludedCount += 1; return false; }
    if (recent.has(shop.id)) { recentCount += 1; return false; }
    return true;
  });
  return { matched, candidates, excludedCount, recentCount };
}

/** 抽签权重：没评分或评分少的店按 3 分算，避免新店永远抽不到。 */
export function shopWeight(rating: ShopRating | undefined, preferRated: boolean) {
  if (!preferRated) return 1;
  const count = rating?.count ?? 0;
  // 评分人数少时向 3 分收缩。
  const score = (3 * 2 + (rating?.average ?? 0) * count) / (2 + count);
  return Math.max(0.2, (score - 1) ** 2);
}

export function secureRandom() {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 0x100000000;
  } catch {
    return Math.random();
  }
}

/** 按权重抽一家；有多家可选时不会连续抽到同一家。 */
export function pickShop(
  candidates: CanteenShop[],
  ratings: RatingMap,
  preferRated: boolean,
  previousId?: string | null,
  random: () => number = secureRandom,
) {
  let pool = candidates;
  if (pool.length > 1 && previousId) pool = pool.filter((shop) => shop.id !== previousId);
  if (!pool.length) return null;
  const weights = pool.map((shop) => shopWeight(ratings[shop.id], preferRated));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let target = random() * total;
  for (let index = 0; index < pool.length; index += 1) {
    target -= weights[index];
    if (target < 0) return pool[index];
  }
  return pool[pool.length - 1];
}

export function addMeal(history: MealRecord[], id: string, now = Date.now()) {
  // 同一天同一家只记一次。
  const day = new Date(now).toDateString();
  const rest = history.filter((item) => !(item.id === id && new Date(item.at).toDateString() === day));
  return [{ id, at: now }, ...rest].slice(0, HISTORY_LIMIT);
}

export function relativeDay(at: number, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((start.getTime() - at) / DAY) + 1;
  if (at >= start.getTime()) return "今天";
  if (diff <= 1) return "昨天";
  if (diff === 2) return "前天";
  if (diff < 7) return `${diff} 天前`;
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
