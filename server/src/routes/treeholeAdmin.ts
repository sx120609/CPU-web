import { getSchool } from "../schools/registry";
import { requestSchoolId } from "../schools/modules";
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  loadTreeholeConfig,
  notifyTreehole,
  parseTreeholeId,
  checkedHostNickname,
  presenceOf,
  syncHostRoomAlias,
  requireTreeholeAdmin,
  requireTreeholeStaffManager,
  saveTreeholeConfig,
  staffLabel,
  treeholeAdminUserIds,
  viewerOf,
  writeTreeholeAudit,
  type TreeholeViewer,
} from "../services/treehole";
import { listSessionSummaries } from "../services/treeholeSessions";
import {
  bookingDisplayStatus,
  hostDisplayName,
  normalizeHostCode,
  normalizeShifts,
  revealApprovalState,
  roomCategoryLabel,
  TREEHOLE_SESSION_MODES,
  TREEHOLE_SESSION_TAGS,
} from "../services/treeholePolicy";

// 树洞后台：核心管理员看会话、跟进高危工单、审批溯源、看统计和日志；人员任免站点管理员（运维）也能做。

export const treeholeAdminRouter = Router();

const REVEAL_LOCK = -71003;

/** 后台数据只取管理员本校的：会话带学校，工单、溯源经由会话归属学校。 */
const sessionsOfSchool = (schoolId: string) => ({ schoolId });
const casesOfSchool = (schoolId: string) => ({ session: sessionsOfSchool(schoolId) });
const revealsOfSchool = (schoolId: string) => ({ crisisCase: casesOfSchool(schoolId) });

treeholeAdminRouter.get("/overview", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeStaffManager(viewer);
    if (!viewer.isAdmin) {
      ok(res, { isAdmin: false, isSiteAdmin: viewer.isSiteAdmin, counts: null });
      return;
    }
    const [openCases, pendingReveals, activeSessions, activeRooms] = await Promise.all([
      prisma.treeholeCrisisCase.count({ where: { status: { not: "closed" }, ...casesOfSchool(viewer.schoolId) } }),
      prisma.treeholeRevealRequest.count({ where: { status: "pending", ...revealsOfSchool(viewer.schoolId) } }),
      prisma.treeholeSession.count({ where: { status: "active", ...sessionsOfSchool(viewer.schoolId) } }),
      prisma.treeholeRoom.count({ where: { status: "active", schoolId: viewer.schoolId } }),
    ]);
    ok(res, { isAdmin: true, isSiteAdmin: viewer.isSiteAdmin, counts: { openCases, pendingReveals, activeSessions, activeRooms } });
  } catch (error) {
    next(error);
  }
});

// ---- 会话日志 ----

const sessionListSchema = z.object({
  tag: z.enum(TREEHOLE_SESSION_TAGS).optional(),
  status: z.enum(["active", "ended"]).optional(),
  mode: z.enum(TREEHOLE_SESSION_MODES).optional(),
  hostId: z.coerce.number().int().positive().optional(),
  claim: z.enum(["unclaimed", "claimed", "replied"]).optional(),
  topic: z.string().trim().max(10).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
});

treeholeAdminRouter.get("/sessions", validate(sessionListSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const query = req.query as unknown as z.infer<typeof sessionListSchema>;
    const where: Prisma.TreeholeSessionWhereInput = {
      ...sessionsOfSchool(viewer.schoolId),
      ...(query.tag ? { tag: query.tag } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.hostId ? { hostId: query.hostId } : {}),
      ...(query.claim === "unclaimed" ? { hostId: null } : {}),
      ...(query.claim === "claimed" ? { hostId: { not: null }, firstReplyAt: null } : {}),
      ...(query.claim === "replied" ? { firstReplyAt: { not: null } } : {}),
      ...(query.topic ? { topics: { has: query.topic } } : {}),
    };
    const config = await loadTreeholeConfig(viewerOf(res).schoolId);
    const [total, list] = await Promise.all([
      prisma.treeholeSession.count({ where }),
      listSessionSummaries(where, "admin", config, { take: 30, skip: (query.page - 1) * 30 }),
    ]);
    ok(res, { total, page: query.page, size: 30, list });
  } catch (error) {
    next(error);
  }
});

// ---- 高危工单 ----

const caseListSchema = z.object({ status: z.enum(["open", "following", "closed", "unclosed", "all"]).optional().default("unclosed") });

