import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { getApnsConfig } from "./apnsConfig";
import { appleReferenceSeconds, sendLiveActivityPayload } from "./apnsClient";
import { LIVE_ACTIVITY_WINDOWS } from "./liveActivityWindows";

const PURPOSE = "live-activity-start-token";
const EVENT = "hybrid-start-v1";
const DAY = 86400;
export type StartWindow = { dateKey: string; window: string; start: number; end: number };
function tokenHash(token: unknown) {
  if (typeof token !== "string" || !/^(?:[a-fA-F0-9]{2}){16,256}$/.test(token)) throw new Error("启动 token 无效");
  return crypto.createHash("sha256").update(token.toLowerCase()).digest("hex");
}
export function parseStartWindows(raw: unknown, lead: unknown, now = Date.now() / 1000) {
  if (!Number.isInteger(lead) || Number(lead) < 0 || Number(lead) > 60) throw new Error("提前量必须为 0–60 分钟的整数");
  if (!Array.isArray(raw) || raw.length > 1110) throw new Error("启动计划最多包含 370 天的三个时段");
  const seen = new Set<string>();
  return raw.map((item): StartWindow => {
    if (!item || typeof item !== "object") throw new Error("启动时段无效");
    const { dateKey, window, start, end } = item;
    const definition = LIVE_ACTIVITY_WINDOWS.find(w => w.id === window);
    if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !definition
      || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error("启动时段无效");
    const midnight = Date.parse(`${dateKey}T00:00:00+08:00`) / 1000;
    const hour = (start - midnight) / 3600;
    if (!Number.isFinite(midnight) || new Date((midnight + 8 * 3600) * 1000).toISOString().slice(0, 10) !== dateKey || hour < definition.startHour || hour >= definition.endHour
      || start < now - DAY || start > now + 370 * DAY || end <= start
      || end > midnight + DAY || end - (start - Number(lead) * 60) >= 8 * 3600) throw new Error("时段日期、时间或活动时长无效");
    const key = `${dateKey}:${window}`;
    if (seen.has(key)) throw new Error("同一天同一时段只能启动一次");
    seen.add(key);
    // Whitelist fields: no course names, arbitrary APNs payloads or channel IDs.
    return { dateKey, window, start, end };
  }).sort((a, b) => a.start - b.start);
}
async function lock(tx: Prisma.TransactionClient, hash: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 7419))::text`;
}
export async function syncRemoteStarts(userId: number, input: any) {
  const hash = tokenHash(input?.token);
  if (!["sandbox", "production"].includes(input.environment)) throw new Error("APNs 环境无效");
  const config = await getApnsConfig();
  if (!config.configured || input.bundleID !== config.bundleID) throw new Error("APNs 未配置或 Bundle ID 不匹配");
  const windows = parseStartWindows(input.items, input.leadMinutes);
  const digest = crypto.createHash("sha256").update(JSON.stringify([input.leadMinutes, windows, input.environment, input.bundleID])).digest("hex");
  let replacement: { id: string; userId: number; hash: string } | undefined;
  if (input.replaces) {
    if (typeof input.replaces !== "string" || input.replaces.length > 4096) throw new Error("设备凭据无效");
    replacement = decryptJwxtSensitiveJson<typeof replacement>("live-activity-revoke", "v1", input.replaces).value;
    if (replacement?.userId !== userId) throw new Error("设备凭据不属于当前账号");
  }
  return prisma.$transaction(async tx => {
    for (const key of [...new Set([hash, ...(replacement ? [replacement.hash] : [])])].sort()) await lock(tx, key);
    const previous = await tx.liveActivityDevice.findUnique({ where: { startTokenHash: hash } });
    if (previous && previous.userId !== userId) await tx.liveActivityDevice.delete({ where: { id: previous.id } });
    const rotating = !previous && replacement
      ? await tx.liveActivityDevice.findFirst({ where: { id: replacement.id, userId, startTokenHash: replacement.hash } }) : null;
    const tokenData = { startTokenHash: hash, startTokenCiphertext: encryptJwxtSensitiveJson(PURPOSE, hash, { token: input.token.toLowerCase() }), enabled: true, environment: input.environment, bundleID: input.bundleID, broadcastEnabled: true };
    const device = rotating ? await tx.liveActivityDevice.update({ where: { id: rotating.id }, data: tokenData }) : await tx.liveActivityDevice.upsert({
      where: { startTokenHash: hash },
      create: { userId, startTokenHash: hash, startTokenCiphertext: encryptJwxtSensitiveJson(PURPOSE, hash, { token: input.token.toLowerCase() }), environment: input.environment, bundleID: input.bundleID, broadcastEnabled: true },
      update: { enabled: true, environment: input.environment, bundleID: input.bundleID, broadcastEnabled: true },
    });
    if (device.planDigest !== digest) {
      // Keep completed identities so changing the lead time/reopening cannot restart today's activity.
      await tx.liveActivityPlan.deleteMany({ where: { deviceId: device.id, state: "pending" } });
      const now = Date.now() / 1000;
      const rows = windows.filter(w => w.end > now).map(w => ({
        deviceId: device.id, itemID: `${EVENT}:${w.dateKey}:${w.window}`, event: EVENT,
        fireAt: new Date(Math.max(now, w.start - input.leadMinutes * 60) * 1000),
        expiresAt: new Date(Math.min(w.end, Math.max(w.start + 60, Math.max(now, w.start - input.leadMinutes * 60) + 300)) * 1000),
        payload: JSON.stringify(w),
      }));
      if (rows.length) await tx.liveActivityPlan.createMany({ data: rows, skipDuplicates: true });
      await tx.liveActivityDevice.update({ where: { id: device.id }, data: { planDigest: digest, lastError: null } });
    }
    // Revocation also works after the website login cookie has been cleared.
    const revoke = encryptJwxtSensitiveJson("live-activity-revoke", "v1", { id: device.id, userId, hash });
    return { deviceID: device.id, revoke, scheduledThrough: windows.at(-1)?.dateKey ?? null,
      missingWindows: LIVE_ACTIVITY_WINDOWS.filter(w => !config.channels[`${input.environment}:cpu-${w.id}`]).map(w => w.id) };
  }, { timeout: 20000 });
}
export async function revokeRemoteStarts(capability: unknown) {
  if (typeof capability !== "string" || capability.length > 4096) throw new Error("撤销凭据无效");
  const { value } = decryptJwxtSensitiveJson<{ id: string; userId: number; hash: string }>("live-activity-revoke", "v1", capability);
  await prisma.$transaction(async tx => {
    await lock(tx, value.hash);
    // Account transfers create a new id, so an old account cannot revoke the new one.
    await tx.liveActivityDevice.deleteMany({ where: { id: value.id, userId: value.userId, startTokenHash: value.hash } });
  });
}
export function remoteStartPayload(window: StartWindow, channel: string, now: number) {
  return { aps: {
    timestamp: Math.floor(now), event: "start", "input-push-channel": channel,
    "attributes-type": "ScheduleLiveActivityAttributes",
    attributes: { semester: "", week: 0, dateKey: window.dateKey, broadcastWindow: window.window, broadcastChannel: channel, reservationStart: appleReferenceSeconds(window.start), reservationEnd: appleReferenceSeconds(window.end) },
    "content-state": { phase: now >= window.start ? "inProgress" : "upcoming", courseName: "课程", teacher: "", location: "", startDate: appleReferenceSeconds(window.start), endDate: appleReferenceSeconds(window.end), updatedAt: appleReferenceSeconds(now), broadcastDateKey: window.dateKey },
    "stale-date": Math.floor(window.end), alert: { title: "课程提醒", body: "课表实时活动已开始" },
  } };
}
export async function tickRemoteStarts() {
  const config = await getApnsConfig();
  if (!config.configured) return;
  const now = new Date();
  const rows = await prisma.liveActivityPlan.findMany({
    where: { event: EVENT, state: "pending", fireAt: { lte: now }, nextAttemptAt: { lte: now }, device: { enabled: true } },
    orderBy: { fireAt: "asc" }, take: 200,
    select: { id: true, device: { select: { startTokenHash: true } } },
  });
  // A bounded pool shares HTTP/2 sessions. The same token lock serializes edits,
  // revocation and sends across server processes; never scan every user's plan.
  let index = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(12, rows.length) }, async () => {
    while (index < rows.length) {
      const candidate = rows[index++];
      if (!candidate.device.startTokenHash) continue;
      await prisma.$transaction(async tx => {
        await lock(tx, candidate.device.startTokenHash!);
        const row = await tx.liveActivityPlan.findUnique({ where: { id: candidate.id }, include: { device: true } });
        if (!row || row.state !== "pending" || !row.device.enabled || row.device.startTokenHash !== candidate.device.startTokenHash || row.nextAttemptAt > new Date()) return;
        const seconds = Date.now() / 1000;
        const finish = (state: string, detail = "") => tx.liveActivityPlan.update({ where: { id: row.id }, data: { state, detail, ...(state === "sent" ? { sentAt: new Date() } : {}) } });
        if (row.expiresAt.getTime() <= Date.now() || row.device.bundleID !== config.bundleID) { await finish("skipped", "启动已过期或配置已改变"); return; }
        const window = JSON.parse(row.payload) as StartWindow;
        const channel = config.channels[`${row.device.environment}:cpu-${window.window}`];
        if (!channel) {
          await tx.liveActivityPlan.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + 30000), detail: "等待时段频道" } });
          return;
        }
        try {
          const { value } = decryptJwxtSensitiveJson<{ token: string }>(PURPOSE, row.device.startTokenHash!, row.device.startTokenCiphertext!);
          await sendLiveActivityPayload({ token: value.token, environment: row.device.environment as "production" | "sandbox", bundleID: row.device.bundleID, payload: remoteStartPayload(window, channel, seconds), config });
          await finish("sent");
        } catch (error: any) {
          const status = Number(error?.status || 0);
          if (["BadDeviceToken", "Unregistered"].includes(error?.apnsReason)) {
            await tx.liveActivityDevice.update({ where: { id: row.deviceId }, data: { enabled: false, lastError: error.apnsReason } });
            await finish("failed", error.apnsReason);
          } else if (!status || status === 408 || status === 429 || status >= 500) {
            await tx.liveActivityPlan.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(60000, 5000 * 2 ** Math.min(row.attempts, 4))), detail: String(error.message).slice(0, 300) } });
          } else await finish("failed", String(error.message).slice(0, 300));
        }
      }, { timeout: 25000, maxWait: 20000 });
    }
  }));
  for (const result of results) if (result.status === "rejected") throw result.reason;
  return rows.length;
}
