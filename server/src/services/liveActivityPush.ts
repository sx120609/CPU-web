import crypto from "node:crypto";
import { prisma } from "../prisma";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { appleReferenceSeconds, sendLiveActivityBroadcast, sendLiveActivityPayload, unixSecondsFromActivityDate } from "./apnsClient";
import { getApnsConfig } from "./apnsConfig";
import { listScheduleTermConfigs } from "./scheduleTermConfig";
import { adjustmentForDate, isMovedSourceDate } from "../shared/scheduleAdjustments";

const PUSH_PURPOSE = "live-activity-apns-token";
const START_PUSH_PURPOSE = "live-activity-start-token";
const PLAN_PUSH_PURPOSE = "live-activity-plan-payload";
const TICK_MS = 5_000;
const MAX_PLAN_ITEMS = 240;
const MAX_PLAN_HORIZON_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_PLAN_ITEM_BYTES = 3200;
const CPU_SCHOOL_ID = "cpu";
const CLAIM_MS = 30_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 300_000;
let lastBroadcastMaterializedAt = 0;

type ActivityJSON = Record<string, unknown>;

function normalizeToken(raw: string) {
  const token = raw.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (!token || token.length < 32 || token.length > 512 || token.length % 2 !== 0) throw new Error("APNs device token 无效");
  return token;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseToken(raw: string, label: string) {
  const token = normalizeToken(raw);
  if (token.length > 200) throw new Error(`${label} 过长`);
  return token;
}

function parsePlanItem(raw: unknown, now: number) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("计划项必须是对象");
  const item = raw as Record<string, unknown>;
  const id = String(item.id || "").trim();
  const event = String(item.event || "").trim();
  const fireAt = Number(item.fireAt);
  const expiresAt = Number(item.expiresAt);
  if (!id || id.length > 120) throw new Error("计划项 id 无效");
  if (!["start", "update", "end"].includes(event)) throw new Error("计划事件必须是 start、update 或 end");
  if (!Number.isFinite(fireAt) || fireAt < now - 3600 || fireAt > now + MAX_PLAN_HORIZON_MS / 1000) {
    throw new Error(`计划项 ${id} 的 fireAt 超出允许范围`);
  }
  const effectiveExpires = Number.isFinite(expiresAt) && expiresAt > fireAt ? expiresAt : fireAt + 60;
  if (!item.contentState || typeof item.contentState !== "object" || Array.isArray(item.contentState)) {
    throw new Error(`计划项 ${id} 缺少 contentState`);
  }
  if (event === "start" && (!item.attributes || typeof item.attributes !== "object" || Array.isArray(item.attributes))) {
    throw new Error(`计划项 ${id} 缺少 attributes`);
  }
  const payload = JSON.stringify({
    contentState: item.contentState,
    attributesType: String(item.attributesType || "ScheduleLiveActivityAttributes"),
    ...(event === "start" ? { attributes: item.attributes } : {}),
    ...(Number.isFinite(Number(item.staleDate)) ? { staleDate: Number(item.staleDate) } : {}),
    ...(Number.isFinite(Number(item.dismissalDate)) ? { dismissalDate: Number(item.dismissalDate) } : {}),
    ...(Number.isFinite(Number(item.relevanceScore)) ? { relevanceScore: Number(item.relevanceScore) } : {}),
    ...(item.alert && typeof item.alert === "object" ? { alert: item.alert } : {}),
  });
  if (Buffer.byteLength(payload) > MAX_PLAN_ITEM_BYTES) throw new Error(`计划项 ${id} 超过 ${MAX_PLAN_ITEM_BYTES} 字节`);
  return { id, event, fireAt: new Date(fireAt * 1000), expiresAt: new Date(effectiveExpires * 1000), payload };
}

function planPayload(event: string, raw: string, timestamp: number) {
  const value = JSON.parse(raw) as Record<string, any>;
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(timestamp),
    event,
    "content-state": value.contentState,
  };
  if (event === "start") {
    aps["attributes-type"] = value.attributesType || "ScheduleLiveActivityAttributes";
    aps.attributes = value.attributes || {};
  }
  if (Number.isFinite(Number(value.staleDate))) aps["stale-date"] = Number(value.staleDate);
  if (event === "end" && Number.isFinite(Number(value.dismissalDate))) aps["dismissal-date"] = Number(value.dismissalDate);
  if (Number.isFinite(Number(value.relevanceScore))) aps["relevance-score"] = Number(value.relevanceScore);
  if (value.alert && typeof value.alert === "object") aps.alert = value.alert;
  return { aps };
}

