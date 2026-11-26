import { z } from "zod";
import {
  PERSONAL_AGENT_SCOPE_KEYS,
  PERSONAL_AGENT_SCOPE_LABELS,
  type PersonalAgentMemory,
  type PersonalAgentPermissions,
  type PersonalAgentScopeKey,
} from "./store";

export class JwxtReauthRequiredError extends Error {
  readonly code = "JWXT_REAUTH_NEEDED";
  constructor(message = "学校教务授权已过期或尚未登录") {
    super(message);
    this.name = "JwxtReauthRequiredError";
  }
}

export interface PersonalAgentToolContext {
  userId: number;
  username: string;
  nickname: string;
  studentSso: boolean;
  role: string;
  schoolId: string;
  forumAccessEnabled: boolean;
  permissions: PersonalAgentPermissions;
  jwxtToken: string | null;
  /** 前端已在收到 jwxt_reauth_needed 后执行过一次静默恢复重试，若仍无有效会话则不再中断流，而是下发手动授权卡片。 */
  retriedAfterRecover: boolean;
  /** 本轮推理中因未开启授权而被物理拦截的权限域，引擎据此自动附加一键开启卡片。 */
  blockedScopes: Set<PersonalAgentScopeKey>;
  /** 本轮因教务未登录或静默恢复失败而需要提示用户手动授权。 */
  needsManualJwxtReauth: boolean;
  signal?: AbortSignal;
  now: Date;
}

export interface PersonalAgentStepEvent {
  id: string;
  tool: string;
  label: string;
  status: "running" | "done" | "blocked" | "error";
  detail?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const AGENDA_ID_RE = /^[a-z0-9]{6,24}$/u;

export const agendaProposalItemSchema = z.object({
  kind: z.enum(["event", "todo"]).default("event"),
  title: z.string().trim().min(1).max(60),
  date: z.union([z.string().regex(DATE_RE), z.literal("")]).default(""),
  start: z.union([z.string().regex(TIME_RE), z.literal("")]).default(""),
  end: z.union([z.string().regex(TIME_RE), z.literal("")]).default(""),
  location: z.string().trim().max(40).default(""),
  note: z.string().trim().max(500).default(""),
  remind: z.number().int().min(-1).max(10_080).default(-1),
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]).default("none"),
});

export const personalAgentProposalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agenda.create"),
    item: agendaProposalItemSchema,
    conflictHint: z.string().trim().max(160).default(""),
  }),
  z.object({
    type: z.literal("agenda.update"),
    id: z.string().regex(AGENDA_ID_RE),
    title: z.string().trim().max(60).default(""),
    changes: agendaProposalItemSchema.partial(),
  }),
  z.object({
    type: z.literal("agenda.complete"),
    id: z.string().regex(AGENDA_ID_RE),
    title: z.string().trim().max(60).default(""),
    date: z.union([z.string().regex(DATE_RE), z.literal("")]).default(""),
  }),
  z.object({
    type: z.literal("agenda.delete"),
    id: z.string().regex(AGENDA_ID_RE),
    title: z.string().trim().max(60).default(""),
  }),
  z.object({
    type: z.literal("forum.post"),
    board: z.string().regex(/^[a-z0-9-]{1,40}$/u),
    boardName: z.string().trim().max(40).default(""),
    title: z.string().trim().min(2).max(80),
    content: z.string().trim().min(1).max(5_000),
    anonymous: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("forum.reply"),
    topicId: z.number().int().positive(),
    topicTitle: z.string().trim().max(80).default(""),
    content: z.string().trim().min(1).max(2_000),
    parentReplyId: z.number().int().positive().optional(),
    anonymous: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("lostfound.post"),
    kind: z.enum(["lost", "found"]),
    // 除了物品名，其余缺了也给出卡片，由用户在卡片里补齐（卡片发布前会检查）。
    itemName: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1_000).default(""),
    campus: z.string().trim().max(40).default(""),
    location: z.string().trim().max(100).default(""),
    happenedAt: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?$/u), z.literal("")]).default(""),
    storageLocation: z.string().trim().max(160).default(""),
    contact: z.string().trim().max(120).default(""),
  }),
  z.object({
    type: z.literal("dm.send"),
    userId: z.number().int().positive(),
    name: z.string().trim().max(40).default(""),
    content: z.string().trim().min(1).max(1_000),
  }),
  z.object({
    type: z.literal("messages.readAll"),
  }),
  z.object({
    type: z.literal("permission.enable"),
    scope: z.enum(PERSONAL_AGENT_SCOPE_KEYS),
    title: z.string().trim().max(40),
    hint: z.string().trim().max(160),
  }),
  z.object({
    type: z.literal("jwxt.reauth"),
    reason: z.string().trim().max(160).default("需要恢复学校统一认证授权以读取教务与校园数据"),
  }),
]);

export type PersonalAgentProposal = z.infer<typeof personalAgentProposalSchema>;

export interface PersonalAgentMemoryChange {
  op: "saved" | "deleted";
  id: string;
  memory?: PersonalAgentMemory;
}

export interface PersonalAgentToolDefinition<TArgs extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  scope: PersonalAgentScopeKey;
  label: (args: z.infer<TArgs>) => string;
  description: string;
  schema: TArgs;
  execute: (args: z.infer<TArgs>, ctx: PersonalAgentToolContext) => Promise<unknown>;
}

export function guardToolScope(ctx: PersonalAgentToolContext, scope: PersonalAgentScopeKey) {
  if (ctx.permissions[scope]) return null;
  ctx.blockedScopes.add(scope);
  const meta = PERSONAL_AGENT_SCOPE_LABELS[scope];
  return {
    ok: false,
    errorCode: "PERMISSION_DISABLED",
    scope,
    scopeTitle: meta.title,
    message: `用户当前未开启「${meta.title}」权限开关（${meta.hint}），服务端已拦截本次读取。请礼貌告知用户点击回答下方的授权卡片开启后再继续。`,
  };
}

export function shanghaiNowParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const time = `${hour}:${parts.minute}`;
  const weekdayIndex = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return {
    date,
    time,
    isoMinute: `${date}T${time}`,
    weekday: weekdays[weekdayIndex] ?? "",
    dayOfWeek1To7: weekdayIndex === 0 ? 7 : weekdayIndex,
  };
}
