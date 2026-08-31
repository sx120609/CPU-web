export const CAMPUS_LIFE_ACTIVITY_ID = "campus-life-2026";

export const CAMPUS_LIFE_ACTIVITY = {
  id: CAMPUS_LIFE_ACTIVITY_ID,
  title: "药大校园生活图鉴",
  shortTitle: "一起写下药大的日常",
  intro: "食堂、周边、校园此刻和小小趣事，都值得被同学看见。也欢迎其他平台的优秀创作者，带着原创内容来到药大拾间。",
  funding: "这 200 元，来自用户的暖心赞助，也有开发者自己添上的心意，另有 10份以上 VIP 权限；公布的奖项数量只是最低数量，参与越热闹，奖励只多不少。",
  judging: "评选将综合点赞数、回复数与内容质量；内容质量由拾间大模型和论坛管理员共同评定。活动支持匿名参与，但同等质量下匿名投稿的评分权重可能略低。暖心回复奖与投稿奖不可兼得。",
  compactRule: "200 元奖金 + 10份以上 VIP · 点赞、回复与质量综合评选",
} as const;

export const CAMPUS_LIFE_ACTIVITY_THEMES = [
  {
    key: "canteen",
    label: "食堂测评",
    description: "一食堂新店，也欢迎所有窗口",
    icon: "camera",
    mode: "post",
    titlePlaceholder: "新装修的一食堂，有哪家新店值得去？",
    prompt: "可以从新装修完成的一食堂新店开始，也欢迎分享其他食堂、窗口和菜品。写清位置、价格与真实感受，有图片会更直观。",
  },
  {
    key: "nearby",
    label: "周边店铺",
    description: "把值得去的小店分享出来",
    icon: "pin",
    mode: "post",
    titlePlaceholder: "这家店，值得同学专程去一次吗？",
    prompt: "可以分享位置、人均、推荐与避雷，真实体验最珍贵。",
  },
  {
    key: "today",
    label: "今日校园",
    description: "记录今天校园里的一瞬",
    icon: "school",
    mode: "say",
    titlePlaceholder: "",
    prompt: "一张照片、一段见闻，留住今天只属于药大的片刻。",
  },
  {
    key: "fun",
    label: "日常趣事",
    description: "让普通日子也被大家看见",
    icon: "forum",
    mode: "say",
    titlePlaceholder: "",
    prompt: "分享让你会心一笑的小事，也许正好照亮另一个同学。",
  },
] as const;

export type CampusLifeActivityTheme = (typeof CAMPUS_LIFE_ACTIVITY_THEMES)[number];
export type CampusLifeActivityThemeKey = CampusLifeActivityTheme["key"];

export function resolveCampusLifeActivityTheme(activity: unknown, theme: unknown) {
  if (activity !== CAMPUS_LIFE_ACTIVITY_ID || typeof theme !== "string") return null;
  return CAMPUS_LIFE_ACTIVITY_THEMES.find((item) => item.key === theme) ?? null;
}

export function campusLifeActivityPostUrl(theme: CampusLifeActivityTheme) {
  const query = new URLSearchParams({
    board: "life",
    mode: theme.mode,
    activity: CAMPUS_LIFE_ACTIVITY_ID,
    theme: theme.key,
  });
  return `/post?${query.toString()}`;
}
