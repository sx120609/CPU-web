/**
 * 中国药科大学食堂门店目录，网页和服务端共用。
 *
 * - 门店 id 是 `楼层编号::店名`，评分按这个 id 存。改店名会让旧评分对不上，
 *   所以改名时把旧 id 写进 `formerIds`，服务端会把旧评分算到新店名上。
 * - 分类定义在 CANTEEN_CATEGORIES，门店标签使用分类 id。
 * - 一食堂三楼（1.3）暂未提供门店数据，保留为空楼层。
 */

export const CANTEEN_CATEGORIES = [
  { id: "malatang", name: "麻辣烫·香锅" },
  { id: "noodle", name: "面·粉" },
  { id: "rice", name: "米饭·套餐" },
  { id: "snack", name: "饼·小吃" },
  { id: "soup", name: "粥汤·馄饨" },
  { id: "roast", name: "烤肉·烤鸭" },
  { id: "western", name: "汉堡·披萨" },
  { id: "regional", name: "地方风味" },
  { id: "light", name: "轻食" },
] as const;

export type CanteenCategoryId = (typeof CANTEEN_CATEGORIES)[number]["id"];

export interface CanteenShop {
  id: string;
  name: string;
  tags: CanteenCategoryId[];
  canteenId: string;
  canteenName: string;
  floorCode: string;
  floorLabel: string;
  level: number;
  formerIds: string[];
}

export interface CanteenFloor {
  code: string;
  label: string;
  level: number;
  shops: CanteenShop[];
}

export interface Canteen {
  id: string;
  name: string;
  floors: CanteenFloor[];
}

type ShopSpec = { name: string; tags: CanteenCategoryId[]; formerNames?: string[] };

const CATEGORY_IDS = new Set<string>(CANTEEN_CATEGORIES.map((category) => category.id));
const CATEGORY_NAMES = new Map<string, string>(CANTEEN_CATEGORIES.map((category) => [category.id, category.name]));

function shop(name: string, tags: CanteenCategoryId[], formerNames: string[] = []): ShopSpec {
  return { name, tags, formerNames };
}

function floor(code: string, label: string, level: number, specs: ShopSpec[]) {
  return { code, label, level, specs };
}

function canteen(id: string, name: string, floors: ReturnType<typeof floor>[]): Canteen {
  return {
    id,
    name,
    floors: floors.map((item) => {
      const seen = new Set<string>();
      return {
        code: item.code,
        label: item.label,
        level: item.level,
        shops: item.specs.map((spec) => {
          for (const tag of spec.tags) {
            if (!CATEGORY_IDS.has(tag)) throw new Error(`未知分类 "${tag}"，请检查 ${item.code} ${spec.name}`);
          }
          const shopId = `${item.code}::${spec.name}`;
          if (seen.has(shopId)) throw new Error(`同一楼层出现重复店名 "${spec.name}"，请检查 ${item.code}`);
          seen.add(shopId);
          return {
            id: shopId,
            name: spec.name,
            tags: [...new Set(spec.tags)],
            canteenId: id,
            canteenName: name,
            floorCode: item.code,
            floorLabel: item.label,
            level: item.level,
            formerIds: (spec.formerNames || []).map((former) => `${item.code}::${former}`),
          };
        }),
      };
    }),
  };
}

