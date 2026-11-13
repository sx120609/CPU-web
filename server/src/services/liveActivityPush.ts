import { clockChannelKey, clockLabel, clockMarks, clockStepMinutes, currentTiming, declaredPeriods, retainTiming, timingFor, timingVersion, endChannelKey, startChannelKey } from "./liveActivitySchedule";
import { prisma } from "../prisma";
import { appleReferenceSeconds, sendLiveActivityBroadcast } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";
import { type ScheduleTermConfigValue } from "./scheduleTermConfig";
import { maintainApnsChannels } from "./apnsChannels";
import { Errors, HttpError } from "../utils/response";

import { tickRemoteStarts, START_BATCH_SIZE } from "./liveActivityRemoteStart";

const db = prisma;
const TICK_MS = 5_000;
const CLAIM_MS = 30_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 300_000;
// A missed bell is not worth replaying, but a missed end leaves the activity
// on screen: it still goes out this late, never past the day's midnight.
const END_GRACE_SECONDS = 8 * 3600;
let lastBroadcastMaterializedAt = 0;
let materializedDigest = "";

// The client receives only public school timing/channel metadata. No device
// token, personal timetable, activity state or future personal plan is stored.
type BroadcastConfig = Awaited<ReturnType<typeof readBroadcastConfig>>;
const broadcastReads = new Map<string, Promise<BroadcastConfig>>();

/**
 * `schoolId` is the reader's school and `periods` the table their app declares (see `declaredPeriods`):
 * a school other than the default is timed by its own bells, never by the default school's.
 */
export async function liveActivityBroadcastConfig(environment: string, bundleID: string, local = false, schoolId?: string | null, periods?: unknown) {
  if (!["production", "sandbox"].includes(environment)) throw new Error("APNs 环境无效");
  if (bundleID.length > 256) throw Errors.badRequest("Bundle ID 无效");
  const declared = declaredPeriods(periods);
  const key = JSON.stringify([environment, bundleID, local, schoolId ?? "", declared ? timingVersion(declared) : ""]);
  let pending = broadcastReads.get(key);
  if (!pending) {
    if (broadcastReads.size >= 32) throw Errors.busy();
    pending = readBroadcastConfig(environment, bundleID, local, schoolId, declared);
    broadcastReads.set(key, pending);
    const cleanup = () => { if (broadcastReads.get(key) === pending) broadcastReads.delete(key); };
    pending.then(cleanup, cleanup);
  }
  // Share work only while it is in flight, never cache nullable/retired channel
  // IDs or extend advertised validity without committing retention first.
  return structuredClone(await pending);
}

async function readBroadcastConfig(environment: string, bundleID: string, local: boolean, schoolId: string | null | undefined, declared: ReturnType<typeof declaredPeriods>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withApnsConfigLock(async db => {
        const config = await getApnsConfig(db);
        if (config.configured && bundleID !== config.bundleID) throw new Error("Bundle ID 与 CPU APNs 配置不一致");
        const timing = await timingFor(schoolId, declared, db);
        const issuedAt = Date.now() / 1000;
        if (local) await retainTiming(timing.id, new Date((issuedAt + 8 * 86400) * 1000), db);
        const channel = (key: string) => config.configured ? config.channels[key] || null : null;
        return { protocolVersion: 2, scheduleId: timing.scheduleId, scheduleVersion: timing.id,
          timezone: timing.timezone, periods: timing.periods, issuedAt,
          usableUntil: issuedAt + 7 * 86400, broadcastUntil: issuedAt + 8 * 86400,
          // 上课时收起: the server ends an activity at its first period's start.
          // A client only offers the option when this is advertised.
          endsAtClassStart: true,
          // 日程: a channel for each mark of the day ("0805" → channel) ends an activity at that time.
          // Only the marks whose channel exists are listed; none while the feature is off.
          clock: local && config.configured ? { stepMinutes: clockStepMinutes(), channels: Object.fromEntries(clockMarks()
            .map(minute => [clockLabel(minute), config.channels[clockChannelKey(environment, minute)]] as const)
            .filter(([, id]) => id)) } : null,
          windows: local ? timing.periods.map(p => ({ id: String(p.id), startHour: 0, endHour: 24,
            channelID: channel(endChannelKey(environment, timing.id, p.id)),
            startChannelID: channel(startChannelKey(environment, timing.id, p.id)) })) : [] };
      });
    } catch (error) {
      // The advisory lock also fences channel retirement against retention.
      // Retry only failure to acquire it, after the transaction has released
      // its connection. Never hold a pool connection while waiting.
      if (!(error instanceof HttpError) || error.code !== 5030 || attempt >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 25)));
    }
  }
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
  const seconds = (clock: string) => new Date(`${dateKey}T${clock}:00+08:00`).getTime() / 1000;
  const midnight = seconds("00:00") + 86400;
  const lateEnd = (fireAt: number) => new Date(Math.max(fireAt + 60, Math.min(fireAt + END_GRACE_SECONDS, midnight)) * 1000);
  const boundaries = term.periods.flatMap((final, index) => {
    const end = seconds(final.end);
    return [...new Set(term.periods.slice(0, index + 1).flatMap(p => [seconds(p.start), seconds(p.end)]))]
      .sort((a, b) => a - b).map(fireAt => ({
        windowID: `${version}:${final.id}`, eventID: `v2-${version}-${dateKey}-${final.id}-${fireAt}`,
        fireAt: new Date(fireAt * 1000),
        expiresAt: fireAt === end ? lateEnd(fireAt) : new Date((fireAt + 60) * 1000),
        payload: JSON.stringify(broadcastPayload(dateKey, fireAt, fireAt === end, version)),
        event: fireAt === end ? "end" : "update",
      }));
  });
  // 上课时收起: each period also has a channel that says nothing until that
  // period starts, then ends whatever is subscribed to it.
  const starts = term.periods.map(period => {
    const fireAt = seconds(period.start);
    return {
      windowID: `${version}:start:${period.id}`, eventID: `v2-${version}-${dateKey}-start-${period.id}-${fireAt}`,
      fireAt: new Date(fireAt * 1000), expiresAt: lateEnd(fireAt),
      payload: JSON.stringify(broadcastPayload(dateKey, fireAt, true, version)),
      event: "end",
    };
  });
  return [...boundaries, ...starts];
}

