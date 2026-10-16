/**
 * 论坛帖子与同步来的学校公告的检索。
 *
 * 规模只有几万帖，所以在内存里放每帖的标题和开头一段做候选打分，不依赖数据库的中文分词扩展。
 * 索引只负责找候选；正文、回复和可见性每次都回数据库核对，帖子被隐藏或删除后不会因为索引
 * 还没刷新就被引用。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { isRetiredBoardSlug } from "./retiredBoards";
import {
  KNOWLEDGE_DAY_MS,
  extractKnowledgeQueryTerms,
  focusedExcerpt,
  knowledgePlainText,
  normalizeKnowledgeText,
  rankKnowledgeEntries,
} from "./knowledgeText";

export type ForumKnowledgeKind = "forum" | "announce" | "coursereview";

export type ForumKnowledgeAudience = {
  /** 普通板块和提问广场；没有论坛权限的用户只能用公告。 */
  forum: boolean;
  coursereview: boolean;
};

export type ForumKnowledgeReply = {
  excerpt: string;
  likeCount: number;
  accepted: boolean;
};

export type ForumKnowledgeHit = {
  topicId: number;
  kind: ForumKnowledgeKind;
  boardName: string;
  title: string;
  /** YYYY-MM-DD；公告是学校的发布日期。 */
  publishedAt: string;
  excerpt: string;
  replies: ForumKnowledgeReply[];
  url: string;
  coverage: number;
};

type IndexedTopic = {
  id: number;
  boardType: string;
  publishedAt: number;
  replyCount: number;
  titleKey: string;
  bodyKey: string;
};

export type ForumKnowledgeIndexRow = {
  id: number;
  title: string;
  content: string | null;
  createdAt: Date;
  replyCount: number;
  hidden: boolean;
  boardType: string;
  boardSlug: string;
  boardName: string;
};

const INDEXED_BOARD_TYPES = ["normal", "question", "announce", "coursereview"] as const;
// 树洞是情绪倾诉，失物招领带联系方式且有单独的隐私处理，都不拿来当资料。
export const FORUM_KNOWLEDGE_EXCLUDED_BOARD_SLUGS = new Set(["treehole", "lost-found"]);
const INDEX_BODY_CHARS = 320;
const INDEX_LOAD_BATCH = 2_000;
const INCREMENTAL_REFRESH_MS = 2 * 60_000;
const FULL_REBUILD_MS = 6 * 60 * 60_000;
// 应用节点之间的时钟差和事务提交延迟。
const UPDATED_AT_MARGIN_MS = 2 * 60_000;

type IndexState = {
  docs: Map<number, IndexedTopic>;
  maxId: number;
  syncedAt: number;
  builtAt: number;
};

let indexState: IndexState | null = null;
let indexBuild: Promise<IndexState> | null = null;
let indexRefresh: Promise<void> | null = null;
let indexBuildFailedAt = 0;
// 数据库暂时不可用时，对话请求不要每次都重新整表扫描。
const INDEX_BUILD_RETRY_MS = 60_000;

function kindForBoardType(boardType: string): ForumKnowledgeKind {
  if (boardType === "announce") return "announce";
  if (boardType === "coursereview") return "coursereview";
  return "forum";
}

function isIndexableRow(row: Pick<ForumKnowledgeIndexRow, "hidden" | "boardType" | "boardSlug">) {
  return !row.hidden
    && (INDEXED_BOARD_TYPES as readonly string[]).includes(row.boardType)
    && !FORUM_KNOWLEDGE_EXCLUDED_BOARD_SLUGS.has(row.boardSlug)
    && !isRetiredBoardSlug(row.boardSlug);
}

function toIndexedTopic(row: ForumKnowledgeIndexRow): IndexedTopic {
  const titleKey = normalizeKnowledgeText(row.title);
  const body = normalizeKnowledgeText(knowledgePlainText(row.content || "")).slice(0, INDEX_BODY_CHARS);
  return {
    id: row.id,
    boardType: row.boardType,
    publishedAt: new Date(row.createdAt).getTime(),
    replyCount: Number(row.replyCount) || 0,
    titleKey,
    // 公告的发布部门（板块名）也参与匹配：“教务处 补考”这类问法。
    bodyKey: `${titleKey}\n${row.boardType === "announce" ? normalizeKnowledgeText(row.boardName) : ""}\n${body}`,
  };
}

const INDEX_SELECT = Prisma.sql`
  SELECT t.id, t.title, LEFT(t.content, 1200) AS content, t."createdAt", t."replyCount", t.hidden,
         b.type AS "boardType", b.slug AS "boardSlug", b.name AS "boardName"
  FROM "Topic" t
  JOIN "Board" b ON b.id = t."boardId"`;

