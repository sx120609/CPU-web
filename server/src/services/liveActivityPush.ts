import { currentTiming, retainTiming, timingVersion, endChannelKey } from "./liveActivitySchedule";
import { prisma } from "../prisma";
import { appleReferenceSeconds, sendLiveActivityBroadcast } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";
import { type ScheduleTermConfigValue } from "./scheduleTermConfig";
import { maintainApnsChannels } from "./apnsChannels";

import { tickRemoteStarts, START_BATCH_SIZE } from "./liveActivityRemoteStart";

const db = prisma;
const TICK_MS = 5_000;
const CLAIM_MS = 30_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 300_000;
let lastBroadcastMaterializedAt = 0;
let materializedDigest = "";

// The client receives only public school timing/channel metadata. No device
// token, personal timetable, activity state or future personal plan is stored.
export async function liveActivityBroadcastConfig(environment: string, bundleID: string, local = false) {
  if (!["production", "sandbox"].includes(environment)) throw new Error("APNs 环境无效");
  return withApnsConfigLock(async db => {
  const config = await getApnsConfig(db);
  if (config.configured && bundleID !== config.bundleID) throw new Error("Bundle ID 与 CPU APNs 配置不一致");
  const timing = await currentTiming();
  const issuedAt = Date.now() / 1000;
  if (local) await retainTiming(timing.id, new Date((issuedAt + 8 * 86400) * 1000));
  return { protocolVersion: 2, scheduleId: timing.scheduleId, scheduleVersion: timing.id,
    timezone: timing.timezone, periods: timing.periods, issuedAt,
    usableUntil: issuedAt + 7 * 86400, broadcastUntil: issuedAt + 8 * 86400,
    windows: local ? timing.periods.map(p => ({ id: String(p.id), startHour: 0, endHour: 24,
      channelID: config.configured ? config.channels[endChannelKey(environment, timing.id, p.id)] || null : null })) : [] };
  });
}

export function broadcastPayload(dateKey: string, timestamp: number, ended = false, scheduleVersion = "") {
  return { aps: {
    timestamp: Math.floor(timestamp), event: ended ? "end" : "update",
    ...(ended ? { "dismissal-date": Math.floor(timestamp) } : {}),
    "content-state": {
      protocolVersion: 2, scheduleId: "main-campus", scheduleVersion,
      eventType: ended ? "end" : "update", eventTime: appleReferenceSeconds(timestamp),
      phase: ended ? "idle" : "upcoming", courseName: "", teacher: "", location: "",
      startDate: appleReferenceSeconds(timestamp), endDate: appleReferenceSeconds(timestamp),
      updatedAt: appleReferenceSeconds(timestamp), broadcastDateKey: dateKey,
      broadcastTimestamp: appleReferenceSeconds(timestamp),
    },
  } };
}

/** Every held timing version broadcasts every day, including holidays. */
export function schoolBroadcastEvents(term: Pick<ScheduleTermConfigValue, "periods">, dateKey: string, _daily = false, version = timingVersion(term.periods)) {
  return term.periods.flatMap((final, index) => {
    const seconds = (clock: string) => new Date(`${dateKey}T${clock}:00+08:00`).getTime() / 1000;
    const end = seconds(final.end);
    return [...new Set(term.periods.slice(0, index + 1).flatMap(p => [seconds(p.start), seconds(p.end)]))]
      .sort((a, b) => a - b).map(fireAt => ({
        windowID: `${version}:${final.id}`, eventID: `v2-${version}-${dateKey}-${final.id}-${fireAt}`,
        fireAt: new Date(fireAt * 1000), expiresAt: new Date((fireAt + 60) * 1000),
        payload: JSON.stringify(broadcastPayload(dateKey, fireAt, fireAt === end, version)),
        event: fireAt === end ? "end" : "update",
      }));
  });
}

async function ensureBroadcastEvents(now: number) {
  if (now - lastBroadcastMaterializedAt < 60) return;
  const config = await getApnsConfig();
  if (!config.configured) return;
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now * 1000));
  const current = await currentTiming();
  const versions = await db.liveActivityScheduleVersion.findMany({ where: { OR: [{ id: current.id }, { broadcastUntil: { gte: new Date(now * 1000) } }] } });
  const digest = JSON.stringify([dateKey, config.bundleID, config.channels, versions]);
  if (digest === materializedDigest) { lastBroadcastMaterializedAt = now; return; }
  const events = versions.flatMap(v => schoolBroadcastEvents({ periods: JSON.parse(v.periods) }, dateKey, false, v.id));
  const rows = events.flatMap(({ windowID, ...event }) => ["production", "sandbox"].flatMap(environment => {
    const [version, period] = windowID.split(":");
    const channelID = config.channels[endChannelKey(environment, version, Number(period))];
    return channelID ? [{ ...event, environment, channelID, bundleID: config.bundleID }] : [];
  }));
  // Retire old protocol events and obsolete times after timetable edits.
  await db.liveActivityBroadcastEvent.updateMany({
    where: { state: "pending", NOT: { OR: rows.map(row => ({ channelID: row.channelID, eventID: row.eventID })) } },
    data: { state: "skipped", detail: "已替换为当前学校广播时间", claimedUntil: null },
  });
  for (const row of rows) {
    await db.liveActivityBroadcastEvent.upsert({
      where: { channelID_eventID: { channelID: row.channelID, eventID: row.eventID } },
      create: row, update: { payload: row.payload, event: row.event, expiresAt: row.expiresAt },
    });
  }
  await db.liveActivityBroadcastEvent.deleteMany({ where: { state: { not: "pending" }, fireAt: { lt: new Date((now - 3 * 86400) * 1000) } } });
  materializedDigest = digest;
  lastBroadcastMaterializedAt = now;
}

