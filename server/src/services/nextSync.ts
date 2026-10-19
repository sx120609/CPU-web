import { z } from "zod";
import { prisma } from "../prisma";

/**
 * 药大拾间 NEXT 的跨设备同步。每台手机把自己的日程、拾间AI 对话和操作记录按条
 * 推上来，再拉下其他设备改过的条目；同一条以客户端修改时间新的为准，删除留下
 * 墓碑，免得离线的设备把删掉的东西又推回来。这里只校验大小和格式，不解读内容。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const RECORD_ID = /^[A-Za-z0-9_-]{6,40}$/u;
/** A device clock ahead of the server cannot make its edits win for ever. */
const MAX_CLOCK_LEAD_MS = 60_000;
/** Deleted records are remembered this long, so devices that were offline drop them too. */
const TOMBSTONE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
export const NEXT_SYNC_PAGE_SIZE = 200;
export const NEXT_SYNC_MAX_PUSH = 50;

const dateOrEmpty = z.union([z.string().regex(DATE), z.literal("")]).default("");
const timeOrEmpty = z.union([z.string().regex(TIME), z.literal("")]).default("");
const shortId = z.string().max(40).default("");

const agendaSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,24}$/u),
  kind: z.enum(["event", "todo"]).default("event"),
  title: z.string().trim().min(1).max(60),
  date: dateOrEmpty,
  start: timeOrEmpty,
  end: timeOrEmpty,
  location: z.string().max(40).default(""),
  note: z.string().max(1_000).default(""),
  remind: z.number().int().min(-1).max(10_080).default(-1),
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]).default("none"),
  until: dateOrEmpty,
  done: z.boolean().default(false),
  doneDates: z.array(z.string().regex(DATE)).max(400).default([]),
  createdAt: z.number().int().min(0).default(0),
  updatedAt: z.number().int().min(0).default(0),
  origin: z.enum(["user", "assistant"]).default("user"),
});

/** An action 拾间AI proposed, as the app stored it: a small JSON object. */
const actionSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 4_000, "action too large");

const conversationSchema = z.object({
  title: z.string().max(60).default(""),
  messages: z.array(z.object({
    id: z.string().min(1).max(40),
    fromUser: z.boolean(),
    text: z.string().max(8_000).default(""),
    failed: z.boolean().default(false),
    links: z.array(z.object({ label: z.string().max(40), url: z.string().max(300) })).max(3).default([]),
    proposals: z.array(z.object({
      id: z.string().min(1).max(40),
      action: actionSchema,
      state: z.enum(["Pending", "Applied", "Dismissed", "Failed"]).default("Dismissed"),
      note: z.string().max(200).default(""),
      /** Run without asking, under the user's confirmation setting. */
      auto: z.boolean().default(false),
    })).max(8).default([]),
  })).max(80).default([]),
});

const activitySchema = z.object({
  at: z.number().int().min(0),
  conversationId: shortId,
  messageId: shortId,
  proposalId: shortId,
  action: actionSchema,
  note: z.string().max(200).default(""),
  device: z.string().max(40).default(""),
  state: z.enum(["applied", "undone", "failed"]).default("applied"),
  auto: z.boolean().default(false),
});

/** Each collection: its record format, how many live records a user may keep, and the largest record. */
export const NEXT_SYNC_COLLECTIONS = {
  agenda: { schema: agendaSchema, max: 600, maxBytes: 4_000, overflow: "reject" },
  conversation: { schema: conversationSchema, max: 100, maxBytes: 120_000, overflow: "prune" },
  activity: { schema: activitySchema, max: 300, maxBytes: 5_000, overflow: "prune" },
} as const;

export type NextSyncCollection = keyof typeof NEXT_SYNC_COLLECTIONS;

export const nextSyncPushSchema = z.object({
  records: z.array(z.object({
    collection: z.string().max(20),
    id: z.string().max(40),
    updatedAt: z.number().int().min(0),
    deleted: z.boolean().default(false),
    data: z.unknown().optional(),
  }).strict()).min(1).max(NEXT_SYNC_MAX_PUSH),
}).strict();

export type NextSyncIncoming = z.infer<typeof nextSyncPushSchema>["records"][number];

export type NextSyncRecordOut = {
  collection: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
};

/** One incoming record made safe, or the reason it is refused. */
export function sanitizeNextSyncRecord(record: NextSyncIncoming, serverNow: number):
  { ok: true; collection: NextSyncCollection; id: string; updatedAt: number; deleted: boolean; data: string } | { ok: false; reason: string } {
  if (!Object.hasOwn(NEXT_SYNC_COLLECTIONS, record.collection)) return { ok: false, reason: "collection" };
  const collection = record.collection as NextSyncCollection;
  if (!RECORD_ID.test(record.id)) return { ok: false, reason: "id" };
  const updatedAt = Math.min(record.updatedAt, serverNow + MAX_CLOCK_LEAD_MS);
  if (record.deleted) return { ok: true, collection, id: record.id, updatedAt, deleted: true, data: "" };
  const spec = NEXT_SYNC_COLLECTIONS[collection];
  const parsed = spec.schema.safeParse(record.data);
  if (!parsed.success) return { ok: false, reason: "format" };
  if (collection === "agenda" && (parsed.data as z.infer<typeof agendaSchema>).id !== record.id) return { ok: false, reason: "id" };
  const data = JSON.stringify(parsed.data);
  if (data.length > spec.maxBytes) return { ok: false, reason: "size" };
  return { ok: true, collection, id: record.id, updatedAt, deleted: false, data };
}