async function buildIndex(): Promise<IndexState> {
  const startedAt = Date.now();
  const docs = new Map<number, IndexedTopic>();
  let cursor = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<ForumKnowledgeIndexRow[]>(Prisma.sql`${INDEX_SELECT}
      WHERE t.id > ${cursor} AND t.hidden = false
        AND b.type IN (${Prisma.join([...INDEXED_BOARD_TYPES])})
      ORDER BY t.id
      LIMIT ${INDEX_LOAD_BATCH}`);
    for (const row of rows) {
      if (isIndexableRow(row)) docs.set(row.id, toIndexedTopic(row));
    }
    if (rows.length < INDEX_LOAD_BATCH) break;
    cursor = rows[rows.length - 1].id;
  }
  const maxIdRows = await prisma.$queryRaw<Array<{ max: number | null }>>`SELECT MAX(id) AS max FROM "Topic"`;
  return { docs, maxId: Number(maxIdRows[0]?.max || 0), syncedAt: startedAt, builtAt: startedAt };
}

async function refreshIndex(state: IndexState) {
  const startedAt = Date.now();
  // 新帖按 id 取：同步来的公告把 updatedAt 设成了学校的发布时间，不能只看 updatedAt。
  const rows = await prisma.$queryRaw<ForumKnowledgeIndexRow[]>(Prisma.sql`${INDEX_SELECT}
    WHERE t.id > ${state.maxId} OR t."updatedAt" > ${new Date(state.syncedAt - UPDATED_AT_MARGIN_MS)}
    ORDER BY t.id
    LIMIT 5000`);
  for (const row of rows) {
    if (isIndexableRow(row)) state.docs.set(row.id, toIndexedTopic(row));
    else state.docs.delete(row.id);
    if (row.id > state.maxId) state.maxId = row.id;
  }
  state.syncedAt = startedAt;
}

async function loadIndex() {
  if (indexState && Date.now() - indexState.builtAt < FULL_REBUILD_MS) {
    if (Date.now() - indexState.syncedAt >= INCREMENTAL_REFRESH_MS && !indexRefresh) {
      const state = indexState;
      indexRefresh = refreshIndex(state)
        .catch((error) => console.warn("[forum-knowledge] incremental refresh failed", error instanceof Error ? error.message : error))
        .finally(() => { indexRefresh = null; });
    }
    if (indexRefresh) await indexRefresh;
    return indexState;
  }
  if (!indexBuild) {
    indexBuild = buildIndex()
      .then((state) => {
        indexState = state;
        indexBuildFailedAt = 0;
        return state;
      })
      .catch((error) => {
        indexBuildFailedAt = Date.now();
        throw error;
      })
      .finally(() => { indexBuild = null; });
  }
  // 旧索引在重建期间照常使用。
  if (indexState) return indexState;
  return indexBuild;
}

/** 对话请求不等首次建索引：索引没好就先不带论坛资料，同时在后台建好。 */
function peekIndex() {
  if (!indexState) {
    if (!indexBuild && Date.now() - indexBuildFailedAt < INDEX_BUILD_RETRY_MS) return null;
    void loadIndex().catch((error) => console.warn("[forum-knowledge] index build failed", error instanceof Error ? error.message : error));
    return null;
  }
  return loadIndex();
}

export function setForumKnowledgeIndexForTests(rows?: ForumKnowledgeIndexRow[]) {
  indexBuild = null;
  indexRefresh = null;
  if (!rows) {
    indexState = null;
    return;
  }
  const now = Date.now();
  indexState = {
    docs: new Map(rows.filter(isIndexableRow).map((row) => [row.id, toIndexedTopic(row)])),
    maxId: Math.max(0, ...rows.map((row) => row.id)),
    syncedAt: now,
    builtAt: now,
  };
}

