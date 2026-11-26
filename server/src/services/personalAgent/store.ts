import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../../prisma";
import { containsRestrictedPublicTopic } from "../campusAssistant";

/**
 * 药大拾间个人 Agent 的分项隐私授权与跨会话个人记忆存储。
 *
 * 复用 `NextSyncRecord` 表下的两个服务端受管集合（`agentprefs` 与 `agentmemory`）：
 * 1. 无需破坏性数据库表结构迁移，天然支持线上蓝绿无感发布；
 * 2. `nextSync.ts` 默认游标同步仅枚举 `NEXT_SYNC_COLLECTIONS`，本模块数据不会混入移动端旧同步流；
 * 3. 账号注销（`accountDeletion.ts`）清理 `nextSyncRecord` 时自动 100% 物理擦除。
 */

export const AGENT_PREFS_COLLECTION = "agentprefs";
export const AGENT_PREFS_RECORD_ID = "scopes";
export const AGENT_MEMORY_COLLECTION = "agentmemory";
export const MAX_AGENT_MEMORIES = 80;

export const PERSONAL_AGENT_SCOPE_KEYS = [
  "schedule",
  "academic",
  "collab",
  "campusLife",
  "community",
  "messages",
] as const;

export type PersonalAgentScopeKey = (typeof PERSONAL_AGENT_SCOPE_KEYS)[number];

export const personalAgentPermissionsSchema = z.object({
  /** 是否启用个人 Agent 模式（关闭则退回不读任何个人数据的普通问答模式）。 */
  enabled: z.boolean().default(true),
  /** 课表与个人日程（含调休、自定义改课、日程增删改与冲突检查）。 */
  schedule: z.boolean().default(true),
  /** 成绩与学业档案（成绩单、GPA 精算、期中/考试、学业完成度、培养方案、等级考试、学籍）。默认关闭，需显式开启。 */
  academic: z.boolean().default(false),
  /** 多人协同课表（已绑定的情侣课表、宿舍课表共同空闲计算）。 */
  collab: z.boolean().default(true),
  /** 校园生活与工具待办（宿舍电费、图书馆借阅、查分单、待填问卷与文件收集）。 */
  campusLife: z.boolean().default(true),
  /** 社区、选课课评与代办草稿（公告热榜、论坛检索、课程点评、失物招领、发帖/回帖草稿）。 */
  community: z.boolean().default(true),
  /** 我的通知与站内私信（未读通知、私信梳理、标为已读、代拟私信）。默认关闭，需显式开启。 */
  messages: z.boolean().default(false),
  /** 跨会话个人记忆（记住校区、年级专业、升学目标与习惯偏好）。 */
  memory: z.boolean().default(true),
  /** 用户同意的个人模式说明版本；不是当前版本时个人模式不生效。只能经 recordConsent 写入。 */
  consentVersion: z.string().max(40).default(""),
  /** 同意时间（服务器时间，毫秒）。 */
  consentAt: z.number().int().min(0).default(0),
}).strict();

/**
 * 个人模式说明的版本。说明内容（读取范围、发给谁、保存多久）有实质变化时改这个值，
 * 所有用户下次使用都要重新同意。
 */
export const PERSONAL_AGENT_CONSENT_VERSION = "2026-11-26";

/** 用户自己改授权时可以写的字段（同意记录不在其中）。 */
export const personalAgentPermissionsPatchSchema = personalAgentPermissionsSchema
  .omit({ consentVersion: true, consentAt: true })
  .partial()
  .strict();

/** 同意时一并提交的授权选择。 */
export const personalAgentConsentSchema = personalAgentPermissionsSchema
  .pick({ schedule: true, academic: true, collab: true, campusLife: true, community: true, messages: true, memory: true })
  .partial()
  .extend({ version: z.literal(PERSONAL_AGENT_CONSENT_VERSION) })
  .strict();

export function hasPersonalAgentConsent(permissions: Pick<PersonalAgentPermissions, "consentVersion">) {
  return permissions.consentVersion === PERSONAL_AGENT_CONSENT_VERSION;
}

/** 个人模式实际是否生效：开关打开且同意了当前版本的说明。 */
export function personalAgentActive(permissions: PersonalAgentPermissions) {
  return permissions.enabled && hasPersonalAgentConsent(permissions);
}

export type PersonalAgentPermissions = z.infer<typeof personalAgentPermissionsSchema>;

export const PERSONAL_AGENT_SCOPE_LABELS: Record<PersonalAgentScopeKey, { title: string; hint: string }> = {
  schedule: { title: "课表和日程", hint: "本学期课表、调课和你的日程，用来排时间、查冲突、找空教室" },
  academic: { title: "成绩和学业", hint: "成绩单、绩点、考试安排、毕业学分和培养方案" },
  collab: { title: "情侣和宿舍课表", hint: "已绑定的情侣课表、宿舍课表，用来找大家都没课的时间" },
  campusLife: { title: "校园生活", hint: "宿舍电费、图书馆借阅、查分单、问卷和文件收集" },
  community: { title: "论坛和课评", hint: "公告热帖、课程评价、失物招领，以及发帖回帖草稿" },
  messages: { title: "通知和私信", hint: "未读通知、最近的私信，以及全部已读、私信草稿" },
};

