import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  hasToolContentManagePermission,
  isSiteAdmin,
  listContentManageableToolCodes,
  type ServiceToolCode,
} from "./serviceTools";
import { dispatchRecentQqNotifications } from "./qqbot";

export const TOOL_QQ_NOTIFICATION_CATEGORY = "service-tool";
export const TOOL_QQ_NOTIFICATION_SOURCE = "小工具提醒";

export type ToolQqReminderTargetType = "questionnaire" | "file_collect" | "grade_check";
export type ToolQqReminderTiming = "instant" | "after" | "deadline";
export type ToolQqReminderEvent = "response" | "submission" | "lookup" | "feedback";

export type ToolQqReminderPatch = {
  enabled?: boolean;
  events?: string[];
  timing?: string;
  afterAt?: string | null;
  deadlineAt?: string | null;
  beforeDeadlineHours?: number | null;
};

type AccessUser = {
  userId?: number;
  role?: string;
} | null | undefined;

type ReminderNotificationInput = {
  ownerId?: number | null;
  enabled?: boolean | null;
  actorUserId?: number | null;
  title: string;
  content: string;
  link: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  dedupeWindowMs?: number;
};

const GRADE_LOOKUP_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;
let toolQqDispatchQueued = false;

const targetToolCode: Record<ToolQqReminderTargetType, ServiceToolCode> = {
  questionnaire: "questionnaire",
  file_collect: "file_collect",
  grade_check: "grade_check",
};
const reminderEvents: Record<ToolQqReminderTargetType, ToolQqReminderEvent[]> = {
  questionnaire: ["response"],
  file_collect: ["submission"],
  grade_check: ["lookup", "feedback"],
};
const reminderEventLabels: Record<ToolQqReminderEvent, string> = {
  response: "新答卷",
  submission: "新提交",
  lookup: "成绩查询",
  feedback: "问题反馈",
};
const reminderTimingOptions: ToolQqReminderTiming[] = ["instant", "after", "deadline"];

export function normalizeToolQqReminderTargetType(value: unknown): ToolQqReminderTargetType | null {
  if (value === "questionnaire" || value === "file_collect" || value === "grade_check") return value;
  return null;
}

