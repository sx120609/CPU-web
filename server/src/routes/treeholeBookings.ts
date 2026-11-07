import { Router } from "express";
import { z } from "zod";
import type { Prisma, TreeholeBooking } from "@prisma/client";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  bookingPlaceOf,
  loadTreeholeConfig,
  notifyTreehole,
  parseTreeholeId,
  presenceOf,
  requireConsent,
  requireTreeholeAdmin,
  requireTreeholeHost,
  takeTreeholeRate,
  viewerOf,
  type TreeholeViewer,
} from "../services/treehole";
import {
  bookingDisplayStatus,
  bookingSlots,
  generateVisitorAlias,
  hostDisplayName,
  isBookableSlot,
  TREEHOLE_BOOKING_ACTIVE_LIMIT,
  TREEHOLE_BOOKING_DAYS,
  TREEHOLE_BOOKING_SLOT_MINUTES,
} from "../services/treeholePolicy";

// 预约线下一对一倾诉：学生看完整值班表，挑小艾绒和 30 分钟档位提交预约；
// 小艾绒确认或拒绝，双方都能提前取消，每一步都提醒对方。见面在心理发展中心。

export const treeholeBookingRouter = Router();

const BOOKING_LOCK = -71005;
const ACTIVE_STATUSES = ["pending", "confirmed"];

const BEIJING_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function slotText(startAt: Date) {
  return BEIJING_FORMAT.format(startAt);
}

type BookingWithHost = Prisma.TreeholeBookingGetPayload<{ include: { host: { select: { id: true; hostCode: true; userId: true } } } }>;

function serializeBooking(booking: BookingWithHost, as: "visitor" | "host" | "admin", place: string, now = new Date()) {
  return {
    id: booking.id,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: bookingDisplayStatus(booking, now),
    place,
    note: booking.note,
    // 学生看到的是小艾绒编号；小艾绒和后台看到的是这次预约的虚拟 ID，不是实名。
    host: { id: booking.host.id, code: booking.host.hostCode || "", name: hostDisplayName(booking.host.hostCode) },
    alias: as === "visitor" ? null : booking.alias,
    rejectReason: booking.rejectReason,
    cancelledBy: booking.cancelledBy,
    cancelReason: booking.cancelReason,
    createdAt: booking.createdAt,
    decidedAt: booking.decidedAt,
    cancellable: ACTIVE_STATUSES.includes(booking.status) && booking.startAt > now,
  };
}

const HOST_SELECT = { select: { id: true, hostCode: true, userId: true } } as const;

async function ensureCanBook(viewer: TreeholeViewer) {
  await requireConsent(viewer.userId);
  const config = await loadTreeholeConfig(viewer.schoolId);
  const staffMember = viewer.isHost || viewer.isAdmin;
  if (!config.open && !staffMember) throw Errors.forbidden("树洞暂未开放，开放后会在这里通知大家");
  if (config.studentOnly && !staffMember) {
    const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { studentSso: true } });
    if (!user?.studentSso) throw Errors.forbidden("预约仅面向在校同学，请先用学校统一身份认证登录");
  }
  return config;
}

// 完整值班排班表 + 接下来两周每个 30 分钟档位是否还能约。不透露谁约了哪个档位。
treeholeBookingRouter.get("/schedule", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const config = await loadTreeholeConfig(viewer.schoolId);
    const now = new Date();
    const hosts = await prisma.treeholeStaff.findMany({
      where: { schoolId: viewer.schoolId, enabled: true, isHost: true, hostCode: { not: null } },
      include: { shifts: true },
      orderBy: { hostCode: "asc" },
    });
    const taken = await prisma.treeholeBooking.findMany({
      where: { schoolId: viewer.schoolId, status: { in: ACTIVE_STATUSES }, startAt: { gte: now } },
      select: { hostId: true, startAt: true },
    });
    const takenKeys = new Set(taken.map((row) => `${row.hostId}:${row.startAt.getTime()}`));
    ok(res, {
      slotMinutes: TREEHOLE_BOOKING_SLOT_MINUTES,
      days: TREEHOLE_BOOKING_DAYS,
      place: bookingPlaceOf(config),
      hosts: hosts.map((host) => ({
        id: host.id,
        code: host.hostCode || "",
        name: hostDisplayName(host.hostCode),
        intro: host.intro,
        online: presenceOf(host, now).online,
        mine: host.userId === viewer.userId,
        shifts: host.shifts
          .map((shift) => ({ weekday: shift.weekday, startMinute: shift.startMinute, endMinute: shift.endMinute }))
          .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
        slots: bookingSlots(host.shifts, now).map((slot) => ({
          startAt: slot.startAt,
          endAt: slot.endAt,
          available: !takenKeys.has(`${host.id}:${slot.startAt.getTime()}`),
        })),
      })),
    });
  } catch (error) {
    next(error);
  }
});