export const BASE_CANTEENS: Canteen[] = [
  canteen("canteen-1", "一食堂", [
    floor("1.1", "一楼", 1, [
      shop("张良麻辣烫", ["malatang"]),
      shop("东北风味", ["regional", "rice"]),
      shop("东北铁锅炖", ["regional", "rice"]),
      shop("洋食屋蛋包饭", ["rice", "western"]),
      shop("手工大包面条馄饨", ["noodle", "soup", "snack"]),
      shop("妙老板双拼饭", ["rice"]),
      shop("谷膳卤味饭", ["rice"]),
      shop("粥员外", ["soup"]),
      shop("巴尔郎鸡公煲", ["regional", "rice"]),
      shop("淮南牛肉汤", ["soup", "regional"]),
      shop("煎饼来了", ["snack"]),
      shop("烤肉拌饭", ["roast", "rice"]),
      shop("牛肉米线", ["noodle"]),
      shop("重庆小面", ["noodle", "regional"]),
      shop("和善园手工大包", ["snack"]),
      shop("七宝炒饭", ["rice"]),
      shop("板煮演义", ["rice"]),
      shop("炊思源馄饨", ["soup"]),
      shop("悦轻荷", ["light"]),
      shop("宿莱堡", ["western"]),
    ]),
    floor("1.2", "二楼", 2, [
      shop("巴郎火锅烧烤麻辣烫", ["malatang", "roast"]),
      shop("民族风味快餐", ["regional", "rice"]),
      shop("兰州牛肉面", ["noodle", "regional"]),
      shop("西安面庄", ["noodle", "regional"]),
      shop("刘云楠云南小锅米线", ["noodle", "regional"]),
      shop("张府园大碗面", ["noodle"]),
      shop("菌小满", ["soup"]),
      shop("牛肉蘸水菜", ["regional", "rice"]),
      shop("济群食坊", ["rice"]),
      shop("甜芸手作汉堡", ["western"]),
    ]),
    floor("1.3", "三楼", 3, []),
  ]),
  canteen("canteen-2", "二食堂", [
    floor("2.1", "一楼", 1, [
      shop("袁记云饺", ["soup", "snack"]),
      shop("杂粮煎饼", ["snack"]),
      shop("掉渣饼", ["snack"], ["掉渣饼卫孔记"]),
      shop("卫孔记面馆", ["noodle"]),
      shop("精品快餐", ["rice"]),
      shop("手工鲜包营养粥", ["soup", "snack"]),
      shop("亦鱼亦饭", ["rice"]),
      shop("辣椒炒肉", ["rice", "regional"]),
      shop("青海牛肉拉面", ["noodle", "regional"]),
      shop("迷亚披萨", ["western"]),
      shop("江南美食", ["rice", "regional"]),
      shop("蘸水菜", ["rice", "regional"]),
      shop("煲仔饭", ["rice", "regional"]),
      shop("重庆小面", ["noodle", "regional"]),
      shop("塔斯汀", ["western"]),
      shop("瓦香鸡", ["rice"]),
      shop("麻辣烫", ["malatang"]),
    ]),
    floor("2.2", "二楼", 2, [
      shop("柳州招牌粉", ["noodle", "regional"]),
      shop("意美达", ["western"]),
      shop("麻辣拌麻辣烫麻辣香锅", ["malatang"]),
      shop("酥大娘中国烧饼", ["snack"]),
      shop("酷堡王", ["western"]),
      shop("手工馄饨水饺", ["soup"]),
      shop("油泼面", ["noodle", "regional"]),
      shop("豆花饭", ["rice", "regional"]),
      shop("滑蛋饭", ["rice"]),
      shop("猪肚鸡", ["soup", "regional"]),
      shop("吊龙牛肉汤", ["soup", "regional"]),
      shop("江西小炒", ["rice", "regional"]),
      shop("铁板炒饭", ["rice"]),
      shop("现炒浇头面", ["noodle"]),
      shop("鲍汁捞饭", ["rice"]),
      shop("军歌家膳", ["rice"]),
      shop("猪脚饭", ["rice", "regional"]),
      shop("港式烤鸭饭", ["rice", "roast", "regional"]),
      shop("喜掌柜", ["rice"]),
    ]),
    floor("2.3", "三楼", 3, [
      shop("王记果木脆皮烤鸭", ["roast", "rice", "regional"]),
      shop("徐州骨香米线", ["noodle", "soup", "regional"]),
      shop("潮汕粿条福鼎肉片", ["noodle", "soup", "regional"]),
      shop("阿兵套餐饭", ["rice"]),
      shop("朱家小馆羊杂面", ["noodle", "soup", "regional"]),
      shop("手工馄饨", ["soup"]),
      shop("蛋包饭", ["rice", "western"]),
      shop("鸡排饭", ["rice", "roast"]),
      shop("李记黄焖鸡", ["rice", "regional"]),
      shop("淮蓝香牛肉汤", ["soup", "regional"]),
      shop("新疆炒米粉", ["noodle", "regional"]),
      shop("鸡汤砂锅", ["soup"]),
      shop("堡中霸", ["western"]),
      shop("煲老太下饭砂锅煲", ["rice", "regional"]),
      shop("律食魔方", ["light"]),
    ]),
  ]),
];

/* ---------- 门店纠错生效后的修改 ---------- */

export const CANTEEN_SHOP_NAME_MAX = 24;

export type CanteenPatch =
  | { op: "rename"; shopId: string; name: string }
  | { op: "remove"; shopId: string }
  | { op: "move"; shopId: string; floorCode: string }
  | { op: "retag"; shopId: string; tags: CanteenCategoryId[] }
  | { op: "add"; floorCode: string; name: string; tags: CanteenCategoryId[] };

export interface CanteenCatalogIndex {
  canteens: Canteen[];
  shops: CanteenShop[];
  /** 按当前或曾用 id 找门店。 */
  find(id: string): CanteenShop | undefined;
}

export function canteenCategoryName(id: string) {
  return CATEGORY_NAMES.get(id) || id;
}

export function isCanteenCategory(id: unknown): id is CanteenCategoryId {
  return typeof id === "string" && CATEGORY_IDS.has(id);
}