function retryableError(error: any) {
  const status = Number(error?.status || 0);
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(attempts: number) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.min(Math.max(0, attempts - 1), 6)));
}

async function retryBroadcast(row: any, now: number, detail: string) {
  const attempts = Number(row.attempts || 0) + 1;
  await db.liveActivityBroadcastEvent.updateMany({
    where: { id: row.id, state: "pending" },
    data: { attempts, nextAttemptAt: new Date(now * 1000 + retryDelayMs(attempts)), claimedUntil: null, detail: detail.slice(0, 500) },
  }).catch(() => undefined);
}

export async function tickBroadcastEvents() {
  if (!db.liveActivityBroadcastEvent) return;
  await maintainApnsChannels();
  const config = await getApnsConfig();
  if (!config.configured) return;
  const now = Date.now() / 1000;
  await ensureBroadcastEvents(now);
  await db.liveActivityBroadcastEvent.updateMany({ where: { state: "pending", expiresAt: { lte: new Date() } },
    data: { state: "skipped", detail: "广播已过有效期", claimedUntil: null } });
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
    const claimed = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.channelID}, 7420))::text`;
      const newer = await tx.liveActivityBroadcastEvent.findFirst({ where: {
        channelID: row.channelID, fireAt: { gt: row.fireAt }, OR: [{ state: "sent" }, { claimedUntil: { not: null } }],
      } });
      if (newer) {
        await tx.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "skipped", detail: "已有更新的边界" } });
        return { count: 0 };
      }
      const inFlight = await tx.liveActivityBroadcastEvent.findFirst({ where: {
        channelID: row.channelID, id: { not: row.id }, state: "pending", claimedUntil: { gt: new Date() },
      } });
      if (inFlight) return { count: 0 };
      return tx.liveActivityBroadcastEvent.updateMany({
        where: { id: row.id, state: "pending", OR: [{ claimedUntil: null }, { claimedUntil: { lte: new Date(now * 1000) } }] },
        data: { claimedUntil: new Date(now * 1000 + CLAIM_MS) },
      });
    });
    if (!claimed.count) continue;
    const current = await db.liveActivityBroadcastEvent.findUnique({ where: { id: row.id }, select: { state: true, payload: true } }).catch(() => null);
    if (!current || current.state !== "pending" || current.payload !== row.payload) {
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { claimedUntil: null } });
      continue;
    }
    if (row.bundleID !== config.bundleID || !Object.values(config.channels).includes(row.channelID) || row.expiresAt.getTime() <= Date.now()) {
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "skipped", detail: "广播事件已过期", claimedUntil: null } });
      continue;
    }
    try {
      const payload = JSON.parse(row.payload);
      // A later submitted boundary suppresses delayed older updates.
      const newer = await db.liveActivityBroadcastEvent.findFirst({ where: {
        channelID: row.channelID, fireAt: { gt: row.fireAt }, state: { in: ["sent", "submitting"] },
      } });
      if (newer) {
        await db.liveActivityBroadcastEvent.update({ where: { id: row.id }, data: { state: "skipped", detail: "已有更新的边界", claimedUntil: null } });
        continue;
      }
      console.info("[apns] broadcast-boundary", JSON.stringify({ event: row.event, queueDelayMs: Date.now() - row.fireAt.getTime(), attempts: row.attempts }));
      await sendLiveActivityBroadcast({ environment: row.environment === "sandbox" ? "sandbox" : "production", bundleID: row.bundleID, channelID: row.channelID, payload, expiration: 0, collapseID: `cpu-${row.eventID}` });
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "sent", sentAt: new Date(), detail: "", claimedUntil: null } });
    } catch (error: any) {
      const detail = String(error?.message || error);
      if (retryableError(error) && row.expiresAt.getTime() / 1000 >= now) await retryBroadcast(row, now, detail);
      else await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "failed", detail: detail.slice(0, 500), claimedUntil: null } });
    }
  }
}

// Independent loops: slow per-device starts cannot delay public end events.
let started = false;
export function startLiveActivityPushScheduler() {
  if (started) return;
  started = true;
  for (const work of [tickBroadcastEvents, tickRemoteStarts]) {
    const tick = async () => {
      let backlog = false;
      try { backlog = work === tickRemoteStarts && (await work()) === START_BATCH_SIZE; if (work !== tickRemoteStarts) await work(); } catch (error: any) { console.warn("[apns] 调度失败:", error?.message || error); }
      const delay = backlog ? 500 : await getApnsConfig().then(c => c.tickSeconds * 1000).catch(() => TICK_MS);
      setTimeout(tick, Math.max(500, delay)).unref?.();
    };
    void tick();
  }
}
