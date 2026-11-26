import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { withCache } from "../services/cache";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { getFeatures } from "../services/siteSettings";
import { resolveForumAccess } from "../services/forumAccess";
import { visibleBoardSlugFilter } from "../services/retiredBoards";
import { decodeTopicsForViewerForList, forumAuthorReputationSelect } from "../services/forumPresentation";
import {
  askCampusAssistant,
  campusActionToSearchService,
  searchCampusAssistantActions,
  streamCampusAssistant,
} from "../services/campusAssistant";
import { isDataRequestOnly, personalContextSchema, streamPersonalAssistant } from "../services/personalAssistant";
import { streamCampusPersonalAgent } from "../services/personalAgent/engine";
import {
  MEMORY_CATEGORIES,
  hasPersonalAgentConsent,
  PERSONAL_AGENT_CONSENT_VERSION,
  personalAgentActive,
  personalAgentConsentSchema,
  personalAgentPermissionsPatchSchema,
  personalAgentStore,
} from "../services/personalAgent/store";
import { JwxtReauthRequiredError } from "../services/personalAgent/types";
import { scheduleWidgetSessions } from "../services/scheduleWidgetSession";
import { extractAgendaFromContent } from "../services/agendaExtract";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  deleteCampusAssistantConversation,
  listCampusAssistantConversations,
  saveCampusAssistantConversation,
} from "../services/campusAssistantHistory";
import {
  consumeCampusAssistantQuota,
  getCampusAssistantQuotaStatus,
  refundCampusAssistantQuota,
  type CampusAssistantQuotaReservation,
} from "../services/campusAssistantQuota";
import { detectLoginClient } from "../utils/loginClient";
import { isCampusAssistantDestination, shouldHideHarmonyAssistant } from "../utils/nativeAssistantAccess";
import { readCachedDepartmentContactSearch, searchDepartmentContactsWithAi } from "../services/departmentContactSearch";
import { isDepartmentContactCampus } from "../services/departmentContacts";
import { applySchoolToSiteFeatures, requestSchoolId, requireSchoolModule } from "../schools/modules";

export const searchRouter = Router();

const assistantSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).max(60).default([]),
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
const assistantHistoryImageSchema = z.object({
  url: z.string().trim().min(1).max(500).regex(
    /^\/uploads\/assistant-generated\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg)$/u,
  ),
  alt: z.string().trim().min(1).max(200),
}).strict();
const assistantHistorySourceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  // 网页来源是 http(s) 链接；论坛帖子和同步的公告是站内路径。
  url: z.string().trim().max(500).refine(
    (value) => /^\/forum\/topic\/\d{1,10}$/u.test(value) || (/^https?:\/\//iu.test(value) && z.string().url().safeParse(value).success),
    "仅支持 http(s) 来源或站内帖子",
  ),
}).strict();
const assistantHistoryMessageSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
  actions: z.array(assistantHistoryActionSchema).max(3).optional(),
  suggestions: z.array(z.string().trim().min(1).max(60)).max(3).optional(),
  images: z.array(assistantHistoryImageSchema).max(1).optional(),
  sources: z.array(assistantHistorySourceSchema).max(5).optional(),
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
    const servicesOnly = req.query.scope === "services";
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const assistantHidden = shouldHideHarmonyAssistant(
      detectLoginClient(req).client,
      Boolean(userId),
      req.user?.studentId,
    );
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const schoolId = requestSchoolId(req);
    // 站点开关和这所学校的功能开关取交集，拾间AI 推荐的入口也按学校来。
    const features = applySchoolToSiteFeatures(getFeatures(), schoolId);
    const assistantContext = {
      features,
      forumAccessEnabled,
      loggedIn: Boolean(userId),
      schoolId,
    };
    const searchableBoardTypes = servicesOnly ? [] : ["announce"];
    if (!servicesOnly && forumAccessEnabled && features.forum) searchableBoardTypes.push("normal", "question");
    if (!servicesOnly && forumAccessEnabled && features.market) searchableBoardTypes.push("market");
    if (!servicesOnly && forumAccessEnabled && features.coursereview) searchableBoardTypes.push("coursereview");

    const cacheParts = [
      "retired-boards-v2",
      schoolId,
      q,
      servicesOnly ? "services-only" : "all-content",
      forumAccessEnabled ? "forum-enabled" : "announce-only",
      features.forum ? "forum-on" : "forum-off",
      features.market ? "market-on" : "market-off",
      features.coursereview ? "course-on" : "course-off",
      features.electric ? "electric-on" : "electric-off",
    ];
    const { topics, courses, services } = await withCache("search", cacheParts, 60_000, async () => {
      const [topics, courses, services] = await Promise.all([
        servicesOnly ? Promise.resolve([]) : prisma.topic.findMany({
          where: {
            hidden: false,
            board: { schoolId, type: { in: searchableBoardTypes }, ...visibleBoardSlugFilter() },
            OR: [{ title: { contains: q } }, { content: { contains: q } }],
          },
          orderBy: { lastReplyAt: "desc" },
          take: 10,
          include: {
            board: { select: { slug: true, name: true, color: true, type: true } },
            author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
            tags: { include: { tag: true } },
          },
        }),
        !servicesOnly && forumAccessEnabled && features.coursereview ? prisma.course.findMany({
          where: {
            schoolId,
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
          where: visibleServiceWhere(schoolId, {
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
      // 缓存里是原始行，匿名作者按当前查看者解码，和首页、板块列表同一出口
      topics: await decodeTopicsForViewerForList(topics, req.user),
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
      ]).filter((service) => !assistantHidden || !isCampusAssistantDestination(service.url)).slice(0, 10),
    });
  } catch (e) { next(e); }
});

// 拾间AI 挂在搜索下面，但按自己的开关算。
searchRouter.use("/assistant", requireSchoolModule("assistant"), authRequired, (req, _res, next) => {
  if (shouldHideHarmonyAssistant(detectLoginClient(req).client, true, req.user?.studentId)) {
    return next(Errors.forbidden("拾间AI在当前客户端不可用"));
  }
  next();
});

searchRouter.get("/assistant/quota", async (req, res, next) => {
  try {
    ok(res, await getCampusAssistantQuotaStatus(req.user!.userId));
  } catch (error) {
    next(error);
  }
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
    const deleted = await deleteCampusAssistantConversation(userId, id);
    ok(res, { ok: true, deletedAt: deleted.deletedAt });
  } catch (error) {
    next(error);
  }
});

searchRouter.post("/assistant/department-contacts",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(z.object({ q: z.string().trim().min(1).max(160), campus: z.string().max(30).refine(isDepartmentContactCampus).optional(),
    category: z.string().max(80).optional(), includeSpecial: z.boolean().optional() }).strict()),
  async (req, res, next) => {
    let reservation: CampusAssistantQuotaReservation | null = null;
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(new Error("AI_SEARCH_ABORTED")); };
    req.on("aborted", abort); res.on("close", abort);
    try {
      const cached = readCachedDepartmentContactSearch(req.body);
      if (cached) return ok(res, cached);
      reservation = (await consumeCampusAssistantQuota(req.user!.userId)).reservation;
      if (controller.signal.aborted) throw new Error("AI_SEARCH_ABORTED");
      const result = await searchDepartmentContactsWithAi({ ...req.body, signal: controller.signal, cache: true,
        usage: { createdById: req.user!.userId, pointCost: reservation?.source === "points" ? 1 : 0 } });
      if (controller.signal.aborted) throw new Error("AI_SEARCH_ABORTED");
      ok(res, result);
    } catch (error) {
      if (reservation) await refundCampusAssistantQuota(req.user!.userId, reservation).catch(() => {});
      if (!controller.signal.aborted) next(error instanceof Error && /^(DEPARTMENT_SEARCH_|\[|Unexpected|Invalid)/u.test(error.message)
        ? Errors.badGateway("拾间AI暂时未能返回可核验结果，请稍后重试。") : error);
    } finally { req.off("aborted", abort); res.off("close", abort); }
  });

searchRouter.post(
  "/assistant",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(assistantSchema),
  async (req, res, next) => {
    let quotaReservation: CampusAssistantQuotaReservation | null = null;
    try {
      const userId = req.user!.userId;
      const role = req.user!.role;
      const forumAccessEnabled = await resolveForumAccess(userId, role);
      quotaReservation = (await consumeCampusAssistantQuota(userId)).reservation;
      const response = await askCampusAssistant({
        message: req.body.message,
        history: req.body.history,
        context: {
          features: applySchoolToSiteFeatures(getFeatures(), requestSchoolId(req)),
          forumAccessEnabled,
          loggedIn: true,
          schoolId: requestSchoolId(req),
        },
        usage: {
          createdById: userId,
          pointCost: quotaReservation?.source === "points" ? 1 : 0,
        },
      });
      if (response.fallback && quotaReservation) {
        await refundCampusAssistantQuota(userId, quotaReservation);
        quotaReservation = null;
      }
      ok(res, response);
    } catch (error) {
      if (quotaReservation) {
        await refundCampusAssistantQuota(req.user!.userId, quotaReservation).catch(() => {});
      }
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
    let clientDisconnected = false;
    let quotaReservation: CampusAssistantQuotaReservation | null = null;
    const controller = new AbortController();
    const abortForClientDisconnect = () => {
      if (streamCompleted || clientDisconnected) return;
      clientDisconnected = true;
      controller.abort(new Error("客户端已断开连接，AI 请求已取消"));
    };
    req.on("aborted", abortForClientDisconnect);
    res.on("close", abortForClientDisconnect);

    try {
      const userId = req.user!.userId;
      const role = req.user!.role;
      const forumAccessEnabled = await resolveForumAccess(userId, role);
      quotaReservation = (await consumeCampusAssistantQuota(userId)).reservation;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      streamStarted = true;
      writeAssistantEvent(res, "status", { status: "connected", elapsedMs: 0 });

      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          writeAssistantEvent(res, "heartbeat", {
            status: "generating",
            elapsedMs: Date.now() - startedAt,
          });
        }
      }, 5_000);
      heartbeat.unref?.();
      try {
        const response = await streamCampusAssistant({
          message: req.body.message,
          history: req.body.history,
          context: {
            features: applySchoolToSiteFeatures(getFeatures(), requestSchoolId(req)),
            forumAccessEnabled,
            loggedIn: true,
            schoolId: requestSchoolId(req),
          },
          usage: {
            createdById: userId,
            pointCost: quotaReservation?.source === "points" ? 1 : 0,
          },
          signal: controller.signal,
        }, (delta) => {
          if (!delta || res.writableEnded) return;
          writeAssistantEvent(res, "delta", { delta });
        });
        if (response.fallback && quotaReservation) {
          await refundCampusAssistantQuota(userId, quotaReservation);
          quotaReservation = null;
        }
        if (!res.writableEnded) writeAssistantEvent(res, "done", response);
        streamCompleted = true;
        res.end();
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      if (quotaReservation) {
        await refundCampusAssistantQuota(req.user!.userId, quotaReservation).catch(() => {});
      }
      if (clientDisconnected) return;
      if (!streamStarted) return next(error);
      if (!res.writableEnded) writeAssistantEvent(res, "error", { message: "拾间AI暂时不可用，请稍后再试" });
      streamCompleted = true;
      if (!res.writableEnded) res.end();
    }
  },
);

