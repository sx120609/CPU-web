/**
 * 药大拾间 种子数据
 * 运行：npm run db:seed
 *
 * 包括：测试用户 + 机器人 + 板块 + 示例话题 + 课程 + 服务卡片 + 爬虫源
 * 注意：本脚本幂等 —— 重复运行会先清空所有业务数据。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { COMMUNITY_BOARD_DEFS } from "../src/services/defaultBoardCatalog";

const prisma = new PrismaClient();

async function clean() {
  await prisma.notificationRead.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.messageSetting.deleteMany();
  await prisma.like.deleteMany();
  await prisma.topicTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.reply.deleteMany();
  await prisma.courseRating.deleteMany();
  await prisma.topic.deleteMany();
  // 先把 Board.feedSourceId 解绑，再删除爬虫源
  await prisma.board.updateMany({ data: { feedSourceId: null } });
  await prisma.schoolFeedItem.deleteMany();
  await prisma.schoolFeedSource.deleteMany();
  await prisma.board.deleteMany();
  await prisma.courseTeacher.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.course.deleteMany();
  await prisma.serviceCard.deleteMany();
  await prisma.user.deleteMany();
  await prisma.siteSetting.deleteMany();
}

async function main() {
  console.log("🧹 清空旧数据...");
  await clean();

  // ============ 用户 ============
  console.log("👤 创建用户...");
  const hash = await bcrypt.hash("123456", 10);
  const adminHash = await bcrypt.hash("admin123", 10);

  const alice = await prisma.user.create({
    data: {
      username: "alice", passwordHash: hash, nickname: "小药丸",
      college: "药学院", enrollYear: 2023, bio: "本科生 · 江宁",
      reputation: 12, postCount: 0, replyCount: 0,
    },
  });
  const bob = await prisma.user.create({
    data: {
      username: "bob", passwordHash: hash, nickname: "夜归人",
      college: "中药学院", enrollYear: 2022, bio: "研究生 · 玄武门",
      reputation: 30, postCount: 0, replyCount: 0,
    },
  });
  const carol = await prisma.user.create({
    data: {
      username: "carol", passwordHash: hash, nickname: "胶囊小姐",
      college: "国际医药商学院", enrollYear: 2024, bio: "新生报到",
      reputation: 3,
    },
  });
  const admin = await prisma.user.create({
    data: { username: "admin", passwordHash: adminHash, nickname: "管理员", role: "admin" },
  });

  // 学校公告机器人（每个爬虫源用同一个 bot）
  const bot = await prisma.user.create({
    data: {
      username: "school-bot", passwordHash: hash, nickname: "学校公告 🤖",
      role: "bot", bio: "我会自动同步学校官方公告",
    },
  });

  for (const u of [alice, bob, carol, admin, bot]) {
    await prisma.messageSetting.create({ data: { userId: u.id } }).catch(() => {});
  }

  // ============ 爬虫源（创建后 Board 引用） ============
  console.log("🕷️  创建学校爬虫源...");
  const feeds = await Promise.all([
    prisma.schoolFeedSource.create({
      data: {
        slug: "jwc-notice", name: "教务处通知",
        homepage: "http://jwc.cpu.edu.cn/", listUrl: "http://jwc.cpu.edu.cn/851/list{page}.htm",
        pageSize: 14, maxPages: 2, cronMinutes: 15, botUserId: bot.id,
      },
    }),
    prisma.schoolFeedSource.create({
      data: {
        slug: "xgc-notice", name: "学工处通知",
        homepage: "http://xgc.cpu.edu.cn/", listUrl: "http://xgc.cpu.edu.cn/18011/list{page}.htm",
        pageSize: 14, maxPages: 2, cronMinutes: 15, botUserId: bot.id,
      },
    }),
    prisma.schoolFeedSource.create({
      data: {
        slug: "yjsy-notice", name: "研究生院通知",
        homepage: "http://yjsy.cpu.edu.cn/", listUrl: "http://yjsy.cpu.edu.cn/6305/list{page}.htm",
        pageSize: 14, maxPages: 2, cronMinutes: 20, botUserId: bot.id,
      },
    }),
    prisma.schoolFeedSource.create({
      data: {
        slug: "yjszs-notice", name: "研究生招生网通知",
        homepage: "https://yjszs.cpu.edu.cn/", listUrl: "https://yjszs.cpu.edu.cn/",
        pageSize: 12, maxPages: 1, cronMinutes: 20, botUserId: bot.id,
      },
    }),
  ]);

  // ============ 板块 ============
  console.log("🏛️  创建板块...");
  let order = 0;
  const inc = () => order++;

  // 公告聚合区
  for (const f of feeds) {
    await prisma.board.create({
      data: {
        slug: f.slug, name: f.name,
        description: `自动同步自 ${f.homepage}`,
        icon: "📢", color: "#1d4d8a",
        order: inc(), type: "announce", readOnly: true,
        feedSourceId: f.id,
      },
    });
  }

  // 综合讨论区
  const communityBoards = new Map<string, any>();
  for (const board of COMMUNITY_BOARD_DEFS) {
    const created = await prisma.board.create({
      data: {
        slug: board.slug,
        name: board.name,
        description: board.description,
        icon: board.icon,
        color: board.color,
        order: inc(),
        type: board.type,
        anonymousEnabled: Boolean(board.anonymousEnabled),
      },
    });
    communityBoards.set(board.slug, created);
  }
  const general = communityBoards.get("general");
  const treehole = communityBoards.get("treehole");
  const life = communityBoards.get("life");
  const freshman = communityBoards.get("freshman");
  const question = communityBoards.get("question");
  const market = communityBoards.get("market");
  const coursereview = communityBoards.get("coursereview");

  // ============ 课程（点评板块附属） ============
  console.log("📚 创建课程...");
  // 每条 (code, name, teacherNames[], credits, category, college)
  // teacherNames 用数组形式，方便表达多老师授课
  const courseDefs: {
    code: string; name: string; teachers: string[];
    credits?: number; category?: string; college?: string;
  }[] = [
    { code: "PHA101", name: "药理学",       teachers: ["王明远"],          credits: 4,   category: "必修", college: "药学院" },
    { code: "PHA102", name: "药物化学",     teachers: ["刘静怡"],          credits: 3.5, category: "必修", college: "药学院" },
    { code: "PHA103", name: "药剂学",       teachers: ["周晓东"],          credits: 3,   category: "必修", college: "药学院" },
    { code: "ENG201", name: "学术英语",     teachers: ["Anna Lee"],        credits: 2,   category: "通识" },
    { code: "MAT101", name: "高等数学（下）", teachers: ["孙立群", "陈一鸣"], credits: 4, category: "通识" },
    { code: "GED105", name: "中国近现代史纲要", teachers: ["高文博"],       credits: 2,   category: "通识" },
  ];
  const courses: any[] = [];
  // courseTeachers[i][teacherName] = CourseTeacher 关联 id
  const courseTeachers: Record<string, number>[] = [];
  for (const def of courseDefs) {
    const c = await prisma.course.create({
      data: {
        code: def.code, name: def.name,
        teacher: def.teachers.join("、"), // 旧字段：用分隔符拼接，方便回滚
        credits: def.credits, category: def.category, college: def.college,
      },
    });
    courses.push(c);
    const ctMap: Record<string, number> = {};
    for (const tn of def.teachers) {
      const t = await prisma.teacher.upsert({
        where: { name: tn },
        update: {},
        create: { name: tn },
      });
      const ct = await prisma.courseTeacher.create({
        data: { courseId: c.id, teacherId: t.id, source: "seed" },
      });
      ctMap[tn] = ct.id;
    }
    courseTeachers.push(ctMap);
  }

  // ============ 服务导航卡片（外链） ============
  console.log("🧭 创建服务卡片...");
  const services = [
    { code: "ACAD_PORTAL", name: "教务数据", category: "教务", owner: "教务处", icon: "🎓",
      url: "/jwxt", needSso: true,
      description: "在站内查看课表、成绩和培养方案",
      materials: "学校统一身份认证账号", duration: "即时", contact: "025-86185115" },
    { code: "LIB_OPAC", name: "图书馆 OPAC 检索", category: "学习", owner: "图书馆", icon: "📖",
      url: "http://opac.cpu.edu.cn/", needSso: false,
      description: "馆藏图书检索（无需登录），借阅记录需登录",
      duration: "即时" },
    { code: "JOB_PLATFORM", name: "智慧就业平台（91job）", category: "就业", owner: "招生就业处", icon: "💼",
      url: "https://cpu.91job.org.cn/sub-station/home/10316", needSso: false,
      description: "药企招聘 / 双选会 / 推荐表",
      duration: "即时", contact: "025-86185236" },
    { code: "HEALTH_PSY", name: "心理咨询预约", category: "健康", owner: "心理发展中心", icon: "🧠",
      url: "http://xinli.cpu.edu.cn/14185/list.htm", needSso: false,
      description: "通过公众号「药大心理发展中心」预约，需提前 24 小时",
      duration: "提前 24h", contact: "025-86185222" },
    { code: "HEALTH_HOTLINE", name: "心理援助热线", category: "健康", owner: "心理发展中心", icon: "📞",
      url: "tel:02586185911",
      description: "24 小时心理援助热线",
      duration: "7x24h", contact: "025-86185911" },
    { code: "DORM_REPAIR", name: "宿舍报修", category: "后勤", owner: "后勤服务集团", icon: "🔧",
      url: "https://i.cpu.edu.cn", needSso: true,
      description: "走企业微信「后勤服务」提交工单",
      duration: "约 24 小时" },
    { code: "MAIL", name: "校园邮箱", category: "信息化", owner: "信息化建设管理处", icon: "📧",
      url: "https://mail.cpu.edu.cn/", needSso: true,
      description: "学校 Webmail" },
    { code: "VPN", name: "校园 VPN（校外访问）", category: "信息化", owner: "信息化建设管理处", icon: "🔐",
      url: "https://vpn.cpu.edu.cn/", needSso: true,
      description: "校外访问教务/图书馆数据库" },
  ];
  for (let i = 0; i < services.length; i++) {
    await prisma.serviceCard.create({
      data: { ...services[i], order: i },
    });
  }

  // ============ 示例话题 ============
  console.log("💬 创建示例话题...");
  const now = new Date();
  const dt = (h: number) => new Date(now.getTime() - h * 3600 * 1000);

  async function makeTopic(boardId: number, authorId: number, title: string, content: string, hoursAgo: number, metadata?: any, opts?: { pinned?: boolean; likes?: number; replies?: number }) {
    return prisma.topic.create({
      data: {
        boardId, authorId, title, content,
        metadata: JSON.stringify(metadata ?? {}),
        pinned: opts?.pinned ?? false,
        likeCount: opts?.likes ?? 0,
        replyCount: opts?.replies ?? 0,
        lastReplyAt: dt(Math.max(0, hoursAgo - 1)),
        lastReplyById: authorId,
        createdAt: dt(hoursAgo),
        updatedAt: dt(hoursAgo),
      },
    });
  }

  // 灌水广场
  const t1 = await makeTopic(general.id, alice.id,
    "[置顶] 欢迎来到药大拾间！请先看版规",
    "## 欢迎\n\n这里是民间药大学生论坛，**与学校官方无关**。\n\n- 请理性发言，禁止人身攻击\n- 想发碎碎念或心情记录可以去树洞\n- 二手交易请到二手市场板块\n- 提问请到提问广场\n- 课程点评请到课程点评板块\n",
    72, undefined, { pinned: true, likes: 18, replies: 4 });
  const t2 = await makeTopic(general.id, bob.id,
    "今晚的月亮真好看",
    "走在玄武门校区，看到月亮特别圆。有人一起逛逛吗？",
    5, undefined, { likes: 6 });
  await makeTopic(treehole.id, carol.id,
    "有人也会在忙的时候突然想安静一下吗",
    "最近事情有点多，就想找个地方留一句：大家都辛苦了。看到这条的人今晚早点休息。",
    14, undefined, { likes: 4, replies: 1 });
  await makeTopic(life.id, carol.id,
    "新生第一周食堂避雷指南",
    "**第一食堂**：早上的鸡蛋灌饼 ⭐⭐⭐⭐⭐\n\n**第二食堂**：中午高峰排队 30 分钟起，建议 13:00 后再去\n\n**留学生餐厅**：菜单偏西餐，价格略高",
    10, undefined, { likes: 9, replies: 2 });

  // 提问
  await makeTopic(question.id, alice.id,
    "药理学期末复习重点谁能分享下？",
    "如题，复习时间不够了，求重点。给红包 🧧",
    3, { resolved: false, bounty: 10, tags: ["药理学", "期末"] });
  await makeTopic(question.id, carol.id,
    "教务系统打不开了，是只有我这样吗？",
    "刚才登录提示「服务异常」，重启浏览器也没用。",
    1, { resolved: true, bounty: 0 }, { replies: 3 });

  // 二手
  await makeTopic(market.id, bob.id,
    "出二手《药理学（第 9 版）》——杨宝峰主编",
    "九成新，无笔记，原价 89 出 50。\n面交：江宁校区西门菜鸟驿站",
    8, { price: 50, condition: "九成新", tradeMode: "当面 / 包邮+5", images: [] });
  await makeTopic(market.id, alice.id,
    "求购 山地车 / 通勤车（江宁）",
    "预算 300 以内，能骑就行。",
    20, { price: 300, condition: "求购", tradeMode: "当面" });

  // 课评
  const cr1 = await makeTopic(coursereview.id, bob.id,
    "PHA101 药理学（王明远）—— 推荐",
    "## 总评\n王老师上课节奏快但条理清晰，期末是闭卷但题目偏向理解。\n\n## 体验\n- PPT 制作非常用心\n- 期末重点会在最后一次课点到\n- 给分中等偏上",
    12, {
      courseId: courses[0].id,
      courseTeacherId: courseTeachers[0]["王明远"],
      ratings: { difficulty: 3, reward: 5, recommend: 5, givingScore: 4 },
      semester: "2024-2025-1",
    });
  // 课评要写入派生表 CourseRating
  await prisma.courseRating.create({
    data: {
      topicId: cr1.id, courseId: courses[0].id,
      courseTeacherId: courseTeachers[0]["王明远"],
      authorId: bob.id,
      difficulty: 3, reward: 5, recommend: 5, givingScore: 4, semester: "2024-2025-1",
    },
  });

  const cr2 = await makeTopic(coursereview.id, alice.id,
    "MAT101 高等数学下（孙立群）—— 慎选",
    "节奏太快，难度大。期末挂科率高，建议提前预习。",
    30, {
      courseId: courses[4].id,
      courseTeacherId: courseTeachers[4]["孙立群"],
      ratings: { difficulty: 5, reward: 4, recommend: 2, givingScore: 2 },
      semester: "2024-2025-2",
    });
  await prisma.courseRating.create({
    data: {
      topicId: cr2.id, courseId: courses[4].id,
      courseTeacherId: courseTeachers[4]["孙立群"],
      authorId: alice.id,
      difficulty: 5, reward: 4, recommend: 2, givingScore: 2, semester: "2024-2025-2",
    },
  });

  // 更新课程聚合
  for (const c of [courses[0], courses[4]]) {
    const agg = await prisma.courseRating.aggregate({
      where: { courseId: c.id },
      _count: true,
      _avg: { difficulty: true, reward: true, recommend: true, givingScore: true },
    });
    await prisma.course.update({
      where: { id: c.id },
      data: {
        ratingCount: agg._count,
        avgDifficulty: agg._avg.difficulty ?? 0,
        avgReward: agg._avg.reward ?? 0,
        avgRecommend: agg._avg.recommend ?? 0,
        avgScore: agg._avg.givingScore ?? 0,
      },
    });
  }

  // 新生入学
  await makeTopic(freshman.id, bob.id,
    "学长亲历：江宁→玄武门校车攻略",
    "## 班次\n07:00 08:30 10:00 12:00 14:00 16:30 18:30 21:00\n\n## 票价\n免费（凭校园卡）\n\n## 注意\n周六周日班次同。雨天易堵，建议提前 20 分钟到。",
    24);

  // 示例回复（给 t1 加几条回复）
  for (let i = 0; i < 4; i++) {
    await prisma.reply.create({
      data: {
        topicId: t1.id,
        authorId: [bob.id, carol.id, admin.id, bob.id][i],
        content: ["签到 ✋", "新生表示已收藏", "管理员到此一游", "支持！"][i],
        floor: i + 1,
        createdAt: dt(70 - i * 6),
      },
    });
  }

  // 给 t2 加 2 条回复
  await prisma.reply.create({
    data: { topicId: t2.id, authorId: alice.id, content: "在哪里？我也想出来走走", floor: 1, createdAt: dt(4) },
  });

  // 更新各帖的 replyCount 与 lastReplyAt 已经在 makeTopic 时设置

  // 更新 board.topicCount
  for (const slug of COMMUNITY_BOARD_DEFS.map((board) => board.slug)) {
    const b = await prisma.board.findUnique({ where: { slug } });
    if (!b) continue;
    const c = await prisma.topic.count({ where: { boardId: b.id, hidden: false } });
    await prisma.board.update({ where: { id: b.id }, data: { topicCount: c } });
  }

  // 更新用户帖数
  for (const u of [alice, bob, carol, admin]) {
    const pc = await prisma.topic.count({ where: { authorId: u.id } });
    const rc = await prisma.reply.count({ where: { authorId: u.id } });
    await prisma.user.update({ where: { id: u.id }, data: { postCount: pc, replyCount: rc } });
  }

  // 示例通知
  await prisma.notification.createMany({
    data: [
      { userId: alice.id, category: "reply", level: "normal", title: "有人回复了你的帖子", content: "@夜归人 回复了「欢迎来到药大拾间」", link: `/forum/topic/${t1.id}`, source: "论坛" },
      { userId: null, category: "system", level: "weak", title: "「药大拾间」上线公测", content: "欢迎试用！本站为民间学生站，与学校官方无关。", source: "站务组" },
      { userId: null, category: "system", level: "normal", title: "版规公示", content: "请理性发言、不传播敏感内容、不发布违法信息。", source: "站务组" },
    ],
  });

  // 站点功能开关：默认全开，admin 可在管理后台一键关闭
  console.log("⚙️  初始化功能开关...");
  await prisma.siteSetting.createMany({
    data: [
      { key: "feature.forum",        value: "on" },
      { key: "feature.market",       value: "on" },
      { key: "feature.coursereview", value: "on" },
      { key: "feature.electric",     value: "on" },
    ],
  });

  console.log("✅ 种子数据生成完成。");
  console.log(`  用户: alice/bob/carol (123456), admin (admin123), school-bot`);
  console.log(`  板块: ${feeds.length} 个公告板（爬虫）+ ${COMMUNITY_BOARD_DEFS.length} 个 UGC 板块`);
  console.log(`  课程: 6 门`);
  console.log(`  服务卡片: ${services.length} 项`);
  console.log(`  示例话题已发`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
