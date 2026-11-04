import assert from "node:assert/strict";
import test from "node:test";
import { BASE_CANTEEN_INDEX, canteenCategoryName } from "../src/data/canteenPicker";
import {
  addMeal,
  defaultState,
  filterShops,
  pickShop,
  recentlyEaten,
  relativeDay,
  restoreState,
  shopWeight,
} from "../src/views/services/canteen/picker";

const shops = BASE_CANTEEN_INDEX.shops;
const categories = ["noodle", "rice", "malatang", "snack", "soup", "roast", "western", "regional", "light"];
const NOW = new Date(2026, 10, 4, 12, 0).getTime();

test("filters combine canteen, floor, category, search and rating, then drop excluded and recent shops", () => {
  const state = defaultState();
  state.filters.canteens = ["canteen-2"];
  state.filters.levels = [2];
  state.filters.categories = ["noodle"];
  const noodles = filterShops(shops, state, {}, canteenCategoryName, NOW);
  assert.ok(noodles.matched.length > 0);
  assert.ok(noodles.matched.every((shop) => shop.floorCode === "2.2" && shop.tags.includes("noodle")));

  state.excluded = [noodles.matched[0].id];
  state.history = [{ id: noodles.matched[1].id, at: NOW - 60_000 }];
  state.filters.avoidDays = 1;
  const narrowed = filterShops(shops, state, {}, canteenCategoryName, NOW);
  assert.equal(narrowed.excludedCount, 1);
  assert.equal(narrowed.recentCount, 1);
  assert.equal(narrowed.candidates.length, noodles.matched.length - 2);

  const searched = filterShops(shops, { ...defaultState(), filters: { ...defaultState().filters, query: " 2.3 烤鸭 " } }, {}, canteenCategoryName, NOW);
  assert.deepEqual(searched.matched.map((shop) => shop.name), []);
  const byName = filterShops(shops, { ...defaultState(), filters: { ...defaultState().filters, query: "脆皮" } }, {}, canteenCategoryName, NOW);
  assert.deepEqual(byName.matched.map((shop) => shop.name), ["王记果木脆皮烤鸭"]);
  const byCategory = filterShops(shops, { ...defaultState(), filters: { ...defaultState().filters, query: "烤鸭" } }, {}, canteenCategoryName, NOW);
  assert.ok(byCategory.matched.every((shop) => shop.tags.includes("roast") || shop.name.includes("烤鸭")));

  const rated = filterShops(shops, { ...defaultState(), filters: { ...defaultState().filters, minRating: 4 } }, {
    "1.1::张良麻辣烫": { average: 4.5, count: 3 },
    "1.1::东北风味": { average: 3.9, count: 9 },
  }, canteenCategoryName, NOW);
  assert.deepEqual(rated.matched.map((shop) => shop.id), ["1.1::张良麻辣烫"]);
});

test("draws never repeat the previous shop and weight high ratings only when asked", () => {
  const pool = shops.slice(0, 2);
  for (let i = 0; i < 20; i += 1) assert.equal(pickShop(pool, {}, false, pool[0].id, Math.random)?.id, pool[1].id);
  assert.equal(pickShop([pool[0]], {}, false, pool[0].id)?.id, pool[0].id);
  assert.equal(pickShop([], {}, false), null);
  assert.equal(shopWeight({ average: 5, count: 50 }, false), 1);
  assert.ok(shopWeight({ average: 5, count: 50 }, true) > shopWeight(undefined, true));
  assert.ok(shopWeight({ average: 1, count: 50 }, true) < shopWeight(undefined, true));
  // A single 5-star review does not make a shop dominate.
  assert.ok(shopWeight({ average: 5, count: 1 }, true) < shopWeight({ average: 5, count: 40 }, true));
});

test("saved settings survive reloads and invalid values are dropped", () => {
  const raw = JSON.stringify({
    filters: { canteens: ["canteen-1", "nope"], levels: [2, 9], categories: ["noodle", "bad"], query: "面", minRating: 4, avoidDays: 3, preferRated: true },
    excluded: ["1.1::张良麻辣烫", "1.3::纠错后新开的店", "<script>"],
    history: [{ id: "2.1::塔斯汀", at: NOW - 1000 }, { id: "2.1::塔斯汀", at: "x" }],
  });
  const state = restoreState(raw, shops, categories, NOW);
  assert.deepEqual(state.filters, { canteens: ["canteen-1"], levels: [2], categories: ["noodle"], query: "面", minRating: 4, avoidDays: 3, preferRated: true });
  assert.deepEqual(state.excluded, ["1.1::张良麻辣烫", "1.3::纠错后新开的店"]);
  assert.equal(state.history.length, 1);
  assert.deepEqual(restoreState("{not json", shops, categories, NOW), defaultState());
});

test("meal history keeps one entry per shop per day and labels days", () => {
  let history = addMeal([], "2.1::塔斯汀", NOW);
  history = addMeal(history, "2.1::塔斯汀", NOW + 60_000);
  assert.equal(history.length, 1);
  history = addMeal(history, "2.1::塔斯汀", NOW + 24 * 3600_000);
  assert.equal(history.length, 2);
  assert.equal(relativeDay(NOW, NOW), "今天");
  assert.equal(relativeDay(NOW - 24 * 3600_000, NOW), "昨天");
  assert.equal(relativeDay(NOW - 3 * 24 * 3600_000, NOW), "3 天前");
  assert.ok(recentlyEaten([{ id: "a", at: NOW - 2 * 24 * 3600_000 }], 3, NOW).has("a"));
  assert.ok(!recentlyEaten([{ id: "a", at: NOW - 2 * 24 * 3600_000 }], 1, NOW).has("a"));
});
