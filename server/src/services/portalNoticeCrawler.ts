/**
 * 融合门户“门户资讯聚合”入库。
 *
 * 列表要登录后才能看，所以用管理员在后台绑定的教务会话去取（走教务通道，落到持有该会话的节点）；
 * 正文在各部门的公开网站上，走公告抓取通道。每个发布部门对应一个公告板块，没有就自动建。
 */
import crypto from "node:crypto";
import type { Board, SchoolFeedSource } from "@prisma/client";
import { prisma } from "../prisma";
import { isDev } from "../config";
import { Errors } from "../utils/response";
import { invalidateBoardCaches, invalidateForumCaches } from "./cacheInvalidation";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { getPortalNotices } from "./jwxtTransport";
import { fetchSchoolFeedDetails } from "./schoolCrawlerTransport";
import { SCHOOL_FEED_DETAIL_BATCH, type SchoolFeedDetail } from "./schoolCrawlerCore";
import {
  isDefaultAnnouncementDepartment,
  PORTAL_NOTICE_HOMEPAGE,
  PORTAL_NOTICE_LIST_URL,
  PORTAL_NOTICE_MAX_PAGE_SIZE,
  PORTAL_NOTICE_PARSER,
  PORTAL_NOTICE_SOURCE_SLUG,
  portalNoticeExternalId,
  type PortalNotice,
} from "./portalNotices";

// 首次同步有上百条积压；每轮只入库这么多，剩下的留给后面几轮，避免一轮抓取占住调度锁太久。
const NEW_NOTICES_PER_RUN = 20;
const SESSION_PURPOSE = "portal-notice-session";

function readSessionToken(source: Pick<SchoolFeedSource, "id" | "sessionToken">) {
  if (!source.sessionToken) return null;
  try {
    const { value } = decryptJwxtSensitiveJson<{ token?: string }>(SESSION_PURPOSE, String(source.id), source.sessionToken);
    return typeof value?.token === "string" && value.token ? value.token : null;
  } catch {
    return null;
  }
}

function departmentSlug(department: string) {
  return `dept-${crypto.createHash("sha1").update(department).digest("hex").slice(0, 10)}`;
}

async function departmentBoard(department: string, cache: Map<string, Board>) {
  const cached = cache.get(department);
  if (cached) return cached;
  let board = await prisma.board.findUnique({ where: { feedDepartment: department } });
  if (!board) {
    // 已有直接抓部门网站的板块（如“教务处通知”）时并进去，不另开一个同名部门。
    const existing = await prisma.board.findFirst({
      where: { type: "announce", feedDepartment: null, feedSourceId: { not: null }, name: { startsWith: department } },
    });
    if (existing) {
      board = await prisma.board.update({ where: { id: existing.id }, data: { feedDepartment: department } });
    } else {
      const last = await prisma.board.aggregate({ where: { type: "announce" }, _max: { order: true } });
      board = await prisma.board.create({
        data: {
          slug: departmentSlug(department),
          // 学校主站的通知在门户里署名是校名，当标签不好认。
          name: department === "中国药科大学" ? "学校通知" : department,
          description: `${department}发布的通知，同步自学校融合门户`,
          icon: "📢",
          color: "#1d4d8a",
          order: (last._max.order ?? 0) + 1,
          type: "announce",
          readOnly: true,
          feedDepartment: department,
          announceDefault: isDefaultAnnouncementDepartment(department),
        },
      });
    }
  }
  cache.set(department, board);
  return board;
}

function noticeContent(notice: PortalNotice, detail: SchoolFeedDetail | undefined) {
  if (detail?.content) return detail.content;
  if (notice.summary) return `${notice.summary}……\n\n_以上是摘要，完整内容请点击帖子顶部原文入口查看。_`;
  return "_未能提取正文，请点击帖子顶部原文入口查看_";
}

