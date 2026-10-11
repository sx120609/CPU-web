// 宣传片取景用的示例数据。capture.mjs 用它代替后端响应，让真实页面渲染出“有人在用”的样子。
// 所有人物、帖子、课程和成绩都是虚构的；时间都相对于 NOW 计算，和浏览器里冻结的时钟一致。

// 2026-2027 学年第一学期第 7 周周三，下午第一节课开始前。
export const NOW = new Date("2026-10-14T13:20:00+08:00");
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

/* ---------- 全站 ---------- */
export const features = { forum: true, market: true, coursereview: true, electric: true, sponsor: false, forumLoginRequired: true, assistantEntry: true };
export const siteConfig = { siteOrigin: "https://cputime.cn", siteFilingNumber: "" };
export const navigation = [
  { id: "home", label: "首页", fullLabel: "首页", to: "/home", icon: "home", enabled: true, primary: true, showInDrawer: false, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "forum", label: "论坛", fullLabel: "校园论坛", to: "/forum", icon: "forum", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "forum", requireForumAccess: false, openInNewTab: false },
  { id: "lost-found", label: "失物", fullLabel: "失物招领", to: "/lost-found", icon: "lost-found", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "announcements", label: "公告", fullLabel: "校园公告", to: "/announcements", icon: "announcement", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "jwxt", label: "教务", fullLabel: "教务数据", to: "/jwxt", icon: "academic", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "schedule", label: "课表", fullLabel: "课表", to: "/schedule", icon: "schedule", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "services", label: "服务", fullLabel: "校园服务", to: "/services", icon: "service", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "coursereview", label: "课评", fullLabel: "课程点评", to: "/coursereview", icon: "course", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "coursereview", requireForumAccess: true, openInNewTab: false },
  { id: "market", label: "二手", fullLabel: "二手交流", to: "/forum/b/market", icon: "market", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "market", requireForumAccess: true, openInNewTab: false },
];

export const STUDENT_NO = "2024100123";
export const me = {
  id: 1024, username: STUDENT_NO, nickname: "小药丸", avatar: null, bio: "药学院 · 冰美式续命", college: "药学院", enrollYear: 2024,
  role: "user", studentSso: true, dataAuthAgreedAt: "2026-09-01T08:00:00.000Z", forumEnabled: true, status: "active",
  postCount: 18, replyCount: 96, reputation: 72,
  reputationLevel: { level: 3, name: "活跃同学", minReputation: 60, nextLevel: { level: 4, name: "资深成员", minReputation: 90, need: 18 } },
  vipActive: false, profileFrame: null, nicknameReview: { status: "approved" }, createdAt: "2024-09-02T10:00:00.000Z",
};

export const messages = [
  { id: 501, userId: 1024, category: "reply", level: "normal", title: "夜归人 回复了你的帖子", content: "二教晚上也开着，人少很安静", link: "/forum/topic/3012", payload: { topicId: 3012 }, source: null, readAt: null, createdAt: ago(5) },
  { id: 502, userId: 1024, category: "like", level: "normal", title: "你的帖子收到 12 个赞", content: "", link: "/forum/topic/3005", payload: { topicId: 3005 }, source: null, readAt: null, createdAt: ago(40) },
];
export const messageSettings = { userId: 1024, subscribeReply: true, subscribeLike: true, subscribeSchool: true, subscribeSystem: true };