async function staffLabels(ids: Array<number | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  const rows = unique.length
    ? await prisma.treeholeStaff.findMany({ where: { id: { in: unique } }, select: { id: true, hostCode: true, hostNickname: true, isHost: true, isAdmin: true, user: { select: { nickname: true } } } })
    : [];
  // 后台只有核心管理员能看，人员名单本来就对他们公开，这里带上昵称方便分清是谁。
  const map = new Map(rows.map((row) => [row.id, `${staffLabel(row)}（${row.user.nickname || "未设置昵称"}）`]));
  return (id: number | null | undefined) => (typeof id === "number" ? map.get(id) ?? "已移除的人员" : null);
}

treeholeAdminRouter.get("/cases", validate(caseListSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const query = req.query as unknown as z.infer<typeof caseListSchema>;
    const where: Prisma.TreeholeCrisisCaseWhereInput = {
      ...casesOfSchool(viewer.schoolId),
      ...(query.status === "all" ? {} : query.status === "unclosed" ? { status: { not: "closed" } } : { status: query.status }),
    };
    const cases = await prisma.treeholeCrisisCase.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: {
        session: { select: { id: true, alias: true, status: true, contact: true } },
        reveals: { select: { status: true } },
        _count: { select: { notes: true } },
      },
    });
    const label = await staffLabels(cases.map((row) => row.reporterId));
    ok(res, cases.map((row) => ({
      id: row.id,
      status: row.status,
      urgency: row.urgency,
      crisisType: row.crisisType,
      reporter: label(row.reporterId),
      session: row.session,
      hasContact: Boolean(row.session.contact),
      notes: row._count.notes,
      pendingReveal: row.reveals.some((reveal) => reveal.status === "pending"),
      revealed: row.reveals.some((reveal) => reveal.status === "approved"),
      createdAt: row.createdAt,
    })));
  } catch (error) {
    next(error);
  }
});

