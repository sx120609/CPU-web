import { prisma } from "../prisma";
import { ConcurrencyGate, TtlLru } from "../utils/loadShield";
import { sanitizeLostFoundTopicFields } from "./lostFoundPrivacy";
import { isRetiredBoardSlug, visibleBoardSlugFilter } from "./retiredBoards";
import { enabledBoardTypes, getSiteOrigin, isBoardTypeEnabled, isFeatureOn } from "./siteSettings";

// 主站是单页应用：搜索引擎和聊天软件的链接预览只看得到服务端返回的 index.html。
// 这里按路径给它换上该页自己的标题、描述、canonical 和结构化数据，私人页面标 noindex。
// 前端新增公开页面时要在 STATIC_PAGES 或 resolveDynamicPage 里登记，否则按未知路径处理（noindex）。

export const SITE_NAME = "药大拾间";
export const SITE_HOME_TITLE = "药大拾间 · 中国药科大学校园互助与服务平台";
export const SITE_HOME_DESCRIPTION = "药大拾间是面向中国药科大学同学的校园互助与服务平台，提供课表与教务数据查询、教务处和学工处等部门通知汇总、校园论坛、失物招领、校园小工具和小游戏。";
const SITE_KEYWORDS = "药大拾间,中国药科大学,药大,CPU,课表,教务系统,校园公告,校园论坛,失物招领";
const FALLBACK_ORIGIN = "https://cputime.cn";
const SITE_IMAGE_PATH = "/icon-512-v3.png";

const DYNAMIC_CACHE_TTL_MS = 60_000;
const DYNAMIC_LOOKUP_TIMEOUT_MS = 400;
const SITEMAP_CACHE_TTL_MS = 15 * 60_000;
const SITEMAP_TOPIC_LIMIT = 20_000;
const SITEMAP_WORKSHOP_LIMIT = 2_000;
const TOPIC_BODY_CHARS = 600;
const MAX_TOPIC_ID = 2_147_483_647;

export type PageSeo = {
  /** 完整的文档标题。 */
  title: string;
  description: string;
  /** 站内路径；可收录页面用作 canonical。 */
  path: string;
  index: boolean;
  type?: "website" | "article";
  keywords?: string;
  image?: { url: string; width?: number; height?: number };
  article?: {
    headline: string;
    section: string;
    publisher?: string;
    publishedAt: Date;
    modifiedAt: Date;
  };
  /** 不执行脚本的抓取器（如百度）看到的正文。 */
  heading?: string;
  body?: string;
};

type Access = "always" | "forum" | "market" | "coursereview";

type StaticPage = {
  title: string | null;
  description: string;
  index?: boolean;
  /** 同一内容的规范地址。 */
  canonical?: string;
  /** 只有对应功能对游客开放时才收录。 */
  access?: Access;
  sitemap?: boolean;
};

const GAME_DESCRIPTION = "药大主题的轻量小游戏，打开网页就能玩，登录后成绩计入全校排行。";