export async function listToolQqReminderItems(user: AccessUser) {
  if (!user?.userId) return [];
  const manageableCodes = await listContentManageableToolCodes(user);
  const canSeeAll = isSiteAdmin(user.role);
  const tasks: Array<Promise<any[]>> = [];

  if (manageableCodes.includes("questionnaire")) {
    tasks.push(prisma.questionnaire.findMany({
      where: {
        toolCode: "questionnaire",
        isSystem: false,
        ...(canSeeAll ? {} : { createdById: user.userId }),
      },
      orderBy: [{ updatedAt: "desc" }],
      include: { _count: { select: { responses: true } } },
      take: 200,
    }).then((rows) => rows.map((row) => normalizeQuestionnaireReminderItem(row))));
  }

  if (manageableCodes.includes("grade_check")) {
    tasks.push(prisma.gradeCheckTable.findMany({
      where: canSeeAll ? {} : { createdById: user.userId },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }).then((rows) => rows.map((row) => normalizeGradeCheckReminderItem(row))));
  }

  if (manageableCodes.includes("file_collect")) {
    tasks.push(prisma.fileCollectTask.findMany({
      where: canSeeAll ? {} : { createdById: user.userId },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }).then((rows) => rows.map((row) => normalizeFileCollectReminderItem(row))));
  }

  const groups = await Promise.all(tasks);
  return groups.flat().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function updateToolQqReminderItem(
  user: AccessUser,
  targetType: ToolQqReminderTargetType,
  targetId: number,
  patch: ToolQqReminderPatch,
) {
  if (!user?.userId) throw Errors.unauthorized();
  const toolCode = targetToolCode[targetType];
  if (!(await hasToolContentManagePermission(toolCode, user))) {
    throw Errors.forbidden("没有该小工具的管理权限");
  }

  if (targetType === "questionnaire") {
    const current = await prisma.questionnaire.findUnique({
      where: { id: targetId },
      select: { id: true, createdById: true, toolCode: true, isSystem: true, qqBotNotifyEnabled: true, qqBotNotifyConfig: true },
    });
    if (!current || current.toolCode !== "questionnaire" || current.isSystem) throw Errors.notFound("问卷不存在");
    assertReminderOwner(current.createdById, user);
    const reminder = normalizeReminderPatch(targetType, current.qqBotNotifyEnabled, current.qqBotNotifyConfig, patch);
    const updated = await prisma.questionnaire.update({
      where: { id: targetId },
      data: { qqBotNotifyEnabled: reminder.enabled, qqBotNotifyConfig: JSON.stringify(reminder.config) },
      include: { _count: { select: { responses: true } } },
    });
    return normalizeQuestionnaireReminderItem(updated);
  }

  if (targetType === "grade_check") {
    const current = await prisma.gradeCheckTable.findUnique({
      where: { id: targetId },
      select: { id: true, createdById: true, qqBotNotifyEnabled: true, qqBotNotifyConfig: true },
    });
    if (!current) throw Errors.notFound("成绩核对表不存在");
    assertReminderOwner(current.createdById, user);
    const reminder = normalizeReminderPatch(targetType, current.qqBotNotifyEnabled, current.qqBotNotifyConfig, patch);
    const updated = await prisma.gradeCheckTable.update({
      where: { id: targetId },
      data: { qqBotNotifyEnabled: reminder.enabled, qqBotNotifyConfig: JSON.stringify(reminder.config) },
    });
    return normalizeGradeCheckReminderItem(updated);
  }

  const current = await prisma.fileCollectTask.findUnique({
    where: { id: targetId },
    select: { id: true, createdById: true, qqBotNotifyEnabled: true, qqBotNotifyConfig: true },
  });
  if (!current) throw Errors.notFound("收集任务不存在");
  assertReminderOwner(current.createdById, user);
  const reminder = normalizeReminderPatch(targetType, current.qqBotNotifyEnabled, current.qqBotNotifyConfig, patch);
  const updated = await prisma.fileCollectTask.update({
    where: { id: targetId },
    data: { qqBotNotifyEnabled: reminder.enabled, qqBotNotifyConfig: JSON.stringify(reminder.config) },
  });
  return normalizeFileCollectReminderItem(updated);
}

export async function notifyQuestionnaireResponseForQqBot(input: {
  questionnaire: {
    id: number;
    slug: string;
    title: string;
    toolCode: string;
    createdById: number | null;
    qqBotNotifyEnabled?: boolean | null;
    qqBotNotifyConfig?: string | null;
  };
  responseId: number;
  respondentId?: number | null;
}) {
  const feedbackTable = await prisma.gradeCheckTable.findFirst({
    where: { feedbackQuestionnaireSlug: input.questionnaire.slug },
    select: {
      id: true,
      slug: true,
      title: true,
      createdById: true,
      qqBotNotifyEnabled: true,
      qqBotNotifyConfig: true,
    },
  });
  if (feedbackTable) {
    return notifyGradeCheckFeedbackForQqBot({
      table: feedbackTable,
      responseId: input.responseId,
      respondentId: input.respondentId ?? null,
    });
  }
  if (input.questionnaire.toolCode !== "questionnaire") return null;

  const actor = await resolveUserLabel(input.respondentId);
  return createReminderNotification({
    ownerId: input.questionnaire.createdById,
    enabled: shouldTriggerToolQqReminder("questionnaire", "response", input.questionnaire.qqBotNotifyEnabled, input.questionnaire.qqBotNotifyConfig),
    actorUserId: input.respondentId,
    title: "问卷收到新答卷",
    content: `${actor || "有人"}提交了《${limitText(input.questionnaire.title, 48)}》。`,
    link: "/services/tools/manage?tool=questionnaire",
    payload: {
      type: "questionnaire-response",
      targetType: "questionnaire",
      targetId: input.questionnaire.id,
      responseId: input.responseId,
      slug: input.questionnaire.slug,
    },
  });
}

export async function notifyFileCollectSubmissionForQqBot(input: {
  task: {
    id: number;
    slug: string;
    title: string;
    createdById: number | null;
    qqBotNotifyEnabled?: boolean | null;
    qqBotNotifyConfig?: string | null;
    deadline?: Date | string | null;
  };
  submission: {
    id: number;
    identity?: string | null;
    submitterId?: number | null;
    data?: string | Record<string, unknown> | null;
  };
  fileCount?: number;
}) {
  const actor = await resolveUserLabel(input.submission.submitterId);
  const dataSummary = summarizeSubmissionData(input.submission.data);
  const identity = limitText(String(input.submission.identity || dataSummary || "").trim(), 36);
  const who = actor || (identity ? `提交者 ${identity}` : "有人");
  const fileText = Number(input.fileCount) > 0 ? `，包含 ${input.fileCount} 个文件` : "";
  return createReminderNotification({
    ownerId: input.task.createdById,
    enabled: shouldTriggerToolQqReminder("file_collect", "submission", input.task.qqBotNotifyEnabled, input.task.qqBotNotifyConfig, input.task.deadline),
    actorUserId: input.submission.submitterId,
    title: "文件收集收到新提交",
    content: `${who}提交了《${limitText(input.task.title, 48)}》${fileText}。`,
    link: "/services/tools/filestore",
    payload: {
      type: "file-collect-submission",
      targetType: "file_collect",
      targetId: input.task.id,
      submissionId: input.submission.id,
      slug: input.task.slug,
    },
  });
}

export async function notifyGradeCheckLookupForQqBot(input: {
  table: {
    id: number;
    slug: string;
    title: string;
    createdById: number | null;
    qqBotNotifyEnabled?: boolean | null;
    qqBotNotifyConfig?: string | null;
  };
  studentId: string;
  actorUserId?: number | null;
}) {
  const maskedStudentId = maskStudentId(input.studentId);
  return createReminderNotification({
    ownerId: input.table.createdById,
    enabled: shouldTriggerToolQqReminder("grade_check", "lookup", input.table.qqBotNotifyEnabled, input.table.qqBotNotifyConfig),
    actorUserId: input.actorUserId,
    title: "成绩核对表被查询",
    content: `有同学查询了《${limitText(input.table.title, 48)}》${maskedStudentId ? `（${maskedStudentId}）` : ""}。`,
    link: "/services/tools/manage?tool=grade_check",
    payload: {
      type: "grade-check-lookup",
      targetType: "grade_check",
      targetId: input.table.id,
      studentId: normalizeStudentIdForPayload(input.studentId),
      slug: input.table.slug,
    },
    dedupeKey: `grade-check-lookup:${input.table.id}:${normalizeStudentIdForPayload(input.studentId)}`,
    dedupeWindowMs: GRADE_LOOKUP_DEDUPE_WINDOW_MS,
  });
}

async function notifyGradeCheckFeedbackForQqBot(input: {
  table: {
    id: number;
    slug: string;
    title: string;
    createdById: number | null;
    qqBotNotifyEnabled?: boolean | null;
    qqBotNotifyConfig?: string | null;
  };
  responseId: number;
  respondentId?: number | null;
}) {
  const actor = await resolveUserLabel(input.respondentId);
  return createReminderNotification({
    ownerId: input.table.createdById,
    enabled: shouldTriggerToolQqReminder("grade_check", "feedback", input.table.qqBotNotifyEnabled, input.table.qqBotNotifyConfig),
    actorUserId: input.respondentId,
    title: "成绩核对收到问题反馈",
    content: `${actor || "有人"}提交了《${limitText(input.table.title, 48)}》的问题反馈。`,
    link: "/services/tools/manage?tool=grade_check",
    payload: {
      type: "grade-check-feedback",
      targetType: "grade_check",
      targetId: input.table.id,
      responseId: input.responseId,
      slug: input.table.slug,
    },
  });
}

async function createReminderNotification(input: ReminderNotificationInput) {
  if (!input.enabled || !input.ownerId) return null;
  const payload = input.dedupeKey
    ? { ...input.payload, dedupeKey: input.dedupeKey }
    : input.payload;
  const payloadText = JSON.stringify(payload);
  if (input.dedupeKey && input.dedupeWindowMs) {
    const duplicated = await prisma.notification.findFirst({
      where: {
        userId: input.ownerId,
        category: TOOL_QQ_NOTIFICATION_CATEGORY,
        createdAt: { gte: new Date(Date.now() - input.dedupeWindowMs) },
        payload: { contains: `"dedupeKey":"${input.dedupeKey}"` },
      },
      select: { id: true },
    });
    if (duplicated) return null;
  }
  const notification = await prisma.notification.create({
    data: {
      userId: input.ownerId,
      category: TOOL_QQ_NOTIFICATION_CATEGORY,
      level: "normal",
      title: input.title,
      content: input.content,
      payload: payloadText,
      link: input.link,
      source: TOOL_QQ_NOTIFICATION_SOURCE,
    },
  });
  queueToolQqDispatch();
  return notification;
}

function assertReminderOwner(createdById: number | null, user: AccessUser) {
  if (!user?.userId || (!isSiteAdmin(user.role) && createdById !== user.userId)) {
    throw Errors.forbidden("只能设置自己发起的小工具提醒");
  }
}

function normalizeReminderPatch(
  targetType: ToolQqReminderTargetType,
  currentEnabled: boolean,
  currentRawConfig: string | null | undefined,
  patch: ToolQqReminderPatch,
) {
  const current = parseToolQqReminderConfig(targetType, currentRawConfig);
  const enabled = patch.enabled === undefined ? Boolean(currentEnabled) : Boolean(patch.enabled);
  const nextEvents = patch.events === undefined
    ? current.events
    : normalizeReminderEvents(targetType, patch.events);
  const nextTiming = patch.timing === undefined
    ? current.timing
    : normalizeReminderTiming(patch.timing);
  return {
    enabled,
    config: {
      events: nextEvents,
      timing: nextTiming,
      afterAt: patch.afterAt === undefined ? current.afterAt : normalizeDateString(patch.afterAt),
      deadlineAt: patch.deadlineAt === undefined ? current.deadlineAt : normalizeDateString(patch.deadlineAt),
      beforeDeadlineHours: patch.beforeDeadlineHours === undefined
        ? current.beforeDeadlineHours
        : normalizeBeforeDeadlineHours(patch.beforeDeadlineHours),
    },
  };
}

function parseToolQqReminderConfig(
  targetType: ToolQqReminderTargetType,
  raw: string | null | undefined,
  fallbackDeadline?: Date | string | null,
) {
  const parsed = parseJsonObject(raw || "{}") as Record<string, unknown>;
  const timing = normalizeReminderTiming(parsed.timing);
  const deadlineAt = normalizeDateString(parsed.deadlineAt) || normalizeDateString(fallbackDeadline);
  return {
    events: normalizeReminderEvents(targetType, Array.isArray(parsed.events) ? parsed.events.map(String) : undefined),
    timing,
    afterAt: normalizeDateString(parsed.afterAt),
    deadlineAt,
    beforeDeadlineHours: normalizeBeforeDeadlineHours(parsed.beforeDeadlineHours),
  };
}

function shouldTriggerToolQqReminder(
  targetType: ToolQqReminderTargetType,
  event: ToolQqReminderEvent,
  enabled?: boolean | null,
  rawConfig?: string | null,
  fallbackDeadline?: Date | string | null,
) {
  if (!enabled) return false;
  const config = parseToolQqReminderConfig(targetType, rawConfig, fallbackDeadline);
  if (!config.events.includes(event)) return false;
  const now = Date.now();
  if (config.timing === "after") {
    const afterAt = parseTime(config.afterAt);
    return Boolean(afterAt && now >= afterAt);
  }
  if (config.timing === "deadline") {
    const deadlineAt = parseTime(config.deadlineAt);
    if (!deadlineAt) return false;
    return now >= deadlineAt - config.beforeDeadlineHours * 60 * 60 * 1000;
  }
  return true;
}

function normalizeReminderEvents(targetType: ToolQqReminderTargetType, events?: readonly string[] | null) {
  const allowed = reminderEvents[targetType];
  const allowedSet = new Set<string>(allowed);
  const normalized = Array.from(new Set((events ?? allowed).map((item) => String(item || "").trim()).filter((item) => allowedSet.has(item)))) as ToolQqReminderEvent[];
  return normalized.length ? normalized : [...allowed];
}

function normalizeReminderTiming(value: unknown): ToolQqReminderTiming {
  const raw = String(value || "").trim();
  return reminderTimingOptions.includes(raw as ToolQqReminderTiming) ? raw as ToolQqReminderTiming : "instant";
}

function normalizeBeforeDeadlineHours(value: unknown) {
  if (value === null || value === undefined || value === "") return 24;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(720, Math.max(1, Math.round(parsed)));
}

function normalizeDateString(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseTime(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function queueToolQqDispatch() {
  if (toolQqDispatchQueued) return;
  toolQqDispatchQueued = true;
  setTimeout(() => {
    toolQqDispatchQueued = false;
    dispatchRecentQqNotifications().catch((error) => {
      console.warn("[tools] qqbot reminder dispatch failed", error);
    });
  }, 0);
}

function normalizeQuestionnaireReminderItem(row: any) {
  const config = parseToolQqReminderConfig("questionnaire", row.qqBotNotifyConfig);
  return {
    targetType: "questionnaire" as const,
    targetId: row.id,
    toolCode: "questionnaire" as const,
    toolName: "在线问卷",
    title: row.title,
    status: row.status,
    enabled: Boolean(row.qqBotNotifyEnabled),
    config,
    eventOptions: reminderEvents.questionnaire.map((event) => ({ value: event, label: reminderEventLabels[event] })),
    eventLabel: "收到新答卷",
    metricLabel: `${Number(row._count?.responses ?? 0)} 份答卷`,
    link: `/services/tools/questionnaires/${row.slug}`,
    manageLink: "/services/tools/manage?tool=questionnaire",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeGradeCheckReminderItem(row: any) {
  const config = parseToolQqReminderConfig("grade_check", row.qqBotNotifyConfig);
  return {
    targetType: "grade_check" as const,
    targetId: row.id,
    toolCode: "grade_check" as const,
    toolName: "成绩表核对",
    title: row.title,
    status: row.status,
    enabled: Boolean(row.qqBotNotifyEnabled),
    config,
    eventOptions: reminderEvents.grade_check.map((event) => ({ value: event, label: reminderEventLabels[event] })),
    eventLabel: "被查询 / 收到反馈",
    metricLabel: `${Number(row.rowCount ?? 0)} 条记录`,
    link: `/services/tools/grade-checks/${row.slug}`,
    manageLink: "/services/tools/manage?tool=grade_check",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeFileCollectReminderItem(row: any) {
  const config = parseToolQqReminderConfig("file_collect", row.qqBotNotifyConfig, row.deadline);
  return {
    targetType: "file_collect" as const,
    targetId: row.id,
    toolCode: "file_collect" as const,
    toolName: "文件收集",
    title: row.title,
    status: row.status,
    enabled: Boolean(row.qqBotNotifyEnabled),
    config,
    eventOptions: reminderEvents.file_collect.map((event) => ({ value: event, label: reminderEventLabels[event] })),
    eventLabel: "收到新提交",
    metricLabel: `${Number(row.submissionCount ?? 0)} 次提交`,
    link: `/filestore/submit/${row.slug}`,
    manageLink: "/services/tools/filestore",
    deadlineAt: row.deadline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveUserLabel(userId?: number | null) {
  if (!userId) return "";
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, nickname: true },
  }).catch(() => null);
  return limitText(user?.nickname || user?.username || "", 24);
}

function summarizeSubmissionData(value: string | Record<string, unknown> | null | undefined) {
  const data = typeof value === "string" ? parseJsonObject(value) : (value ?? {});
  const preferredKeys = ["name", "姓名", "student_id", "学号", "id", "编号"];
  const parts: string[] = [];
  for (const key of preferredKeys) {
    const item = String((data as any)[key] ?? "").trim();
    if (item) parts.push(item);
    if (parts.length >= 2) break;
  }
  if (!parts.length) {
    for (const item of Object.values(data)) {
      const text = String(item ?? "").trim();
      if (text) parts.push(text);
      if (parts.length >= 2) break;
    }
  }
  return limitText(parts.join(" / "), 40);
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeStudentIdForPayload(value: string) {
  return String(value || "").trim().replace(/\s+/g, "").slice(0, 80);
}

function maskStudentId(value: string) {
  const normalized = normalizeStudentIdForPayload(value);
  if (!normalized) return "";
  if (normalized.length <= 4) return `学号 ${normalized}`;
  if (normalized.length <= 8) return `学号 ${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  return `学号 ${normalized.slice(0, 4)}****${normalized.slice(-4)}`;
}

function limitText(value: string, max: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}