/** 门店的当前 id 和全部曾用 id，查评分时用。 */
export function canteenShopIds(item: CanteenShop) {
  return [item.id, ...item.formerIds];
}

export function normalizeCanteenShopName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim().replace(/::/g, ":");
}

export function indexCanteens(canteens: Canteen[]): CanteenCatalogIndex {
  const shops = canteens.flatMap((item) => item.floors.flatMap((floorItem) => floorItem.shops));
  const byId = new Map<string, CanteenShop>();
  // 当前 id 优先于别的店的曾用 id。
  for (const item of shops) for (const former of item.formerIds) byId.set(former, item);
  for (const item of shops) byId.set(item.id, item);
  return { canteens, shops, find: (id: string) => byId.get(id) };
}

function cloneCanteens(canteens: Canteen[]): Canteen[] {
  return canteens.map((item) => ({
    ...item,
    floors: item.floors.map((floorItem) => ({
      ...floorItem,
      shops: floorItem.shops.map((shopItem) => ({ ...shopItem, tags: [...shopItem.tags], formerIds: [...shopItem.formerIds] })),
    })),
  }));
}

function findFloor(canteens: Canteen[], code: string) {
  for (const item of canteens) {
    const floorItem = item.floors.find((candidate) => candidate.code === code);
    if (floorItem) return { canteen: item, floor: floorItem };
  }
  return null;
}

function locateShop(canteens: Canteen[], id: string) {
  for (const exact of [true, false]) {
    for (const item of canteens) {
      for (const floorItem of item.floors) {
        const index = floorItem.shops.findIndex((candidate) => exact ? candidate.id === id : candidate.formerIds.includes(id));
        if (index >= 0) return { canteen: item, floor: floorItem, index, shop: floorItem.shops[index] };
      }
    }
  }
  return null;
}

function validTags(tags: unknown): CanteenCategoryId[] | null {
  if (!Array.isArray(tags) || !tags.length || tags.length > 4) return null;
  const unique = [...new Set(tags)];
  return unique.every(isCanteenCategory) ? unique as CanteenCategoryId[] : null;
}

/** 把一条修改套到目录上，返回新目录或不能套用的原因；不修改传入的目录。 */
export function applyCanteenPatch(canteens: Canteen[], patch: CanteenPatch): { canteens: Canteen[] } | { error: string } {
  const next = cloneCanteens(canteens);
  const nameOk = (name: string) => name.length >= 2 && [...name].length <= CANTEEN_SHOP_NAME_MAX;
  if (patch.op === "add") {
    const target = findFloor(next, patch.floorCode);
    if (!target) return { error: "没有这个楼层" };
    const name = normalizeCanteenShopName(patch.name);
    if (!nameOk(name)) return { error: "店名长度不合适" };
    const tags = validTags(patch.tags);
    if (!tags) return { error: "品类不正确" };
    const id = `${target.floor.code}::${name}`;
    if (target.floor.shops.some((item) => item.id === id || item.name === name)) return { error: "这个楼层已经有同名门店" };
    target.floor.shops.push({
      id, name, tags,
      canteenId: target.canteen.id, canteenName: target.canteen.name,
      floorCode: target.floor.code, floorLabel: target.floor.label, level: target.floor.level,
      formerIds: [],
    });
    return { canteens: next };
  }
  const found = locateShop(next, patch.shopId);
  if (!found) return { error: "门店已经不存在" };
  const { shop: current, floor: fromFloor, index } = found;
  if (patch.op === "remove") {
    fromFloor.shops.splice(index, 1);
    return { canteens: next };
  }
  if (patch.op === "retag") {
    const tags = validTags(patch.tags);
    if (!tags) return { error: "品类不正确" };
    if (tags.length === current.tags.length && tags.every((tag) => current.tags.includes(tag))) return { error: "品类没有变化" };
    current.tags = tags;
    return { canteens: next };
  }
  if (patch.op === "rename") {
    const name = normalizeCanteenShopName(patch.name);
    if (!nameOk(name)) return { error: "店名长度不合适" };
    if (name === current.name) return { error: "店名没有变化" };
    const id = `${current.floorCode}::${name}`;
    if (fromFloor.shops.some((item) => item !== current && (item.id === id || item.name === name))) return { error: "这个楼层已经有同名门店" };
    current.formerIds = [...new Set([...current.formerIds, current.id])].filter((former) => former !== id);
    current.id = id;
    current.name = name;
    return { canteens: next };
  }
  if (patch.op === "move") {
    const target = findFloor(next, patch.floorCode);
    if (!target) return { error: "没有这个楼层" };
    if (target.floor === fromFloor) return { error: "楼层没有变化" };
    const id = `${target.floor.code}::${current.name}`;
    if (target.floor.shops.some((item) => item.id === id || item.name === current.name)) return { error: "目标楼层已经有同名门店" };
    fromFloor.shops.splice(index, 1);
    target.floor.shops.push({
      ...current,
      id,
      canteenId: target.canteen.id, canteenName: target.canteen.name,
      floorCode: target.floor.code, floorLabel: target.floor.label, level: target.floor.level,
      formerIds: [...new Set([...current.formerIds, current.id])].filter((former) => former !== id),
    });
    return { canteens: next };
  }
  return { error: "不支持的修改" };
}