const STATIC_PAGES: Record<string, StaticPage> = {
  "/": { title: null, description: SITE_HOME_DESCRIPTION, sitemap: true },
  "/home": { title: null, description: SITE_HOME_DESCRIPTION, canonical: "/" },
  "/index.html": { title: null, description: SITE_HOME_DESCRIPTION, canonical: "/" },
  "/announcements": {
    title: "校园公告",
    description: "汇总中国药科大学教务处、学工处、研究生院等部门的最新通知公告，可按部门筛选，第一时间查看。",
    sitemap: true,
  },
  "/services": {
    title: "校园服务",
    description: "药大拾间的校园服务入口：课表、教务数据、日程、失物招领、校历与地图、PDF 工具和小游戏。",
    sitemap: true,
  },
  "/services/tools": {
    title: "校园小工具",
    description: "中国药科大学校园小工具合集：PDF 工具、校历与地图、场馆预约、在线问卷、文件收集、综测填表等。",
    sitemap: true,
  },
  "/schedule": {
    title: "课表",
    description: "导入中国药科大学教务系统课表，按周查看课程、上课时间和教室，网页与手机 App 同步。",
    sitemap: true,
  },
  "/jwxt": {
    title: "教务数据",
    description: "查询中国药科大学教务系统的成绩、绩点、考试安排、培养方案和空教室等数据。",
    sitemap: true,
  },
  "/download": {
    title: "客户端下载",
    description: "下载药大拾间 iOS、安卓、鸿蒙和电脑客户端，课表、通知和校园服务随时可用。",
    sitemap: true,
  },
  "/downloads": { title: "客户端下载", description: "下载药大拾间 iOS、安卓、鸿蒙和电脑客户端。", canonical: "/download" },
  "/lost-found": {
    title: "失物招领",
    description: "中国药科大学校园失物招领：按校区、地点和时间查找丢失物品与招领信息。",
    sitemap: true,
  },
  "/workshop": {
    title: "创意工坊",
    description: "药大同学制作的小游戏和实用网页工具，审核通过后向全校开放，也可以上传自己的作品。",
    sitemap: true,
  },
  "/workshop/develop": {
    title: "工坊开发指南",
    description: "为药大拾间创意工坊开发网页小游戏和工具：作品格式、运行环境、存档与排行榜接口。",
    sitemap: true,
  },
  "/thanks": { title: "致谢", description: "感谢为药大拾间提供帮助、建议和支持的同学与朋友。", sitemap: true },
  "/sponsor": { title: "支持药大拾间", description: "支持药大拾间的持续运营。" },
  "/search": { title: "拾间AI", description: "药大拾间的 AI 助手，可以查询校园事务、部门联系方式和最新通知。" },
  "/agenda": { title: "日程", description: "记下课表以外的安排和待办，到点提醒，也显示在课表里。", index: false },
  "/forum": {
    title: "论坛",
    description: "中国药科大学同学的校园论坛：学习交流、校园生活、二手交易和问答。",
    access: "forum",
    sitemap: true,
  },
  "/forum/hot": { title: "热榜", description: "药大拾间论坛热门讨论。", access: "forum", sitemap: true },
  "/forum/latest": { title: "最新内容", description: "药大拾间论坛最新发布的帖子。", access: "forum", sitemap: true },
  "/forum/b/market": {
    title: "二手交流",
    description: "中国药科大学校内二手交易：教材、数码、宿舍用品和票券。",
    access: "market",
    sitemap: true,
  },
  "/coursereview": {
    title: "课程点评",
    description: "中国药科大学课程与任课教师点评，选课前看看同学们的评价。",
    access: "coursereview",
    sitemap: true,
  },
  "/services/tools/games": { title: "小游戏", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/yaoda-can-fly": { title: "药大人能飞", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/yaoda-can-fly/tomato-egg-noodles": { title: "番茄鸡蛋面", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/yaoda-can-fly/zombie-defense": { title: "药大人大战僵尸", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/yaoda-can-fly/yaoda-nai": { title: "合成药大奶", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/yaoda-can-fly/greedy-nailong": { title: "药大人能吃", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/yaoda-can-fly/yaoda-mines": { title: "清扫药大雷", description: GAME_DESCRIPTION, sitemap: true },
  "/services/tools/voicehub": {
    title: "药苑之声",
    description: "中国药科大学校园广播站点歌：提交歌曲、参与投票、查看播出排期。",
    sitemap: true,
  },
  "/services/tools/assessment-form": {
    title: "综测填表工具",
    description: "中国药科大学本科生综合素质测评材料整理工具：本机填写项目和附件，一键生成排版完成的 Word。",
    sitemap: true,
  },
  "/services/tools/department_contacts": {
    title: "部门联系",
    description: "按部门、校区或办事需求查找中国药科大学各部门的公开联系方式。",
    sitemap: true,
  },
  "/services/tools/pdf_tools": {
    title: "PDF 工具",
    description: "在浏览器本地合并、拆分、压缩 PDF，转图片和提取文字，适合整理作业、通知和课程材料。",
    sitemap: true,
  },
  "/services/tools/school_calendar": {
    title: "校历与地图",
    description: "查看中国药科大学官方校历和校园地图，支持大图浏览与地图下载。",
    sitemap: true,
  },
  "/services/tools/venue_reservation": {
    title: "场馆预约",
    description: "进入中国药科大学智慧场馆预约系统，微信内直接打开，其他设备扫码。",
    sitemap: true,
  },
  "/services/tools/questionnaire": { title: "在线问卷", description: "发布和填写问卷，查看结果统计并导出。" },
  "/services/tools/file_collect": { title: "文件收集", description: "集中收作业、材料和照片：字段校验、文件命名、提交统计和批量下载。" },
  "/services/tools/grade_check": { title: "成绩表核对", description: "上传带学号的成绩表，学生登录后只能查看自己的记录。" },
  "/services/tools/feedback": { title: "需求反馈", description: "提交校园服务建议与使用问题。" },
};

// 登录后才有内容、或只属于某个人的页面：可以打开，但不让搜索引擎收录。
const PRIVATE_PAGES: Array<[RegExp, string]> = [
  [/^\/login$/, "登录"],
  [/^\/register$/, "注册"],
  [/^\/next$/, "药大拾间 NEXT"],
  [/^\/post(?:\/|$)/, "发帖"],
  [/^\/messages(?:\/|$)/, "消息中心"],
  [/^\/profile(?:\/|$)/, "我的"],
  [/^\/vip$/, "VIP 中心"],
  [/^\/admin(?:\/|$)/, "管理后台"],
  [/^\/u\/[^/]+$/, "用户"],
  [/^\/home\/services$/, "首页"],
  [/^\/search\/results$/, "站内搜索"],
  [/^\/schedule\/(?:share|couple)(?:\/|$)/, "共享课表"],
  [/^\/workshop\/(?:mine|review)$/, "创意工坊"],
  [/^\/workshop\/[^/]+\/run$/, "创意工坊"],
  [/^\/services\/tools\/yaoda-can-fly\/workshop\/[^/]+$/, "创意工坊"],
  [/^\/services\/tools\/(?:manage|filestore|filestore-beta|qqbot-reminders)(?:\/|$)/, "校园小工具"],
  [/^\/services\/tools\/(?:questionnaires|grade-checks|file-collections)\/[^/]+$/, "校园小工具"],
  [/^\/market(?:\/|$)/, "二手交流"],
  [/^\/coursereview\/[^/]+$/, "课程"],
];

const NOSCRIPT_LINKS: Array<[string, string]> = [
  ["/", "首页"],
  ["/announcements", "校园公告"],
  ["/schedule", "课表"],
  ["/jwxt", "教务数据"],
  ["/services", "校园服务"],
  ["/services/tools", "校园小工具"],
  ["/workshop", "创意工坊"],
  ["/download", "客户端下载"],
  ["/about.html", "关于我们"],
];

const LEGAL_PAGES = ["/about.html", "/terms.html", "/privacy.html", "/community-rules.html"];

export function resolveSiteOrigin() {
  return (getSiteOrigin() || FALLBACK_ORIGIN).replace(/\/+$/, "");
}

export function documentTitle(title: string | null | undefined) {
  const text = String(title || "").trim();
  return text ? `${text} · ${SITE_NAME}` : SITE_HOME_TITLE;
}

export function normalizeSeoPath(pathname: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(String(pathname || "/"));
  } catch {
    decoded = String(pathname || "/");
  }
  return `/${decoded}`.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
}

function accessOpen(access: Access | undefined) {
  if (!access || access === "always") return true;
  if (isFeatureOn("forumLoginRequired")) return false;
  if (access === "forum") return isFeatureOn("forum");
  return isFeatureOn(access);
}

function staticPageSeo(path: string, page: StaticPage): PageSeo {
  return {
    title: documentTitle(page.title),
    description: page.description,
    path: page.canonical || path,
    index: page.index !== false && accessOpen(page.access),
    keywords: page.canonical === "/" || path === "/" ? SITE_KEYWORDS : undefined,
  };
}

function privatePageSeo(path: string, title: string | null): PageSeo {
  return { title: documentTitle(title), description: SITE_HOME_DESCRIPTION, path, index: false };
}

/** 不需要查库就能确定的页面；返回 null 表示要按动态内容（帖子、板块、作品）查。 */
export function resolveStaticPageSeo(pathname: string): PageSeo | null {
  const path = normalizeSeoPath(pathname);
  const page = STATIC_PAGES[path];
  if (page) return staticPageSeo(path, page);
  for (const [pattern, title] of PRIVATE_PAGES) {
    if (pattern.test(path)) return privatePageSeo(path, title);
  }
  if (/^\/forum\/topic\/[^/]+$/.test(path) || /^\/forum\/b\/[^/]+$/.test(path) || /^\/workshop\/[^/]+$/.test(path)) return null;
  return privatePageSeo(path, null);
}

type TopicSeoRecord = {
  id: number;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  board: { slug: string; name: string; type: string; feedDepartment: string | null };
};

type BoardSeoRecord = { slug: string; name: string; description: string | null; type: string };

type WorkshopSeoRecord = {
  id: string;
  updatedAt: Date;
  publishedVersion: { name: string; description: string } | null;
};

const topicCache = new TtlLru<TopicSeoRecord | null>({
  maxEntries: 5_000,
  maxBytes: 8 * 1024 * 1024,
  sizeOf: (topic) => 256 + 2 * ((topic?.title.length ?? 0) + (topic?.content.length ?? 0)),
});
const boardCache = new TtlLru<BoardSeoRecord | null>({ maxEntries: 512 });
const workshopCache = new TtlLru<WorkshopSeoRecord | null>({ maxEntries: 2_000 });
// 页面请求不经过准入控制；查库的并发和排队都封顶，满了就退回通用标题，不让页面等。
const lookupGate = new ConcurrencyGate(4, 32);

export function parseSeoTopicId(value: string) {
  if (!/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 && id <= MAX_TOPIC_ID ? id : null;
}

/** 游客能否读到该板块类型的内容：公告始终公开，其他板块要等论坛对游客开放。 */
function boardTypeOpen(type: string) {
  if (!isBoardTypeEnabled(type)) return false;
  return type === "announce" || !isFeatureOn("forumLoginRequired");
}

function indexableBoardTypes() {
  return enabledBoardTypes().filter(boardTypeOpen);
}

async function loadTopic(id: number) {
  return topicCache.load(String(id), DYNAMIC_CACHE_TTL_MS, () => lookupGate.run(async () => {
    const topic = await prisma.topic.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        content: true,
        metadata: true,
        hidden: true,
        createdAt: true,
        updatedAt: true,
        board: { select: { slug: true, name: true, type: true, feedDepartment: true } },
      },
    });
    if (!topic || topic.hidden || !topic.board || isRetiredBoardSlug(topic.board.slug)) return null;
    const { title, content } = sanitizeLostFoundTopicFields(topic);
    return { id: topic.id, title, content, createdAt: topic.createdAt, updatedAt: topic.updatedAt, board: topic.board };
  }));
}