async function loadCaseDetail(caseId: number, viewer: TreeholeViewer) {
  const row = await prisma.treeholeCrisisCase.findFirst({
    where: { id: caseId, ...casesOfSchool(viewer.schoolId) },
    include: {
      session: { select: { id: true, alias: true, status: true, mode: true, contact: true, contactAt: true, createdAt: true, hostId: true } },
      notes: { orderBy: { createdAt: "asc" } },
      reveals: { orderBy: { id: "desc" }, include: { approvals: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!row) throw Errors.notFound("工单不存在");
  const label = await staffLabels([
    row.reporterId,
    row.session.hostId,
    ...row.notes.map((note) => note.authorId),
    ...row.reveals.flatMap((reveal) => [reveal.requesterId, reveal.rejectedById, ...reveal.approvals.map((approval) => approval.staffId)]),
  ]);
  const myStaffId = viewer.staff?.id ?? null;
  return {
    id: row.id,
    status: row.status,
    urgency: row.urgency,
    crisisType: row.crisisType,
    currentState: row.currentState,
    hostRecord: row.hostRecord,
    reporter: label(row.reporterId),
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    session: { ...row.session, host: label(row.session.hostId) },
    notes: row.notes.map((note) => ({ id: note.id, author: label(note.authorId), content: note.content, createdAt: note.createdAt })),
    reveals: row.reveals.map((reveal) => {
      const state = revealApprovalState(reveal.approvals.map((approval) => approval.staffId));
      return {
        id: reveal.id,
        status: reveal.status,
        reason: reveal.reason,
        requester: label(reveal.requesterId),
        approvals: reveal.approvals.map((approval) => ({ by: label(approval.staffId), at: approval.createdAt })),
        approvalCount: state.approvals,
        required: state.required,
        approvedByMe: myStaffId !== null && reveal.approvals.some((approval) => approval.staffId === myStaffId),
        rejectedBy: label(reveal.rejectedById),
        rejectReason: reveal.rejectReason,
        decidedAt: reveal.decidedAt,
        createdAt: reveal.createdAt,
      };
    }),
  };
}

treeholeAdminRouter.get("/cases/:id", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const caseId = parseTreeholeId(req.params.id, "工单编号");
    const detail = await loadCaseDetail(caseId, viewer);
    await writeTreeholeAudit({ actor: viewer, action: "case.view", targetType: "case", targetId: caseId });
    ok(res, detail);
  } catch (error) {
    next(error);
  }
});

async function notifyCaseReporter(caseId: number, content: string, store: Prisma.TransactionClient | typeof prisma = prisma) {
  const row = await store.treeholeCrisisCase.findUnique({ where: { id: caseId }, select: { reporterId: true, sessionId: true } });
  if (!row) return;
  const reporter = await store.treeholeStaff.findUnique({ where: { id: row.reporterId }, select: { userId: true, enabled: true } });
  if (!reporter?.enabled) return;
  await notifyTreehole([reporter.userId], {
    title: "你上报的高危会话有新的跟进",
    content,
    link: `/treehole/session/${row.sessionId}`,
    type: "treehole-crisis-update",
    extra: { caseId },
  }, store);
}

const noteSchema = z.object({ content: z.string().trim().min(2, "备注至少 2 个字").max(2000) });

treeholeAdminRouter.post("/cases/:id/notes", validate(noteSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeAdmin(viewer);
    const caseId = parseTreeholeId(req.params.id, "工单编号");
    await prisma.$transaction(async (tx) => {
      const row = await tx.treeholeCrisisCase.findFirst({ where: { id: caseId, ...casesOfSchool(viewer.schoolId) }, select: { id: true } });
      if (!row) throw Errors.notFound("工单不存在");
      await tx.treeholeCaseNote.create({ data: { caseId, authorId: staff.id, content: req.body.content } });
      await tx.treeholeCrisisCase.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
      await writeTreeholeAudit({ actor: viewer, action: "case.note", targetType: "case", targetId: caseId }, tx);
      await notifyCaseReporter(caseId, "核心管理员追加了跟进记录。", tx);
    });
    ok(res, await loadCaseDetail(caseId, viewer));
  } catch (error) {
    next(error);
  }
});

const caseStatusSchema = z.object({ status: z.enum(["open", "following", "closed"]) });

treeholeAdminRouter.patch("/cases/:id", validate(caseStatusSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const caseId = parseTreeholeId(req.params.id, "工单编号");
    await prisma.$transaction(async (tx) => {
      const row = await tx.treeholeCrisisCase.findFirst({ where: { id: caseId, ...casesOfSchool(viewer.schoolId) }, select: { status: true } });
      if (!row) throw Errors.notFound("工单不存在");
      await tx.treeholeCrisisCase.update({
        where: { id: caseId },
        data: { status: req.body.status, closedAt: req.body.status === "closed" ? new Date() : null },
      });
      await writeTreeholeAudit({ actor: viewer, action: "case.status", targetType: "case", targetId: caseId, detail: { from: row.status, to: req.body.status } }, tx);
      const label = req.body.status === "closed" ? "已结案" : req.body.status === "following" ? "跟进中" : "待处理";
      await notifyCaseReporter(caseId, `工单状态已更新为「${label}」。`, tx);
    });
    ok(res, await loadCaseDetail(caseId, viewer));
  } catch (error) {
    next(error);
  }
});

const revealSchema = z.object({ reason: z.string().trim().min(4, "请写明需要线下干预的理由").max(500) });