function parseObject(raw: string, label: string): ActivityJSON {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`${label} 不是有效 JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`);
  return value as ActivityJSON;
}

const db = prisma as any;

export async function registerLiveActivityDevice(input: {
  userId: number;
  deviceID?: string;
  startToken?: string;
  environment: string;
  bundleID: string;
  timeZone?: string;
  supportsBroadcast?: boolean;
}) {
  const environment = input.environment === "sandbox" ? "sandbox" : "production";
  const bundleID = String(input.bundleID || "").trim();
  if (!bundleID || bundleID.length > 200) throw new Error("Bundle ID 无效");
  const startToken = input.startToken ? parseToken(input.startToken, "startToken") : "";
  const existing = input.deviceID
    ? await db.liveActivityDevice.findFirst({ where: { id: input.deviceID, userId: input.userId } })
    : null;
  const tokenHash = startToken ? hashToken(startToken) : null;
  const tokenCiphertext = startToken
    ? encryptJwxtSensitiveJson(START_PUSH_PURPOSE, tokenHash!, { token: startToken })
    : undefined;
  const config = await getApnsConfig();
  const channelID = input.supportsBroadcast ? (config.channels[`${environment}:${CPU_SCHOOL_ID}`] || null) : null;
  const row = existing
    ? await db.liveActivityDevice.update({
      where: { id: existing.id },
      data: {
        startTokenHash: tokenHash || existing.startTokenHash,
        startTokenCiphertext: tokenCiphertext || existing.startTokenCiphertext,
        environment, bundleID, timeZone: String(input.timeZone || "Asia/Shanghai").slice(0, 64), enabled: true,
        broadcastEnabled: Boolean(channelID), channelID,
      },
    })
    : await db.liveActivityDevice.create({
      data: {
        userId: input.userId,
        startTokenHash: tokenHash,
        startTokenCiphertext: tokenCiphertext,
        environment,
        bundleID,
        timeZone: String(input.timeZone || "Asia/Shanghai").slice(0, 64),
        broadcastEnabled: Boolean(channelID), channelID,
      },
    });
  const pending = await db.liveActivityPlan.count({ where: { deviceId: row.id, state: "pending" } });
  const next = await db.liveActivityPlan.findFirst({ where: { deviceId: row.id, state: "pending" }, orderBy: { fireAt: "asc" } });
  return {
    deviceID: row.id,
    pushConfigured: config.configured,
    hasStartToken: Boolean(row.startTokenHash),
    broadcastEnabled: Boolean(row.broadcastEnabled),
    channelID: row.channelID,
    pendingCount: pending,
    nextFireAt: next?.fireAt?.getTime?.() ? next.fireAt.getTime() / 1000 : null,
  };
}

export async function replaceLiveActivityPlan(userId: number, deviceID: string, rawItems: unknown) {
  if (!Array.isArray(rawItems)) throw new Error("items 必须是数组");
  if (rawItems.length > MAX_PLAN_ITEMS) throw new Error(`计划最多包含 ${MAX_PLAN_ITEMS} 项`);
  const device = await db.liveActivityDevice.findFirst({ where: { id: deviceID, userId, enabled: true } });
  if (!device) throw new Error("设备不存在或已停用");
  const now = Date.now() / 1000;
  const items = rawItems.map((item) => parsePlanItem(item, now));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`计划项 ${item.id} 重复`);
    seen.add(item.id);
  }
  const digest = crypto.createHash("sha256").update(JSON.stringify(items.map((item) => ({ ...item, fireAt: item.fireAt.toISOString(), expiresAt: item.expiresAt.toISOString() })))).digest("hex");
  await db.$transaction(async (tx: any) => {
    const latest = await tx.liveActivityPlan.aggregate({ where: { deviceId: deviceID }, _max: { revision: true } });
    const revision = Number(latest?._max?.revision || 0) + 1;
    const nextAttemptAt = new Date();
    await tx.liveActivityPlan.deleteMany({ where: { deviceId: deviceID, state: "pending" } });
    for (const item of items) {
      await tx.liveActivityPlan.upsert({
        where: { deviceId_itemID: { deviceId: deviceID, itemID: item.id } },
        create: { deviceId: deviceID, itemID: item.id, fireAt: item.fireAt, expiresAt: item.expiresAt, event: item.event, payload: item.payload, revision, nextAttemptAt },
        update: { fireAt: item.fireAt, expiresAt: item.expiresAt, event: item.event, payload: item.payload, state: "pending", detail: "", sentAt: null, revision, attempts: 0, nextAttemptAt, claimedUntil: null },
      });
    }
    await tx.liveActivityDevice.update({ where: { id: deviceID }, data: { planDigest: digest, lastError: null } });
  });
  return liveActivityDeviceStatus(userId, deviceID);
}

