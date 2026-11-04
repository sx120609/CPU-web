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
 * pages 是网页路由前缀，tools 是服务页上的工具卡片 slug；网页据此隐藏入口、拦下直达链接。
 * 一个网页路径归最长匹配的前缀所属的功能管。
 */
export type SchoolModuleIsolation = "school" | "global" | "pending";

export type SchoolModuleDefinition = {
  key: string;
  label: string;
  isolation: SchoolModuleIsolation;
  implementedFor?: readonly string[];
  routes: readonly string[];
  pages?: readonly string[];
  tools?: readonly string[];
};

export const SCHOOL_MODULES: readonly SchoolModuleDefinition[] = [
  {
    key: "academic",
    label: "教务与课表",
    isolation: "school",
    routes: ["/jwxt", "/schedule-shares", "/couple"],
    pages: ["/jwxt", "/schedule"],
  },
  {
    key: "announcements",
    label: "学校公告",
    isolation: "school",
    implementedFor: ["cpu"],
    routes: ["/announcements"],
    pages: ["/announcements"],
  },
  {
    key: "forum",
    label: "论坛",
    isolation: "school",
    routes: ["/boards", "/topics", "/replies", "/likes", "/forum-ads", "/forum-reports"],
    pages: ["/forum", "/post"],
  },
  { key: "search", label: "站内搜索", isolation: "school", routes: ["/search"] },
  {
    key: "courseReview",
    label: "课程评价",
    isolation: "school",
    routes: ["/courses", "/course-bot"],
    pages: ["/coursereview"],
  },
  {
    key: "lostFound",
    label: "失物招领",
    isolation: "school",
    routes: ["/lost-found"],
    pages: ["/lost-found"],
    tools: ["lost_found"],
  },
  {
    key: "treehole",
    label: "艾绒树洞",
    isolation: "school",
    routes: ["/treehole"],
    pages: ["/treehole"],
    tools: ["treehole"],
  },
  { key: "directMessage", label: "私信", isolation: "school", routes: ["/direct-messages"] },
  { key: "market", label: "二手市场", isolation: "school", routes: [], pages: ["/forum/b/market"] },
  {
    key: "workshop",
    label: "创意工坊",
    isolation: "school",
    routes: [],
    pages: ["/workshop", "/services/tools/yaoda-can-fly/workshop"],
    tools: ["workshop"],
  },
  { key: "assistant", label: "拾间AI", isolation: "school", implementedFor: ["cpu"], routes: [] },
  {
    key: "games",
    label: "小游戏",
    isolation: "school",
    routes: [
      "/tools/yaoda-can-fly",
      "/tools/tomato-egg-noodles",
      "/tools/zombie-defense",
      "/tools/yaoda-nai",
      "/tools/greedy-nailong",
      "/tools/yaoda-mines",
    ],
    pages: ["/services/tools/yaoda-can-fly", "/services/tools/games"],
    tools: ["mini_games"],
  },
  {
    key: "toolbox",
    label: "问卷与收集工具",
    isolation: "global",
    routes: [],
    pages: [
      "/services/tools/questionnaires",
      "/services/tools/grade-checks",
      "/services/tools/file-collections",
      "/services/tools/filestore",
      "/services/tools/assessment-form",
    ],
    tools: ["feedback", "questionnaire", "grade_check", "file_collect", "pdf_tools", "assessment-form"],
  },
  { key: "dormElectric", label: "宿舍电费", isolation: "school", implementedFor: ["cpu"], routes: ["/dorm"] },
  {
    key: "campus3d",
    label: "三维校园",
    isolation: "school",
    implementedFor: ["cpu"],
    routes: ["/tools/campus-3d/presence"],
    pages: ["/services/tools/yaoda-can-fly/campus-3d"],
    tools: ["campus_3d"],
  },
  {
    key: "departmentContacts",
    label: "部门通讯录",
    isolation: "school",
    implementedFor: ["cpu"],
    routes: ["/tools/department-contacts"],
    pages: ["/services/tools/department_contacts"],
    tools: ["department_contacts"],
  },
  { key: "schoolCalendar", label: "校历", isolation: "school", implementedFor: ["cpu"], routes: [], tools: ["school_calendar"] },
  { key: "venueReservation", label: "场馆预约", isolation: "school", implementedFor: ["cpu"], routes: [], tools: ["venue_reservation"] },
  { key: "canteen", label: "食堂选择器", isolation: "school", implementedFor: ["cpu"], routes: [], tools: ["canteen_picker"] },
  {
    key: "voicehub",
    label: "药苑之声",
    isolation: "school",
    implementedFor: ["cpu"],
    routes: [],
    pages: ["/services/tools/voicehub"],
    tools: ["voicehub"],
  },
  { key: "vip", label: "会员与赞助", isolation: "global", routes: ["/vip", "/payments"], pages: ["/vip", "/sponsor"] },
];

export const SCHOOL_MODULE_KEYS: readonly string[] = SCHOOL_MODULES.map((module) => module.key);

export function findSchoolModule(key: string): SchoolModuleDefinition | undefined {
  return SCHOOL_MODULES.find((module) => module.key === key);
}

/** 网页路由前缀和工具卡片各归哪个功能，原样下发给网页。 */
export function schoolModulePageMap() {
  return {
    pages: SCHOOL_MODULES.flatMap((module) => (module.pages ?? []).map((prefix) => ({ prefix, module: module.key }))),
    tools: SCHOOL_MODULES.flatMap((module) => (module.tools ?? []).map((slug) => ({ slug, module: module.key }))),
  };
}