treeholeAdminRouter.post("/cases/:id/reveals", validate(revealSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeAdmin(viewer);
    const caseId = parseTreeholeId(req.params.id, "工单编号");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REVEAL_LOCK}::int, ${caseId}::int)`;
      const row = await tx.treeholeCrisisCase.findFirst({ where: { id: caseId, ...casesOfSchool(viewer.schoolId) }, include: { reveals: { select: { status: true } } } });
      if (!row) throw Errors.notFound("工单不存在");
      if (row.reveals.some((reveal) => reveal.status === "pending")) throw Errors.conflict("已有一份溯源申请在等待审批");
      if (row.reveals.some((reveal) => reveal.status === "approved")) throw Errors.conflict("这张工单已经完成实名溯源");
      const request = await tx.treeholeRevealRequest.create({ data: { caseId, requesterId: staff.id, reason: req.body.reason } });
      // 管理员提交时本人算第一票，还需要另一名核心管理员同意。
      await tx.treeholeRevealApproval.create({ data: { requestId: request.id, staffId: staff.id } });
      await writeTreeholeAudit({ actor: viewer, action: "reveal.request", targetType: "case", targetId: caseId, detail: { requestId: request.id, reason: req.body.reason } }, tx);
      const others = (await treeholeAdminUserIds(tx)).filter((id) => id !== viewer.userId);
      await notifyTreehole(others, {
        title: "树洞实名溯源审批申请",
        content: "一张高危工单申请实名溯源，需要你审批。",
        link: `/treehole/admin?tab=cases&case=${caseId}`,
        type: "treehole-reveal-request",
        level: "strong",
        extra: { caseId, requestId: request.id },
      }, tx);
    });
    ok(res, await loadCaseDetail(caseId, viewer));
  } catch (error) {
    next(error);
  }
});

treeholeAdminRouter.post("/reveals/:id/approve", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeAdmin(viewer);
    const requestId = parseTreeholeId(req.params.id, "申请编号");
    const caseId = await prisma.$transaction(async (tx) => {
      const request = await tx.treeholeRevealRequest.findFirst({ where: { id: requestId, ...revealsOfSchool(viewer.schoolId) }, select: { caseId: true } });
      if (!request) throw Errors.notFound("溯源申请不存在");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REVEAL_LOCK}::int, ${request.caseId}::int)`;
      const fresh = await tx.treeholeRevealRequest.findUniqueOrThrow({ where: { id: requestId }, include: { approvals: true } });
      if (fresh.status !== "pending") throw Errors.conflict("这份申请已经处理过了");
      if (fresh.approvals.some((approval) => approval.staffId === staff.id)) throw Errors.conflict("你已经同意过了，需要另一名核心管理员审批");
      await tx.treeholeRevealApproval.create({ data: { requestId, staffId: staff.id } });
      const state = revealApprovalState([...fresh.approvals.map((approval) => approval.staffId), staff.id]);
      if (state.approved) {
        await tx.treeholeRevealRequest.update({ where: { id: requestId }, data: { status: "approved", decidedAt: new Date() } });
        await notifyTreehole(await treeholeAdminUserIds(tx), {
          title: "实名溯源已获批准",
          content: "一份溯源申请已由两名核心管理员批准，可在工单里查看来访者信息。查看会记入日志。",
          link: `/treehole/admin?tab=cases&case=${fresh.caseId}`,
          type: "treehole-reveal-approved",
          level: "strong",
          extra: { caseId: fresh.caseId, requestId },
        }, tx);
      }
      await writeTreeholeAudit({ actor: viewer, action: state.approved ? "reveal.approve.final" : "reveal.approve", targetType: "case", targetId: fresh.caseId, detail: { requestId, approvals: state.approvals } }, tx);
      return fresh.caseId;
    });
    ok(res, await loadCaseDetail(caseId, viewer));
  } catch (error) {
    next(error);
  }
});

const rejectSchema = z.object({ reason: z.string().trim().min(2, "请写明不同意的理由").max(500) });