export function defaultPersonalAgentPermissions(): PersonalAgentPermissions {
  return personalAgentPermissionsSchema.parse({});
}

export const MEMORY_CATEGORIES = [
  "academic",
  "goal",
  "campus",
  "schedule",
  "preference",
  "note",
] as const;

export type PersonalAgentMemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABELS: Record<PersonalAgentMemoryCategory, string> = {
  academic: "学业背景",
  goal: "目标规划",
  campus: "校区生活",
  schedule: "时间习惯",
  preference: "个人偏好",
  note: "长期备忘",
};

export const personalAgentMemorySchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,24}$/u),
  category: z.enum(MEMORY_CATEGORIES).default("note"),
  content: z.string().trim().min(1).max(240),
  source: z.enum(["user", "agent"]).default("user"),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
}).strict();

export type PersonalAgentMemory = z.infer<typeof personalAgentMemorySchema>;

export const memoryOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    id: z.string().regex(/^[a-z0-9]{6,24}$/u).optional(),
    category: z.enum(MEMORY_CATEGORIES).default("note"),
    content: z.string().trim().min(2).max(240),
  }).strict(),
  z.object({
    op: z.literal("delete"),
    id: z.string().regex(/^[a-z0-9]{6,24}$/u),
  }).strict(),
]);

export type PersonalAgentMemoryOperation = z.infer<typeof memoryOperationSchema>;

export interface PersonalAgentRecordRow {
  id: string;
  data: string;
  clientUpdatedAt: Date;
  deletedAt: Date | null;
}

export interface PersonalAgentStorageAdapter {
  findRecord(userId: number, collection: string, id: string): Promise<PersonalAgentRecordRow | null>;
  listLiveRecords(userId: number, collection: string): Promise<PersonalAgentRecordRow[]>;
  upsertRecord(userId: number, collection: string, id: string, data: string, at: Date): Promise<void>;
  deleteRecord(userId: number, collection: string, id: string, at: Date): Promise<boolean>;
  clearCollection(userId: number, collection: string, at: Date): Promise<number>;
}

export const prismaPersonalAgentStorage: PersonalAgentStorageAdapter = {
  async findRecord(userId, collection, id) {
    return prisma.nextSyncRecord.findUnique({
      where: { userId_collection_id: { userId, collection, id } },
      select: { id: true, data: true, clientUpdatedAt: true, deletedAt: true },
    });
  },
  async listLiveRecords(userId, collection) {
    return prisma.nextSyncRecord.findMany({
      where: { userId, collection, deletedAt: null },
      orderBy: [{ clientUpdatedAt: "desc" }, { id: "asc" }],
      select: { id: true, data: true, clientUpdatedAt: true, deletedAt: true },
    });
  },
  async upsertRecord(userId, collection, id, data, at) {
    await prisma.nextSyncRecord.upsert({
      where: { userId_collection_id: { userId, collection, id } },
      create: { userId, collection, id, data, clientUpdatedAt: at, deletedAt: null },
      update: { data, clientUpdatedAt: at, deletedAt: null },
    });
  },
  async deleteRecord(userId, collection, id, at) {
    const updated = await prisma.nextSyncRecord.updateMany({
      where: { userId, collection, id, deletedAt: null },
      data: { data: "", clientUpdatedAt: at, deletedAt: at },
    });
    return updated.count > 0;
  },
  async clearCollection(userId, collection, at) {
    const updated = await prisma.nextSyncRecord.updateMany({
      where: { userId, collection, deletedAt: null },
      data: { data: "", clientUpdatedAt: at, deletedAt: at },
    });
    return updated.count;
  },
};

export function createMemoryId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "m";
  for (let i = 0; i < 11; i += 1) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

function normalizeMemoryText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function canonicalMemoryKey(value: string) {
  return normalizeMemoryText(value).toLowerCase().replace(/[，。！？、；：,.!?;:\s]+/gu, "");
}

