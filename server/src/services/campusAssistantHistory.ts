import { prisma } from "../prisma";

export const CAMPUS_ASSISTANT_HISTORY_LIMIT = 20;

export type StoredCampusAssistantConversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: unknown[];
};

type SaveCampusAssistantConversationInput = StoredCampusAssistantConversation;

export async function listCampusAssistantConversations(userId: number) {
  const rows = await prisma.campusAssistantConversation.findMany({
    where: { userId },
    orderBy: [{ clientUpdatedAt: "desc" }, { updatedAt: "desc" }],
    take: CAMPUS_ASSISTANT_HISTORY_LIMIT,
  });
  return rows.map(toStoredConversation);
}

export async function saveCampusAssistantConversation(
  userId: number,
  input: SaveCampusAssistantConversationInput,
) {
  const clientUpdatedAt = new Date(input.updatedAt);
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.campusAssistantConversation.findUnique({
      where: { userId_id: { userId, id: input.id } },
    });
    if (existing && existing.clientUpdatedAt.getTime() > clientUpdatedAt.getTime()) {
      return existing;
    }
    return tx.campusAssistantConversation.upsert({
      where: { userId_id: { userId, id: input.id } },
      create: {
        id: input.id,
        userId,
        title: input.title,
        messages: JSON.stringify(input.messages),
        clientUpdatedAt,
      },
      update: {
        title: input.title,
        messages: JSON.stringify(input.messages),
        clientUpdatedAt,
      },
    });
  });

  const expired = await prisma.campusAssistantConversation.findMany({
    where: { userId },
    orderBy: [{ clientUpdatedAt: "desc" }, { updatedAt: "desc" }],
    skip: CAMPUS_ASSISTANT_HISTORY_LIMIT,
    select: { id: true },
  });
  if (expired.length) {
    await prisma.campusAssistantConversation.deleteMany({
      where: { userId, id: { in: expired.map((item) => item.id) } },
    });
  }
  return toStoredConversation(saved);
}

export async function deleteCampusAssistantConversation(userId: number, id: string) {
  await prisma.campusAssistantConversation.deleteMany({ where: { userId, id } });
}

function toStoredConversation(row: {
  id: string;
  title: string;
  messages: string;
  clientUpdatedAt: Date;
}): StoredCampusAssistantConversation {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.clientUpdatedAt.getTime(),
    messages: parseMessages(row.messages),
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