treeholeAdminRouter.post("/reveals/:id/reject", validate(rejectSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeAdmin(viewer);
    const requestId = parseTreeholeId(req.params.id, "申请编号");
    const caseId = await prisma.$transaction(async (tx) => {
      const request = await tx.treeholeRevealRequest.findFirst({ where: { id: requestId, ...revealsOfSchool(viewer.schoolId) } });
      if (!request) throw Errors.notFound("溯源申请不存在");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REVEAL_LOCK}::int, ${request.caseId}::int)`;
      const updated = await tx.treeholeRevealRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: "rejected", decidedAt: new Date(), rejectedById: staff.id, rejectReason: req.body.reason },
      });
      if (!updated.count) throw Errors.conflict("这份申请已经处理过了");
      await writeTreeholeAudit({ actor: viewer, action: "reveal.reject", targetType: "case", targetId: request.caseId, detail: { requestId, reason: req.body.reason } }, tx);
      return request.caseId;
    });
    ok(res, await loadCaseDetail(caseId, viewer));
  } catch (error) {
    next(error);
  }
});

treeholeAdminRouter.get("/reveals/:id/identity", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const requestId = parseTreeholeId(req.params.id, "申请编号");
    const request = await prisma.treeholeRevealRequest.findFirst({
      where: { id: requestId, ...revealsOfSchool(viewer.schoolId) },
      include: { crisisCase: { select: { id: true, session: { select: { visitorId: true } } } } },
    });
    if (!request || request.status !== "approved") throw Errors.forbidden("只有获得双人审批的溯源申请才能查看实名信息");
    const user = await prisma.user.findUnique({
      where: { id: request.crisisCase.session.visitorId },
      select: { username: true, nickname: true, studentSso: true, college: true, enrollYear: true, email: true, status: true, lastLoginAt: true, createdAt: true },
    });
    if (!user) throw Errors.notFound("账号不存在");
    await writeTreeholeAudit({ actor: viewer, action: "reveal.view", targetType: "case", targetId: request.crisisCase.id, detail: { requestId } });
    const deleted = user.status === "deleted" || user.status === "deleting";
    ok(res, {
      deleted,
      studentId: deleted ? null : user.username,
      studentVerified: user.studentSso,
      nickname: deleted ? null : user.nickname,
      college: user.college,
      enrollYear: user.enrollYear,
      email: deleted ? null : user.email,
      lastLoginAt: user.lastLoginAt,
      registeredAt: user.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

// ---- 人员与排班 ----

function serializeStaff(staff: Prisma.TreeholeStaffGetPayload<{ include: { shifts: true; user: { select: { id: true; username: true; nickname: true; status: true } } } }>) {
  const presence = presenceOf(staff);
  return {
    id: staff.id,
    user: staff.user,
    isHost: staff.isHost,
    isAdmin: staff.isAdmin,
    hostCode: staff.hostCode,
    hostNickname: staff.hostNickname,
    name: staff.isHost && staff.hostCode ? hostDisplayName(staff.hostCode, staff.hostNickname) : null,
    intro: staff.intro,
    enabled: staff.enabled,
    online: presence.online,
    presenceSource: presence.source,
    shifts: staff.shifts
      .map((shift) => ({ weekday: shift.weekday, startMinute: shift.startMinute, endMinute: shift.endMinute }))
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
    createdAt: staff.createdAt,
  };
}

const STAFF_INCLUDE = { shifts: true, user: { select: { id: true, username: true, nickname: true, status: true } } } as const;

treeholeAdminRouter.get("/staff", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeStaffManager(viewer);
    const rows = await prisma.treeholeStaff.findMany({ where: { schoolId: viewer.schoolId }, include: STAFF_INCLUDE, orderBy: [{ enabled: "desc" }, { hostCode: "asc" }, { id: "asc" }] });
    ok(res, rows.map(serializeStaff));
  } catch (error) {
    next(error);
  }
});

/** 洞主编号同校内唯一，各校都从 01 排起。 */
async function freeHostCode(tx: Prisma.TransactionClient, schoolId: string) {
  const used = new Set((await tx.treeholeStaff.findMany({ where: { schoolId, hostCode: { not: null } }, select: { hostCode: true } })).map((row) => row.hostCode));
  for (let code = 1; code <= 99; code += 1) {
    const value = String(code).padStart(2, "0");
    if (!used.has(value)) return value;
  }
  throw Errors.badRequest("洞主编号 01 到 99 已经用完");
}

async function ensureAdminRemains(tx: Prisma.TransactionClient, viewer: TreeholeViewer, changingStaffId: number) {
  if (viewer.isSiteAdmin) return;
  const others = await tx.treeholeStaff.count({ where: { schoolId: viewer.schoolId, enabled: true, isAdmin: true, id: { not: changingStaffId } } });
  if (!others) throw Errors.badRequest("至少要保留一名在任的核心管理员");
}

const createStaffSchema = z.object({
  username: z.string().trim().min(1, "请填写学号或用户名").max(64),
  isHost: z.boolean(),
  isAdmin: z.boolean(),
  hostCode: z.string().trim().max(2).optional().default(""),
});

treeholeAdminRouter.post("/staff", validate(createStaffSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeStaffManager(viewer);
    const body = req.body as z.infer<typeof createStaffSchema>;
    if (!body.isHost && !body.isAdmin) throw Errors.badRequest("请至少选择洞主或核心管理员中的一项");
    const user = await prisma.user.findUnique({
      where: { schoolId_username: { schoolId: viewer.schoolId, username: body.username } },
      select: { id: true, status: true, role: true },
    });
    if (!user || ["deleted", "deleting", "banned"].includes(user.status) || user.role === "bot") throw Errors.notFound(`没有找到这个账号，请对方先登录一次${getSchool(requestSchoolId(req)).brandName}`);
    const staff = await prisma.$transaction(async (tx) => {
      const existing = await tx.treeholeStaff.findUnique({ where: { userId: user.id } });
      const hostCode = body.isHost
        ? (body.hostCode ? normalizeHostCode(body.hostCode) : existing?.hostCode || await freeHostCode(tx, viewer.schoolId))
        : existing?.hostCode ?? null;
      const data = { schoolId: viewer.schoolId, isHost: body.isHost, isAdmin: body.isAdmin, hostCode, enabled: true };
      const saved = existing
        ? await tx.treeholeStaff.update({ where: { id: existing.id }, data, include: STAFF_INCLUDE })
        : await tx.treeholeStaff.create({ data: { userId: user.id, ...data }, include: STAFF_INCLUDE });
      await writeTreeholeAudit({ actor: viewer, action: "staff.appoint", targetType: "staff", targetId: saved.id, detail: { userId: user.id, isHost: body.isHost, isAdmin: body.isAdmin, hostCode } }, tx);
      return saved;
    });
    ok(res, serializeStaff(staff));
  } catch (error) {
    if ((error as any)?.code === "P2002") {
      next(Errors.conflict("这个洞主编号已经有人在用"));
      return;
    }
    next(error);
  }
});

const updateStaffSchema = z.object({
  isHost: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  hostCode: z.string().trim().max(2).optional(),
  enabled: z.boolean().optional(),
  intro: z.string().trim().max(80).optional(),
  hostNickname: z.string().max(40).optional(),
});

treeholeAdminRouter.patch("/staff/:id", validate(updateStaffSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeStaffManager(viewer);
    const body = req.body as z.infer<typeof updateStaffSchema>;
    const staffId = parseTreeholeId(req.params.id, "人员编号");
    const staff = await prisma.$transaction(async (tx) => {
      const existing = await tx.treeholeStaff.findFirst({ where: { id: staffId, schoolId: viewer.schoolId } });
      if (!existing) throw Errors.notFound("人员不存在");
      const losingAdmin = existing.isAdmin && existing.enabled && (body.isAdmin === false || body.enabled === false);
      if (losingAdmin) await ensureAdminRemains(tx, viewer, staffId);
      const isHost = body.isHost ?? existing.isHost;
      let hostCode = existing.hostCode;
      if (body.hostCode !== undefined && body.hostCode !== "") hostCode = normalizeHostCode(body.hostCode);
      if (isHost && !hostCode) hostCode = await freeHostCode(tx, viewer.schoolId);
      const hostNickname = body.hostNickname !== undefined ? await checkedHostNickname(tx, viewer.schoolId, staffId, body.hostNickname) : undefined;
      const saved = await tx.treeholeStaff.update({
        where: { id: staffId },
        data: {
          isHost,
          isAdmin: body.isAdmin ?? existing.isAdmin,
          hostCode,
          enabled: body.enabled ?? existing.enabled,
          ...(body.intro !== undefined ? { intro: body.intro } : {}),
          ...(hostNickname !== undefined ? { hostNickname } : {}),
          ...(body.enabled === false ? { presenceOverride: null, presenceOverrideUntil: null } : {}),
        },
        include: STAFF_INCLUDE,
      });
      if (hostNickname !== undefined || hostCode !== existing.hostCode) await syncHostRoomAlias(tx, saved);
      await writeTreeholeAudit({ actor: viewer, action: "staff.update", targetType: "staff", targetId: staffId, detail: { ...body, hostCode } }, tx);
      return saved;
    });
    ok(res, serializeStaff(staff));
  } catch (error) {
    if ((error as any)?.code === "P2002") {
      next(Errors.conflict("这个洞主编号已经有人在用"));
      return;
    }
    next(error);
  }
});

const shiftsSchema = z.object({
  shifts: z.array(z.object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })).max(42),
});

treeholeAdminRouter.put("/staff/:id/shifts", validate(shiftsSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeStaffManager(viewer);
    const staffId = parseTreeholeId(req.params.id, "人员编号");
    let shifts;
    try {
      shifts = normalizeShifts(req.body.shifts);
    } catch (error) {
      throw Errors.badRequest((error as Error).message);
    }
    const staff = await prisma.$transaction(async (tx) => {
      const existing = await tx.treeholeStaff.findFirst({ where: { id: staffId, schoolId: viewer.schoolId } });
      if (!existing) throw Errors.notFound("人员不存在");
      await tx.treeholeShift.deleteMany({ where: { staffId } });
      if (shifts.length) await tx.treeholeShift.createMany({ data: shifts.map((shift) => ({ staffId, ...shift })) });
      await writeTreeholeAudit({ actor: viewer, action: "staff.shifts", targetType: "staff", targetId: staffId, detail: { count: shifts.length } }, tx);
      return tx.treeholeStaff.findUniqueOrThrow({ where: { id: staffId }, include: STAFF_INCLUDE });
    });
    ok(res, serializeStaff(staff));
  } catch (error) {
    next(error);
  }
});

// ---- 宣泄室 ----

treeholeAdminRouter.get("/rooms", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const rooms = await prisma.treeholeRoom.findMany({
      where: { schoolId: viewer.schoolId },
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
      include: {
        members: { where: { status: "active" }, select: { role: true } },
        proposal: { select: { proposerId: true, signatures: { select: { staffId: true } } } },
        _count: { select: { messages: true } },
      },
    });
    const label = await staffLabels(rooms.flatMap((room) => [room.createdById, ...(room.proposal?.signatures.map((sig) => sig.staffId) ?? [])]));
    ok(res, rooms.map((room) => ({
      id: room.id,
      name: room.name,
      category: room.category,
      categoryLabel: roomCategoryLabel(room.category),
      intro: room.intro,
      status: room.status,
      closeReason: room.closeReason,
      closedAt: room.closedAt,
      createdAt: room.createdAt,
      lastMessageAt: room.lastMessageAt,
      visitorCount: room.members.filter((member) => member.role === "visitor").length,
      hostCount: room.members.filter((member) => member.role === "host").length,
      founders: room.createdById ? [label(room.createdById)] : room.proposal?.signatures.map((sig) => label(sig.staffId)) ?? [],
      messageCount: room._count.messages,
    })));
  } catch (error) {
    next(error);
  }
});

// ---- 统计 ----

const statsSchema = z.object({ days: z.coerce.number().int().min(1).max(366).optional().default(30) });

function shanghaiDateKey(date: Date) {
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

treeholeAdminRouter.get("/stats", validate(statsSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const { days } = req.query as unknown as z.infer<typeof statsSchema>;
    const since = new Date(Date.now() - days * 86_400_000);
    const [sessions, cases, openCases, activeSessions, hosts, rooms, roomMessages, bookings] = await Promise.all([
      prisma.treeholeSession.findMany({ where: { createdAt: { gte: since }, ...sessionsOfSchool(viewer.schoolId) }, select: { createdAt: true, mode: true, tag: true, hostId: true, status: true, topics: true, firstReplyAt: true } }),
      prisma.treeholeCrisisCase.findMany({ where: { createdAt: { gte: since }, ...casesOfSchool(viewer.schoolId) }, select: { urgency: true, status: true } }),
      prisma.treeholeCrisisCase.count({ where: { status: { not: "closed" }, ...casesOfSchool(viewer.schoolId) } }),
      prisma.treeholeSession.count({ where: { status: "active", ...sessionsOfSchool(viewer.schoolId) } }),
      prisma.treeholeStaff.findMany({ where: { schoolId: viewer.schoolId, isHost: true, hostCode: { not: null } }, include: { shifts: true } }),
      prisma.treeholeRoom.findMany({ where: { schoolId: viewer.schoolId }, select: { id: true, name: true, category: true, status: true, members: { where: { status: "active", role: "visitor" }, select: { id: true } } } }),
      prisma.treeholeRoomMessage.groupBy({ by: ["roomId"], where: { createdAt: { gte: since }, kind: { not: "notice" }, room: { schoolId: viewer.schoolId } }, _count: { _all: true } }),
      prisma.treeholeBooking.findMany({ where: { schoolId: viewer.schoolId, startAt: { gte: since } }, select: { hostId: true, status: true, startAt: true, endAt: true } }),
    ]);
    const byHost = new Map<number, number>();
    const bookingsByHost = new Map<number, number>();
    const byTopic = new Map<string, number>();
    const daily = new Map<string, number>();
    for (const session of sessions) {
      if (session.hostId !== null) byHost.set(session.hostId, (byHost.get(session.hostId) ?? 0) + 1);
      for (const topic of session.topics.length ? session.topics : ["未标注"]) byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
      const key = shanghaiDateKey(session.createdAt);
      daily.set(key, (daily.get(key) ?? 0) + 1);
    }
    const dailySeries = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = shanghaiDateKey(new Date(Date.now() - i * 86_400_000));
      dailySeries.push({ date: key, sessions: daily.get(key) ?? 0 });
    }
    const roomActivity = new Map(roomMessages.map((row) => [row.roomId, row._count._all]));
    const now = new Date();
    const bookingStates = bookings.map((booking) => bookingDisplayStatus(booking, now));
    for (const booking of bookings) {
      if (booking.status === "confirmed") bookingsByHost.set(booking.hostId, (bookingsByHost.get(booking.hostId) ?? 0) + 1);
    }
    ok(res, {
      days,
      sessions: {
        total: sessions.length,
        async: sessions.filter((session) => session.mode === "async").length,
        live: sessions.filter((session) => session.mode === "live").length,
        unclaimed: sessions.filter((session) => session.hostId === null && session.status === "active").length,
        replied: sessions.filter((session) => session.firstReplyAt !== null).length,
        focus: sessions.filter((session) => session.tag === "focus").length,
        crisis: sessions.filter((session) => session.tag === "crisis").length,
        ended: sessions.filter((session) => session.status === "ended").length,
        activeNow: activeSessions,
      },
      cases: {
        total: cases.length,
        urgent: cases.filter((row) => row.urgency === "urgent").length,
        high: cases.filter((row) => row.urgency === "high").length,
        openNow: openCases,
      },
      hosts: hosts
        .map((host) => ({
          code: host.hostCode,
          name: hostDisplayName(host.hostCode, host.hostNickname),
          enabled: host.enabled,
          online: presenceOf(host, now).online,
          sessions: byHost.get(host.id) ?? 0,
          bookings: bookingsByHost.get(host.id) ?? 0,
        }))
        .sort((a, b) => String(a.code).localeCompare(String(b.code))),
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        categoryLabel: roomCategoryLabel(room.category),
        status: room.status,
        members: room.members.length,
        messages: roomActivity.get(room.id) ?? 0,
      })).sort((a, b) => b.messages - a.messages),
      topics: [...byTopic.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count),
      bookings: {
        total: bookings.length,
        pending: bookingStates.filter((state) => state === "pending").length,
        confirmed: bookingStates.filter((state) => state === "confirmed" || state === "done").length,
        done: bookingStates.filter((state) => state === "done").length,
        cancelled: bookingStates.filter((state) => state === "cancelled" || state === "rejected" || state === "expired").length,
      },
      daily: dailySeries,
    });
  } catch (error) {
    next(error);
  }
});

// ---- 操作日志 ----

const auditSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  action: z.string().trim().max(40).optional(),
});

treeholeAdminRouter.get("/audit", validate(auditSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const query = req.query as unknown as z.infer<typeof auditSchema>;
    const where: Prisma.TreeholeAuditLogWhereInput = { schoolId: viewer.schoolId, ...(query.action ? { action: { startsWith: query.action } } : {}) };
    const [total, rows] = await Promise.all([
      prisma.treeholeAuditLog.count({ where }),
      prisma.treeholeAuditLog.findMany({ where, orderBy: { id: "desc" }, take: 50, skip: (query.page - 1) * 50 }),
    ]);
    ok(res, {
      total,
      page: query.page,
      size: 50,
      list: rows.map((row) => {
        let detail: unknown = {};
        try { detail = JSON.parse(row.detail); } catch { detail = {}; }
        return { ...row, detail };
      }),
    });
  } catch (error) {
    next(error);
  }
});

// ---- 设置 ----

treeholeAdminRouter.get("/config", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    ok(res, await loadTreeholeConfig(viewerOf(res).schoolId));
  } catch (error) {
    next(error);
  }
});

const configSchema = z.object({
  open: z.boolean(),
  studentOnly: z.boolean(),
  centerName: z.string().max(40),
  centerHotline: z.string().max(120),
  centerLocation: z.string().max(120),
  centerHours: z.string().max(120),
  crisisGuide: z.string().max(400),
  emergencyNote: z.string().max(200),
  bookingPlace: z.string().max(120).optional().default(""),
  roomRules: z.string().max(1000).optional().default(""),
});

treeholeAdminRouter.put("/config", validate(configSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    requireTreeholeAdmin(viewer);
    const before = await loadTreeholeConfig(viewerOf(res).schoolId);
    const saved = await saveTreeholeConfig(req.body, viewer.schoolId);
    const changed = Object.keys(saved).filter((key) => (saved as any)[key] !== (before as any)[key]);
    await writeTreeholeAudit({ actor: viewer, action: "config.update", targetType: "config", detail: { changed, open: saved.open } });
    ok(res, saved);
  } catch (error) {
    next(error);
  }
});