/** 依次套用全部已生效的纠错；每条纠错的修改一起套用，套不上的整条跳过（例如门店后来被别的修改删掉了）。 */
export function buildCanteenCatalog(groups: (CanteenPatch | CanteenPatch[])[], base: Canteen[] = BASE_CANTEENS) {
  let canteens = base;
  for (const group of groups) {
    const result = applyCanteenPatches(canteens, Array.isArray(group) ? group : [group]);
    if ("canteens" in result) canteens = result.canteens;
  }
  return indexCanteens(canteens);
}

/** 解析并校验数据库或 AI 给出的修改，结构不对就返回 null。 */
export function parseCanteenPatch(value: unknown): CanteenPatch | null {
  let data: any = value;
  if (typeof value === "string") {
    try { data = JSON.parse(value); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const str = (key: string) => (typeof data[key] === "string" ? data[key].trim() : "");
  switch (data.op) {
    case "rename": return str("shopId") && str("name") ? { op: "rename", shopId: str("shopId"), name: normalizeCanteenShopName(data.name) } : null;
    case "remove": return str("shopId") ? { op: "remove", shopId: str("shopId") } : null;
    case "move": return str("shopId") && str("floorCode") ? { op: "move", shopId: str("shopId"), floorCode: str("floorCode") } : null;
    case "retag": {
      const tags = validTags(data.tags);
      return str("shopId") && tags ? { op: "retag", shopId: str("shopId"), tags } : null;
    }
    case "add": {
      const tags = validTags(data.tags);
      return str("floorCode") && str("name") && tags ? { op: "add", floorCode: str("floorCode"), name: normalizeCanteenShopName(data.name), tags } : null;
    }
    default: return null;
  }
}

/** 一条纠错最多带几条修改（例如拆店 = 改名 + 新增）。 */
export const CANTEEN_PATCHES_MAX = 4;

/** 解析一条纠错的全部修改：单条或数组；任意一条不合格就整体作废。 */
export function parseCanteenPatches(value: unknown): CanteenPatch[] | null {
  let data: any = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try { data = JSON.parse(value); } catch { return null; }
  }
  const list = Array.isArray(data) ? data : [data];
  if (!list.length || list.length > CANTEEN_PATCHES_MAX) return null;
  const patches = list.map(parseCanteenPatch);
  return patches.every(Boolean) ? patches as CanteenPatch[] : null;
}

/** 依次套用一组修改，任何一条套不上就整体失败。 */
export function applyCanteenPatches(canteens: Canteen[], patches: CanteenPatch[]): { canteens: Canteen[] } | { error: string } {
  let current = canteens;
  for (const patch of patches) {
    const result = applyCanteenPatch(current, patch);
    if ("error" in result) return result;
    current = result.canteens;
  }
  return { canteens: current };
}

/** 给人看的一句话描述，用修改前的目录找店名和楼层。 */
export function describeCanteenPatch(patch: CanteenPatch, before: CanteenCatalogIndex) {
  const floorName = (code: string) => {
    const hit = findFloor(before.canteens, code);
    return hit ? `${hit.canteen.name}${hit.floor.label}` : code;
  };
  const shopName = (id: string) => before.find(id)?.name || id.split("::").pop() || id;
  switch (patch.op) {
    case "rename": return `「${shopName(patch.shopId)}」改名为「${patch.name}」`;
    case "remove": return `移除「${shopName(patch.shopId)}」`;
    case "move": return `「${shopName(patch.shopId)}」移到${floorName(patch.floorCode)}`;
    case "retag": return `「${shopName(patch.shopId)}」的品类改为 ${patch.tags.map(canteenCategoryName).join("、")}`;
    case "add": return `${floorName(patch.floorCode)}新增「${patch.name}」`;
  }
}

/** 没有任何修改时的目录，网页首屏先用它。 */
export const BASE_CANTEEN_INDEX = indexCanteens(BASE_CANTEENS);
export const CANTEEN_FLOORS = BASE_CANTEENS.flatMap((item) =>
  item.floors.map((floorItem) => ({ code: floorItem.code, label: floorItem.label, level: floorItem.level, canteenId: item.id, canteenName: item.name })),
);