async function loadBoard(slug: string) {
  return boardCache.load(slug, DYNAMIC_CACHE_TTL_MS, () => lookupGate.run(async () => {
    const board = await prisma.board.findUnique({ where: { slug }, select: { slug: true, name: true, description: true, type: true } });
    return board && !isRetiredBoardSlug(board.slug) ? board : null;
  }));
}

async function loadWorkshopWork(id: string) {
  return workshopCache.load(id, DYNAMIC_CACHE_TTL_MS, () => lookupGate.run(() => prisma.workshopWork.findFirst({
    where: { id, disabled: false, publishedVersion: { is: { status: "APPROVED" } } },
    select: { id: true, updatedAt: true, publishedVersion: { select: { name: true, description: true } } },
  })));
}

async function resolveDynamicPage(path: string, origin: string): Promise<PageSeo> {
  const topicMatch = /^\/forum\/topic\/([^/]+)$/.exec(path);
  if (topicMatch) {
    const id = parseSeoTopicId(topicMatch[1]);
    const topic = id === null ? null : await loadTopic(id);
    if (!topic || !boardTypeOpen(topic.board.type)) return privatePageSeo(path, "帖子");
    const text = plainText(topic.content);
    const announce = topic.board.type === "announce";
    return {
      title: documentTitle(topic.title),
      description: truncateText(text, 120) || `${topic.board.name} · ${topic.title}`,
      path: `/forum/topic/${topic.id}`,
      index: true,
      type: "article",
      image: { url: `${origin}/share/topic/${topic.id}/card.png`, width: 720 },
      article: {
        headline: truncateText(topic.title, 110),
        section: topic.board.name,
        publisher: announce ? topic.board.feedDepartment || topic.board.name : undefined,
        publishedAt: topic.createdAt,
        modifiedAt: topic.updatedAt,
      },
      heading: topic.title,
      body: truncateText(text, TOPIC_BODY_CHARS),
    };
  }

  const boardMatch = /^\/forum\/b\/([^/]+)$/.exec(path);
  if (boardMatch) {
    const slug = boardMatch[1];
    const board = /^[\w-]{1,64}$/.test(slug) ? await loadBoard(slug) : null;
    if (!board || !boardTypeOpen(board.type)) return privatePageSeo(path, "板块");
    const description = board.type === "announce"
      ? `${board.name}：中国药科大学${board.name.replace(/通知$/, "")}发布的最新通知公告，由药大拾间自动同步整理。`
      : board.description?.trim() || `药大拾间论坛「${board.name}」板块。`;
    return { title: documentTitle(board.name), description, path: `/forum/b/${board.slug}`, index: true };
  }

  const workMatch = /^\/workshop\/([^/]+)$/.exec(path);
  if (workMatch) {
    const id = workMatch[1];
    const work = /^[0-9a-f-]{36}$/i.test(id) ? await loadWorkshopWork(id) : null;
    if (!work?.publishedVersion) return privatePageSeo(path, "作品详情");
    const name = work.publishedVersion.name.trim() || "作品详情";
    const description = truncateText(plainText(work.publishedVersion.description), 120) || `药大拾间创意工坊作品「${name}」。`;
    return {
      title: documentTitle(name),
      description,
      path: `/workshop/${work.id}`,
      index: true,
      heading: name,
      body: description,
    };
  }

  return privatePageSeo(path, null);
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("seo lookup timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 给 index.html 换上该路径自己的标题、描述和收录规则。 */
export async function applyPageSeo(html: string, pathname: string) {
  const origin = resolveSiteOrigin();
  return renderSeoHtml(html, await resolvePageSeo(pathname, origin), origin);
}

export async function resolvePageSeo(pathname: string, origin = resolveSiteOrigin()): Promise<PageSeo> {
  const known = resolveStaticPageSeo(pathname);
  if (known) return known;
  const path = normalizeSeoPath(pathname);
  try {
    return await withTimeout(resolveDynamicPage(path, origin), DYNAMIC_LOOKUP_TIMEOUT_MS);
  } catch {
    // 查库慢或排队满：给通用标题且不收录，页面照常打开；下次抓取时再给真实内容。
    return privatePageSeo(path, null);
  }
}

export function renderSeoHtml(html: string, seo: PageSeo, origin = resolveSiteOrigin()) {
  const url = `${origin}${seo.path === "/" ? "/" : seo.path}`;
  const image = seo.image || { url: `${origin}${SITE_IMAGE_PATH}`, width: 512, height: 512 };
  const head = [
    seo.keywords ? `<meta name="keywords" content="${escapeHtml(seo.keywords)}" />` : "",
    seo.index ? `<link rel="canonical" href="${escapeHtml(url)}" />` : `<meta name="robots" content="noindex" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="zh_CN" />`,
    `<meta property="og:type" content="${seo.type || "website"}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image.url)}" />`,
    image.width ? `<meta property="og:image:width" content="${image.width}" />` : "",
    image.height ? `<meta property="og:image:height" content="${image.height}" />` : "",
    `<meta name="twitter:card" content="${seo.image ? "summary_large_image" : "summary"}" />`,
    seo.index ? renderJsonLd(seo, url, origin) : "",
  ].filter(Boolean).map((line) => `    ${line}`).join("\n");

  let output = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(seo.title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(seo.description)}" />`)
    .replace(/\s*<\/head>/, `\n${head}\n  </head>`);
  if (seo.index) output = output.replace(/<body([^>]*)>/, (match) => `${match}\n    ${renderNoscript(seo)}`);
  return output;
}

function renderJsonLd(seo: PageSeo, url: string, origin: string) {
  const organization = { "@type": "Organization", name: SITE_NAME, url: `${origin}/`, logo: `${origin}${SITE_IMAGE_PATH}` };
  const graph: Record<string, unknown>[] = [];
  if (seo.path === "/") {
    graph.push({ "@type": "WebSite", name: SITE_NAME, url: `${origin}/`, inLanguage: "zh-CN", description: seo.description, publisher: organization });
    graph.push(organization);
  } else if (seo.article) {
    graph.push({
      "@type": "Article",
      headline: seo.article.headline,
      description: seo.description,
      articleSection: seo.article.section,
      datePublished: seo.article.publishedAt.toISOString(),
      dateModified: seo.article.modifiedAt.toISOString(),
      mainEntityOfPage: url,
      inLanguage: "zh-CN",
      image: seo.image?.url,
      ...(seo.article.publisher ? { author: { "@type": "Organization", name: seo.article.publisher } } : {}),
      publisher: organization,
    });
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: seo.article.section },
        { "@type": "ListItem", position: 3, name: seo.article.headline, item: url },
      ],
    });
  } else {
    return "";
  }
  // JSON 放进 <script> 前转义尖括号和 &，内容里出现 </script> 也不会提前结束脚本块。
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return `<script type="application/ld+json">${json}</script>`;
}

