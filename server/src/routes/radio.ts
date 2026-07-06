import { Readable } from "node:stream";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { withCache } from "../services/cache";
import { invalidateRadioCaches } from "../services/cacheInvalidation";
import {
  RADIO_MUSIC_PROVIDER_KEYS,
  RADIO_MUSIC_SEARCH_MODES,
  audioContentTypeForUrl,
  audioProxyHeadersFor,
  buildRadioMusicStreamPath,
  buildQqRadioMusicSyncRedirectPath,
  clearQqRadioMusicCookie,
  createQqRadioMusicSyncSession,
  getRadioMusicAuthStatus,
  issueRadioMusicStreamToken,
  readQqRadioMusicSyncSession,
  readRadioMusicStreamPayload,
  resolveRadioMusicUrl,
  saveQqRadioMusicCookie,
  searchRadioMusic,
  serializeRadioMusicSelection,
  touchQqRadioMusicSyncSession,
} from "../services/radioMusic";
import {
  normalizeRadioPlayTime,
  normalizeRadioPublicSongRequest,
  normalizeRadioScheduleItem,
  normalizeRadioSemester,
  normalizeRadioSongRequest,
  RADIO_REQUEST_STATUSES,
  RADIO_SCHEDULE_STATUSES,
  RADIO_SEMESTER_STATUSES,
  RADIO_TOOL_CODE,
  RADIO_WEEKDAYS,
  resolveCurrentRadioSemester,
  serializeRadioTags,
} from "../services/radioStation";
import { assertToolUsable, hasToolContentManagePermission } from "../services/serviceTools";
import { Errors, ok } from "../utils/response";

export const radioRouter = Router();

const timeSchema = z.string().trim().regex(/^\d{2}:\d{2}$/, "时间格式应为 HH:mm");
const optionalString = (max: number) => z.string().trim().max(max).optional();
const optionalNullableString = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional();
const optionalDateInput = z.union([z.string().trim().max(40), z.null()]).optional();

const semesterStatusSchema = z.enum(RADIO_SEMESTER_STATUSES);
const scheduleStatusSchema = z.enum(RADIO_SCHEDULE_STATUSES);
const requestStatusSchema = z.enum(RADIO_REQUEST_STATUSES);
const radioMusicProviderSchema = z.enum(RADIO_MUSIC_PROVIDER_KEYS);
const radioMusicSearchModeSchema = z.enum(RADIO_MUSIC_SEARCH_MODES);
const radioMusicSelectionSchema = z.object({
  provider: radioMusicProviderSchema,
  trackId: z.string().trim().min(1).max(120),
  mediaMid: optionalNullableString(120),
  album: optionalNullableString(200),
  cover: optionalNullableString(1000),
  duration: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

const createSemesterSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(80),
  description: optionalString(1000),
  status: semesterStatusSchema.optional(),
  isCurrent: z.boolean().optional(),
  startDate: optionalDateInput,
  endDate: optionalDateInput,
});

const patchSemesterSchema = createSemesterSchema.partial();