/* ---------- 论坛 ---------- */
const B = {
  tree: { id: 2, slug: "treehole", name: "树洞", color: "#6366f1", type: "normal", anonymousEnabled: true },
  life: { id: 3, slug: "life", name: "校园生活", color: "#f59e0b", type: "normal" },
  fresh: { id: 5, slug: "freshman", name: "新生入学", color: "#84cc16", type: "normal" },
  q: { id: 6, slug: "question", name: "提问广场", color: "#3b82f6", type: "question" },
  mk: { id: 7, slug: "market", name: "二手交流", color: "#168c78", type: "market" },
  cr: { id: 8, slug: "coursereview", name: "课程点评", color: "#8b5cf6", type: "coursereview" },
  jwc: { id: 20, slug: "jwc-notice", name: "教务处通知", color: "#2563eb", type: "announce" },
  xgc: { id: 21, slug: "xgc-notice", name: "学工处通知", color: "#0891b2", type: "announce" },
  lib: { id: 22, slug: "lib-notice", name: "图书馆通知", color: "#7c3aed", type: "announce" },
};
const LEVELS = ["初来乍到", "渐入佳境", "活跃同学", "资深成员", "校园传说"];
const user = (id, nickname, lv, extra = {}) => ({
  id, nickname, avatar: null, role: "user", vipActive: false, profileTheme: null, profileFrame: null, verification: null,
  reputation: lv * 30, reputationLevel: { level: lv, name: LEVELS[lv - 1], minReputation: (lv - 1) * 30 }, ...extra,
});
const anon = (alias) => ({ id: null, nickname: alias, avatar: null, role: "anonymous", anonymous: true });
const reply = (id, topicId, author, content, likes, minutes) => ({
  id, topicId, authorId: author.id, content, isAnonymous: !!author.anonymous, anonymousAlias: author.anonymous ? author.nickname : null,
  floor: 1, likeCount: likes, createdAt: ago(minutes), author,
});
const topic = (id, board, title, content, author, [views, replies, likes, minutes], extra = {}) => ({
  id, boardId: board.id, authorId: author.id, title, content, metadata: {}, isAnonymous: !!author.anonymous,
  anonymousAlias: author.anonymous ? author.nickname : null, pinned: false, globalPinned: false, locked: false, hidden: false, editCount: 0,
  viewCount: views, replyCount: replies, likeCount: likes, createdAt: ago(minutes), updatedAt: ago(minutes), lastReplyAt: ago(Math.max(1, minutes - 20)),
  tags: [], board, author, previewReplies: [], ...extra,
});

