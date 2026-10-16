/**
 * 拾间AI 的资料检索入口：学校事务资料、同步的学校公告、论坛帖子三类合在一起，
 * 统一编号（R1、R2…）交给模型，模型回答时报告用到了哪几条，服务端据此附上来源。
 *
 * 站内功能说明（campusAssistant.ts 里的 knowledge/catalog）仍按入口匹配，不走这里：
 * 它决定能推荐哪些入口按钮，和这里的“查资料”是两回事。
 */
import { searchForumKnowledge, type ForumKnowledgeAudience, type ForumKnowledgeHit } from "./forumKnowledge";
import { searchSchoolDocs, type SchoolDocHit, type SchoolDocStatus } from "./schoolDocsKnowledge";

export type CampusKnowledgeKind = "school-doc" | "announce" | "forum" | "coursereview";

export type CampusKnowledgeItem = {
  ref: string;
  kind: CampusKnowledgeKind;
  title: string;
  /** 资料所在：文件里的章节，或公告的发布部门、帖子的板块。 */
  where: string;
  date: string | null;
  status?: SchoolDocStatus;
  excerpt: string;
  replies?: Array<{ text: string; likes: number; accepted?: boolean }>;
  topicId?: number;
  /** 回答里引用这条时附上的链接；学生手册这类没有公开网址的为 null。 */
  source: { title: string; url: string } | null;
};

export type CampusKnowledgeLimits = {
  schoolDocs?: number;
  announcements?: number;
  forum?: number;
};

const DEFAULT_LIMITS: Required<CampusKnowledgeLimits> = { schoolDocs: 3, announcements: 2, forum: 3 };

function sourceTitle(prefix: string, title: string) {
  return `${prefix} · ${title}`.slice(0, 120);
}

function fromSchoolDoc(hit: SchoolDocHit): Omit<CampusKnowledgeItem, "ref"> {
  return {
    kind: "school-doc",
    title: hit.title,
    where: hit.heading,
    date: hit.date,
    status: hit.status,
    excerpt: hit.excerpt,
    source: hit.sourceUrl && /^https?:\/\//iu.test(hit.sourceUrl)
      ? { title: sourceTitle("学校文件", hit.title), url: hit.sourceUrl }
      : null,
  };
}

function fromForumHit(hit: ForumKnowledgeHit): Omit<CampusKnowledgeItem, "ref"> {
  const label = hit.kind === "announce" ? hit.boardName : hit.kind === "coursereview" ? "课程点评" : "论坛";
  return {
    kind: hit.kind,
    title: hit.title,
    where: hit.boardName,
    date: hit.publishedAt,
    excerpt: hit.excerpt,
    ...(hit.replies.length
      ? { replies: hit.replies.map((reply) => ({ text: reply.excerpt, likes: reply.likeCount, ...(reply.accepted ? { accepted: true } : {}) })) }
      : {}),
    topicId: hit.topicId,
    source: { title: sourceTitle(label, hit.title), url: hit.url },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        console.warn("[campus-knowledge] forum search failed", error instanceof Error ? error.message : error);
        resolve(fallback);
      },
    );
  });
}

function itemKey(item: Omit<CampusKnowledgeItem, "ref">) {
  return item.topicId ? `topic:${item.topicId}` : `${item.kind}:${item.title}:${item.where}:${item.excerpt.slice(0, 40)}`;
}

/**
 * 多个查询（例如帖子标题，和标题加正文）各检索一遍再合并：标题短而准，正文补细节。
 * 前面查询的结果排在前面，每类仍按限额截断。
 */
export async function retrieveCampusKnowledgeForQueries(queries: string[], options: Parameters<typeof retrieveCampusKnowledge>[1]) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const unique = [...new Set(queries.map((query) => String(query || "").trim()).filter(Boolean))];
  const results = await Promise.all(unique.map((query) => retrieveCampusKnowledge(query, options)));
  const seen = new Set<string>();
  const byKind = new Map<CampusKnowledgeKind, Array<Omit<CampusKnowledgeItem, "ref">>>();
  // 各查询轮流取：否则第一个查询就占满名额，追问时上一轮引用的资料会被挤掉。
  const stripped = results.map((items) => items.map(({ ref: _ref, ...item }) => item));
  const rounds = Math.max(0, ...stripped.map((items) => items.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const items of stripped) {
      const item = items[round];
      if (!item) continue;
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      const group = byKind.get(item.kind) || [];
      group.push(item);
      byKind.set(item.kind, group);
    }
  }
  const limitFor = (kind: CampusKnowledgeKind) => kind === "school-doc" ? limits.schoolDocs : kind === "announce" ? limits.announcements : limits.forum;
  const forumAndCourse = [...(byKind.get("forum") || []), ...(byKind.get("coursereview") || [])].slice(0, limits.forum);
  return [
    ...(byKind.get("school-doc") || []).slice(0, limitFor("school-doc")),
    ...(byKind.get("announce") || []).slice(0, limitFor("announce")),
    ...forumAndCourse,
  ].map((item, index) => ({ ref: `R${index + 1}`, ...item }));
}

