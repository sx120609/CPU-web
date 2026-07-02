import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { validate } from "../middleware/validate";
import { detectLoginClient } from "../utils/loginClient";

export const messageRouter = Router();

function safeJson(value: string | null | undefined) {
  if (!value) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

const notificationTargetClients = ["ios", "android", "harmony", "web"] as const;

function effectiveMessageClient(client: string) {
  return client === "unknown" ? "web" : client;
}

function parseNotificationTargets(value?: string | null) {
  if (!value || value === "all") return null;
  const allowed = new Set<string>(notificationTargetClients);
  const targets = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return targets.length ? new Set(targets) : null;
}

function notificationVisibleToClient(notification: { targetClient?: string | null }, client: string) {
  const targets = parseNotificationTargets(notification.targetClient);
  if (!targets) return true;
  return targets.has(effectiveMessageClient(client));
}

function notificationTargetClientWhere(client: string) {
  const target = effectiveMessageClient(client);
  return {
    OR: [
      { targetClient: null },
      { targetClient: "all" },
      { targetClient: target },
      { targetClient: { startsWith: `${target},` } },
      { targetClient: { endsWith: `,${target}` } },
      { targetClient: { contains: `,${target},` } },
    ],
  };
}

messageRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const category = req.query.category ? String(req.query.category) : undefined;
    const client = detectLoginClient(req).client;
    const [list, reads] = await Promise.all([
      prisma.notification.findMany({
        where: {
          AND: [
            { OR: [{ userId }, { userId: null }] },
            category ? { category } : {},
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.notificationRead.findMany({ where: { userId } }),
    ]);
    const readSet = new Map<number, Date>();
    reads.forEach((r) => readSet.set(r.notificationId, r.readAt));
    ok(res, list.filter((n) => notificationVisibleToClient(n, client)).map((n) => ({
      ...n,
      payload: safeJson((n as any).payload),
      readAt: n.userId === null ? readSet.get(n.id) ?? null : n.readAt,
    })));
  } catch (e) { next(e); }
});

messageRouter.post("/:id/read", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    const client = detectLoginClient(req).client;
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n) throw Errors.notFound();
    if (!notificationVisibleToClient(n, client)) throw Errors.forbidden("该通知仅对当前客户端可见");
    if (n.userId === null) {
      const r = await prisma.notificationRead.upsert({
        where: { userId_notificationId: { userId, notificationId: id } },
        create: { userId, notificationId: id },
        update: { readAt: new Date() },
      });
      return ok(res, { ...n, payload: safeJson((n as any).payload), readAt: r.readAt });
    }
    if (n.userId !== userId) throw Errors.forbidden();
    const u = await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    ok(res, { ...u, payload: safeJson((u as any).payload) });
  } catch (e) { next(e); }
});

messageRouter.post("/read-all", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const client = detectLoginClient(req).client;
    const now = new Date();
    await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...notificationTargetClientWhere(client),
      },
      data: { readAt: now },
    });
    const globals = await prisma.notification.findMany({
      where: {
        userId: null,
        ...notificationTargetClientWhere(client),
      },
      select: { id: true },
    });
    if (globals.length) {
      const existing = await prisma.notificationRead.findMany({
        where: { userId, notificationId: { in: globals.map((g) => g.id) } },
        select: { notificationId: true },
      });
      const existingSet = new Set(existing.map((e) => e.notificationId));
      const toCreate = globals.filter((g) => !existingSet.has(g.id)).map((g) => ({ userId, notificationId: g.id, readAt: now }));
      if (toCreate.length) await prisma.notificationRead.createMany({ data: toCreate });
    }
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

messageRouter.get("/settings", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    let s = await prisma.messageSetting.findUnique({ where: { userId } });
    if (!s) s = await prisma.messageSetting.create({ data: { userId } });
    ok(res, s);
  } catch (e) { next(e); }
});

messageRouter.patch(
  "/settings",
  validate(z.object({
    quietStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    quietEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    qqBotNotifyEnabled: z.boolean().optional(),
    subscribeReply: z.boolean().optional(),
    subscribeLike: z.boolean().optional(),
    subscribeSchool: z.boolean().optional(),
    subscribeSystem: z.boolean().optional(),
  })),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId;
      let s = await prisma.messageSetting.findUnique({ where: { userId } });
      if (!s) s = await prisma.messageSetting.create({ data: { userId, ...req.body } });
      else s = await prisma.messageSetting.update({ where: { userId }, data: req.body });
      ok(res, s);
    } catch (e) { next(e); }
  }
);