const yeguiren = user(7, "夜归人", 4);
const xuezhang = user(3, "学长阿杰", 5);
export const forumTopics = [
  topic(3012, B.tree, "", "<p>期中周的图书馆，三楼靠窗的位置永远有人。大家都在悄悄努力呀 🌙</p>", anon("在图书馆漂流的小胶囊 🧪"), [862, 34, 121, 18], {
    metadata: { _postMode: "say" }, previewReplies: [reply(9001, 3012, yeguiren, "二教晚上也开着，人少很安静", 12, 10)],
  }),
  topic(3011, B.cr, "药理学课程点评：机制图一定要自己画一遍", "<p>老师讲得很系统，每章有小测，期末重点很清楚。认真听的话一点都不难。</p>", user(11, "实验室常驻", 4), [1530, 56, 203, 42], {
    tags: [{ id: 3, name: "选课参考" }],
    previewReplies: [reply(9002, 3011, user(12, "胶囊小姐", 2), "同意！机制图画熟了期末轻松很多", 31, 30)],
  }),
  topic(3010, B.q, "体测补测在哪里报名？", "<p>上周生病错过了体测，想问问补测的流程和截止时间。</p>", user(12, "胶囊小姐", 2), [421, 9, 15, 65], {
    previewReplies: [reply(9003, 3010, xuezhang, "体育部公众号发了通知，这周五前报名", 8, 50)],
  }),
  topic(3008, B.life, "南苑食堂新开的麻辣烫测评", "<p>15 块一碗，量很足，汤底偏清淡，可以自己加辣。周三中午人最少。</p>", user(21, "干饭第一名", 3), [2104, 88, 356, 130]),
  topic(3007, B.tree, "", "<p>今天在银杏大道看到一只超亲人的橘猫，晒着太阳一动不动 🐈</p>", anon("偷偷晒太阳的校园橘猫 🐈"), [977, 41, 240, 190], { metadata: { _postMode: "say" } }),
  topic(3006, B.fresh, "新生入学攻略：宿舍必带清单", "<p>床帘、插排、收纳箱、晾衣架……整理了一份清单，学弟学妹们按需取用。</p>", xuezhang, [5320, 120, 890, 300]),
  topic(3005, B.cr, "高等数学（下）复习资料整理好了", "<p>按章节整理了知识点和往年题型，需要的同学评论区自取。</p>", user(1024, "小药丸", 3), [2650, 73, 412, 420], { tags: [{ id: 4, name: "期中" }] }),
  topic(3004, B.life, "今天中午药苑之声放的歌好好听", "<p>午饭的时候听到的，有人知道是哪首吗？</p>", user(25, "南苑常客", 2), [640, 22, 98, 500]),
];
export const marketTopics = [
  topic(3009, B.mk, "出九成新《有机化学》教材，附笔记", "<p>重点都标出来了，江宁校区当面交易。</p>", user(15, "实验室常驻", 3), [318, 6, 11, 90], {
    metadata: { marketKind: "sell", price: 35, category: "books", campus: "江宁校区", condition: "九成新" },
  }),
  topic(3003, B.mk, "求一个宿舍用的台灯", "<p>能正常用就行，价格好商量。</p>", user(27, "早八战士", 2), [156, 4, 3, 240], {
    metadata: { marketKind: "wanted", price: 20, category: "dorm", campus: "江宁校区" },
  }),
];
export const boards = [
  { id: 2, slug: "treehole", name: "树洞", description: "想说的话、烦恼和碎碎念都可以发这里", icon: "🕳️", color: "#6366f1", order: 1, type: "normal", readOnly: false, anonymousEnabled: true, topicCount: 2741, feedSource: null },
  { id: 3, slug: "life", name: "校园生活", description: "吃喝玩乐、校园日常", icon: "☕", color: "#f59e0b", order: 2, type: "normal", readOnly: false, anonymousEnabled: false, topicCount: 1863, feedSource: null },
  { id: 6, slug: "question", name: "提问广场", description: "有问题就问，总有人知道", icon: "❓", color: "#3b82f6", order: 3, type: "question", readOnly: false, anonymousEnabled: false, topicCount: 1208, feedSource: null },
  { id: 8, slug: "coursereview", name: "课程点评", description: "选课参考与学习经验", icon: "📚", color: "#8b5cf6", order: 4, type: "coursereview", readOnly: false, anonymousEnabled: false, topicCount: 964, feedSource: null },
  { id: 7, slug: "market", name: "二手交流", description: "闲置、求购和交易经验", icon: "🛍️", color: "#168c78", order: 5, type: "market", readOnly: false, anonymousEnabled: false, topicCount: 732, feedSource: null },
  { id: 5, slug: "freshman", name: "新生入学", description: "新生问答与入学攻略", icon: "🎒", color: "#84cc16", order: 6, type: "normal", readOnly: false, anonymousEnabled: false, topicCount: 455, feedSource: null },
  ...[B.jwc, B.xgc, B.lib].map((b, i) => ({
    id: b.id, slug: b.slug, name: b.name, description: `${b.name}自动同步`, icon: "📢", color: b.color, order: 20 + i, type: "announce", readOnly: true,
    anonymousEnabled: false, topicCount: 400 - i * 90, announceDefault: true, feedDepartment: b.name.replace("通知", ""),
    feedSource: { name: b.name, homepage: "", lastRunAt: ago(10), enabled: true },
  })),
];
const notice = (id, board, title, minutes) => ({
  id, title, boardId: board.id, authorId: 5, board: { id: board.id, slug: board.slug, name: board.name, color: board.color, type: "announce" },
  tags: [], metadata: {}, isAnonymous: false, createdAt: ago(minutes), author: { id: 5, nickname: "学校公告", role: "bot", avatar: null },
});
export const announcements = [
  notice(8801, B.jwc, "关于 2026 年秋季学期期中考试安排的通知", 25),
  notice(8802, B.xgc, "关于开展 2026 年学生体质健康测试补测的通知", 180),
  notice(8803, B.lib, "图书馆国庆节后开放时间调整", 420),
  notice(8804, B.jwc, "关于做好 2026 年下半年全国大学英语四、六级考试报名工作的通知", 1500),
  notice(8805, B.xgc, "2026 年秋季学期勤工助学岗位招聘公告", 2900),
  notice(8806, B.jwc, "关于秋季学期体育选项课补选的说明", 4300),
];
const hot = [forumTopics[3], forumTopics[1], forumTopics[5]].map((t, i) => ({ ...t, rank: i + 1, hotScore: [386, 241, 198][i] }));
export const homeSummary = {
  identity: { id: 1024, nickname: me.nickname, avatar: null, college: me.college, role: "user", postCount: 18, replyCount: 96, reputation: 72, forumEnabled: true, unreadCount: 2 },
  pinnedTopics: [],
  hotTopics: hot,
  latestTopics: forumTopics,
  announce: announcements.slice(0, 5),
  services: [
    { id: 1, code: "ACAD_PORTAL", name: "教务数据", category: "教务", owner: "教务处", icon: "🎓", description: "在站内查看课表、成绩和培养方案", url: "/jwxt", needSso: true, order: 0 },
    { id: 2, code: "LIB_OPAC", name: "图书馆 OPAC 检索", category: "学习", owner: "图书馆", icon: "📖", description: "馆藏图书检索（无需登录），借阅记录需登录", url: "", needSso: false, order: 1 },
    { id: 3, code: "JOB_PLATFORM", name: "智慧就业平台", category: "就业", owner: "招生就业处", icon: "💼", description: "药企招聘 / 双选会 / 推荐表", url: "", needSso: false, order: 2 },
    { id: 4, code: "HEALTH_PSY", name: "心理咨询预约", category: "健康", owner: "心理发展中心", icon: "🧠", description: "通过公众号预约，需提前 24 小时", url: "", needSso: false, order: 3 },
  ],
};
export const hotRanking = hot;

