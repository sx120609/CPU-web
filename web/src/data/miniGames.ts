export interface MiniGame {
  slug: string;
  name: string;
  summary: string;
  routeName: string;
  cover: string;
  hue: "brand" | "blue" | "orange" | "green" | "amber" | "violet";
  tags: string[];
  /** 本机最高分的 localStorage 键；合集页的“我的最高”取它和云端最高分里较大的一个。 */
  bestStorageKey: string;
  /** 排行榜接口，登录后返回的 me.bestScore 是账号在所有设备上的最高分。 */
  leaderboardPath: string;
}

// 合集页的路径。新游戏要全屏，路由上有两件事都得做：
// 1. 路径放在 /services/tools/yaoda-can-fly 之下：已发布的安卓和 iOS 壳只对这个前缀隐藏自己的顶栏和底栏；
// 2. 路由 meta 带 immersive: true：鸿蒙壳不看路径，看网页里有没有站点顶栏，带上它布局就不渲染顶栏。
export const MINI_GAMES_PATH = "/services/tools/games";

export const miniGames: MiniGame[] = [
  {
    slug: "yaoda-can-fly",
    name: "药大人能飞",
    summary: "操控飞行胶囊，穿过一座座药学实验装置",
    routeName: "service-yaoda-can-fly",
    cover: "🛫",
    hue: "blue",
    tags: ["全校排行", "14 枚成就"],
    bestStorageKey: "cpu-web:yaoda-can-fly:v2:best",
    leaderboardPath: "/tools/yaoda-can-fly/leaderboard",
  },
  {
    slug: "tomato-egg-noodles",
    name: "番茄鸡蛋面",
    summary: "切菜、炒蛋、煮面，看准火候做出一碗好面",
    routeName: "service-tomato-egg-noodles",
    cover: "🍜",
    hue: "orange",
    tags: ["全校排行", "14 枚成就"],
    bestStorageKey: "cpu-web:tomato-egg-noodles:v1:best",
    leaderboardPath: "/tools/tomato-egg-noodles/leaderboard",
  },
  {
    slug: "zombie-defense",
    name: "药大人大战僵尸",
    summary: "种药材守药圃，一只僵尸都不能放过去",
    routeName: "service-zombie-defense",
    cover: "🧟",
    hue: "green",
    tags: ["全校排行", "14 枚成就"],
    bestStorageKey: "cpu-web:zombie-defense:v1:best",
    leaderboardPath: "/tools/zombie-defense/leaderboard",
  },
  {
    slug: "yaoda-nai",
    name: "合成药大奶",
    summary: "两只一样的奶蛙撞一起，合成更大的一只",
    routeName: "service-yaoda-nai",
    cover: "🐸",
    hue: "amber",
    tags: ["全校排行", "14 枚成就"],
    bestStorageKey: "cpu-web:yaoda-nai:v1:best",
    leaderboardPath: "/tools/yaoda-nai/leaderboard",
  },
  {
    slug: "greedy-nailong",
    name: "药大人能吃",
    summary: "滑动带路，吃得越多身子越长",
    routeName: "service-greedy-nailong",
    cover: "🐉",
    hue: "violet",
    tags: ["全校排行", "14 枚成就"],
    bestStorageKey: "cpu-web:greedy-nailong:v1:best",
    leaderboardPath: "/tools/greedy-nailong/leaderboard",
  },
  {
    slug: "yaoda-mines",
    name: "清扫药大雷",
    summary: "推理排雷不用猜，和倒计时赛跑",
    routeName: "service-yaoda-mines",
    cover: "💣",
    hue: "brand",
    tags: ["全校排行", "14 枚成就"],
    bestStorageKey: "cpu-web:yaoda-mines:v1:best",
    leaderboardPath: "/tools/yaoda-mines/leaderboard",
  },
];