export async function registerLiveActivityDeviceActivity(userId: number, deviceID: string, input: { activityID: string; updateToken: string; expiresAt?: number }) {
  const device = await db.liveActivityDevice.findFirst({ where: { id: deviceID, userId, enabled: true } });
  if (!device) throw new Error("设备不存在或已停用");
  const activityID = String(input.activityID || "").trim();
  if (!activityID || activityID.length > 200) throw new Error("activityID 无效");
  const token = parseToken(input.updateToken, "updateToken");
  const tokenHash = hashToken(token);
  const tokenCiphertext = encryptJwxtSensitiveJson(PUSH_PURPOSE, tokenHash, { token });
  await db.liveActivityDeviceActivity.upsert({
    where: { deviceId_activityID: { deviceId: deviceID, activityID } },
    create: { deviceId: deviceID, activityID, updateTokenHash: tokenHash, updateTokenCiphertext: tokenCiphertext, expiresAt: Number.isFinite(Number(input.expiresAt)) ? new Date(Number(input.expiresAt) * 1000) : null },
    update: { updateTokenHash: tokenHash, updateTokenCiphertext: tokenCiphertext, expiresAt: Number.isFinite(Number(input.expiresAt)) ? new Date(Number(input.expiresAt) * 1000) : null, lastError: null },
  });
  return { ok: true };
}

export async function unregisterLiveActivityDeviceActivity(userId: number, deviceID: string, activityID: string) {
  const device = await db.liveActivityDevice.findFirst({ where: { id: deviceID, userId } });
  if (!device) return;
  await db.liveActivityDeviceActivity.deleteMany({ where: { deviceId: deviceID, activityID } });
}

export async function removeLiveActivityDevice(userId: number, deviceID: string) {
  await db.liveActivityDevice.deleteMany({ where: { id: deviceID, userId } });
}

export async function liveActivityDeviceStatus(userId: number, deviceID: string) {
  const row = await db.liveActivityDevice.findFirst({ where: { id: deviceID, userId } });
  if (!row) throw new Error("设备不存在");
  const config = await getApnsConfig();
  const [pendingCount, next] = await Promise.all([
    db.liveActivityPlan.count({ where: { deviceId: deviceID, state: "pending" } }),
    db.liveActivityPlan.findFirst({ where: { deviceId: deviceID, state: "pending" }, orderBy: { fireAt: "asc" } }),
  ]);
  return { deviceID, pushConfigured: config.configured, hasStartToken: Boolean(row.startTokenHash), pendingCount, nextFireAt: next?.fireAt?.getTime?.() ? next.fireAt.getTime() / 1000 : null };
}

export async function registerLiveActivity(input: {
  userId: number;
  token: string;
  environment: string;
  bundleID: string;
  attributes: unknown;
  contentState: unknown;
}) {
  const token = normalizeToken(input.token);
  const tokenHash = hashToken(token);
  const environment = input.environment === "sandbox" ? "sandbox" : "production";
  const bundleID = String(input.bundleID || "").trim();
  if (!bundleID || bundleID.length > 200) throw new Error("Bundle ID 无效");
  const attributes = JSON.stringify(parseObject(JSON.stringify(input.attributes), "Activity attributes"));
  const contentState = JSON.stringify(parseObject(JSON.stringify(input.contentState), "Activity content state"));
  const tokenCiphertext = encryptJwxtSensitiveJson(PUSH_PURPOSE, tokenHash, { token });
  const row = await prisma.liveActivityRegistration.upsert({
    where: { tokenHash },
    create: { userId: input.userId, tokenHash, tokenCiphertext, environment, bundleID, attributes, contentState },
    update: { userId: input.userId, tokenCiphertext, environment, bundleID, attributes, contentState, active: true, lastError: null },
    select: { id: true, tokenHash: true, environment: true, bundleID: true, active: true },
  });
  return row;
}