/* ---------- 教务 ---------- */
const SEM = "2026-2027-1";
const PREV = "2025-2026-2";
const span = (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
const cell = (day, start, end, name, location, weeks = "1-16(周)", weekList = span(1, 16)) => ({
  day, bigSlot: Math.ceil(start / 2),
  courses: [{ name, teacher: "", weeks, weekList, location, slotNote: `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}节`, startSlot: start, endSlot: end }],
});
const semesters = [{ value: SEM, label: SEM, current: true }, { value: PREV, label: PREV, current: false }];
const schedule = {
  pageRecognized: true, scope: "semester", source: "modern", semesters, currentSemester: SEM, currentWeek: "",
  weeks: span(1, 19).map((n) => ({ value: String(n), label: `第${n}周`, current: false })),
  cells: [
    cell(1, 1, 2, "药物化学", "教学楼B-301"), cell(1, 3, 4, "大学英语（三）", "教学楼C-207"), cell(1, 7, 8, "体育（三）", "体育馆"),
    cell(2, 1, 2, "药理学", "教学楼B-205"), cell(2, 3, 4, "高等数学", "教学楼A-305"), cell(2, 5, 6, "有机化学", "教学楼A-104"),
    cell(2, 9, 10, "形势与政策", "教学楼C-101", "1-8(周)", span(1, 8)),
    cell(3, 3, 4, "分析化学", "教学楼B-210"), cell(3, 5, 8, "药理学实验", "实验楼312", "2-17(周)", span(2, 17)),
    cell(4, 1, 2, "生物化学", "教学楼B-402"), cell(4, 3, 4, "药剂学", "教学楼B-108"), cell(4, 6, 7, "药物分析", "教学楼A-210", "3-18(周)", span(3, 18)),
    cell(5, 1, 2, "物理化学", "教学楼A-201", "1-15(单周)", span(1, 15, 2)), cell(5, 3, 4, "大学英语（三）", "教学楼C-207"),
    cell(5, 5, 8, "有机化学实验", "实验楼312", "2-17(周)", span(2, 17)),
  ],
};
const calendarWeeks = Array.from({ length: 19 }, (_, i) => {
  const monday = Date.UTC(2026, 7, 31 + i * 7);
  const days = Array.from({ length: 7 }, (_, k) => new Date(monday + k * 864e5).toISOString().slice(0, 10));
  return { week: i + 1, days, monday: days[0], sunday: days[6] };
});
const calendar = { source: "modern", semesters, currentSemester: SEM, semesterStart: "2026-08-31", semesterEnd: "2027-01-10", weeks: calendarWeeks, currentWeek: 7, today: "2026-10-14" };

const grade = (semester, courseCode, courseName, score, credits, hours, courseAttr, usual, final) => ({
  semester, courseCode, courseName, score: String(score), scoreNum: typeof score === "number" ? score : null,
  ...(usual ? { usual: String(usual), final: String(final), usualWeight: "30%", finalWeight: "70%" } : {}),
  credits, hours, courseAttr, examType: "正常考试",
});
// 2024 级药学专业：前两学年的成绩，本学期（大三上）的课还在上。
const Y1A = "2024-2025-1", Y1B = "2024-2025-2", Y2A = "2025-2026-1";
const gradeList = [
  grade(PREV, "0702032", "有机化学（下）", 93, 4, 64, "必修", 95, 92),
  grade(PREV, "0905002", "医药数理统计", 95, 2.5, 40, "必修", 96, 95),
  grade(PREV, "0601012", "生物学", 90, 3, 48, "必修", 92, 89),
  grade(PREV, "1301004", "毛泽东思想和中国特色社会主义理论体系概论", 88, 3, 48, "必修"),
  grade(PREV, "0806010", "药用植物学", 91, 2, 32, "限选", 94, 90),
  grade(PREV, "1203001", "大学生心理健康", "优秀", 1, 16, "公选"),
  grade(Y2A, "0702031", "有机化学（上）", 92, 4, 64, "必修", 94, 91),
  grade(Y2A, "0801012", "分析化学", 89, 3.5, 56, "必修", 92, 88),
  grade(Y2A, "0603011", "人体解剖生理学", 91, 3, 48, "必修", 94, 90),
  grade(Y2A, "1102003", "大学英语（二）", 87, 2, 32, "必修"),
  grade(Y1B, "0904002", "高等数学（下）", 90, 4, 64, "必修"), grade(Y1B, "0905001", "大学物理", 86, 3.5, 56, "必修"),
  grade(Y1B, "1301002", "中国近现代史纲要", 89, 3, 48, "必修"), grade(Y1B, "0701021", "无机化学实验", 94, 1.5, 48, "必修"),
  grade(Y1B, "1401002", "体育（二）", 88, 1, 32, "必修"),
  grade(Y1A, "0701020", "无机化学", 91, 4, 64, "必修"), grade(Y1A, "0904001", "高等数学（上）", 88, 4, 64, "必修"),
  grade(Y1A, "1102002", "大学英语（一）", 86, 2, 32, "必修"), grade(Y1A, "1301001", "思想道德与法治", 90, 3, 48, "必修"),
  grade(Y1A, "0101001", "药学导论", 95, 1, 16, "必修"), grade(Y1A, "1401001", "体育（一）", 85, 1, 32, "必修"),
];
const grades = {
  source: "modern",
  semesters: [PREV, Y2A, Y1B, Y1A].map((value, i) => ({ value, label: value, current: i === 0 })),
  list: gradeList,
};
const progress = {
  source: "modern",
  summary: [
    { name: "通识必修课", requiredMust: 42, requiredOpt: 0, earnedMust: 26, earnedOpt: 0, leftMust: 16, leftOpt: 0 },
    { name: "学科基础课", requiredMust: 48, requiredOpt: 0, earnedMust: 32, earnedOpt: 0, leftMust: 16, leftOpt: 0 },
    { name: "专业核心课", requiredMust: 38, requiredOpt: 0, earnedMust: 4, earnedOpt: 0, leftMust: 34, leftOpt: 0 },
    { name: "专业选修课", requiredMust: 0, requiredOpt: 20, earnedMust: 0, earnedOpt: 10, leftMust: 0, leftOpt: 10 },
    { name: "通识选修课", requiredMust: 0, requiredOpt: 12, earnedMust: 0, earnedOpt: 8, leftMust: 0, leftOpt: 4 },
  ],
  totals: { requiredMust: 128, requiredOpt: 32, earnedMust: 62, earnedOpt: 18, leftMust: 66, leftOpt: 14 },
  completed: gradeList.map((g) => ({ courseName: g.courseName, courseCode: g.courseCode, semester: g.semester, hours: g.hours, credits: g.credits, attr: g.courseAttr, score: g.score, passed: true })),
  uncompleted: [
    { courseName: "药物化学", courseCode: "0703040", semester: SEM, hours: 64, credits: 4, attr: "必修", passed: false },
    { courseName: "药剂学", courseCode: "0703020", semester: SEM, hours: 56, credits: 3.5, attr: "必修", passed: false },
    { courseName: "药理学", courseCode: "0603030", semester: SEM, hours: 64, credits: 4, attr: "必修", passed: false },
  ],
};
const pyfaCourse = (index, semester, courseCode, courseName, credits, hours, attr) => ({ index, semester, courseCode, courseName, unit: "药学院", credits, hours, examMethod: "考试", attr, isExam: "是" });
const pyfa = {
  source: "modern",
  list: [
    pyfaCourse(1, SEM, "0703040", "药物化学", 4, 64, "必修"), pyfaCourse(2, SEM, "0603030", "药理学", 4, 64, "必修"),
    pyfaCourse(3, SEM, "0703020", "药剂学", 3.5, 56, "必修"), pyfaCourse(4, SEM, "0801030", "药物分析", 3, 48, "必修"),
    pyfaCourse(5, SEM, "0702040", "生物化学", 3.5, 56, "必修"), pyfaCourse(6, SEM, "0704010", "物理化学", 3, 48, "必修"),
    pyfaCourse(7, "2026-2027-2", "0703050", "天然药物化学", 3, 48, "必修"), pyfaCourse(8, "2026-2027-2", "0703060", "药事管理学", 2, 32, "必修"),
  ],
  bySemester: [
    { semester: Y1A, courses: 8, credits: 23 }, { semester: Y1B, courses: 7, credits: 21.5 }, { semester: Y2A, courses: 8, credits: 24 }, { semester: PREV, courses: 9, credits: 24.5 },
    { semester: SEM, courses: 9, credits: 25.5 }, { semester: "2026-2027-2", courses: 8, credits: 22 },
  ],
};
const levelExams = { kind: "level-exams", list: [
  { name: "全国大学英语四级考试", subject: "英语", level: "四级", date: "2025-12-13", score: 563, written: 563, grade: "", note: "" },
  { name: "全国大学英语六级考试", subject: "英语", level: "六级", date: "2026-06-13", score: 528, written: 528, grade: "", note: "" },
] };
const iapps = { apps: [
  ["校园卡充值", "一卡通在线充值与账单", "生活服务", 5321], ["空闲教室查询", "按楼栋和节次查找空教室", "学习服务", 4210],
  ["图书馆座位预约", "预约自习座位与研讨间", "学习服务", 3987], ["宿舍报修", "提交宿舍维修工单", "生活服务", 2764],
  ["成绩单打印", "自助打印中英文成绩单", "教务服务", 1893], ["校车时刻", "江宁与玄武门校区往返班车", "生活服务", 1652],
].map(([name, detail, type, clickNum], i) => ({ id: i + 1, name, detail, url: "", icon: "", types: [type], clickNum, favorite: i < 2, favCount: 200 - i * 20, dept: "", scope: ["学生"] })) };

const synced = NOW.toISOString();
const wrap = (parsed) => ({ parsed, syncedAt: synced, stale: false, source: "modern" });
export function jwxt(method, path, params) {
  switch (`${method} ${path}`) {
    case "GET /status": return { active: true, since: NOW.getTime() - 86_400_000, username: STUDENT_NO };
    case "GET /identity": return { identity: "undergraduate", source: "detected", capabilities: { undergraduate: true, graduate: false } };
    case "POST /schedule-widget-tokens/refresh": return { updated: 0 };
    case "GET /calendar": return wrap(calendar);
    case "GET /schedule": return { ...wrap(schedule), calendar, calendarSyncedAt: synced };
    case "GET /grades": return wrap(grades);
    case "GET /progress": return wrap(progress);
    case "GET /pyfa": return wrap(pyfa);
    case "GET /records": return wrap(params.get("kind") === "level-exams" ? levelExams : { kind: params.get("kind"), list: [] });
    case "GET /iapps": return iapps;
    default: return undefined;
  }
}

/* ---------- 浏览器本地状态 ---------- */
export const localState = {
  "cpu-authenticated": "1",
  "cpu-academic-identity-v1": "undergraduate",
  "cpu-couple-status-v1": JSON.stringify({ status: "none" }),
  "cpu-schedule-last-state-v1:browser-session:undergraduate": JSON.stringify({ semester: SEM, week: "7", activeDay: 3, viewMode: "week" }),
  "cpu-schedule-display-v1": JSON.stringify({ showSaturday: false, showSunday: false }),
};
