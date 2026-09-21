import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

const KEYS = {
  keyPath: "apns.keyPath",
  keyID: "apns.keyID",
  teamID: "apns.teamID",
  bundleID: "apns.bundleID",
  tickSeconds: "apns.tickSeconds",
  channels: "apns.channels",
} as const;

export type ApnsConfig = {
  keyPath: string;
  keyID: string;
  teamID: string;
  bundleID: string;
  tickSeconds: number;
  channels: Record<string, string>;
  configured: boolean;
  updatedAt: string | null;
};

function envFallback(): ApnsConfig {
  const channels = (() => {
    try {
      const value = JSON.parse(process.env.CPU_APNS_CHANNELS_JSON || "{}");
      return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" ? item : String((item as any)?.channelID || (item as any)?.channelId || ""),
      ]).filter(([, value]) => value)) : {};
    } catch { return {}; }
  })();
  const keyPath = String(process.env.CPU_APNS_KEY_PATH || "").trim();
  const keyID = String(process.env.CPU_APNS_KEY_ID || "").trim();
  const teamID = String(process.env.CPU_APNS_TEAM_ID || "").trim();
  const bundleID = String(process.env.CPU_APNS_BUNDLE_ID || "").trim();
  return {
    keyPath, keyID, teamID, bundleID,
    tickSeconds: Number(process.env.CPU_APNS_TICK_SECONDS || 5) || 5,
    channels,
    configured: Boolean(keyPath && keyID && teamID && bundleID),
    updatedAt: null,
  };
}

export async function getApnsConfig(db: Prisma.TransactionClient = prisma): Promise<ApnsConfig> {
  const rows = await db.siteSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  if (!rows.length) return envFallback();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const keyPath = String(values.get(KEYS.keyPath) || "").trim();
  const keyID = String(values.get(KEYS.keyID) || "").trim();
  const teamID = String(values.get(KEYS.teamID) || "").trim();
  const bundleID = String(values.get(KEYS.bundleID) || "").trim();
  let channels: Record<string, string> = {};
  try {
    const value = JSON.parse(values.get(KEYS.channels) || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      channels = Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" ? item : String((item as any)?.channelID || (item as any)?.channelId || ""),
      ]).filter(([, value]) => value));
    }
  } catch { /* malformed legacy data is treated as an empty channel map */ }
  const updatedAt = rows.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null);
  const tick = Number(values.get(KEYS.tickSeconds) || 5);
  return {
    keyPath, keyID, teamID, bundleID,
    tickSeconds: Number.isFinite(tick) ? tick : 5,
    channels,
    configured: Boolean(keyPath && keyID && teamID && bundleID),
    updatedAt: updatedAt?.toISOString() || null,
  };
}

export function normalizeApnsConfig(input: unknown) {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fields = Object.fromEntries(["keyPath", "keyID", "teamID", "bundleID"].map((key) => [key, String(value[key] || "").trim()])) as Record<string, string>;
  if (Object.values(fields).some(Boolean) && !Object.values(fields).every(Boolean)) {
    throw new Error("keyPath、keyID、teamID 和 bundleID 必须同时填写");
  }
  const tickSeconds = Number(value.tickSeconds ?? 5);
  if (!Number.isFinite(tickSeconds) || tickSeconds < 0.5 || tickSeconds > 3600) throw new Error("推送调度间隔必须在 0.5-3600 秒之间");
  const rawChannels = value.channels && typeof value.channels === "object" && !Array.isArray(value.channels) ? value.channels as Record<string, unknown> : {};
  const channels: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(rawChannels)) {
    const key = rawKey.trim();
    const channel = typeof rawValue === "string" ? rawValue.trim() : String((rawValue as any)?.channelID || (rawValue as any)?.channelId || "").trim();
    if (!key && !channel) continue;
    const [environment, schoolID] = key.split(":", 2);
    if (!schoolID || !["production", "sandbox"].includes(environment) || !channel) {
      throw new Error("频道键必须是 production:学校ID 或 sandbox:学校ID，且频道 ID 有效");
    }
    channels[key] = channel;
  }
  return {
    keyPath: fields.keyPath,
    keyID: fields.keyID,
    teamID: fields.teamID,
    bundleID: fields.bundleID,
    tickSeconds,
    channels,
  };
}

export async function saveApnsConfig(input: unknown): Promise<ApnsConfig> {
  const value = normalizeApnsConfig(input);
  if (value.keyPath) {
    const key = createPrivateKey(await readFile(value.keyPath, "utf8"));
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("APNs 密钥必须是 P-256 EC 私钥");
    }
  }
  return withApnsConfigLock(async (db) => {
    const previous = await getApnsConfig(db);
    // Channels belong to the App ID and team. Form submissions never supply IDs.
    const channels = previous.bundleID === value.bundleID && previous.teamID === value.teamID
      ? previous.channels : {};
    for (const [key, setting] of Object.entries({
      [KEYS.keyPath]: value.keyPath,
      [KEYS.keyID]: value.keyID,
      [KEYS.teamID]: value.teamID,
      [KEYS.bundleID]: value.bundleID,
      [KEYS.tickSeconds]: String(value.tickSeconds),
      [KEYS.channels]: JSON.stringify(channels),
    })) {
      await db.siteSetting.upsert({ where: { key }, create: { key, value: setting }, update: { value: setting } });
    }
    return getApnsConfig(db);
  });
}

// Serializes saves and channel creation across processes during a rolling deploy.
export function withApnsConfigLock<T>(operation: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(742091, 1)::text`;
    return operation(db);
  }, { timeout: 60000, maxWait: 5000 });
}