/**
 * 截图或粘贴的通知读成日程（课表的日程编辑器用）：返回要预填的几条，用户看过再存。
 * 算一次拾间AI 用量；读不出来或拾间AI 没响应时退回。
 */
searchRouter.post(
  "/assistant/agenda-extract",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(z.object({
    image: z.string().max(12 * 1024 * 1024).regex(/^data:image\/(?:jpeg|jpg|png|webp);base64,/u).optional(),
    text: z.string().trim().max(4000).optional(),
  }).strict().refine((body) => Boolean(body.image || body.text), "先选一张截图或粘贴通知文字")),
  async (req, res, next) => {
    let reservation: CampusAssistantQuotaReservation | null = null;
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(new Error("AGENDA_EXTRACT_ABORTED")); };
    req.on("aborted", abort); res.on("close", abort);
    try {
      const userId = req.user!.userId;
      reservation = (await consumeCampusAssistantQuota(userId)).reservation;
      const result = await extractAgendaFromContent({
        image: req.body.image,
        text: req.body.text,
        signal: controller.signal,
        usage: { createdById: userId, pointCost: reservation?.source === "points" ? 1 : 0 },
      });
      if ((result.fallback || !result.items.length) && reservation) {
        await refundCampusAssistantQuota(userId, reservation);
        reservation = null;
      }
      if (!controller.signal.aborted) ok(res, result);
    } catch (error) {
      if (reservation) await refundCampusAssistantQuota(req.user!.userId, reservation).catch(() => {});
      if (controller.signal.aborted) return;
      next(error instanceof Error && /^图片/u.test(error.message) ? Errors.badRequest(error.message) : error);
    } finally { req.off("aborted", abort); res.off("close", abort); }
  },
);

