/**
 * 中国药科大学食堂门店数据
 *
 * 分类是初版人工归类，可继续调整：
 * - 修改店名：改 shop("店名", [...分类]) 中的店名。
 * - 增加门店：在对应 floor(...) 的数组里增加一行。
 * - 分类定义在 CATEGORIES，门店标签使用分类 id。
 *
 * 一食堂三楼（1.3）暂未提供门店数据，保留为空楼层。
 * 店名和备注均通过 textContent 渲染，不会被当作 HTML 解析。
 */

export const CATEGORIES = [
  { id: "malatang", name: "麻辣烫 · 香锅" },
  { id: "noodle", name: "面食 · 粉面" },
  { id: "rice", name: "米饭 · 套餐" },
  { id: "snack", name: "饼类 · 小吃" },
  { id: "soup", name: "粥汤 · 馄饨" },
  { id: "roast", name: "烤肉 · 烤鸭" },
  { id: "western", name: "汉堡 · 披萨" },
  { id: "regional", name: "地方风味" },
  { id: "light", name: "轻食 · 其他" },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id));
const CATEGORY_NAMES = new Map(CATEGORIES.map((category) => [category.id, category.name]));

function shop(name: string, tags: string[]) {
  return { name, tags };
}

function floor(code: string, label: string, level: number, shops: ReturnType<typeof shop>[]) {
  const seen = new Set();
  return {
    code,
    label,
    level,
    shops: shops.map((item) => {
      for (const tag of item.tags) {
        if (!CATEGORY_IDS.has(tag)) {
          throw new Error(`未知分类 "${tag}"，请检查 ${code} ${item.name}`);
        }
      }
      const id = `${code}::${item.name}`;
      if (seen.has(id)) {
        throw new Error(`同一楼层出现重复店名 "${item.name}"，请检查 ${code}`);
      }
      seen.add(id);
      return {
        id,
        name: item.name,
        tags: [...new Set(item.tags)],
      };
    }),
  };
}

export const CANTEENS = [
  {
    id: "canteen-1",
    name: "一食堂",
    floors: [
      floor("1.1", "一楼", 1, [
        shop("张良麻辣烫", ["malatang"]),
        shop("东北风味", ["regional", "rice"]),
        shop("东北铁锅炖", ["regional", "rice"]),
        shop("洋食屋蛋包饭", ["rice"]),
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
    ],
  },
  {
    id: "canteen-2",
    name: "二食堂",
    floors: [
      floor("2.1", "一楼", 1, [
        shop("袁记云饺", ["soup", "snack"]),
        shop("杂粮煎饼", ["snack"]),
        shop("掉渣饼卫孔记", ["snack"]),
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
        shop("蛋包饭", ["rice"]),
        shop("鸡排饭", ["rice", "roast"]),
        shop("李记黄焖鸡", ["rice", "regional"]),
        shop("淮蓝香牛肉汤", ["soup", "regional"]),
        shop("新疆炒米粉", ["noodle", "regional"]),
        shop("鸡汤砂锅", ["soup"]),
        shop("堡中霸", ["western"]),
        shop("煲老太下饭砂锅煲", ["rice", "regional"]),
        shop("律食魔方", ["light"]),
      ]),
    ],
  },
];

/** 带食堂、楼层和分类信息的扁平门店列表。 */
export const ALL_SHOPS = CANTEENS.flatMap((canteen) =>
  canteen.floors.flatMap((floorItem) =>
    floorItem.shops.map((item) => ({
      ...item,
      canteenId: canteen.id,
      canteenName: canteen.name,
      floorCode: floorItem.code,
      floorLabel: floorItem.label,
      level: floorItem.level,
    })),
  ),
);

export const FLOOR_LEVELS = [
  ...new Set(CANTEENS.flatMap((canteen) => canteen.floors.map((floorItem) => floorItem.level))),
].sort((a, b) => a - b);

export const FLOOR_COUNT = CANTEENS.reduce(
  (total, canteen) => total + canteen.floors.length,
  0,
);

export const POPULATED_FLOOR_COUNT = CANTEENS.reduce(
  (total, canteen) => total + canteen.floors.filter((floorItem) => floorItem.shops.length > 0).length,
  0,
);

export const EMPTY_FLOORS = CANTEENS.flatMap((canteen) =>
  canteen.floors
    .filter((floorItem) => floorItem.shops.length === 0)
    .map((floorItem) => ({
      canteenId: canteen.id,
      canteenName: canteen.name,
      code: floorItem.code,
      label: floorItem.label,
      level: floorItem.level,
    })),
);

export const TOTAL_SHOPS = ALL_SHOPS.length;

export function categoryName(id: string) {
  return CATEGORY_NAMES.get(id) || id;
}

export type CanteenShop = (typeof ALL_SHOPS)[number];
export type CanteenCategory = (typeof CATEGORIES)[number];