function parseAcceptedReplyId(metadata: string | null | undefined) {
  try {
    const value = JSON.parse(metadata || "{}");
    const id = Number(value?.acceptedReplyId || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** 公告时效性强，一年前的通知分数减半；同学经验衰减慢一些，有回复的帖子更可能有答案。 */
function topicPrior(doc: IndexedTopic, now: number) {
  const ageDays = Math.max(0, (now - doc.publishedAt) / KNOWLEDGE_DAY_MS);
  const freshness = doc.boardType === "announce" ? 1 / (1 + ageDays / 365) : 1 / (1 + ageDays / 730);
  const engagement = doc.boardType === "announce" ? 1 : 1 + Math.min(doc.replyCount, 10) / 20;
  return (0.55 + 0.45 * freshness) * engagement;
}

export async function searchForumKnowledge(query: string, options: {
  audience: ForumKnowledgeAudience;
  /** 只要公告或只要帖子；默认两者都要，各自限额。 */
  kinds?: Array<"forum" | "announce">;
  limit?: number;
  excludeTopicIds?: number[];
  minCoverage?: number;
  /** 后台任务可以等首次建索引；对话请求不等。 */
  waitForIndex?: boolean;
  topicExcerptChars?: number;
  replyExcerptChars?: number;
  repliesPerTopic?: number;
}): Promise<ForumKnowledgeHit[]> {
  const terms = extractKnowledgeQueryTerms(query);
  if (!terms.length) return [];
  const pending = options.waitForIndex ? loadIndex() : peekIndex();
  if (!pending) return [];
  const state = await pending;
  const kinds = new Set(options.kinds ?? ["forum", "announce"]);
  const allowedTypes = new Set<string>();
  if (kinds.has("announce")) allowedTypes.add("announce");
  if (kinds.has("forum") && options.audience.forum) {
    allowedTypes.add("normal");
    allowedTypes.add("question");
  }
  if (kinds.has("forum") && options.audience.coursereview) allowedTypes.add("coursereview");
  if (!allowedTypes.size) return [];
  const limit = Math.max(1, Math.min(8, options.limit ?? 4));
  const excluded = new Set(options.excludeTopicIds || []);
  const now = Date.now();
  const candidates = rankKnowledgeEntries(state.docs.values(), terms, {
    allow: (doc) => allowedTypes.has(doc.boardType) && !excluded.has(doc.id),
    prior: (doc) => topicPrior(doc, now),
    minCoverage: options.minCoverage ?? 0.34,
    // 多取几条，数据库核对时可能有已隐藏的。
    limit: limit + 3,
  });
  if (!candidates.length) return [];

  const ids = candidates.map((item) => item.entry.id);
  const topics = await prisma.topic.findMany({
    where: { id: { in: ids }, hidden: false, board: { type: { in: [...allowedTypes] } } },
    select: {
      id: true,
      title: true,
      content: true,
      metadata: true,
      createdAt: true,
      board: { select: { name: true, type: true, slug: true } },
    },
  });
  const byId = new Map(topics
    .filter((topic) => !FORUM_KNOWLEDGE_EXCLUDED_BOARD_SLUGS.has(topic.board.slug) && !isRetiredBoardSlug(topic.board.slug))
    .map((topic) => [topic.id, topic]));
  const selected = candidates.filter((item) => byId.has(item.entry.id)).slice(0, limit);
  if (!selected.length) return [];

  const repliesPerTopic = Math.max(0, Math.min(4, options.repliesPerTopic ?? 3));
  const replyExcerptChars = options.replyExcerptChars ?? 220;
  const forumIds = selected.map((item) => item.entry.id).filter((id) => byId.get(id)!.board.type !== "announce");
  const acceptedIds = forumIds
    .map((id) => parseAcceptedReplyId(byId.get(id)!.metadata))
    .filter((id): id is number => id !== null);
  const replies = repliesPerTopic && forumIds.length
    ? await prisma.reply.findMany({
        where: {
          topicId: { in: forumIds },
          hidden: false,
          OR: [{ likeCount: { gt: 0 } }, { floor: { lte: 6 } }, ...(acceptedIds.length ? [{ id: { in: acceptedIds } }] : [])],
        },
        orderBy: [{ likeCount: "desc" }, { floor: "asc" }],
        take: forumIds.length * 8,
        select: { id: true, topicId: true, content: true, likeCount: true },
      })
    : [];
  const repliesByTopic = new Map<number, ForumKnowledgeReply[]>();
  for (const id of forumIds) {
    const acceptedId = parseAcceptedReplyId(byId.get(id)!.metadata);
    const own = replies
      .filter((reply) => reply.topicId === id)
      .map((reply) => ({ reply, accepted: reply.id === acceptedId, text: knowledgePlainText(reply.content) }))
      .filter(({ text }) => text.length >= 2)
      .sort((a, b) => Number(b.accepted) - Number(a.accepted))
      .slice(0, repliesPerTopic)
      .map(({ reply, accepted, text }) => ({
        excerpt: focusedExcerpt(text, terms, replyExcerptChars),
        likeCount: reply.likeCount,
        accepted,
      }));
    repliesByTopic.set(id, own);
  }

  const topicExcerptChars = options.topicExcerptChars ?? 420;
  return selected.map(({ entry, coverage }) => {
    const topic = byId.get(entry.id)!;
    const kind = kindForBoardType(topic.board.type);
    return {
      topicId: entry.id,
      kind,
      boardName: topic.board.name,
      title: topic.title,
      publishedAt: isoDate(topic.createdAt),
      excerpt: focusedExcerpt(
        knowledgePlainText(topic.content),
        terms,
        kind === "announce" ? Math.round(topicExcerptChars * 1.6) : topicExcerptChars,
      ),
      replies: repliesByTopic.get(entry.id) || [],
      url: `/forum/topic/${entry.id}`,
      coverage,
    };
  });
}
