import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_FORUM_EXCLUDED_BOARD_SLUGS,
  agentForumBoardWhere,
  agentReadableBoardTypes,
  communityTools,
  isClientAgnosticNotification,
  resolveForumMode,
  selectCatalogCourses,
  summarizeNotificationsForAgent,
  type AgentCatalogCourse,
} from "../src/services/personalAgent/communityTools";
import {
  campusLifeTools,
  compactForAgent,
  normalizeGradeCheckStudentId,
  rosterIncludesStudent,
} from "../src/services/personalAgent/campusLifeTools";
import { defaultPersonalAgentPermissions } from "../src/services/personalAgent/store";
import type { PersonalAgentToolContext } from "../src/services/personalAgent/types";

function ctxOf(overrides: Partial<PersonalAgentToolContext> = {}): PersonalAgentToolContext {
  return {
    userId: 1,
    username: "2020240444",
    nickname: "同学",
    studentSso: true,
    role: "user",
    schoolId: "cpu",
    forumAccessEnabled: true,
    permissions: { ...defaultPersonalAgentPermissions(), community: true, campusLife: true, messages: true },
    jwxtToken: null,
    retriedAfterRecover: false,
    blockedScopes: new Set(),
    needsManualJwxtReauth: false,
    now: new Date("2026-11-26T04:00:00Z"),
    ...overrides,
  };
}