const createPlayTimeSchema = z.object({
  semesterId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(80),
  weekday: z.number().int().refine((value) => RADIO_WEEKDAYS.includes(value as typeof RADIO_WEEKDAYS[number]), "星期仅支持 1-7"),
  startTime: timeSchema,
  endTime: timeSchema,
  location: optionalString(120),
  note: optionalString(600),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const patchPlayTimeSchema = createPlayTimeSchema.partial();

const createScheduleSchema = z.object({
  semesterId: z.number().int().positive().nullable().optional(),
  playTimeId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  subtitle: optionalString(120),
  hostNames: optionalString(160),
  summary: optionalString(2000),
  coverImage: optionalString(800),
  tags: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  requestEnabled: z.boolean().optional(),
  status: scheduleStatusSchema.optional(),
  startsAt: optionalDateInput,
  endsAt: optionalDateInput,
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const patchScheduleSchema = createScheduleSchema.partial();

const createRequestSchema = z.object({
  scheduleItemId: z.number().int().positive().nullable().optional(),
  nickname: optionalString(40),
  contact: optionalString(120),
  songTitle: z.string().trim().min(1).max(120),
  artist: optionalString(120),
  sourceSelection: radioMusicSelectionSchema.optional(),
  dedication: optionalString(200),
  message: optionalString(1000),
});

const patchRequestSchema = z.object({
  scheduleItemId: z.number().int().positive().nullable().optional(),
  status: requestStatusSchema.optional(),
  adminNote: optionalNullableString(1000),
});

const searchMusicSchema = z.object({
  q: z.string().trim().min(1).max(120),
  provider: radioMusicSearchModeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(18).optional(),
});

const resolveMusicSchema = z.object({
  provider: radioMusicProviderSchema,
  trackId: z.string().trim().min(1).max(120),
  mediaMid: optionalNullableString(120),
  quality: z.string().trim().max(40).optional(),
});

const saveQqMusicCookieSchema = z.object({
  cookie: z.string().trim().min(1).max(20_000),
});

const createQqMusicSyncSessionSchema = z.object({
  returnPath: z.string().trim().max(500).optional(),
});

async function ensureRadioUsable(user?: { userId?: number; role?: string } | null) {
  try {
    await assertToolUsable(RADIO_TOOL_CODE, user);
  } catch (error: any) {
    if (error?.message === "TOOL_LOGIN_REQUIRED") throw Errors.unauthorized("药苑之声当前需要登录后使用");
    throw error;
  }
}

async function ensureRadioManager(user?: { userId?: number; role?: string } | null) {
  if (!(await hasToolContentManagePermission(RADIO_TOOL_CODE, user))) {
    throw Errors.forbidden("没有药苑之声管理权限");
  }
}

function parseOptionalDate(input: unknown) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw Errors.badRequest("日期格式不正确");
  return date;
}

function compareTimes(startTime: string, endTime: string) {
  return startTime.localeCompare(endTime);
}

function forwardHeaderIfPresent(res: Response, upstream: globalThis.Response, name: string) {
  const value = upstream.headers.get(name);
  if (value) res.setHeader(name, value);
}

function writeMusicStreamHeaders(res: Response, upstream: globalThis.Response, audioUrl: string) {
  res.status(upstream.status);
  res.setHeader("Content-Type", audioContentTypeForUrl(audioUrl, upstream.headers.get("content-type")));
  forwardHeaderIfPresent(res, upstream, "content-length");
  forwardHeaderIfPresent(res, upstream, "content-range");
  forwardHeaderIfPresent(res, upstream, "accept-ranges");
  forwardHeaderIfPresent(res, upstream, "cache-control");
  forwardHeaderIfPresent(res, upstream, "etag");
  forwardHeaderIfPresent(res, upstream, "last-modified");
}

async function ensureSemesterExists(semesterId: number | null | undefined) {
  if (!semesterId) return null;
  const semester = await prisma.radioSemester.findUnique({ where: { id: semesterId } });
  if (!semester) throw Errors.badRequest("学期不存在");
  return semester;
}

async function ensurePlayTimeExists(playTimeId: number | null | undefined) {
  if (!playTimeId) return null;
  const playTime = await prisma.radioPlayTime.findUnique({ where: { id: playTimeId } });
  if (!playTime) throw Errors.badRequest("播出时段不存在");
  return playTime;
}

async function loadManageBootstrap() {
  const [semesters, playTimes, scheduleItems, requests] = await Promise.all([
    prisma.radioSemester.findMany({
      orderBy: [{ isCurrent: "desc" }, { status: "asc" }, { startDate: "desc" }, { id: "desc" }],
      include: {
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { playTimes: true, scheduleItems: true } },
      },
    }),
    prisma.radioPlayTime.findMany({
      orderBy: [{ weekday: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      include: {
        semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { scheduleItems: true } },
      },
    }),
    prisma.radioScheduleItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
        playTime: { select: { id: true, name: true, weekday: true, startTime: true, endTime: true, location: true, enabled: true, sortOrder: true } },
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { songRequests: true } },
      },
    }),
    prisma.radioSongRequest.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        scheduleItem: { select: { id: true, title: true, subtitle: true, requestEnabled: true } },
        requester: { select: { id: true, username: true, nickname: true, role: true } },
        reviewedBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
      take: 200,
    }),
  ]);

  return {
    semesters: semesters.map(normalizeRadioSemester),
    playTimes: playTimes.map(normalizeRadioPlayTime),
    scheduleItems: scheduleItems.map(normalizeRadioScheduleItem),
    requests: requests.map(normalizeRadioSongRequest),
  };
}