/** 日程: every mark of the day ends whatever is subscribed to its channel. */
export function clockBroadcastEvents(dateKey: string, step = clockStepMinutes()) {
  const midnight = new Date(`${dateKey}T00:00:00+08:00`).getTime() / 1000;
  return clockMarks(step).map(minute => {
    const fireAt = midnight + minute * 60;
    return {
      windowID: `clock:${minute}`, eventID: `v2-clock-${dateKey}-${clockLabel(minute)}`,
      fireAt: new Date(fireAt * 1000),
      // Late by up to an hour it still clears the screen; later the item is long over.
      expiresAt: new Date(Math.max(fireAt + 60, Math.min(fireAt + 3600, midnight + 86400)) * 1000),
      payload: JSON.stringify(broadcastPayload(dateKey, fireAt, true, "clock")),
      event: "end",
    };
  });
}

/** The channel key of a broadcast window: `version:period`, `version:start:period`, or `clock:minute`. */
export function windowChannelKey(environment: string, windowID: string) {
  const parts = windowID.split(":");
  if (parts[0] === "clock") return clockChannelKey(environment, Number(parts[1]));
  return parts.length === 3 && parts[1] === "start"
    ? startChannelKey(environment, parts[0], Number(parts[2]))
    : endChannelKey(environment, parts[0], Number(parts[1]));
}

export async function ensureBroadcastEvents(now: number) {
  if (now - lastBroadcastMaterializedAt < 60) return;
  const config = await getApnsConfig();
  if (!config.configured) return;
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now * 1000));
  const current = await currentTiming();
  // Retention extensions do not change today's immutable boundary events.
  const versions = await db.liveActivityScheduleVersion.findMany({
    where: { OR: [{ id: current.id }, { broadcastUntil: { gte: new Date(now * 1000) } }] },
    select: { id: true, periods: true }, orderBy: { id: "asc" },
  });
  const digest = JSON.stringify([dateKey, config.bundleID, config.channels, versions]);
  if (digest === materializedDigest) { lastBroadcastMaterializedAt = now; return; }
  const events = [...versions.flatMap(v => schoolBroadcastEvents({ periods: JSON.parse(v.periods) }, dateKey, false, v.id)),
    ...clockBroadcastEvents(dateKey)];
  const rows = events.flatMap(({ windowID, ...event }) => ["production", "sandbox"].flatMap(environment => {
    const channelID = config.channels[windowChannelKey(environment, windowID)];
    return channelID ? [{ ...event, environment, channelID, bundleID: config.bundleID }] : [];
  }));
  // Retire old protocol events and obsolete times after timetable edits.
  await db.liveActivityBroadcastEvent.updateMany({
    where: { state: "pending", NOT: { OR: rows.map(row => ({ channelID: row.channelID, eventID: row.eventID })) } },
    data: { state: "skipped", detail: "已替换为当前学校广播时间", claimedUntil: null },
  });
  // Event identity includes the immutable timing version and date. Preserve
  // sent/retry/claim state on restarts and across competing schedulers.
  for (let offset = 0; offset < rows.length; offset += 500) {
    await db.liveActivityBroadcastEvent.createMany({ data: rows.slice(offset, offset + 500), skipDuplicates: true });
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
