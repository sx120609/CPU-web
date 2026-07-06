import { prisma } from "../prisma";

export const RADIO_TOOL_CODE = "radio_beta" as const;
export const RADIO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const RADIO_SEMESTER_STATUSES = ["draft", "active", "archived"] as const;
export const RADIO_SCHEDULE_STATUSES = ["draft", "published", "archived"] as const;
export const RADIO_REQUEST_STATUSES = ["pending", "approved", "fulfilled", "rejected"] as const;

function parseStringArray(raw: string | null | undefined) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}

export function normalizeRadioTags(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return input.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20);
}

export function serializeRadioTags(input: unknown) {
  return JSON.stringify(normalizeRadioTags(input));
}

export function normalizeRadioSemester(row: any) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    isCurrent: row.isCurrent,
    startDate: row.startDate,
    endDate: row.endDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      username: row.createdBy.username,
      nickname: row.createdBy.nickname,
      role: row.createdBy.role,
    } : null,
    counts: row._count ? {
      playTimes: row._count.playTimes ?? 0,
      scheduleItems: row._count.scheduleItems ?? 0,
    } : undefined,
  };
}

export function normalizeRadioPlayTime(row: any) {
  return {
    id: row.id,
    semesterId: row.semesterId,
    name: row.name,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    note: row.note,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    semester: row.semester ? {
      id: row.semester.id,
      code: row.semester.code,
      name: row.semester.name,
      status: row.semester.status,
      isCurrent: row.semester.isCurrent,
    } : null,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      username: row.createdBy.username,
      nickname: row.createdBy.nickname,
      role: row.createdBy.role,
    } : null,
    counts: row._count ? {
      scheduleItems: row._count.scheduleItems ?? 0,
    } : undefined,
  };
}

export function normalizeRadioScheduleItem(row: any) {
  return {
    id: row.id,
    semesterId: row.semesterId,
    playTimeId: row.playTimeId,
    title: row.title,
    subtitle: row.subtitle,
    hostNames: row.hostNames,
    summary: row.summary,
    coverImage: row.coverImage,
    tags: parseStringArray(row.tags),
    requestEnabled: row.requestEnabled,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    semester: row.semester ? {
      id: row.semester.id,
      code: row.semester.code,
      name: row.semester.name,
      status: row.semester.status,
      isCurrent: row.semester.isCurrent,
    } : null,
    playTime: row.playTime ? {
      id: row.playTime.id,
      name: row.playTime.name,
      weekday: row.playTime.weekday,
      startTime: row.playTime.startTime,
      endTime: row.playTime.endTime,
      location: row.playTime.location,
      enabled: row.playTime.enabled,
      sortOrder: row.playTime.sortOrder,
    } : null,
    createdBy: row.createdBy ? {
      id: row.createdBy.id,
      username: row.createdBy.username,
      nickname: row.createdBy.nickname,
      role: row.createdBy.role,
    } : null,
    requestCount: row._count?.songRequests ?? 0,
  };
}

export function normalizeRadioSongRequest(row: any) {
  return {
    id: row.id,
    scheduleItemId: row.scheduleItemId,
    requesterId: row.requesterId,
    nickname: row.nickname,
    contact: row.contact,
    songTitle: row.songTitle,
    artist: row.artist,
    dedication: row.dedication,
    message: row.message,
    status: row.status,
    adminNote: row.adminNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scheduleItem: row.scheduleItem ? {
      id: row.scheduleItem.id,
      title: row.scheduleItem.title,
      subtitle: row.scheduleItem.subtitle,
      requestEnabled: row.scheduleItem.requestEnabled,
    } : null,
    requester: row.requester ? {
      id: row.requester.id,
      username: row.requester.username,
      nickname: row.requester.nickname,
      role: row.requester.role,
    } : null,
    reviewedBy: row.reviewedBy ? {
      id: row.reviewedBy.id,
      username: row.reviewedBy.username,
      nickname: row.reviewedBy.nickname,
      role: row.reviewedBy.role,
    } : null,
  };
}

export async function resolveCurrentRadioSemester() {
  const current = await prisma.radioSemester.findFirst({
    where: {
      OR: [
        { isCurrent: true },
        { status: "active" },
      ],
    },
    orderBy: [
      { isCurrent: "desc" },
      { status: "asc" },
      { startDate: "desc" },
      { id: "desc" },
    ],
    include: {
      createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      _count: { select: { playTimes: true, scheduleItems: true } },
    },
  });
  if (current) return current;
  return prisma.radioSemester.findFirst({
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    include: {
      createdBy: { select: { id: true, username: true, nickname: true, role: true } },
      _count: { select: { playTimes: true, scheduleItems: true } },
    },
  });
}