/** 取列表和取正文两步都要出网，测试时换成假的。 */
const network = { listNotices: getPortalNotices, fetchDetails: fetchSchoolFeedDetails };

export async function importPortalNotices(source: SchoolFeedSource, opts: { dryRun?: boolean } = {}, deps = network) {
  const token = readSessionToken(source);
  if (!token) throw new Error("还没有绑定门户登录态，请在后台用自己的账号登录教务后绑定");

  const pageSize = Math.min(PORTAL_NOTICE_MAX_PAGE_SIZE, Math.max(50, source.maxPages * 50));
  const page = await deps.listNotices(token, { pageSize });
  if (isDev) console.log(`  [${source.slug}] ${page.notices.length}/${page.total} notices`);

  const byExternalId = new Map<string, PortalNotice>();
  for (const notice of page.notices) {
    const externalId = portalNoticeExternalId(notice);
    if (!byExternalId.has(externalId)) byExternalId.set(externalId, notice);
  }
  // 不限定来源：部门网站直接抓到过的同一篇文章也算已入库。
  const known = await prisma.schoolFeedItem.findMany({
    where: { externalId: { in: [...byExternalId.keys()] } },
    select: { externalId: true },
  });
  for (const item of known) byExternalId.delete(item.externalId);
  const fresh = [...byExternalId.entries()].slice(0, NEW_NOTICES_PER_RUN);
  if (opts.dryRun || !fresh.length) return fresh.length;

  const details = new Map<string, SchoolFeedDetail>();
  for (let index = 0; index < fresh.length; index += SCHOOL_FEED_DETAIL_BATCH) {
    const urls = fresh.slice(index, index + SCHOOL_FEED_DETAIL_BATCH).map(([, notice]) => notice.url);
    for (const detail of await deps.fetchDetails(urls)) details.set(detail.url, detail);
  }

  const boards = new Map<string, Board>();
  const boardsBefore = await prisma.board.count({ where: { type: "announce" } });
  let created = 0;
  for (const [externalId, notice] of fresh) {
    const board = await departmentBoard(notice.department, boards);
    const detail = details.get(notice.url);
    const sourceUrl = detail?.effectiveUrl || notice.url;
    const wechat = /^https?:\/\/mp\.weixin\.qq\.com\//i.test(sourceUrl);
    const publishedAt = new Date(notice.publishedAt);
    await prisma.$transaction(async (tx) => {
      const topic = await tx.topic.create({
        data: {
          boardId: board.id,
          authorId: source.botUserId,
          title: notice.title.slice(0, 120),
          content: noticeContent(notice, detail),
          metadata: JSON.stringify({
            sourceUrl,
            listUrl: notice.url,
            external: wechat,
            externalType: wechat ? "wechat" : null,
            publishedAt: publishedAt.toISOString(),
            sourceName: notice.department,
            sourceColumn: notice.column || null,
          }),
          createdAt: publishedAt,
          updatedAt: publishedAt,
          lastReplyAt: publishedAt,
          lastReplyById: source.botUserId,
        },
      });
      await tx.schoolFeedItem.create({
        data: { sourceId: source.id, externalId, url: notice.url, title: notice.title, publishedAt, topicId: topic.id },
      });
      await tx.board.update({ where: { id: board.id }, data: { topicCount: { increment: 1 } } });
    });
    created += 1;
  }
  if (created > 0 || boardsBefore !== await prisma.board.count({ where: { type: "announce" } })) {
    await invalidateBoardCaches();
    await invalidateForumCaches();
  }
  return created;
}

export async function runPortalNoticeSource(source: SchoolFeedSource, opts: { dryRun?: boolean } = {}) {
  let newCount = 0;
  let error: string | null = null;
  try {
    newCount = await importPortalNotices(source, opts);
  } catch (e: any) {
    error = e?.message ?? String(e);
    if (isDev) console.warn(`[crawler] ${source.slug} failed:`, error);
  }
  await prisma.schoolFeedSource.update({
    where: { id: source.id },
    data: { lastRunAt: new Date(), lastRunOk: !error, lastError: error },
  });
  return { ok: !error, newCount, error };
}

