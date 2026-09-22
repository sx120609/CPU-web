import { prisma } from "../prisma";
import { appleReferenceSeconds, sendLiveActivityBroadcast } from "./apnsClient";
import { getApnsConfig } from "./apnsConfig";
import { getSchedulePeriods, listScheduleTermConfigs, type ScheduleTermConfigValue } from "./scheduleTermConfig";
import { adjustmentForDate, isMovedSourceDate } from "../shared/scheduleAdjustments";
import { scheduleBlocks } from "./liveActivityBlocks";
import { dayChannelDates, ensureDayChannels } from "./apnsChannels";

import { tickRemoteStarts } from "./liveActivityRemoteStart";

const db = prisma;
const TICK_MS = 5_000;
const CLAIM_MS = 30_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 300_000;
let lastBroadcastMaterializedAt = 0;
let materializedDigest = "";

// The client receives only public school timing/channel metadata. No device
// token, personal timetable, activity state or future personal plan is stored.
export async function liveActivityBroadcastConfig(environment: string, bundleID: string, daily = false) {
  const config = await getApnsConfig();
  if (!["production", "sandbox"].includes(environment)) throw new Error("APNs 环境无效");
  if (config.configured && bundleID !== config.bundleID) throw new Error("Bundle ID 与 CPU APNs 配置不一致");
  if (daily) return {
    mode: "local-scheduled", minimumIOSVersion: 26,
    windows: dayChannelDates().map(date => ({ id: date, startHour: 0, endHour: 24,
      channelID: config.configured ? config.channels[`${environment}:cpu-day:${date}`] || null : null })),
  };
  // Blocks are school-wide clock ranges. Their channels are per school date and
  // provisioned two days ahead, so the client never needs a channel ID: it only
  // groups its own courses, and the server resolves the channel when it sends.
  const blocks = scheduleBlocks(await getSchedulePeriods());
  return {
    mode: "broadcast", minimumIOSVersion: 18,
    windows: blocks.map(block => ({ id: block.id, startClock: block.startClock, endClock: block.endClock })),
  };
}

export function broadcastPayload(dateKey: string, timestamp: number, ended = false) {
  return { aps: {
    timestamp: Math.floor(timestamp), event: ended ? "end" : "update",
    ...(ended ? { "dismissal-date": Math.floor(timestamp) } : {}),
    "content-state": {
      phase: "upcoming", courseName: "", teacher: "", location: "",
      startDate: appleReferenceSeconds(timestamp), endDate: appleReferenceSeconds(timestamp),
      updatedAt: appleReferenceSeconds(timestamp), broadcastDateKey: dateKey,
      broadcastTimestamp: appleReferenceSeconds(timestamp),
    },
  } };
}

/** Build school-wide signals for one date, independent of registered users. */
export function schoolBroadcastEvents(term: ScheduleTermConfigValue, dateKey: string, daily = false) {
  const day = new Date(`${dateKey}T00:00:00Z`);
  const termEnd = new Date(`${term.semesterStartMonday}T00:00:00Z`);
  termEnd.setUTCDate(termEnd.getUTCDate() + term.weekCount * 7);
  if (dateKey < term.semesterStartMonday || day >= termEnd) return [];
  const adjustment = adjustmentForDate(term.adjustments, dateKey);
  if (adjustment?.kind === "off" || isMovedSourceDate(term.adjustments, dateKey)) return [];
  // Weekend classes can exist in the local timetable; an empty day is filtered
  // on the phone, never inferred from the weekday by the broadcast server.
  // iOS 26 takes the whole day on one tick-only channel; iOS 18-25 takes one
  // channel per block so the block end dismisses exactly its own activities.
  const windows = daily
    ? [{ id: `day:${dateKey}`, periods: term.periods }]
    : scheduleBlocks(term.periods).map(block => ({ id: `block:${dateKey}:${block.id}`, periods: block.periods }));
  return windows.flatMap(window => {
    const periods = window.periods;
    if (!periods.length) return [];
    const seconds = (clock: string) => new Date(`${dateKey}T${clock}:00+08:00`).getTime() / 1000;
    const end = Math.max(...periods.map(p => seconds(p.end)));
    const boundaries = new Set(periods.flatMap(p => daily ? [seconds(p.start), seconds(p.end)] : [seconds(p.start) - 900, seconds(p.start), seconds(p.end)]));
    return [...boundaries].sort((a, b) => a - b).map(fireAt => ({
      windowID: window.id, eventID: `broadcast-v2-${dateKey}-${window.id}-${fireAt}`,
      fireAt: new Date(fireAt * 1000), expiresAt: new Date((fireAt + 60) * 1000),
      payload: JSON.stringify(broadcastPayload(dateKey, fireAt, !daily && fireAt === end)),
      event: !daily && fireAt === end ? "end" : "update",
    }));
  });
}

async function ensureBroadcastEvents(now: number) {
  if (now - lastBroadcastMaterializedAt < 60) return;
  const config = await getApnsConfig();
  if (!config.configured) return;
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now * 1000));
  const terms = await listScheduleTermConfigs();
  const digest = JSON.stringify([dateKey, config.bundleID, config.channels, terms]);
  if (digest === materializedDigest) { lastBroadcastMaterializedAt = now; return; }
  // Only today's school signals are materialized. Existing sent IDs dedupe
  // restarts; no seven-day, per-user schedule is involved.
  const events = terms.flatMap(term => [...schoolBroadcastEvents(term, dateKey), ...schoolBroadcastEvents(term, dateKey, true)]);
  const rows = events.flatMap(({ windowID, ...event }) => ["production", "sandbox"].flatMap(environment => {
    const channelID = config.channels[`${environment}:cpu-${windowID}`];
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
  await ensureDayChannels();
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
    if (row.bundleID !== config.bundleID || !Object.values(config.channels).includes(row.channelID) || row.expiresAt.getTime() / 1000 < now) {
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "skipped", detail: "广播事件已过期", claimedUntil: null } });
      continue;
    }
    try {
      const payload = JSON.parse(row.payload);
      const dayChannel = Object.entries(config.channels).some(([key, channel]) =>
        key.startsWith(`${row.environment}:cpu-day:`) && channel === row.channelID,
      );
      if (dayChannel) {
        payload.aps.event = "update";
        delete payload.aps["dismissal-date"];
      }
      await sendLiveActivityBroadcast({ environment: row.environment === "sandbox" ? "sandbox" : "production", bundleID: row.bundleID, channelID: row.channelID, payload, expiration: 0, collapseID: `cpu-${row.eventID}` });
      await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "sent", sentAt: new Date(), detail: "", claimedUntil: null } });
    } catch (error: any) {
      const detail = String(error?.message || error);
      if (retryableError(error) && row.expiresAt.getTime() / 1000 >= now) await retryBroadcast(row, now, detail);
      else await db.liveActivityBroadcastEvent.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "failed", detail: detail.slice(0, 500), claimedUntil: null } });
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
export function startLiveActivityPushScheduler() {
  if (timer || running) return;
  const tick = async () => {
    if (running) return;
    running = true;
    let delay = TICK_MS;
    try {
      await tickBroadcastEvents();
      const starts = await tickRemoteStarts();
      delay = starts === 200 ? 500 : (await getApnsConfig()).tickSeconds * 1000;
    } catch (error: any) { console.warn("[apns] 调度失败:", error?.message || error); }
    finally {
      running = false;
      timer = setTimeout(tick, Math.max(500, Math.min(3600000, delay)));
      timer.unref?.();
    }
  };
  void tick();
}