const personalAssistantSchema = assistantSchema.extend({
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).max(40).default([]),
  personal: personalContextSchema,
});

/**
 * 拾间AI 个人模式（药大拾间 NEXT）：问题带上用户本机的课表与日程，回答可附带
 * 要用户确认的 App 操作。事件与 /assistant/stream 相同，done 里多一个 clientActions。
 */
searchRouter.post(
  "/assistant/agent/stream",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(personalAssistantSchema),
  async (req, res, next) => {
    let streamStarted = false;
    let streamCompleted = false;
    let clientDisconnected = false;
    let quotaReservation: CampusAssistantQuotaReservation | null = null;
    const controller = new AbortController();
    const abortForClientDisconnect = () => {
      if (streamCompleted || clientDisconnected) return;
      clientDisconnected = true;
      controller.abort(new Error("客户端已断开连接，AI 请求已取消"));
    };
    req.on("aborted", abortForClientDisconnect);
    res.on("close", abortForClientDisconnect);

    try {
      const userId = req.user!.userId;
      const forumAccessEnabled = await resolveForumAccess(userId, req.user!.role);
      quotaReservation = (await consumeCampusAssistantQuota(userId)).reservation;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      streamStarted = true;
      writeAssistantEvent(res, "status", { status: "connected", elapsedMs: 0 });

      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) writeAssistantEvent(res, "heartbeat", { status: "generating", elapsedMs: Date.now() - startedAt });
      }, 5_000);
      heartbeat.unref?.();
      try {
        const response = await streamPersonalAssistant({
          message: req.body.message,
          history: req.body.history,
          personal: req.body.personal,
          context: { features: applySchoolToSiteFeatures(getFeatures(), requestSchoolId(req)), forumAccessEnabled, loggedIn: true, schoolId: requestSchoolId(req) },
          usage: { createdById: userId, pointCost: quotaReservation?.source === "points" ? 1 : 0 },
          signal: controller.signal,
        }, (delta) => {
          if (!delta || res.writableEnded) return;
          writeAssistantEvent(res, "delta", { delta });
        });
        // A fetch-only reply is followed at once by the real answer, which is the one charged.
        if ((response.fallback || isDataRequestOnly(response)) && quotaReservation) {
          await refundCampusAssistantQuota(userId, quotaReservation);
          quotaReservation = null;
        }
        if (!res.writableEnded) writeAssistantEvent(res, "done", response);
        streamCompleted = true;
        res.end();
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      if (quotaReservation) {
        await refundCampusAssistantQuota(req.user!.userId, quotaReservation).catch(() => {});
      }
      if (clientDisconnected) return;
      if (!streamStarted) return next(error);
      if (!res.writableEnded) writeAssistantEvent(res, "error", { message: "拾间AI暂时不可用，请稍后再试" });
      streamCompleted = true;
      if (!res.writableEnded) res.end();
    }
  },
);

/** 拾间AI 深度个人 Agent：权限与跨会话记忆管理接口 */
searchRouter.get("/assistant/personal/state", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [permissions, memories] = await Promise.all([
      personalAgentStore.getPermissions(userId),
      personalAgentStore.listMemories(userId),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    ok(res, {
      permissions,
      memories,
      consent: { version: PERSONAL_AGENT_CONSENT_VERSION, required: !hasPersonalAgentConsent(permissions) },
    });
  } catch (error) {
    next(error);
  }
});

searchRouter.put(
  "/assistant/personal/permissions",
  securityRateLimit("campus-assistant-history", 60, 60_000),
  validate(personalAgentPermissionsPatchSchema),
  async (req, res, next) => {
    try {
      if (req.body.enabled === true) {
        const current = await personalAgentStore.getPermissions(req.user!.userId);
        if (!hasPersonalAgentConsent(current)) throw Errors.forbidden("请先阅读并同意个人模式说明");
      }
      const permissions = await personalAgentStore.savePermissions(req.user!.userId, req.body);
      res.setHeader("Cache-Control", "private, no-store");
      ok(res, { permissions });
    } catch (error) {
      next(error);
    }
  },
);