export async function unregisterLiveActivity(userId: number, rawToken: string) {
  const token = normalizeToken(rawToken);
  await prisma.liveActivityRegistration.updateMany({
    where: { userId, tokenHash: hashToken(token) },
    data: { active: false },
  });
}

function contentStateForPush(state: ActivityJSON, phase: "upcoming" | "inProgress") {
  return { ...state, phase, updatedAt: appleReferenceSeconds(Date.now() / 1000) };
}

async function pushRegistration(row: any, payload: Record<string, unknown>) {
  try {
    const decrypted = decryptJwxtSensitiveJson<{ token: string }>(PUSH_PURPOSE, row.tokenHash, row.tokenCiphertext);
    await sendLiveActivityPayload({ token: decrypted.value.token, environment: row.environment, bundleID: row.bundleID, payload });
    await prisma.liveActivityRegistration.update({ where: { id: row.id }, data: { lastPushedAt: new Date(), lastError: null } });
    return true;
  } catch (error: any) {
    const status = Number(error?.status || 0);
    const gone = status === 404 || status === 410 || error?.apnsReason === "BadDeviceToken" || error?.apnsReason === "Unregistered";
    await prisma.liveActivityRegistration.update({
      where: { id: row.id },
      data: { active: gone ? false : row.active, lastError: String(error?.message || error).slice(0, 500) },
    });
    return false;
  }
}

async function finishPlan(id: string, state: string, detail = "", revision?: number) {
  const where: Record<string, unknown> = { id };
  if (revision !== undefined) where.revision = revision;
  await db.liveActivityPlan.updateMany({
    where,
    data: { state, detail: detail.slice(0, 500), sentAt: state === "sent" ? new Date() : null, claimedUntil: null },
  }).catch(() => undefined);
}

function retryableError(error: any) {
  const status = Number(error?.status || 0);
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(attempts: number) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.min(Math.max(0, attempts - 1), 6)));
}

async function retryPlan(row: any, now: number, detail: string) {
  const attempts = Number(row.attempts || 0) + 1;
  await db.liveActivityPlan.updateMany({
    where: { id: row.id, revision: Number(row.revision || 0), state: "pending" },
    data: { attempts, nextAttemptAt: new Date(now * 1000 + retryDelayMs(attempts)), claimedUntil: null, detail: detail.slice(0, 500) },
  }).catch(() => undefined);
}

async function retryBroadcast(row: any, now: number, detail: string) {
  const attempts = Number(row.attempts || 0) + 1;
  await db.liveActivityBroadcastEvent.updateMany({
    where: { id: row.id, state: "pending" },
    data: { attempts, nextAttemptAt: new Date(now * 1000 + retryDelayMs(attempts)), claimedUntil: null, detail: detail.slice(0, 500) },
  }).catch(() => undefined);
}