/** Whether an incoming edit replaces what the server holds: strictly newer wins, ties keep the stored one. */
export function nextSyncWins(stored: { clientUpdatedAt: Date } | null, incomingUpdatedAt: number) {
  return !stored || incomingUpdatedAt > stored.clientUpdatedAt.getTime();
}

/** `ms:collection:id` of the last record a device has seen; empty starts from the beginning. */
export function parseNextSyncCursor(value: unknown): { at: Date; collection: string; id: string } | null {
  if (typeof value !== "string" || !value) return null;
  const match = /^(\d{1,15}):([a-z]{1,20}):([A-Za-z0-9_-]{1,40})$/u.exec(value);
  if (!match) return null;
  return { at: new Date(Number(match[1])), collection: match[2], id: match[3] };
}

export function formatNextSyncCursor(row: { updatedAt: Date; collection: string; id: string }) {
  return `${row.updatedAt.getTime()}:${row.collection}:${row.id}`;
}

function toOut(row: { collection: string; id: string; data: string; clientUpdatedAt: Date; deletedAt: Date | null }): NextSyncRecordOut {
  let data: unknown = null;
  if (!row.deletedAt) {
    try { data = JSON.parse(row.data); } catch { data = null; }
  }
  return { collection: row.collection, id: row.id, updatedAt: row.clientUpdatedAt.getTime(), deleted: Boolean(row.deletedAt) || data === null, data };
}

/** The records changed after [cursor], oldest change first, one page at a time. */
export async function listNextSyncChanges(userId: number, cursorValue: unknown) {
  const cursor = parseNextSyncCursor(cursorValue);
  await prisma.nextSyncRecord.deleteMany({
    where: { userId, deletedAt: { lt: new Date(Date.now() - TOMBSTONE_LIFETIME_MS) } },
  });
  const rows = await prisma.nextSyncRecord.findMany({
    where: {
      userId,
      ...(cursor ? {
        OR: [
          { updatedAt: { gt: cursor.at } },
          { updatedAt: cursor.at, collection: { gt: cursor.collection } },
          { updatedAt: cursor.at, collection: cursor.collection, id: { gt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ updatedAt: "asc" }, { collection: "asc" }, { id: "asc" }],
    take: NEXT_SYNC_PAGE_SIZE + 1,
  });
  const more = rows.length > NEXT_SYNC_PAGE_SIZE;
  const page = rows.slice(0, NEXT_SYNC_PAGE_SIZE);
  const last = page.at(-1);
  return {
    records: page.map(toOut),
    cursor: last ? formatNextSyncCursor(last) : typeof cursorValue === "string" && cursor ? cursorValue : "",
    more,
  };
}

/**
 * Applies a device's changes. Newer edits replace the stored ones; for older
 * ones the stored record comes back so the device can adopt it. A collection
 * over its limit drops its oldest records (conversations, the log) or refuses
 * new ones (agenda).
 */
export async function applyNextSyncChanges(userId: number, incoming: NextSyncIncoming[]) {
  const serverNow = Date.now();
  const applied: Array<{ collection: string; id: string }> = [];
  const newer: NextSyncRecordOut[] = [];
  const rejected: Array<{ collection: string; id: string; reason: string }> = [];
  const touched = new Set<NextSyncCollection>();
  for (const raw of incoming) {
    const record = sanitizeNextSyncRecord(raw, serverNow);
    if (!record.ok) {
      rejected.push({ collection: raw.collection, id: raw.id, reason: record.reason });
      continue;
    }
    const key = { userId_collection_id: { userId, collection: record.collection, id: record.id } };
    const stored = await prisma.nextSyncRecord.findUnique({ where: key });
    if (!nextSyncWins(stored, record.updatedAt)) {
      if (stored) newer.push(toOut(stored));
      continue;
    }
    const spec = NEXT_SYNC_COLLECTIONS[record.collection];
    if (!record.deleted && (!stored || stored.deletedAt) && spec.overflow === "reject") {
      const live = await prisma.nextSyncRecord.count({ where: { userId, collection: record.collection, deletedAt: null } });
      if (live >= spec.max) {
        rejected.push({ collection: record.collection, id: record.id, reason: "limit" });
        continue;
      }
    }
    const clientUpdatedAt = new Date(record.updatedAt);
    const values = record.deleted
      ? { data: "", clientUpdatedAt, deletedAt: new Date(serverNow) }
      : { data: record.data, clientUpdatedAt, deletedAt: null };
    await prisma.nextSyncRecord.upsert({
      where: key,
      create: { userId, collection: record.collection, id: record.id, ...values },
      update: values,
    });
    applied.push({ collection: record.collection, id: record.id });
    if (!record.deleted) touched.add(record.collection);
  }
  for (const collection of touched) {
    const spec = NEXT_SYNC_COLLECTIONS[collection];
    if (spec.overflow !== "prune") continue;
    const expired = await prisma.nextSyncRecord.findMany({
      where: { userId, collection, deletedAt: null },
      orderBy: [{ clientUpdatedAt: "desc" }, { id: "asc" }],
      skip: spec.max,
      select: { id: true },
    });
    if (expired.length) {
      await prisma.nextSyncRecord.updateMany({
        where: { userId, collection, id: { in: expired.map((row) => row.id) } },
        data: { data: "", deletedAt: new Date(serverNow), clientUpdatedAt: new Date(serverNow) },
      });
    }
  }
  return { applied, newer, rejected };
}

/** Removes everything this user's devices synced (the devices keep their own copies). */
export async function clearNextSync(userId: number) {
  const { count } = await prisma.nextSyncRecord.deleteMany({ where: { userId } });
  return { deleted: count };
}