/** 首次使用个人模式时的同意：记录说明版本和同意时间，按用户的选择保存授权并开启。 */
searchRouter.post(
  "/assistant/personal/consent",
  securityRateLimit("campus-assistant-history", 20, 60_000),
  validate(personalAgentConsentSchema),
  async (req, res, next) => {
    try {
      const { version: _version, ...choices } = req.body;
      const permissions = await personalAgentStore.recordConsent(req.user!.userId, choices);
      res.setHeader("Cache-Control", "private, no-store");
      ok(res, { permissions, consent: { version: PERSONAL_AGENT_CONSENT_VERSION, required: false } });
    } catch (error) {
      next(error);
    }
  },
);

const upsertMemoryBodySchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,24}$/u).optional(),
  category: z.enum(MEMORY_CATEGORIES).default("note"),
  content: z.string().trim().min(1, "记忆内容不能为空").max(240, "单条记忆最多 240 字"),
}).strict();

searchRouter.post(
  "/assistant/personal/memories",
  securityRateLimit("campus-assistant-history", 60, 60_000),
  validate(upsertMemoryBodySchema),
  async (req, res, next) => {
    try {
      const memory = await personalAgentStore.upsertMemory(req.user!.userId, {
        id: req.body.id,
        category: req.body.category,
        content: req.body.content,
        source: "user",
      });
      if (!memory) throw Errors.badRequest("记忆内容不合法或包含受限话题");
      res.setHeader("Cache-Control", "private, no-store");
      ok(res, { memory });
    } catch (error) {
      next(error);
    }
  },
);

searchRouter.delete(
  "/assistant/personal/memories/:id",
  securityRateLimit("campus-assistant-history", 60, 60_000),
  async (req, res, next) => {
    try {
      const id = String(req.params.id || "").trim();
      const deleted = await personalAgentStore.deleteMemory(req.user!.userId, id);
      res.setHeader("Cache-Control", "private, no-store");
      ok(res, { deleted });
    } catch (error) {
      next(error);
    }
  },
);

searchRouter.delete(
  "/assistant/personal/memories",
  securityRateLimit("campus-assistant-history", 20, 60_000),
  async (req, res, next) => {
    try {
      const cleared = await personalAgentStore.clearMemories(req.user!.userId);
      res.setHeader("Cache-Control", "private, no-store");
      ok(res, { cleared });
    } catch (error) {
      next(error);
    }
  },
);

const personalAgentStreamBodySchema = assistantSchema.extend({
  message: z.string().trim().min(1).max(1000),
  retriedAfterRecover: z.boolean().optional().default(false),
}).strict();

/**
 * Web 与全平台共用的拾间AI 深度个人 Agent 流式问答：
 * 按用户分项授权在服务端实时调取教务/课表/生活/社区工具并执行确定性精算，单轮提问仅扣 1 次拾间AI 额度。
 */