const createSchema = z.object({
  hostId: z.number().int().positive(),
  startAt: z.coerce.date(),
  note: z.string().trim().max(200, "说明最多 200 字").optional().default(""),
});

treeholeBookingRouter.post("/bookings", validate(createSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const body = req.body as z.infer<typeof createSchema>;
    const config = await ensureCanBook(viewer);
    const host = await prisma.treeholeStaff.findUnique({ where: { id: body.hostId }, include: { shifts: true } });
    if (!host || host.schoolId !== viewer.schoolId || !host.enabled || !host.isHost || !host.hostCode) throw Errors.badRequest("这位小艾绒暂时不能预约，请换一位");
    if (host.userId === viewer.userId) throw Errors.badRequest("不能预约自己");
    const now = new Date();
    if (!isBookableSlot(host.shifts, body.startAt, now)) throw Errors.badRequest("这个时间段已经不能预约了，请重新选择");
    takeTreeholeRate(`booking:${viewer.userId}`, 10, 24 * 60 * 60_000, "今天提交的预约有点多了");
    const endAt = new Date(body.startAt.getTime() + TREEHOLE_BOOKING_SLOT_MINUTES * 60_000);
    const booking = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK}::int, ${host.id}::int)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK - 1}::int, ${viewer.userId}::int)`;
      const slotTaken = await tx.treeholeBooking.findFirst({
        where: { hostId: host.id, startAt: body.startAt, status: { in: ACTIVE_STATUSES } },
        select: { id: true },
      });
      if (slotTaken) throw Errors.conflict("这个时间段刚刚被别的同学约走了，请换一个");
      const mine = await tx.treeholeBooking.findMany({
        where: { visitorId: viewer.userId, status: { in: ACTIVE_STATUSES }, endAt: { gt: now } },
        select: { startAt: true, endAt: true },
      });
      if (mine.length >= TREEHOLE_BOOKING_ACTIVE_LIMIT) throw Errors.conflict(`同时最多保留 ${TREEHOLE_BOOKING_ACTIVE_LIMIT} 个未完成的预约`);
      if (mine.some((row) => row.startAt < endAt && body.startAt < row.endAt)) throw Errors.conflict("你在这个时间已经有预约了");
      const created = await tx.treeholeBooking.create({
        data: {
          schoolId: viewer.schoolId,
          visitorId: viewer.userId,
          hostId: host.id,
          alias: generateVisitorAlias().replace("来访者", "预约同学"),
          startAt: body.startAt,
          endAt,
          note: body.note,
        },
        include: { host: HOST_SELECT },
      });
      await notifyTreehole([host.userId], {
        title: "收到一个线下倾诉预约",
        content: `有同学预约了 ${slotText(created.startAt)}，请在洞主工作台确认或拒绝。`,
        link: "/treehole/host?tab=bookings",
        type: "treehole-booking-new",
        level: "strong",
        extra: { bookingId: created.id },
      }, tx);
      return created;
    });
    ok(res, serializeBooking(booking, "visitor", bookingPlaceOf(config), now));
  } catch (error) {
    next(error);
  }
});

treeholeBookingRouter.get("/bookings/mine", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const config = await loadTreeholeConfig(viewer.schoolId);
    const rows = await prisma.treeholeBooking.findMany({
      where: { visitorId: viewer.userId, schoolId: viewer.schoolId },
      orderBy: { startAt: "desc" },
      take: 50,
      include: { host: HOST_SELECT },
    });
    const now = new Date();
    ok(res, rows.map((row) => serializeBooking(row, "visitor", bookingPlaceOf(config), now)));
  } catch (error) {
    next(error);
  }
});

treeholeBookingRouter.get("/host/bookings", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const config = await loadTreeholeConfig(viewer.schoolId);
    const now = new Date();
    const rows = await prisma.treeholeBooking.findMany({
      where: { hostId: staff.id, startAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      orderBy: { startAt: "asc" },
      take: 200,
      include: { host: HOST_SELECT },
    });
    const list = rows.map((row) => serializeBooking(row, "host", bookingPlaceOf(config), now));
    ok(res, {
      upcoming: list.filter((row) => row.status === "pending" || row.status === "confirmed"),
      past: list.filter((row) => row.status !== "pending" && row.status !== "confirmed").reverse(),
    });
  } catch (error) {
    next(error);
  }
});

async function loadBookingFor(id: number, viewer: TreeholeViewer) {
  const booking = await prisma.treeholeBooking.findUnique({ where: { id }, include: { host: HOST_SELECT } });
  if (!booking || booking.schoolId !== viewer.schoolId) throw Errors.notFound("预约不存在");
  const role = booking.visitorId === viewer.userId
    ? "visitor" as const
    : viewer.isHost && viewer.staff?.id === booking.hostId ? "host" as const : null;
  if (!role) throw Errors.notFound("预约不存在");
  return { booking, role };
}

async function transition(
  booking: TreeholeBooking,
  from: string[],
  data: Prisma.TreeholeBookingUpdateManyMutationInput,
  conflictMessage: string,
) {
  const updated = await prisma.treeholeBooking.updateMany({ where: { id: booking.id, status: { in: from } }, data });
  if (!updated.count) throw Errors.conflict(conflictMessage);
  return prisma.treeholeBooking.findUniqueOrThrow({ where: { id: booking.id }, include: { host: HOST_SELECT } });
}

treeholeBookingRouter.post("/bookings/:id/confirm", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { booking, role } = await loadBookingFor(parseTreeholeId(req.params.id, "预约编号"), viewer);
    if (role !== "host") throw Errors.forbidden("只有被预约的小艾绒可以确认");
    const now = new Date();
    if (booking.startAt <= now) throw Errors.badRequest("这个预约的时间已经过了");
    const updated = await transition(booking, ["pending"], { status: "confirmed", decidedAt: now }, "这个预约已经处理过了");
    const config = await loadTreeholeConfig(viewer.schoolId);
    await notifyTreehole([booking.visitorId], {
      title: "线下倾诉预约成功",
      content: `${hostDisplayName(booking.host.hostCode)} 确认了 ${slotText(booking.startAt)} 的预约，地点：${bookingPlaceOf(config)}。`,
      link: "/treehole/bookings",
      type: "treehole-booking-confirmed",
      level: "strong",
      extra: { bookingId: booking.id },
    });
    ok(res, serializeBooking(updated, "host", bookingPlaceOf(config), now));
  } catch (error) {
    next(error);
  }
});

const reasonSchema = z.object({ reason: z.string().trim().max(200, "原因最多 200 字").optional().default("") });

treeholeBookingRouter.post("/bookings/:id/reject", validate(reasonSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { booking, role } = await loadBookingFor(parseTreeholeId(req.params.id, "预约编号"), viewer);
    if (role !== "host") throw Errors.forbidden("只有被预约的小艾绒可以拒绝");
    if (req.body.reason.length < 2) throw Errors.badRequest("请简单说明原因，同学会看到");
    const now = new Date();
    const updated = await transition(booking, ["pending"], { status: "rejected", decidedAt: now, rejectReason: req.body.reason }, "这个预约已经处理过了");
    await notifyTreehole([booking.visitorId], {
      title: "线下倾诉预约未能接受",
      content: `${slotText(booking.startAt)} 的预约没能接受：${req.body.reason}。可以换个时间或换一位小艾绒再约。`,
      link: "/treehole/bookings",
      type: "treehole-booking-rejected",
      extra: { bookingId: booking.id },
    });
    const config = await loadTreeholeConfig(viewer.schoolId);
    ok(res, serializeBooking(updated, "host", bookingPlaceOf(config), now));
  } catch (error) {
    next(error);
  }
});

// 学生或小艾绒都能在开始前取消，对方会收到提醒。
treeholeBookingRouter.post("/bookings/:id/cancel", validate(reasonSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { booking, role } = await loadBookingFor(parseTreeholeId(req.params.id, "预约编号"), viewer);
    const now = new Date();
    if (booking.startAt <= now) throw Errors.badRequest("预约已经开始或结束，不能再取消");
    if (role === "host" && req.body.reason.length < 2) throw Errors.badRequest("请简单说明取消原因，同学会看到");
    const updated = await transition(
      booking,
      ACTIVE_STATUSES,
      { status: "cancelled", cancelledBy: role, cancelReason: req.body.reason || null, cancelledAt: now },
      "这个预约已经结束或取消了",
    );
    const when = slotText(booking.startAt);
    await notifyTreehole([role === "visitor" ? booking.host.userId : booking.visitorId], role === "visitor"
      ? {
        title: "线下倾诉预约已取消",
        content: `${booking.alias} 取消了 ${when} 的预约${req.body.reason ? `：${req.body.reason}` : ""}。`,
        link: "/treehole/host?tab=bookings",
        type: "treehole-booking-cancelled",
        extra: { bookingId: booking.id },
      }
      : {
        title: "线下倾诉预约被取消",
        content: `${hostDisplayName(booking.host.hostCode)} 取消了 ${when} 的预约：${req.body.reason}。可以换个时间再约。`,
        link: "/treehole/bookings",
        type: "treehole-booking-cancelled",
        level: "strong",
        extra: { bookingId: booking.id },
      });
    const config = await loadTreeholeConfig(viewer.schoolId);
    ok(res, serializeBooking(updated, role, bookingPlaceOf(config), now));
  } catch (error) {
    next(error);
  }
});

// ---- 后台：预约记录 ----

const adminListSchema = z.object({
  status: z.enum(["all", "pending", "confirmed", "done", "cancelled", "rejected", "expired"]).optional().default("all"),
  hostId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
});

treeholeBookingRouter.get("/admin/bookings", validate(adminListSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const query = req.query as unknown as z.infer<typeof adminListSchema>;
    const now = new Date();
    const statusWhere: Prisma.TreeholeBookingWhereInput = {
      all: {},
      pending: { status: "pending", startAt: { gt: now } },
      confirmed: { status: "confirmed", endAt: { gt: now } },
      done: { status: "confirmed", endAt: { lte: now } },
      cancelled: { status: "cancelled" },
      rejected: { status: "rejected" },
      expired: { status: "pending", startAt: { lte: now } },
    }[query.status];
    const where: Prisma.TreeholeBookingWhereInput = {
      schoolId: viewer.schoolId,
      ...statusWhere,
      ...(query.hostId ? { hostId: query.hostId } : {}),
    };
    const config = await loadTreeholeConfig(viewer.schoolId);
    const [total, rows] = await Promise.all([
      prisma.treeholeBooking.count({ where }),
      prisma.treeholeBooking.findMany({ where, orderBy: { startAt: "desc" }, take: 30, skip: (query.page - 1) * 30, include: { host: HOST_SELECT } }),
    ]);
    ok(res, { total, page: query.page, size: 30, list: rows.map((row) => serializeBooking(row, "admin", bookingPlaceOf(config), now)) });
  } catch (error) {
    next(error);
  }
});