/** 删除门户同步来的全部帖子（各部门板块保留），用于重新抓取。 */
export async function clearPortalNoticeItems(source: SchoolFeedSource) {
  const items = await prisma.schoolFeedItem.findMany({ where: { sourceId: source.id }, select: { topicId: true } });
  const topicIds = items.map((item) => item.topicId).filter((id): id is number => typeof id === "number");
  await prisma.$transaction(async (tx) => {
    const boards = topicIds.length
      ? await tx.topic.findMany({ where: { id: { in: topicIds } }, select: { boardId: true }, distinct: ["boardId"] })
      : [];
    await tx.schoolFeedItem.deleteMany({ where: { sourceId: source.id } });
    if (topicIds.length) await tx.topic.deleteMany({ where: { id: { in: topicIds }, board: { type: "announce" } } });
    for (const { boardId } of boards) {
      const count = await tx.topic.count({ where: { boardId, hidden: false } });
      await tx.board.update({ where: { id: boardId }, data: { topicCount: count } });
    }
  });
  await invalidateBoardCaches();
  await invalidateForumCaches();
}

/** 门户已入库文章的外部 ID，供直接抓部门网站的源跳过，省掉重复取正文。 */
export async function portalNoticeExternalIds(limit = 3000) {
  const source = await prisma.schoolFeedSource.findUnique({ where: { slug: PORTAL_NOTICE_SOURCE_SLUG }, select: { id: true } });
  if (!source) return [];
  const items = await prisma.schoolFeedItem.findMany({
    where: { sourceId: source.id },
    orderBy: { id: "desc" },
    take: limit,
    select: { externalId: true },
  });
  return items.map((item) => item.externalId);
}

/** 把管理员当前的教务会话绑定为门户资讯的登录态；第一次绑定时顺带建好同步源。 */
export async function bindPortalNoticeSession(userId: number, token: string) {
  let total: number;
  try {
    total = (await getPortalNotices(token, { pageSize: 1 })).total;
  } catch (error: any) {
    throw Errors.badRequest(`用这个登录态读不到门户资讯：${error?.message ?? "未知错误"}`);
  }
  let source = await prisma.schoolFeedSource.findUnique({ where: { slug: PORTAL_NOTICE_SOURCE_SLUG } });
  if (!source) {
    const bot = (await prisma.schoolFeedSource.findFirst({ orderBy: { id: "asc" }, select: { botUserId: true } }))?.botUserId
      ?? (await prisma.user.findFirst({ where: { role: "bot" }, orderBy: { id: "asc" }, select: { id: true } }))?.id;
    if (!bot) throw Errors.badRequest("没有可用的公告机器人账号");
    source = await prisma.schoolFeedSource.create({
      data: {
        slug: PORTAL_NOTICE_SOURCE_SLUG,
        name: "融合门户资讯聚合",
        homepage: PORTAL_NOTICE_HOMEPAGE,
        listUrl: PORTAL_NOTICE_LIST_URL,
        parser: PORTAL_NOTICE_PARSER,
        pageSize: 50,
        maxPages: 2,
        cronMinutes: 15,
        botUserId: bot,
      },
    });
  }
  await prisma.schoolFeedSource.update({
    where: { id: source.id },
    data: {
      sessionUserId: userId,
      sessionToken: encryptJwxtSensitiveJson(SESSION_PURPOSE, String(source.id), { token }),
      sessionBoundAt: new Date(),
      lastError: null,
    },
  });
  return { sourceId: source.id, total };
}

export async function unbindPortalNoticeSession() {
  await prisma.schoolFeedSource.updateMany({
    where: { slug: PORTAL_NOTICE_SOURCE_SLUG },
    data: { sessionUserId: null, sessionToken: null, sessionBoundAt: null },
  });
}