export function createPersonalAgentStore(storage: PersonalAgentStorageAdapter = prismaPersonalAgentStorage) {
  async function getPermissions(userId: number): Promise<PersonalAgentPermissions> {
    const row = await storage.findRecord(userId, AGENT_PREFS_COLLECTION, AGENT_PREFS_RECORD_ID);
    if (!row || row.deletedAt || !row.data) return defaultPersonalAgentPermissions();
    try {
      const parsed = personalAgentPermissionsSchema.safeParse(JSON.parse(row.data));
      return parsed.success ? parsed.data : defaultPersonalAgentPermissions();
    } catch {
      return defaultPersonalAgentPermissions();
    }
  }

  async function savePermissions(
    userId: number,
    patch: Partial<Omit<PersonalAgentPermissions, "consentVersion" | "consentAt">>,
    now = new Date(),
  ): Promise<PersonalAgentPermissions> {
    const current = await getPermissions(userId);
    // 同意记录只能经 recordConsent 写入
    const { consentVersion: _version, consentAt: _at, ...allowed } = patch as Partial<PersonalAgentPermissions>;
    const next = personalAgentPermissionsSchema.parse({ ...current, ...allowed });
    await storage.upsertRecord(
      userId,
      AGENT_PREFS_COLLECTION,
      AGENT_PREFS_RECORD_ID,
      JSON.stringify(next),
      now,
    );
    return next;
  }

  async function listMemories(userId: number): Promise<PersonalAgentMemory[]> {
    const rows = await storage.listLiveRecords(userId, AGENT_MEMORY_COLLECTION);
    const items: PersonalAgentMemory[] = [];
    for (const row of rows) {
      if (!row.data) continue;
      try {
        const parsed = personalAgentMemorySchema.safeParse(JSON.parse(row.data));
        if (parsed.success) items.push(parsed.data);
      } catch {
        // Ignore malformed legacy rows
      }
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, MAX_AGENT_MEMORIES);
  }

  async function upsertMemory(
    userId: number,
    input: {
      id?: string;
      category?: PersonalAgentMemoryCategory;
      content: string;
      source?: "user" | "agent";
    },
    now = new Date(),
  ): Promise<PersonalAgentMemory | null> {
    const content = normalizeMemoryText(input.content);
    if (!content || content.length > 240 || containsRestrictedPublicTopic(content)) return null;
    const existing = await listMemories(userId);
    const nowMs = now.getTime();
    const byId = input.id ? existing.find((item) => item.id === input.id) : undefined;
    const bySameText = !byId
      ? existing.find((item) => canonicalMemoryKey(item.content) === canonicalMemoryKey(content))
      : undefined;
    const target = byId ?? bySameText;

    const record: PersonalAgentMemory = personalAgentMemorySchema.parse({
      id: target?.id ?? (input.id && /^[a-z0-9]{6,24}$/u.test(input.id) ? input.id : createMemoryId()),
      category: input.category ?? target?.category ?? "note",
      content,
      source: input.source ?? target?.source ?? "user",
      createdAt: target?.createdAt ?? nowMs,
      updatedAt: nowMs,
    });

    await storage.upsertRecord(
      userId,
      AGENT_MEMORY_COLLECTION,
      record.id,
      JSON.stringify(record),
      now,
    );

    if (!target && existing.length >= MAX_AGENT_MEMORIES) {
      const overflow = [...existing]
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, existing.length - MAX_AGENT_MEMORIES + 1);
      for (const stale of overflow) {
        await storage.deleteRecord(userId, AGENT_MEMORY_COLLECTION, stale.id, now);
      }
    }
    return record;
  }

  async function deleteMemory(userId: number, id: string, now = new Date()): Promise<boolean> {
    if (!/^[a-z0-9]{6,24}$/u.test(id)) return false;
    return storage.deleteRecord(userId, AGENT_MEMORY_COLLECTION, id, now);
  }

  async function clearMemories(userId: number, now = new Date()): Promise<number> {
    return storage.clearCollection(userId, AGENT_MEMORY_COLLECTION, now);
  }

  async function applyMemoryOperations(
    userId: number,
    rawOps: unknown,
    now = new Date(),
  ): Promise<Array<{ op: "saved" | "deleted"; memory?: PersonalAgentMemory; id: string }>> {
    if (!Array.isArray(rawOps) || !rawOps.length) return [];
    const applied: Array<{ op: "saved" | "deleted"; memory?: PersonalAgentMemory; id: string }> = [];
    for (const raw of rawOps.slice(0, 4)) {
      const parsed = memoryOperationSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (parsed.data.op === "delete") {
        const ok = await deleteMemory(userId, parsed.data.id, now);
        if (ok) applied.push({ op: "deleted", id: parsed.data.id });
      } else {
        const saved = await upsertMemory(userId, {
          id: parsed.data.id,
          category: parsed.data.category,
          content: parsed.data.content,
          source: "agent",
        }, now);
        if (saved) applied.push({ op: "saved", memory: saved, id: saved.id });
      }
    }
    return applied;
  }

  /** 记录用户同意当前版本的个人模式说明，按用户在说明里的选择保存授权并开启个人模式。 */
  async function recordConsent(
    userId: number,
    choices: Partial<Pick<PersonalAgentPermissions, PersonalAgentScopeKey | "memory">>,
    now = new Date(),
  ): Promise<PersonalAgentPermissions> {
    const current = await getPermissions(userId);
    const next = personalAgentPermissionsSchema.parse({
      ...current,
      ...choices,
      enabled: true,
      consentVersion: PERSONAL_AGENT_CONSENT_VERSION,
      consentAt: now.getTime(),
    });
    await storage.upsertRecord(userId, AGENT_PREFS_COLLECTION, AGENT_PREFS_RECORD_ID, JSON.stringify(next), now);
    return next;
  }

  return {
    getPermissions,
    savePermissions,
    recordConsent,
    listMemories,
    upsertMemory,
    deleteMemory,
    clearMemories,
    applyMemoryOperations,
  };
}

export const personalAgentStore = createPersonalAgentStore();
