import crypto from "node:crypto";
import { prisma } from "../../prisma";
import { getSiteOrigin } from "../siteSettings";

const QqBotAiReplyShareTtlMs = 30 * 24 * 60 * 60 * 1000;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_ANSWER_LENGTH = 32_000;
const MAX_ACTIONS = 8;

export type QqBotAiReplyShareAction = {
  label: string;
  url: string;
};

export type QqBotAiReplyShareRecord = {
  token: string;
  question: string;
  answer: string;
  actions: QqBotAiReplyShareAction[];
  createdAt: Date;
  expiresAt: Date;
};

export async function createQqBotAiReplyShare(input: {
  question: string;
  answer: string;
  actions?: QqBotAiReplyShareAction[];
}): Promise<string | null> {
  const origin = normalizePublicOrigin(getSiteOrigin());
  if (!origin) return null;

  const token = crypto.randomBytes(16).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QqBotAiReplyShareTtlMs);
  const actions = normalizeActions(input.actions);

  try {
    await prisma.qqBotAiReplyShare.create({
      data: {
        token,
        question: String(input.question || "").trim().slice(0, MAX_QUESTION_LENGTH),
        answer: String(input.answer || "").trim().slice(0, MAX_ANSWER_LENGTH),
        actions: JSON.stringify(actions),
        createdAt: now,
        expiresAt,
      },
    });
    void prisma.qqBotAiReplyShare.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => undefined);
    return `${origin}/qqbot/ai-reply/${encodeURIComponent(token)}`;
  } catch (error) {
    console.warn("[qqbot] failed to create AI reply share", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getQqBotAiReplyShare(token: string): Promise<QqBotAiReplyShareRecord | null> {
  const cleanToken = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/u.test(cleanToken)) return null;

  const record = await prisma.qqBotAiReplyShare.findUnique({ where: { token: cleanToken } });
  if (!record) return null;
  if (record.expiresAt.getTime() <= Date.now()) {
    void prisma.qqBotAiReplyShare.delete({ where: { token: cleanToken } }).catch(() => undefined);
    return null;
  }

  return {
    token: record.token,
    question: record.question,
    answer: record.answer,
    actions: normalizeActions(parseActions(record.actions)),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function parseActions(value: string): unknown {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

function normalizeActions(value: unknown): QqBotAiReplyShareAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const item = entry as { label?: unknown; url?: unknown };
      return {
        label: String(item?.label || "相关入口").trim().slice(0, 160),
        url: String(item?.url || "").trim().slice(0, 1_000),
      };
    })
    .filter((entry) => entry.label && isHttpUrl(entry.url))
    .slice(0, MAX_ACTIONS);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizePublicOrigin(value: string): string {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return "";
  }
}