export async function retrieveCampusKnowledge(query: string, options: {
  audience: ForumKnowledgeAudience;
  limits?: CampusKnowledgeLimits;
  excludeTopicIds?: number[];
  /** 后台任务等论坛索引建好；对话请求不等，并给数据库查询设上限。 */
  waitForIndex?: boolean;
  forumTimeoutMs?: number;
  /** 每个帖子带几条回复。 */
  forumReplies?: number;
}): Promise<CampusKnowledgeItem[]> {
  const text = String(query || "").trim();
  if (!text) return [];
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const forumSearch = (kinds: Array<"forum" | "announce">, limit: number) => limit > 0
    ? withTimeout(searchForumKnowledge(text, {
        audience: options.audience,
        kinds,
        limit,
        excludeTopicIds: options.excludeTopicIds,
        waitForIndex: options.waitForIndex,
        repliesPerTopic: options.forumReplies,
      }), options.forumTimeoutMs ?? 0, [] as ForumKnowledgeHit[])
    : Promise.resolve([] as ForumKnowledgeHit[]);
  let schoolDocs: SchoolDocHit[] = [];
  try {
    schoolDocs = limits.schoolDocs > 0 ? searchSchoolDocs(text, { limit: limits.schoolDocs }) : [];
  } catch (error) {
    console.warn("[campus-knowledge] school document search failed", error instanceof Error ? error.message : error);
  }
  const [announcements, posts] = await Promise.all([
    forumSearch(["announce"], limits.announcements),
    forumSearch(["forum"], limits.forum),
  ]);
  return [
    ...schoolDocs.map(fromSchoolDoc),
    ...announcements.map(fromForumHit),
    ...posts.map(fromForumHit),
  ].map((item, index) => ({ ref: `R${index + 1}`, ...item }));
}

/** 提示词里的资料：不带作者，帖子只给正文摘录和几条回复。 */
export function presentCampusKnowledgeForPrompt(items: CampusKnowledgeItem[]) {
  return items.map((item) => ({
    ref: item.ref,
    kind: item.kind,
    title: item.title,
    ...(item.where ? { where: item.where } : {}),
    ...(item.date ? { date: item.date } : {}),
    ...(item.status ? { status: item.status } : {}),
    text: item.excerpt,
    ...(item.replies?.length ? { replies: item.replies } : {}),
  }));
}

/** 资料里原样出现过的文字：回答里的电话、邮箱、链接只要出自这里就算有据可查。 */
export function campusKnowledgeGroundingText(items: CampusKnowledgeItem[] | undefined) {
  if (!items?.length) return "";
  return items
    .map((item) => [item.excerpt, ...(item.replies || []).map((reply) => reply.text), item.source?.url || ""].join("\n"))
    .join("\n");
}

export function readCampusKnowledgeRefs(payload: unknown, items: CampusKnowledgeItem[] | undefined) {
  if (!items?.length) return [] as CampusKnowledgeItem[];
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const raw = Array.isArray(value.knowledgeRefs) ? value.knowledgeRefs : [];
  const byRef = new Map(items.map((item) => [item.ref, item]));
  const seen = new Set<string>();
  const cited: CampusKnowledgeItem[] = [];
  for (const entry of raw) {
    const ref = String(entry || "").trim().toUpperCase();
    const item = byRef.get(ref);
    if (!item || seen.has(ref)) continue;
    seen.add(ref);
    cited.push(item);
  }
  return cited;
}

const KIND_LABELS: Record<CampusKnowledgeKind, string> = {
  "school-doc": "学校文件",
  announce: "学校公告",
  forum: "论坛帖子",
  coursereview: "课程点评",
};

export function campusKnowledgeKindLabel(kind: CampusKnowledgeKind) {
  return KIND_LABELS[kind];
}
