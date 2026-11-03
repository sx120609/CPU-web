/**
 * 可以按学校开关的功能。
 *
 * isolation 说明这个功能的数据有没有按学校分开：
 * - "school"：数据随用户走，或已带 schoolId，各校互不可见；
 * - "global"：不存学校相关的内容，各校共用也不会串；
 * - "pending"：还没按学校拆开。只有默认学校（历史数据的主人）能开，其他学校一律关闭，
 *   免得把药大的帖子、公告、排行榜露给别的学校。拆完后改成 "school"。
 *
 * implementedFor 限定只有某些学校才有实现（对接的是该校自己的系统或数据）。
 * routes 是挂在 /api 下的前缀，学校关掉功能后这些接口直接回 404。
 */
export type SchoolModuleIsolation = "school" | "global" | "pending";

export type SchoolModuleDefinition = {
  key: string;
  label: string;
  isolation: SchoolModuleIsolation;
  implementedFor?: readonly string[];
  routes: readonly string[];
};

export const SCHOOL_MODULES: readonly SchoolModuleDefinition[] = [
  { key: "academic", label: "教务与课表", isolation: "school", routes: ["/jwxt", "/schedule-shares", "/couple"] },
  { key: "announcements", label: "学校公告", isolation: "pending", routes: ["/announcements"] },
  { key: "forum", label: "论坛", isolation: "pending", routes: ["/boards", "/topics", "/replies", "/likes", "/forum-ads", "/forum-reports"] },
  { key: "search", label: "站内搜索", isolation: "pending", routes: ["/search"] },
  { key: "courseReview", label: "课程评价", isolation: "pending", routes: ["/courses", "/course-bot"] },
  { key: "lostFound", label: "失物招领", isolation: "pending", routes: ["/lost-found"] },
  { key: "treehole", label: "艾绒树洞", isolation: "pending", routes: ["/treehole"] },
  { key: "directMessage", label: "私信", isolation: "pending", routes: ["/direct-messages"] },
  { key: "market", label: "二手市场", isolation: "pending", routes: [] },
  { key: "workshop", label: "创意工坊", isolation: "pending", routes: [] },
  { key: "assistant", label: "拾间AI", isolation: "pending", routes: [] },
  {
    key: "games",
    label: "小游戏",
    isolation: "pending",
    routes: [
      "/tools/yaoda-can-fly",
      "/tools/tomato-egg-noodles",
      "/tools/zombie-defense",
      "/tools/yaoda-nai",
      "/tools/greedy-nailong",
      "/tools/yaoda-mines",
    ],
  },
  { key: "dormElectric", label: "宿舍电费", isolation: "school", implementedFor: ["cpu"], routes: ["/dorm"] },
  { key: "campus3d", label: "三维校园", isolation: "school", implementedFor: ["cpu"], routes: ["/tools/campus-3d/presence"] },
  { key: "departmentContacts", label: "部门通讯录", isolation: "school", implementedFor: ["cpu"], routes: ["/tools/department-contacts"] },
  { key: "canteen", label: "食堂选择器", isolation: "pending", implementedFor: ["cpu"], routes: [] },
  { key: "vip", label: "会员与赞助", isolation: "global", routes: ["/vip", "/payments"] },
];

export const SCHOOL_MODULE_KEYS: readonly string[] = SCHOOL_MODULES.map((module) => module.key);

export function findSchoolModule(key: string): SchoolModuleDefinition | undefined {
  return SCHOOL_MODULES.find((module) => module.key === key);
}
