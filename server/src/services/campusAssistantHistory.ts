import { prisma } from "../prisma";
import {
  isCampusAssistantPublicTopicRestricted,
  sanitizeCampusAssistantStoredMessages,
} from "./campusAssistant";

export const CAMPUS_ASSISTANT_HISTORY_LIMIT = 20;
const CAMPUS_ASSISTANT_TOMBSTONE_LIMIT = 200;

export type StoredCampusAssistantConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: unknown[];
  deletedAt?: number;
};

type SaveCampusAssistantConversationInput = Omit<StoredCampusAssistantConversation, "deletedAt">;

export async function listCampusAssistantConversations(userId: number) {
  const [rows, tombstones] = await Promise.all([
    prisma.campusAssistantConversation.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ clientUpdatedAt: "desc" }, { updatedAt: "desc" }],
      take: CAMPUS_ASSISTANT_HISTORY_LIMIT,
    }),
    prisma.campusAssistantConversation.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: [{ deletedAt: "desc" }, { updatedAt: "desc" }],
      take: CAMPUS_ASSISTANT_TOMBSTONE_LIMIT,
    }),
  ]);
  return [...rows, ...tombstones].map(toStoredConversation);
}

export async function saveCampusAssistantConversation(
  userId: number,
  input: SaveCampusAssistantConversationInput,
) {
  const sanitizedInput = sanitizeStoredConversation(input);
  const clientUpdatedAt = new Date(sanitizedInput.updatedAt);
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.campusAssistantConversation.findUnique({
      where: { userId_id: { userId, id: sanitizedInput.id } },
    });
    // A deleted conversation id must never be resurrected by a stale browser
    // snapshot. New conversations always receive a new UUID.
    if (existing?.deletedAt) return existing;
    if (existing && existing.clientUpdatedAt.getTime() > clientUpdatedAt.getTime()) {
      return existing;
    }
    return tx.campusAssistantConversation.upsert({
      where: { userId_id: { userId, id: sanitizedInput.id } },
      create: {
        id: sanitizedInput.id,
        userId,
        title: sanitizedInput.title,
        messages: JSON.stringify(sanitizedInput.messages),
        clientUpdatedAt,
      },
      update: {
        title: sanitizedInput.title,
        messages: JSON.stringify(sanitizedInput.messages),
        clientUpdatedAt,
        deletedAt: null,
      },
    });
  });

  const expired = await prisma.campusAssistantConversation.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ clientUpdatedAt: "desc" }, { updatedAt: "desc" }],
    skip: CAMPUS_ASSISTANT_HISTORY_LIMIT,
    select: { id: true },
  });
  if (expired.length) {
    const deletedAt = new Date();
    await prisma.campusAssistantConversation.updateMany({
      where: { userId, id: { in: expired.map((item) => item.id) } },
      data: {
        title: "",
        messages: "[]",
        clientUpdatedAt: deletedAt,
        deletedAt,
      },
    });
  }
  return toStoredConversation(saved);
}

export async function deleteCampusAssistantConversation(userId: number, id: string) {
  const deletedAt = new Date();
  const deleted = await prisma.campusAssistantConversation.upsert({
    where: { userId_id: { userId, id } },
    create: {
      id,
      userId,
      title: "",
      messages: "[]",
      clientUpdatedAt: deletedAt,
      deletedAt,
    },
    update: {
      title: "",
      messages: "[]",
      clientUpdatedAt: deletedAt,
      deletedAt,
    },
  });
  return toStoredConversation(deleted);
}

function toStoredConversation(row: {
  id: string;
  title: string;
  messages: string;
  clientUpdatedAt: Date;
  deletedAt: Date | null;
}): StoredCampusAssistantConversation {
  if (row.deletedAt) {
    return {
      id: row.id,
      title: "",
      updatedAt: row.clientUpdatedAt.getTime(),
      messages: [],
      deletedAt: row.deletedAt.getTime(),
    };
  }
  return sanitizeStoredConversation({
    id: row.id,
    title: row.title,
    updatedAt: row.clientUpdatedAt.getTime(),
    messages: parseMessages(row.messages),
  });
}

export function sanitizeStoredConversation(
  conversation: StoredCampusAssistantConversation,
): StoredCampusAssistantConversation {
  return {
    ...conversation,
    title: isCampusAssistantPublicTopicRestricted(conversation.title)
      ? "不适合展示的历史会话"
      : conversation.title,
    messages: sanitizeCampusAssistantStoredMessages(conversation.messages),
  };
}

function parseMessages(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