searchRouter.post(
  "/assistant/personal/stream",
  securityRateLimit("campus-assistant", 20, 60_000),
  validate(personalAgentStreamBodySchema),
  async (req: any, res, next) => {
    let streamStarted = false;
    let streamCompleted = false;
    let clientDisconnected = false;
    let quotaReservation: CampusAssistantQuotaReservation | null = null;
    const controller = new AbortController();
    const abortForClientDisconnect = () => {
      if (streamCompleted || clientDisconnected) return;
      clientDisconnected = true;
      controller.abort(new Error("客户端已断开连接，AI 请求已取消"));
    };
    req.on("aborted", abortForClientDisconnect);
    res.on("close", abortForClientDisconnect);

    try {
      const userId = req.user!.userId;
      const role = req.user!.role;
      const schoolId = requestSchoolId(req);
      const [forumAccessEnabled, permissions, userRow] = await Promise.all([
        resolveForumAccess(userId, role),
        personalAgentStore.getPermissions(userId),
        prisma.user.findUnique({
          where: { id: userId },
          select: { username: true, nickname: true, studentSso: true, schoolId: true },
        }),
      ]);
      if (!userRow) throw Errors.unauthorized("账号不存在或已失效");

      quotaReservation = (await consumeCampusAssistantQuota(userId)).reservation;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      streamStarted = true;
      writeAssistantEvent(res, "status", { status: "connected", elapsedMs: 0 });

      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          writeAssistantEvent(res, "heartbeat", {
            status: "generating",
            elapsedMs: Date.now() - startedAt,
          });
        }
      }, 5_000);
      heartbeat.unref?.();

      const assistantContext = {
        features: applySchoolToSiteFeatures(getFeatures(), schoolId),
        forumAccessEnabled,
        loggedIn: true,
        schoolId,
      };

      try {
        // 没开个人模式，或还没同意当前版本的说明：按普通问答处理，不读任何个人数据
        if (!personalAgentActive(permissions)) {
          const basic = await streamCampusAssistant({
            message: req.body.message,
            history: req.body.history,
            context: assistantContext,
            usage: { createdById: userId, pointCost: quotaReservation?.source === "points" ? 1 : 0 },
            signal: controller.signal,
          }, (delta) => {
            if (!delta || res.writableEnded) return;
            writeAssistantEvent(res, "delta", { delta });
          });
          if (basic.fallback && quotaReservation) {
            await refundCampusAssistantQuota(userId, quotaReservation);
            quotaReservation = null;
          }
          if (!res.writableEnded) {
            writeAssistantEvent(res, "done", {
              ...basic,
              proposals: [],
              steps: [],
              memoryChanges: [],
            });
          }
          streamCompleted = true;
          res.end();
          return;
        }

        const headerJwxt = String(req.headers["x-jwxt-token"] || "").trim();
        const directToken = req.browserSession?.jwxtToken
          || (headerJwxt && headerJwxt !== "cookie-session" ? headerJwxt : "")
          || null;
        const rememberedToken = directToken
          ? null
          : (await scheduleWidgetSessions.latest(userId).catch(() => null))?.token || null;

        const response = await streamCampusPersonalAgent({
          message: req.body.message,
          history: req.body.history,
          assistantContext,
          toolContext: {
            userId,
            username: userRow.username,
            nickname: userRow.nickname,
            studentSso: userRow.studentSso,
            role,
            schoolId: userRow.schoolId || schoolId,
            forumAccessEnabled,
            permissions,
            jwxtToken: directToken || rememberedToken,
            retriedAfterRecover: Boolean(req.body.retriedAfterRecover),
            blockedScopes: new Set(),
            needsManualJwxtReauth: false,
            signal: controller.signal,
            now: new Date(),
          },
          usage: {
            createdById: userId,
            pointCost: quotaReservation?.source === "points" ? 1 : 0,
          },
          onStep: (step) => {
            if (res.writableEnded) return;
            writeAssistantEvent(res, "step", step);
          },
          onAnswerDelta: (delta) => {
            if (!delta || res.writableEnded) return;
            writeAssistantEvent(res, "delta", { delta });
          },
        });

        if (response.fallback && quotaReservation) {
          await refundCampusAssistantQuota(userId, quotaReservation);
          quotaReservation = null;
        }
        if (!res.writableEnded) writeAssistantEvent(res, "done", response);
        streamCompleted = true;
        res.end();
      } catch (innerErr) {
        if (innerErr instanceof JwxtReauthRequiredError) {
          if (quotaReservation) {
            await refundCampusAssistantQuota(userId, quotaReservation).catch(() => {});
            quotaReservation = null;
          }
          if (!res.writableEnded) {
            writeAssistantEvent(res, "jwxt_reauth_needed", { message: innerErr.message });
          }
          streamCompleted = true;
          if (!res.writableEnded) res.end();
          return;
        }
        throw innerErr;
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      if (quotaReservation) {
        await refundCampusAssistantQuota(req.user!.userId, quotaReservation).catch(() => {});
      }
      if (clientDisconnected) return;
      if (!streamStarted) return next(error);
      if (!res.writableEnded) writeAssistantEvent(res, "error", { message: "拾间AI暂时不可用，请稍后再试" });
      streamCompleted = true;
      if (!res.writableEnded) res.end();
    }
  },
);


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
