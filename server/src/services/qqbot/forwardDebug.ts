import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { prisma } from "../../prisma";

const QQBOT_FORWARD_DEBUG_FILE = path.resolve(process.cwd(), "runtime", "qqbot-forward-debug.ndjson");
const QQBOT_FORWARD_DEBUG_EXPORT_LIMIT = 200;

export async function buildQqBotDebugExport(input: {
  status?: string;
  eventType?: string;
  take?: number;
}) {
  const take = Math.min(200, Math.max(20, Number(input.take ?? 80) || 80));
  const where: any = {};
  if (input.status) where.status = input.status;
  if (input.eventType) where.eventType = input.eventType;
  const [messageLogs, forwardDebugEntries] = await Promise.all([
    prisma.qqBotMessageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: { user: { select: { id: true, username: true, nickname: true } } },
    }),
    readQqBotForwardDebugEntries(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    filters: {
      status: input.status || "",
      eventType: input.eventType || "",
      take,
    },
    messageLogs: messageLogs.map((row) => ({
      ...row,
      rawPayload: parseJsonTextMaybe(row.rawPayload),
    })),
    forwardDebugEntries,
  };
}

export function queueQqBotForwardDebug(stage: string, payload: Record<string, unknown>) {
  void appendQqBotForwardDebug(stage, payload);
}

function parseJsonTextMaybe(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readQqBotForwardDebugEntries(limit = QQBOT_FORWARD_DEBUG_EXPORT_LIMIT) {
  const raw = await readFile(QQBOT_FORWARD_DEBUG_FILE, "utf8").catch(() => "");
  if (!raw.trim()) return [] as any[];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => parseJsonTextMaybe(line));
}

function trimDebugValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= 5) return "[depth-limit]";
  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated ${value.length - 4000} chars]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const trimmed = value.slice(0, 20).map((item) => trimDebugValue(item, depth + 1));
    if (value.length > 20) trimmed.push(`[truncated ${value.length - 20} items]`);
    return trimmed;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, 30)) out[key] = trimDebugValue(item, depth + 1);
    if (entries.length > 30) out.__truncatedKeys = `[truncated ${entries.length - 30} keys]`;
    return out;
  }
  return String(value);
}

async function appendQqBotForwardDebug(stage: string, payload: Record<string, unknown>) {
  const trimmedPayload = trimDebugValue(payload);
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    stage,
    ...(
      trimmedPayload && typeof trimmedPayload === "object" && !Array.isArray(trimmedPayload)
        ? trimmedPayload as Record<string, unknown>
        : { payload: trimmedPayload }
    ),
  });
  await mkdir(path.dirname(QQBOT_FORWARD_DEBUG_FILE), { recursive: true });
  await appendFile(QQBOT_FORWARD_DEBUG_FILE, `${entry}\n`, "utf8").catch(() => undefined);
}