function toolOf(list: typeof communityTools, name: string) {
  const tool = list.find((item) => item.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

function course(id: number, name: string, stats: Partial<AgentCatalogCourse["stats"]>, teachers: string[] = []): AgentCatalogCourse {
  return {
    id,
    code: `C${id}`,
    name,
    credits: 2,
    category: "公选",
    college: null,
    teachers,
    stats: { count: 0, recommend: 0, reward: 0, difficulty: 0, grading: 0, ...stats },
  };
}

test("forum mode defaults follow the arguments the model gave", () => {
  assert.equal(resolveForumMode({}), "announcements_and_hot");
  assert.equal(resolveForumMode({ query: "四六级" }), "search_topics");
  assert.equal(resolveForumMode({ topicId: 12, query: "x" }), "topic_detail");
  assert.equal(resolveForumMode({ mode: "lost_found", query: "校园卡" }), "lost_found");
});

test("forum board filter keeps treehole, lost-found and retired boards out", () => {
  assert.ok(AGENT_FORUM_EXCLUDED_BOARD_SLUGS.has("treehole"));
  assert.ok(AGENT_FORUM_EXCLUDED_BOARD_SLUGS.has("lost-found"));
  const where = agentForumBoardWhere("cpu", ["normal", "question"], "hot");
  assert.equal(where.schoolId, "cpu");
  assert.deepEqual(where.type, { in: ["normal", "question"] });
  assert.equal(where.slug, "hot");
  const excluded = where.AND.flatMap((clause) => clause.slug.notIn);
  for (const slug of ["treehole", "lost-found", "campus-wall"]) assert.ok(excluded.includes(slug), slug);
});

test("without forum access only announcements stay readable", () => {
  const types = agentReadableBoardTypes("cpu", false);
  assert.ok(types.every((type) => type === "announce"));
  assert.ok(agentReadableBoardTypes("cpu", true).length >= types.length);
});

test("notifications aimed at a specific client are left out", () => {
  assert.equal(isClientAgnosticNotification(null), true);
  assert.equal(isClientAgnosticNotification("all"), true);
  assert.equal(isClientAgnosticNotification("bogus"), true);
  assert.equal(isClientAgnosticNotification("android"), false);
  assert.equal(isClientAgnosticNotification("ios,web"), false);
});

test("notification summary lists unread first and counts unread over the scan", () => {
  const at = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T00:00:00Z`);
  const rows = [
    { id: 1, userId: 1, category: "reply", title: "新回复", content: "a", link: null, readAt: at(20), createdAt: at(25) },
    { id: 2, userId: 1, category: "like", title: "点赞", content: "b", link: "/x", readAt: null, createdAt: at(3) },
    { id: 3, userId: null, category: "system", title: "公告", content: "c", link: null, readAt: null, createdAt: at(24) },
    { id: 4, userId: null, category: "system", title: "旧公告", content: "d", link: null, readAt: null, createdAt: at(2) },
  ];
  const summary = summarizeNotificationsForAgent(rows, new Set([4]), 2);
  assert.equal(summary.unreadCount, 2);
  assert.deepEqual(summary.notifications.map((n) => n.id), [3, 2]);
  assert.ok(summary.notifications.every((n) => n.unread));
  assert.equal(summary.notifications[0].createdAt, "2026-11-24 08:00");
});

test("course selection shrinks thinly reviewed courses toward the mean", () => {
  const catalog = [
    course(1, "一篇五星", { count: 1, recommend: 5, grading: 5 }),
    course(2, "多篇好评", { count: 20, recommend: 4.6, grading: 4 }),
    course(3, "没有课评", {}, ["王明"]),
  ];
  assert.deepEqual(selectCatalogCourses(catalog, {}).map((c) => c.id), [2, 1]);
  assert.deepEqual(selectCatalogCourses(catalog, { query: "王明" }).map((c) => c.id), [3]);
  assert.deepEqual(selectCatalogCourses(catalog, { category: "专业" }), []);
});

test("tools stop at a disabled permission scope", async () => {
  const tool = toolOf(communityTools, "community_course_reviews");
  const ctx = ctxOf({ permissions: { ...defaultPersonalAgentPermissions(), community: false } });
  const result = await tool.execute({ limit: 8 }, ctx) as Record<string, unknown>;
  assert.equal(result.errorCode, "PERMISSION_DISABLED");
  assert.ok(ctx.blockedScopes.has("community"));
});

test("forum modes refuse treehole and lost-found boards before reading anything", async () => {
  const tool = toolOf(communityTools, "community_forum_and_lostfound");
  const treehole = await tool.execute({ mode: "search_topics", board: "treehole", lostFoundKind: "all" }, ctxOf()) as Record<string, unknown>;
  assert.equal(treehole.ok, false);
  assert.equal(treehole.errorCode, "BOARD_NOT_READABLE");
  const lostFound = await tool.execute({ board: "lost-found", lostFoundKind: "all" }, ctxOf()) as Record<string, unknown>;
  assert.equal(lostFound.errorCode, "BOARD_NOT_READABLE");
  assert.match(String(lostFound.message), /lost_found/u);
  const retired = await tool.execute({ query: "x", board: "campus-wall", lostFoundKind: "all" }, ctxOf()) as Record<string, unknown>;
  assert.equal(retired.errorCode, "BOARD_NOT_READABLE");
});

test("dorm electricity is only queried for schools that run it", async () => {
  const tool = toolOf(campusLifeTools, "life_dorm_electric");
  const result = await tool.execute({}, ctxOf({ schoolId: "njmu" })) as Record<string, unknown>;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "FEATURE_CLOSED");
});

test("library lookup for a school without a library never asks for 教务 re-authorization", async () => {
  const tool = toolOf(campusLifeTools, "life_library_status");
  const ctx = ctxOf({ schoolId: "cpu", jwxtToken: null, studentSso: true, retriedAfterRecover: false });
  let result: Record<string, unknown> | null = null;
  await assert.doesNotReject(async () => {
    result = await tool.execute({ includeHistory: false }, ctx) as Record<string, unknown>;
  });
  assert.equal(result!.errorCode, "FEATURE_CLOSED");
  assert.equal(ctx.needsManualJwxtReauth, false);
});

test("file-collection rosters match a student ID only as a whole entry", () => {
  const roster = "张三 2020240444\n李四,20202404441\n2021000001";
  assert.equal(rosterIncludesStudent(roster, "2020240444"), true);
  assert.equal(rosterIncludesStudent(roster, "2021000001"), true);
  assert.equal(rosterIncludesStudent(roster, "202024044"), false);
  assert.equal(rosterIncludesStudent("李四,20202404441", "2020240444"), false);
  assert.equal(rosterIncludesStudent(roster, ""), false);
  assert.equal(normalizeGradeCheckStudentId(" 2020 240444 "), "2020240444");
});

test("external payloads are compacted before reaching the model", () => {
  const big = {
    loans: Array.from({ length: 40 }, (_, i) => ({ title: `书${i}`.padEnd(400, "长"), due: "2026-12-01" })),
    deep: { a: { b: { c: { d: { e: { f: 1 } } } } } },
  };
  const compact = compactForAgent(big, { maxArray: 5, maxString: 20, maxDepth: 4 }) as any;
  assert.equal(compact.loans.length, 6);
  assert.match(compact.loans[5], /另有 35 项/u);
  assert.ok(compact.loans[0].title.length <= 21);
  assert.equal(compact.deep.a.b.c, "{…}");
  assert.ok(JSON.stringify(compactForAgent(big)).length < 9_000);
});