type SearchMusicQuery = z.infer<typeof searchMusicSchema>;
type ResolveMusicQuery = z.infer<typeof resolveMusicSchema>;

radioRouter.get("/overview", authOptional, async (req, res, next) => {
  try {
    await ensureRadioUsable(req.user);
    const payload = await withCache("radio", ["overview"], 60_000, async () => {
      const currentSemester = await resolveCurrentRadioSemester();
      const semesterId = currentSemester?.id ?? null;
      const semesterWhere = semesterId ? { OR: [{ semesterId }, { semesterId: null }] } : {};
      const [playTimes, scheduleItems, recentRequests, pendingRequests, fulfilledRequests, totalRequests] = await Promise.all([
        prisma.radioPlayTime.findMany({
          where: {
            enabled: true,
            ...semesterWhere,
          },
          orderBy: [{ weekday: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
          include: {
            semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
          },
        }),
        prisma.radioScheduleItem.findMany({
          where: {
            status: "published",
            ...semesterWhere,
          },
          include: {
            semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
            playTime: { select: { id: true, name: true, weekday: true, startTime: true, endTime: true, location: true, enabled: true, sortOrder: true } },
            _count: { select: { songRequests: true } },
          },
        }),
        prisma.radioSongRequest.findMany({
          where: semesterId ? { OR: [{ scheduleItem: { semesterId } }, { scheduleItemId: null }] } : undefined,
          orderBy: [{ createdAt: "desc" }],
          take: 120,
          include: {
            scheduleItem: { select: { id: true, title: true, subtitle: true, requestEnabled: true } },
          },
        }),
        prisma.radioSongRequest.count({ where: { status: "pending" } }),
        prisma.radioSongRequest.count({ where: { status: "fulfilled" } }),
        prisma.radioSongRequest.count(),
      ]);

      const normalizedPlayTimes = playTimes.map(normalizeRadioPlayTime);
      const normalizedScheduleItems = scheduleItems
        .map(normalizeRadioScheduleItem)
        .sort((left, right) => {
          const leftWeekday = left.playTime?.weekday ?? 9;
          const rightWeekday = right.playTime?.weekday ?? 9;
          if (leftWeekday !== rightWeekday) return leftWeekday - rightWeekday;
          const leftTime = left.playTime?.startTime ?? "99:99";
          const rightTime = right.playTime?.startTime ?? "99:99";
          if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
          if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
          return left.id - right.id;
        });

      return {
        currentSemester: currentSemester ? normalizeRadioSemester(currentSemester) : null,
        playTimes: normalizedPlayTimes,
        scheduleItems: normalizedScheduleItems,
        recentRequests: recentRequests.map(normalizeRadioPublicSongRequest),
        requestSummary: {
          total: totalRequests,
          pending: pendingRequests,
          fulfilled: fulfilledRequests,
        },
      };
    });
    ok(res, payload);
  } catch (error) {
    next(error);
  }
});

radioRouter.get("/music/search", authOptional, validate(searchMusicSchema, "query"), async (req, res, next) => {
  try {
    await ensureRadioUsable(req.user);
    const query = req.query as unknown as SearchMusicQuery;
    ok(res, await searchRadioMusic(query.q, query.provider ?? "all", query.limit ?? 12));
  } catch (error) {
    next(error);
  }
});

radioRouter.get("/music/resolve", authOptional, validate(resolveMusicSchema, "query"), async (req, res, next) => {
  try {
    await ensureRadioUsable(req.user);
    const query = req.query as unknown as ResolveMusicQuery;
    const resolved = await resolveRadioMusicUrl({
      provider: query.provider,
      trackId: query.trackId,
      mediaMid: query.mediaMid ?? null,
      quality: query.quality,
    });
    if (!resolved.url) {
      ok(res, {
        provider: resolved.provider,
        playable: resolved.playable,
        trial: resolved.trial,
        level: resolved.level ?? null,
        quality: resolved.quality ?? null,
        requestedQuality: resolved.requestedQuality,
        reason: resolved.reason ?? "",
        message: resolved.message ?? "",
        restriction: resolved.restriction ?? null,
        streamToken: null,
        streamUrl: null,
      });
      return;
    }
    const streamToken = await issueRadioMusicStreamToken({
      provider: resolved.provider,
      url: resolved.url,
    });
    ok(res, {
      provider: resolved.provider,
      playable: resolved.playable,
      trial: resolved.trial,
      level: resolved.level ?? null,
      quality: resolved.quality ?? null,
      requestedQuality: resolved.requestedQuality,
      reason: resolved.reason ?? "",
      message: resolved.message ?? "",
      restriction: resolved.restriction ?? null,
      streamToken,
      streamUrl: buildRadioMusicStreamPath(streamToken),
    });
  } catch (error) {
    next(error);
  }
});

async function handleMusicStream(req: Request<{ token: string }>, res: Response, next: (error?: unknown) => void) {
  try {
    const token = String(req.params.token ?? "").trim();
    if (!token) throw Errors.notFound("播放令牌不存在");
    const payload = await readRadioMusicStreamPayload(token);
    if (!payload?.url) throw Errors.notFound("播放令牌已失效，请重新试听");
    const upstream = await fetch(payload.url, {
      method: req.method,
      headers: audioProxyHeadersFor(payload.url, req.headers.range),
      redirect: "follow",
    });
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      const detail = await upstream.text().catch(() => "");
      res.status(502).send(detail ? `音频回源失败：${detail}` : `音频回源失败：HTTP ${upstream.status}`);
      return;
    }
    writeMusicStreamHeaders(res, upstream, payload.url);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (error) {
    next(error);
  }
}

radioRouter.get("/music/stream/:token", (req, res, next) => {
  void handleMusicStream(req, res, next);
});

radioRouter.head("/music/stream/:token", (req, res, next) => {
  void handleMusicStream(req, res, next);
});

radioRouter.post("/requests", authOptional, validate(createRequestSchema), async (req, res, next) => {
  try {
    await ensureRadioUsable(req.user);
    const scheduleItemId = req.body.scheduleItemId ?? null;
    const sourceSelection = req.body.sourceSelection ?? null;
    let scheduleItem = null as Awaited<ReturnType<typeof prisma.radioScheduleItem.findUnique>> | null;
    if (scheduleItemId) {
      scheduleItem = await prisma.radioScheduleItem.findUnique({ where: { id: scheduleItemId } });
      if (!scheduleItem) throw Errors.badRequest("节目不存在");
      if (scheduleItem.status !== "published") throw Errors.badRequest("当前节目暂未开放点歌");
      if (!scheduleItem.requestEnabled) throw Errors.badRequest("当前节目暂未开放点歌");
    }
    const nickname = String(req.body.nickname || req.user?.studentId || "").trim();
    if (!nickname) throw Errors.badRequest("请填写你的称呼");
    const row = await prisma.radioSongRequest.create({
      data: {
        scheduleItemId: scheduleItem?.id ?? null,
        requesterId: req.user?.userId ?? null,
        nickname,
        contact: req.body.contact || null,
        songTitle: req.body.songTitle,
        artist: req.body.artist || null,
        sourceProvider: sourceSelection?.provider ?? null,
        sourceTrackId: sourceSelection?.trackId ?? null,
        sourceTrackMeta: serializeRadioMusicSelection(sourceSelection),
        dedication: req.body.dedication || null,
        message: req.body.message || null,
      },
      include: {
        scheduleItem: { select: { id: true, title: true, subtitle: true, requestEnabled: true } },
        requester: { select: { id: true, username: true, nickname: true, role: true } },
        reviewedBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioSongRequest(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.get("/manage/bootstrap", authRequired, async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    ok(res, await loadManageBootstrap());
  } catch (error) {
    next(error);
  }
});

radioRouter.get("/manage/music-auth", authRequired, async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    ok(res, await getRadioMusicAuthStatus());
  } catch (error) {
    next(error);
  }
});

radioRouter.post("/manage/music-auth/qq-sync-session", authRequired, validate(createQqMusicSyncSessionSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    ok(res, await createQqRadioMusicSyncSession(req.user?.userId ?? null, req.body.returnPath));
  } catch (error) {
    next(error);
  }
});

radioRouter.post("/manage/music-auth/qq-cookie", authRequired, validate(saveQqMusicCookieSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    ok(res, await saveQqRadioMusicCookie(req.body.cookie, req.user?.userId ?? null));
  } catch (error) {
    next(error);
  }
});

radioRouter.delete("/manage/music-auth/qq-cookie", authRequired, async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    ok(res, await clearQqRadioMusicCookie());
  } catch (error) {
    next(error);
  }
});

radioRouter.post("/music-auth/qq-sync/complete", async (req, res) => {
  const fallbackPath = buildQqRadioMusicSyncRedirectPath(null, "error", "同步按钮已失效，请回控制台重新生成");
  const token = String(req.body?.token ?? "").trim();
  const cookie = String(req.body?.cookie ?? "").trim();
  const session = token ? await readQqRadioMusicSyncSession(token) : null;
  if (!session) {
    res.redirect(303, fallbackPath);
    return;
  }
  if (!cookie) {
    res.redirect(303, buildQqRadioMusicSyncRedirectPath(session.returnPath, "error", "没有读取到 QQ 音乐登录态，请确认你是在 QQ 音乐网页里点的同步按钮"));
    return;
  }
  try {
    const status = await saveQqRadioMusicCookie(cookie, session.updatedById);
    await touchQqRadioMusicSyncSession(token).catch(() => undefined);
    const message = status.qq.playbackKeyReady
      ? "QQ 音乐共享登录态已同步，现在可以直接拉试听了"
      : status.qq.loggedIn
        ? "登录态已同步，但还没拿到播放票据；请在 QQ 音乐网页播放器停留几秒后再点一次同步按钮"
        : "登录态已提交，但当前还没有识别到有效的 QQ 音乐登录态";
    const result = status.qq.playbackKeyReady ? "success" : status.qq.loggedIn ? "partial" : "error";
    res.redirect(303, buildQqRadioMusicSyncRedirectPath(session.returnPath, result, message));
  } catch (error: any) {
    res.redirect(303, buildQqRadioMusicSyncRedirectPath(session.returnPath, "error", error?.message || "QQ 音乐登录态同步失败"));
  }
});

radioRouter.post("/manage/semesters", authRequired, validate(createSemesterSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    const startDate = parseOptionalDate(req.body.startDate);
    const endDate = parseOptionalDate(req.body.endDate);
    if (startDate && endDate && startDate.getTime() > endDate.getTime()) throw Errors.badRequest("学期开始时间不能晚于结束时间");
    const shouldCurrent = Boolean(req.body.isCurrent);
    const status = shouldCurrent ? "active" : req.body.status ?? "draft";
    const row = await prisma.$transaction(async (tx) => {
      if (shouldCurrent) {
        await tx.radioSemester.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      }
      return tx.radioSemester.create({
        data: {
          code: req.body.code,
          name: req.body.name,
          description: req.body.description || null,
          status,
          isCurrent: shouldCurrent,
          startDate,
          endDate,
          createdById: req.user!.userId,
        },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
          _count: { select: { playTimes: true, scheduleItems: true } },
        },
      });
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioSemester(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.patch("/manage/semesters/:id", authRequired, validate(patchSemesterSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("学期编号不合法");
    const current = await prisma.radioSemester.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("学期不存在");
    const startDate = req.body.startDate !== undefined ? parseOptionalDate(req.body.startDate) : undefined;
    const endDate = req.body.endDate !== undefined ? parseOptionalDate(req.body.endDate) : undefined;
    const effectiveStart = startDate === undefined ? current.startDate : startDate;
    const effectiveEnd = endDate === undefined ? current.endDate : endDate;
    if (effectiveStart && effectiveEnd && effectiveStart.getTime() > effectiveEnd.getTime()) throw Errors.badRequest("学期开始时间不能晚于结束时间");
    const shouldCurrent = req.body.isCurrent === undefined ? current.isCurrent : Boolean(req.body.isCurrent);
    const status = shouldCurrent ? "active" : (req.body.status ?? current.status);
    const row = await prisma.$transaction(async (tx) => {
      if (shouldCurrent) {
        await tx.radioSemester.updateMany({ where: { isCurrent: true, id: { not: id } }, data: { isCurrent: false } });
      }
      return tx.radioSemester.update({
        where: { id },
        data: {
          code: req.body.code ?? current.code,
          name: req.body.name ?? current.name,
          description: req.body.description === undefined ? current.description : (req.body.description || null),
          status,
          isCurrent: shouldCurrent,
          startDate: startDate === undefined ? current.startDate : startDate,
          endDate: endDate === undefined ? current.endDate : endDate,
        },
        include: {
          createdBy: { select: { id: true, username: true, nickname: true, role: true } },
          _count: { select: { playTimes: true, scheduleItems: true } },
        },
      });
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioSemester(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.post("/manage/play-times", authRequired, validate(createPlayTimeSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    if (compareTimes(req.body.startTime, req.body.endTime) >= 0) throw Errors.badRequest("结束时间需要晚于开始时间");
    await ensureSemesterExists(req.body.semesterId ?? null);
    const row = await prisma.radioPlayTime.create({
      data: {
        semesterId: req.body.semesterId ?? null,
        name: req.body.name,
        weekday: req.body.weekday,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        location: req.body.location || null,
        note: req.body.note || null,
        enabled: req.body.enabled ?? true,
        sortOrder: req.body.sortOrder ?? 0,
        createdById: req.user!.userId,
      },
      include: {
        semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { scheduleItems: true } },
      },
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioPlayTime(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.patch("/manage/play-times/:id", authRequired, validate(patchPlayTimeSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("时段编号不合法");
    const current = await prisma.radioPlayTime.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("播出时段不存在");
    const nextStartTime = req.body.startTime ?? current.startTime;
    const nextEndTime = req.body.endTime ?? current.endTime;
    if (compareTimes(nextStartTime, nextEndTime) >= 0) throw Errors.badRequest("结束时间需要晚于开始时间");
    if (req.body.semesterId !== undefined) await ensureSemesterExists(req.body.semesterId ?? null);
    const row = await prisma.radioPlayTime.update({
      where: { id },
      data: {
        semesterId: req.body.semesterId === undefined ? current.semesterId : (req.body.semesterId ?? null),
        name: req.body.name ?? current.name,
        weekday: req.body.weekday ?? current.weekday,
        startTime: nextStartTime,
        endTime: nextEndTime,
        location: req.body.location === undefined ? current.location : (req.body.location || null),
        note: req.body.note === undefined ? current.note : (req.body.note || null),
        enabled: req.body.enabled ?? current.enabled,
        sortOrder: req.body.sortOrder ?? current.sortOrder,
      },
      include: {
        semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { scheduleItems: true } },
      },
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioPlayTime(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.post("/manage/schedules", authRequired, validate(createScheduleSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    const semester = await ensureSemesterExists(req.body.semesterId ?? null);
    const playTime = await ensurePlayTimeExists(req.body.playTimeId ?? null);
    const startsAt = parseOptionalDate(req.body.startsAt);
    const endsAt = parseOptionalDate(req.body.endsAt);
    if (startsAt && endsAt && startsAt.getTime() > endsAt.getTime()) throw Errors.badRequest("节目开始时间不能晚于结束时间");
    const semesterId = req.body.semesterId ?? playTime?.semesterId ?? semester?.id ?? null;
    const row = await prisma.radioScheduleItem.create({
      data: {
        semesterId,
        playTimeId: req.body.playTimeId ?? null,
        title: req.body.title,
        subtitle: req.body.subtitle || null,
        hostNames: req.body.hostNames || null,
        summary: req.body.summary || null,
        coverImage: req.body.coverImage || null,
        tags: serializeRadioTags(req.body.tags),
        requestEnabled: req.body.requestEnabled ?? true,
        status: req.body.status ?? "draft",
        startsAt,
        endsAt,
        sortOrder: req.body.sortOrder ?? 0,
        createdById: req.user!.userId,
      },
      include: {
        semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
        playTime: { select: { id: true, name: true, weekday: true, startTime: true, endTime: true, location: true, enabled: true, sortOrder: true } },
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { songRequests: true } },
      },
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioScheduleItem(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.patch("/manage/schedules/:id", authRequired, validate(patchScheduleSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("节目编号不合法");
    const current = await prisma.radioScheduleItem.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("节目不存在");
    const semester = req.body.semesterId !== undefined ? await ensureSemesterExists(req.body.semesterId ?? null) : null;
    const playTime = req.body.playTimeId !== undefined ? await ensurePlayTimeExists(req.body.playTimeId ?? null) : null;
    const startsAt = req.body.startsAt !== undefined ? parseOptionalDate(req.body.startsAt) : undefined;
    const endsAt = req.body.endsAt !== undefined ? parseOptionalDate(req.body.endsAt) : undefined;
    const effectiveStartsAt = startsAt === undefined ? current.startsAt : startsAt;
    const effectiveEndsAt = endsAt === undefined ? current.endsAt : endsAt;
    if (effectiveStartsAt && effectiveEndsAt && effectiveStartsAt.getTime() > effectiveEndsAt.getTime()) throw Errors.badRequest("节目开始时间不能晚于结束时间");
    const semesterId = req.body.semesterId === undefined
      ? (req.body.playTimeId !== undefined ? (playTime?.semesterId ?? current.semesterId) : current.semesterId)
      : (req.body.semesterId ?? playTime?.semesterId ?? semester?.id ?? null);
    const row = await prisma.radioScheduleItem.update({
      where: { id },
      data: {
        semesterId,
        playTimeId: req.body.playTimeId === undefined ? current.playTimeId : (req.body.playTimeId ?? null),
        title: req.body.title ?? current.title,
        subtitle: req.body.subtitle === undefined ? current.subtitle : (req.body.subtitle || null),
        hostNames: req.body.hostNames === undefined ? current.hostNames : (req.body.hostNames || null),
        summary: req.body.summary === undefined ? current.summary : (req.body.summary || null),
        coverImage: req.body.coverImage === undefined ? current.coverImage : (req.body.coverImage || null),
        tags: req.body.tags === undefined ? current.tags : serializeRadioTags(req.body.tags),
        requestEnabled: req.body.requestEnabled ?? current.requestEnabled,
        status: req.body.status ?? current.status,
        startsAt: startsAt === undefined ? current.startsAt : startsAt,
        endsAt: endsAt === undefined ? current.endsAt : endsAt,
        sortOrder: req.body.sortOrder ?? current.sortOrder,
      },
      include: {
        semester: { select: { id: true, code: true, name: true, status: true, isCurrent: true } },
        playTime: { select: { id: true, name: true, weekday: true, startTime: true, endTime: true, location: true, enabled: true, sortOrder: true } },
        createdBy: { select: { id: true, username: true, nickname: true, role: true } },
        _count: { select: { songRequests: true } },
      },
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioScheduleItem(row));
  } catch (error) {
    next(error);
  }
});

radioRouter.patch("/manage/requests/:id", authRequired, validate(patchRequestSchema), async (req, res, next) => {
  try {
    await ensureRadioManager(req.user);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("点歌编号不合法");
    const current = await prisma.radioSongRequest.findUnique({ where: { id } });
    if (!current) throw Errors.notFound("点歌记录不存在");
    if (req.body.scheduleItemId !== undefined) {
      if (req.body.scheduleItemId) {
        const scheduleItem = await prisma.radioScheduleItem.findUnique({ where: { id: req.body.scheduleItemId } });
        if (!scheduleItem) throw Errors.badRequest("节目不存在");
      }
    }
    const row = await prisma.radioSongRequest.update({
      where: { id },
      data: {
        scheduleItemId: req.body.scheduleItemId === undefined ? current.scheduleItemId : (req.body.scheduleItemId ?? null),
        status: req.body.status ?? current.status,
        adminNote: req.body.adminNote === undefined ? current.adminNote : (req.body.adminNote || null),
        reviewedById: req.body.status || req.body.adminNote !== undefined ? req.user!.userId : current.reviewedById,
        reviewedAt: req.body.status || req.body.adminNote !== undefined ? new Date() : current.reviewedAt,
      },
      include: {
        scheduleItem: { select: { id: true, title: true, subtitle: true, requestEnabled: true } },
        requester: { select: { id: true, username: true, nickname: true, role: true } },
        reviewedBy: { select: { id: true, username: true, nickname: true, role: true } },
      },
    });
    await invalidateRadioCaches();
    ok(res, normalizeRadioSongRequest(row));
  } catch (error) {
    next(error);
  }
});