function renderNoscript(seo: PageSeo) {
  const heading = seo.heading || seo.title;
  const body = seo.body || seo.description;
  const links = NOSCRIPT_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join(" · ");
  return `<noscript><main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p><nav>${links}</nav></main></noscript>`;
}

export function renderRobotsTxt(origin = resolveSiteOrigin()) {
  return [
    "User-agent: *",
    "Allow: /",
    // 页面靠 /api 渲染内容，搜索引擎渲染时要能请求它，所以不屏蔽 /api。
    "Disallow: /admin",
    "Disallow: /qqbot/",
    "Disallow: /filestore/",
    "Disallow: /search/results",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

type SitemapEntry = { path: string; lastmod?: Date };

const sitemapCache = new TtlLru<string>({ maxEntries: 4 });

export function loadSitemapXml(origin = resolveSiteOrigin()) {
  return sitemapCache.load(origin, SITEMAP_CACHE_TTL_MS, async () => renderSitemapXml(origin, await collectSitemapEntries()));
}

async function collectSitemapEntries(): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  for (const [path, page] of Object.entries(STATIC_PAGES)) {
    if (page.sitemap && page.index !== false && !page.canonical && accessOpen(page.access)) entries.push({ path });
  }
  for (const path of LEGAL_PAGES) entries.push({ path });

  const boardTypes = indexableBoardTypes();
  const [boards, topics, works] = await Promise.all([
    prisma.board.findMany({
      where: { type: { in: boardTypes }, topicCount: { gt: 0 }, ...visibleBoardSlugFilter() },
      select: { slug: true },
      orderBy: [{ type: "asc" }, { order: "asc" }],
    }),
    prisma.topic.findMany({
      where: { hidden: false, board: { type: { in: boardTypes }, ...visibleBoardSlugFilter() } },
      select: { id: true, updatedAt: true },
      orderBy: { id: "desc" },
      take: SITEMAP_TOPIC_LIMIT,
    }),
    prisma.workshopWork.findMany({
      where: { disabled: false, publishedVersion: { is: { status: "APPROVED" } } },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: SITEMAP_WORKSHOP_LIMIT,
    }),
  ]);
  for (const board of boards) {
    const path = `/forum/b/${board.slug}`;
    if (!STATIC_PAGES[path]) entries.push({ path });
  }
  for (const topic of topics) entries.push({ path: `/forum/topic/${topic.id}`, lastmod: topic.updatedAt });
  for (const work of works) entries.push({ path: `/workshop/${work.id}`, lastmod: work.updatedAt });
  return entries;
}

export function renderSitemapXml(origin: string, entries: SitemapEntry[]) {
  const urls = entries.map((entry) => {
    const loc = `<loc>${escapeHtml(`${origin}${entry.path}`)}</loc>`;
    const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod.toISOString()}</lastmod>` : "";
    return `  <url>${loc}${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function plainText(input: string | null | undefined) {
  return String(input || "")
    // 只去掉真正的 HTML 标签；同步来的通知里常用 <…> 当书名号。
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text: string, maxChars: number) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("").trimEnd()}…`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
