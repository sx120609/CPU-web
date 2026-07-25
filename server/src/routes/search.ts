import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { withCache } from "../services/cache";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { getFeatures } from "../services/siteSettings";
import { resolveForumAccess } from "../services/forumAccess";
import { sanitizeLostFoundTopicFields } from "../services/lostFoundPrivacy";
import {
  askCampusAssistant,
  campusActionToSearchService,
  searchCampusAssistantActions,
  streamCampusAssistant,
} from "../services/campusAssistant";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { validate } from "../middleware/validate";
import {
  deleteCampusAssistantConversation,
  listCampusAssistantConversations,
  saveCampusAssistantConversation,
} from "../services/campusAssistantHistory";

export const searchRouter = Router();

const assistantSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2000),
  })).max(12).default([]),
});

const assistantHistoryIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/);
const assistantHistoryActionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(240),
  url: z.string().trim().min(1).max(500),
  icon: z.string().trim().max(16),
  owner: z.string().trim().max(80),
  requireLogin: z.boolean(),
}).strict();
const assistantHistoryMessageSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
  actions: z.array(assistantHistoryActionSchema).max(3).optional(),
  suggestions: z.array(z.string().trim().min(1).max(60)).max(3).optional(),
}).strict();
const assistantHistorySaveSchema = z.object({
  title: z.string().trim().min(1).max(80),
  updatedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  messages: z.array(assistantHistoryMessageSchema).min(1).max(60),
}).strict();

/** 全局搜索：帖子标题/正文 + 课程 + 服务卡片 */
searchRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    if (!q) return ok(res, { topics: [], courses: [], services: [] });
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const features = getFeatures();
    const assistantContext = {
      features,
      forumAccessEnabled,
      loggedIn: Boolean(userId),
    };
    const searchableBoardTypes = ["announce"];
    if (forumAccessEnabled && features.forum) searchableBoardTypes.push("normal", "question");
    if (forumAccessEnabled && features.market) searchableBoardTypes.push("market");
    if (forumAccessEnabled && features.coursereview) searchableBoardTypes.push("coursereview");

    const cacheParts = [
      q,
      forumAccessEnabled ? "forum-enabled" : "announce-only",
      features.forum ? "forum-on" : "forum-off",
      features.market ? "market-on" : "market-off",
      features.coursereview ? "course-on" : "course-off",
      features.electric ? "electric-on" : "electric-off",
    ];
    const { topics, courses, services } = await withCache("search", cacheParts, 60_000, async () => {
      const [topics, courses, services] = await Promise.all([
        prisma.topic.findMany({
          where: {
            hidden: false,
            board: { type: { in: searchableBoardTypes } },
            OR: [{ title: { contains: q } }, { content: { contains: q } }],
          },
          orderBy: { lastReplyAt: "desc" },
          take: 10,
          include: {
            board: { select: { slug: true, name: true } },
            author: { select: { nickname: true } },
            tags: { include: { tag: true } },
          },
        }),
        forumAccessEnabled && features.coursereview ? prisma.course.findMany({
          where: {
            OR: [
              { name: { contains: q } },
              { code: { contains: q } },
              { teacher: { contains: q } },
              { courseTeachers: { some: { teacher: { name: { contains: q } } } } },
            ],
          },
          take: 5,
          include: {
            courseTeachers: { include: { teacher: true } },
          },
        }) : Promise.resolve([]),
        prisma.serviceCard.findMany({
          where: visibleServiceWhere({
            OR: [
              { name: { contains: q } },
              { category: { contains: q } },
              { owner: { contains: q } },
              { description: { contains: q } },
            ],
          }),
          take: 8,
        }),
      ]);
      return { topics, courses, services };
    });

    ok(res, {
      topics: topics.map((topic: any) => {
        const presented = sanitizeLostFoundTopicFields(topic, req.user);
        return {
          ...presented,
          metadata: safeJson(presented.metadata),
          tags: Array.isArray(presented.tags)
            ? presented.tags.map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item).filter((item: any) => item?.name)
            : [],
        };
      }),
      courses: courses.map((c: any) => ({
        ...c,
        teachers: (c.courseTeachers ?? []).map((ct: any) => ({
          id: ct.teacher.id,
          name: ct.teacher.name,
          courseTeacherId: ct.id,
        })),
        courseTeachers: undefined,
      })),
      services: mergeSearchServices([
        ...searchCampusAssistantActions(q, assistantContext).map(campusActionToSearchService),
        ...services.map(normalizeServiceCard),
      ]).slice(0, 10),
    });
  } catch (e) { next(e); }
});

searchRouter.get("/assistant/conversations", async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw Errors.unauthorized("登录后才能同步拾间AI历史对话");
    ok(res, await listCampusAssistantConversations(userId));
  } catch (error) {
    next(error);
  }
});

searchRouter.patch(
  "/assistant/conversations/:id",
  securityRateLimit("campus-assistant-history", 120, 60_000),
  validate(assistantHistorySaveSchema),
  async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw Errors.unauthorized("登录后才能同步拾间AI历史对话");
      const id = assistantHistoryIdSchema.parse(req.params.id);
      ok(res, await saveCampusAssistantConversation(userId, {
        id,
        title: req.body.title,
        updatedAt: req.body.updatedAt,
        messages: req.body.messages,
      }));
    } catch (error) {
      next(error);
    }
  },
);

searchRouter.delete("/assistant/conversations/:id", async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw Errors.unauthorized("登录后才能同步拾间AI历史对话");
    const id = assistantHistoryIdSchema.parse(req.params.id);
    await deleteCampusAssistantConversation(userId, id);
    ok(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

searchRouter.post(
  "/assistant",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(assistantSchema),
  async (req, res, next) => {
    try {
      const userId = req.user?.userId ?? null;
      const role = req.user?.role ?? null;
      const forumAccessEnabled = await resolveForumAccess(userId, role);
      ok(res, await askCampusAssistant({
        message: req.body.message,
        history: req.body.history,
        context: {
          features: getFeatures(),
          forumAccessEnabled,
          loggedIn: Boolean(userId),
        },
      }));
    } catch (error) {
      next(error);
    }
  },
);

searchRouter.post(
  "/assistant/stream",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(assistantSchema),
  async (req, res, next) => {
    let streamStarted = false;
    let streamCompleted = false;
    const controller = new AbortController();
    res.on("close", () => {
      if (!streamCompleted) controller.abort();
    });

    try {
      const userId = req.user?.userId ?? null;
      const role = req.user?.role ?? null;
      const forumAccessEnabled = await resolveForumAccess(userId, role);
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      streamStarted = true;

      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": ping\n\n");
          (res as any).flush?.();
        }
      }, 15_000);
      try {
        const response = await streamCampusAssistant({
          message: req.body.message,
          history: req.body.history,
          context: {
            features: getFeatures(),
            forumAccessEnabled,
            loggedIn: Boolean(userId),
          },
          signal: controller.signal,
        }, (delta) => {
          if (!delta || res.writableEnded) return;
          writeAssistantEvent(res, "delta", { delta });
        });
        if (!res.writableEnded) writeAssistantEvent(res, "done", response);
        streamCompleted = true;
        res.end();
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!streamStarted) return next(error);
      writeAssistantEvent(res, "error", { message: "拾间AI暂时不可用，请稍后再试" });
      streamCompleted = true;
      res.end();
    }
  },
);

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function writeAssistantEvent(res: any, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  res.flush?.();
}

function mergeSearchServices(services: any[]) {
  const seen = new Set<string>();
  return services.filter((service) => {
    const key = String(service?.url || service?.code || service?.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