function dateKeyAt(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function broadcastPayload(dateKey: string, period: number, phase: "started" | "ended", timestamp: number) {
  const payload = {
    aps: {
      timestamp: Math.floor(timestamp),
      event: phase === "ended" && period === 0 ? "end" : "update",
      "content-state": {
        phase: phase === "started" ? "inProgress" : "upcoming",
        courseName: "",
        teacher: "",
        location: "",
        periodLabel: null,
        dateLabel: null,
        weekRangeLabel: null,
        startDate: appleReferenceSeconds(timestamp),
        endDate: appleReferenceSeconds(timestamp),
        nextCourseName: null,
        nextCoursePeriod: null,
        nextCourseDateLabel: null,
        nextCourseWeekRangeLabel: null,
        nextCourseTeacher: null,
        nextCourseLocation: null,
        nextCourseStart: null,
        nextCourseEnd: null,
        updatedAt: appleReferenceSeconds(timestamp),
        broadcastDateKey: dateKey,
        broadcastPeriod: period,
        broadcastPhase: phase,
        broadcastTimestamp: Math.floor(timestamp),
      },
    },
  };
  return payload;
}

async function ensureBroadcastEvents(now: number) {
  if (!db.liveActivityBroadcastEvent) return;
  if (now - lastBroadcastMaterializedAt < 60) return;
  lastBroadcastMaterializedAt = now;
  const config = await getApnsConfig();
  const channels = Object.entries(config.channels).filter(([key]) => key.endsWith(`:${CPU_SCHOOL_ID}`));
  if (!config.configured || !channels.length) return;
  const terms = await listScheduleTermConfigs();
  const term = terms[0];
  if (!term) return;
  const startOfToday = new Date(`${dateKeyAt(new Date(now * 1000))}T00:00:00Z`);
  const termStart = new Date(`${term.semesterStartMonday}T00:00:00Z`);
  const termEnd = addDays(termStart, term.weekCount * 7);
  const rows: any[] = [];
  for (const [key, channelID] of channels) {
    const [environment] = key.split(":", 1);
    for (let offset = -1; offset < 9; offset += 1) {
      const day = addDays(startOfToday, offset);
      if (day < termStart || day >= termEnd) continue;
      const weekday = day.getUTCDay();
      const dateKey = day.toISOString().slice(0, 10);
      const adjustment = adjustmentForDate(term.adjustments, dateKey);
      // Weekends are normally idle, but a swap can make one a teaching day.
      if ((weekday === 0 || weekday === 6) && adjustment?.kind !== "swap") continue;
      if (adjustment?.kind === "off" || isMovedSourceDate(term.adjustments, dateKey)) continue;
      for (const period of term.periods) {
        for (const [phase, clock] of [["started", period.start], ["ended", period.end]] as const) {
          const instant = new Date(`${dateKey}T${clock}:00+08:00`);
          const fireAt = instant.getTime() / 1000;
          if (fireAt <= now - 3600 || fireAt > now + 9 * 86400) continue;
          const isFinal = phase === "ended" && period.id === term.periods[term.periods.length - 1]?.id;
          const eventID = `${dateKey}-${period.id}-${phase}`;
          const payload = broadcastPayload(dateKey, period.id, phase, fireAt);
          if (isFinal) {
            payload.aps.event = "end";
            (payload.aps as Record<string, unknown>)["dismissal-date"] = Math.floor(fireAt);
          }
          rows.push({ channelID, environment, bundleID: config.bundleID, eventID, fireAt: instant, expiresAt: instant, event: payload.aps.event, payload: JSON.stringify(payload) });
        }
      }
    }
  }
  for (const row of rows) {
    const existing = await db.liveActivityBroadcastEvent.findUnique({ where: { channelID_eventID: { channelID: row.channelID, eventID: row.eventID } } });
    await db.liveActivityBroadcastEvent.upsert({
      where: { channelID_eventID: { channelID: row.channelID, eventID: row.eventID } },
      create: row,
      update: {
        fireAt: row.fireAt,
        expiresAt: row.expiresAt,
        event: row.event,
        payload: row.payload,
        ...(existing && existing.payload !== row.payload ? { state: "pending", detail: "", sentAt: null, attempts: 0, nextAttemptAt: new Date(), claimedUntil: null } : {}),
      },
    });
  }
  await db.liveActivityBroadcastEvent.deleteMany({ where: { state: { not: "pending" }, fireAt: { lt: new Date((now - 3 * 86400) * 1000) } } });
}

async function tickBroadcastEvents() {
  if (!db.liveActivityBroadcastEvent) return;
  const config = await getApnsConfig();
  if (!config.configured) return;
  const now = Date.now() / 1000;
  await ensureBroadcastEvents(now);
  const rows = await db.liveActivityBroadcastEvent.findMany({
    where: {
      state: "pending",
      fireAt: { lte: new Date(now * 1000) },
      nextAttemptAt: { lte: new Date(now * 1000) },
      OR: [{ claimedUntil: null }, { claimedUntil: { lte: new Date(now * 1000) } }],
    },
    orderBy: { fireAt: "asc" },
    take: 200,
  });
  for (const row of rows) {
    const claimed = await db.liveActivityBroadcastEvent.updateMany({
      where: { id: row.id, state: "pending", OR: [{ claimedUntil: null }, { claimedUntil: { lte: new Date(now * 1000) } }] },
      data: { claimedUntil: new Date(now * 1000 + CLAIM_MS) },
    });
    if (!claimed.count) continue;
    const current = await db.liveActivityBroadcastEvent.findUnique({ where: { id: row.id }, select: { state: true, payload: true } }).catch(() => null);
    if (!current || current.state !== "pending" || current.payload !== row.payload) {
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { claimedUntil: null } });
      continue;
    }
    if (row.expiresAt.getTime() / 1000 < now) {
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "skipped", detail: "广播事件已过期", claimedUntil: null } });
      continue;
    }
    try {
      await sendLiveActivityBroadcast({ environment: row.environment, bundleID: row.bundleID, channelID: row.channelID, payload: JSON.parse(row.payload), expiration: 0, collapseID: `cpu-${row.eventID}` });
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "sent", sentAt: new Date(), detail: "", claimedUntil: null } });
    } catch (error: any) {
      const detail = String(error?.message || error);
      if (retryableError(error) && row.expiresAt.getTime() / 1000 >= now) await retryBroadcast(row, now, detail);
      else await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "failed", detail: detail.slice(0, 500), claimedUntil: null } });
    }
  }
}

async function dispatchPlannedItem(row: any, now: number) {
  const current = await db.liveActivityPlan.findUnique({ where: { id: row.id }, select: { revision: true, state: true } }).catch(() => null);
  if (!current || current.state !== "pending" || Number(current.revision || 0) !== Number(row.revision || 0)) return;
  if (row.expiresAt.getTime() / 1000 < now && row.event !== "end") {
    await finishPlan(row.id, "skipped", "已过期，未迟发历史课程", Number(row.revision || 0));
    return;
  }
  if (!row.device?.enabled) {
    await finishPlan(row.id, "skipped", "设备已停用", Number(row.revision || 0));
    return;
  }
  if (row.device.broadcastEnabled) {
    await finishPlan(row.id, "skipped", "设备使用学校广播频道", Number(row.revision || 0));
    return;
  }
  const event = String(row.event);
  let token: string | null = null;
  let tokenHash = "";
  let activityRows: any[] = [];
  try {
    if (event === "start") {
      if (!row.device.startTokenCiphertext || !row.device.startTokenHash) {
        await retryPlan(row, now, "设备尚未提供 push-to-start token");
        return;
      }
      tokenHash = row.device.startTokenHash;
      token = decryptJwxtSensitiveJson<{ token: string }>(START_PUSH_PURPOSE, tokenHash, row.device.startTokenCiphertext).value.token;
    } else {
      activityRows = await db.liveActivityDeviceActivity.findMany({ where: { deviceId: row.deviceId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { updatedAt: "desc" } });
      if (!activityRows.length) {
        await retryPlan(row, now, "尚未收到 Activity update token");
        return;
      }
    }
    if (event === "start") {
      await sendLiveActivityPayload({ token: token!, environment: row.device.environment, bundleID: row.device.bundleID, payload: planPayload(event, row.payload, now) });
      await finishPlan(row.id, "sent", "", Number(row.revision || 0));
    } else {
      let sent = false;
      let lastError = "";
      let hasRetryableError = false;
      for (const activityRow of activityRows) {
        try {
          const activityToken = decryptJwxtSensitiveJson<{ token: string }>(PUSH_PURPOSE, activityRow.updateTokenHash, activityRow.updateTokenCiphertext).value.token;
          await sendLiveActivityPayload({ token: activityToken, environment: row.device.environment, bundleID: row.device.bundleID, payload: planPayload(event, row.payload, now) });
          sent = true;
        } catch (error: any) {
          lastError = String(error?.apnsReason || error?.message || error);
          hasRetryableError = hasRetryableError || retryableError(error);
          const gone = error?.apnsReason === "BadDeviceToken" || error?.apnsReason === "Unregistered" || Number(error?.status) === 404 || Number(error?.status) === 410;
          if (gone) await db.liveActivityDeviceActivity.delete({ where: { id: activityRow.id } }).catch(() => undefined);
        }
      }
      if (sent) await finishPlan(row.id, "sent", "", Number(row.revision || 0));
      else if (hasRetryableError && row.expiresAt.getTime() / 1000 >= now) await retryPlan(row, now, lastError || "所有 Activity update token 均发送失败");
      else await finishPlan(row.id, "failed", lastError || "所有 Activity update token 均发送失败", Number(row.revision || 0));
    }
  } catch (error: any) {
    const reason = String(error?.apnsReason || error?.message || error);
    const gone = error?.apnsReason === "BadDeviceToken" || error?.apnsReason === "Unregistered" || Number(error?.status) === 404 || Number(error?.status) === 410;
    if (!gone && retryableError(error) && row.expiresAt.getTime() / 1000 >= now) {
      await retryPlan(row, now, reason);
      return;
    }
    await finishPlan(row.id, "failed", reason, Number(row.revision || 0));
    if (gone) {
      if (event === "start" && tokenHash) await db.liveActivityDevice.update({ where: { id: row.deviceId }, data: { startTokenHash: null, startTokenCiphertext: null, lastError: reason } }).catch(() => undefined);
      for (const activityRow of activityRows) await db.liveActivityDeviceActivity.delete({ where: { id: activityRow.id } }).catch(() => undefined);
    } else {
      await db.liveActivityDevice.update({ where: { id: row.deviceId }, data: { lastError: reason.slice(0, 500) } }).catch(() => undefined);
    }
  }
}

async function tickPlannedLiveActivities() {
  if (!db.liveActivityDevice || !db.liveActivityPlan) return;
  const config = await getApnsConfig();
  if (!config.configured) return;
  const now = Date.now() / 1000;
  const rows = await db.liveActivityPlan.findMany({
    where: {
      state: "pending",
      fireAt: { lte: new Date(now * 1000) },
      nextAttemptAt: { lte: new Date(now * 1000) },
      OR: [{ claimedUntil: null }, { claimedUntil: { lte: new Date(now * 1000) } }],
    },
    include: { device: true },
    orderBy: { fireAt: "asc" },
    take: 200,
  });
  for (const row of rows) {
    const claimed = await db.liveActivityPlan.updateMany({
      where: { id: row.id, state: "pending", revision: Number(row.revision || 0), OR: [{ claimedUntil: null }, { claimedUntil: { lte: new Date(now * 1000) } }] },
      data: { claimedUntil: new Date(now * 1000 + CLAIM_MS) },
    });
    if (claimed.count) await dispatchPlannedItem(row, now);
  }
  await db.liveActivityPlan.deleteMany({ where: { state: { not: "pending" }, fireAt: { lt: new Date((now - 3 * 86400) * 1000) } } }).catch(() => undefined);
}

async function tickLiveActivities() {
  // Keep the legacy registration path alive during a rolling deploy where
  // the new plan migration has not reached every worker yet.
  try {
    await tickBroadcastEvents();
    await tickPlannedLiveActivities();
  } catch (error: any) {
    console.warn("[apns] 计划调度暂不可用:", error?.message || error);
  }
  const config = await getApnsConfig();
  if (!config.configured) return;
  const rows = await prisma.liveActivityRegistration.findMany({ where: { active: true }, take: 500 });
  const now = Date.now() / 1000;
  for (const row of rows) {
    let state: ActivityJSON;
    try { state = parseObject(row.contentState, "Activity content state"); } catch {
      await prisma.liveActivityRegistration.update({ where: { id: row.id }, data: { active: false, lastError: "Activity content state 无效" } });
      continue;
    }
    const start = unixSecondsFromActivityDate(state.startDate);
    const end = unixSecondsFromActivityDate(state.endDate);
    if (end !== null && end <= now) {
      const pushed = await pushRegistration(row, { aps: { timestamp: Math.floor(now), event: "end", "dismissal-date": Math.floor(now) } });
      if (pushed) await prisma.liveActivityRegistration.update({ where: { id: row.id }, data: { active: false } }).catch(() => undefined);
      continue;
    }
    if (start !== null && start <= now && state.phase === "upcoming") {
      const nextState = contentStateForPush(state, "inProgress");
      const staleDate = end === null ? undefined : Math.floor(end);
      const pushed = await pushRegistration(row, {
        aps: {
          timestamp: Math.floor(now),
          event: "update",
          "content-state": nextState,
          ...(staleDate ? { "stale-date": staleDate } : {}),
        },
      });
      if (pushed) await prisma.liveActivityRegistration.update({ where: { id: row.id }, data: { contentState: JSON.stringify(nextState) } }).catch(() => undefined);
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startLiveActivityPushScheduler() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    void tickLiveActivities()
      .catch((error) => console.warn("[apns] 调度失败:", error?.message || error))
      .finally(() => { running = false; });
  };
  tick();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
}

export function normalizeLiveActivityToken(raw: string) { return normalizeToken(raw); }
