import { prisma } from "../prisma";
import type { LoginClient } from "../utils/loginClient";
import { getCampusAssistantQuotaStatus } from "./campusAssistantQuota";
import { buildUserTrustSnapshot } from "./userTrust";

export type CampusAssistantSiteIntent = "announcements" | "messages" | "quota" | "account";

export type CampusAssistantSiteToolResult = {
  status: "ready" | "unavailable";
  data?: unknown;
  message?: string;
};

export type CampusAssistantSiteContext = {
  intents: CampusAssistantSiteIntent[];
  queriedAt: string;
  notice: string;
  tools: Partial<Record<CampusAssistantSiteIntent, CampusAssistantSiteToolResult>>;
};

type AssistantHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const FOLLOW_UP_PATTERN = /^(?:那|那么)?(?:还有呢|最新的呢|具体呢|多少|有哪些|全部|详细一点)[？?。.\s]*$/u;

export function detectCampusAssistantSiteIntents(
  message: string,
  history: AssistantHistoryMessage[] = [],
): CampusAssistantSiteIntent[] {
  const text = normalizeText(message);
  if (!text) return [];
  const intents: CampusAssistantSiteIntent[] = [];
  if (isAnnouncementQuery(text)) intents.push("announcements");
  if (isMessageQuery(text)) intents.push("messages");
  if (isQuotaQuery(text)) intents.push("quota");
  if (isAccountQuery(text)) intents.push("account");
  if (intents.length) return intents;
  if (!FOLLOW_UP_PATTERN.test(text)) return [];
  const previousUserMessage = [...history].reverse().find((item) => item.role === "user")?.content ?? "";
  return detectCampusAssistantSiteIntents(previousUserMessage);
}

export async function loadCampusAssistantSiteContext(input: {
  userId: number;
  message: string;
  history?: AssistantHistoryMessage[];
  client?: LoginClient;
}): Promise<CampusAssistantSiteContext | null> {
  const intents = detectCampusAssistantSiteIntents(input.message, input.history ?? []);
  if (!intents.length) return null;

  const entries = await Promise.all(intents.map(async (intent) => {
    try {
      const data = await loadSiteTool(intent, input.userId, input.client ?? "web");
      return [intent, { status: "ready" as const, data }] as const;
    } catch (error) {
      console.warn(
        `[campus-assistant] site tool ${intent} failed`,
        error instanceof Error ? error.message : error,
      );
      return [
        intent,
        {
          status: "unavailable" as const,
          message: "站点数据暂时无法读取，请稍后再试。",
        },
      ] as const;
    }
  }));

  return {
    intents,
    queriedAt: new Date().toISOString(),
    notice: "仅包含当前用户本轮明确请求所需的最小只读站点数据，不包含密码、令牌或后台字段。",
    tools: Object.fromEntries(entries),
  };
}

export function buildCampusAssistantSiteFallback(
  context: CampusAssistantSiteContext | null | undefined,
) {
  if (!context) return null;
  const sections = context.intents.map((intent) => {
    const tool = context.tools[intent];
    if (!tool || tool.status !== "ready") return tool?.message || "这项站点数据暂时无法读取。";
    if (intent === "announcements") return formatAnnouncements(tool.data);
    if (intent === "messages") return formatMessages(tool.data);
    if (intent === "quota") return formatQuota(tool.data);
    return formatAccount(tool.data);
  });
  return sections.filter(Boolean).join("\n\n").trim() || "已经读取站点数据，但没有找到符合条件的记录。";
}

async function loadSiteTool(intent: CampusAssistantSiteIntent, userId: number, client: LoginClient) {
  if (intent === "announcements") {
    const rows = await prisma.topic.findMany({
      where: { hidden: false, board: { type: "announce" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        createdAt: true,
        board: { select: { name: true } },
      },
    });
    return {
      announcements: rows.map((row) => ({
        title: row.title,
        board: row.board.name,
        createdAt: row.createdAt.toISOString(),
        url: `/forum/topic/${row.id}`,
      })),
    };
  }

  if (intent === "messages") {
    const [notifications, reads] = await Promise.all([
      prisma.notification.findMany({
        where: { OR: [{ userId }, { userId: null }] },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true,
          userId: true,
          category: true,
          targetClient: true,
          title: true,
          content: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notificationRead.findMany({
        where: { userId },
        select: { notificationId: true },
      }),
    ]);
    const globalReadIds = new Set(reads.map((item) => item.notificationId));
    const visible = notifications
      .filter((item) => notificationVisibleToClient(item.targetClient, client))
      .map((item) => ({
        category: item.category,
        title: item.title.slice(0, 120),
        content: item.content.slice(0, 300),
        url: item.link || "/messages",
        createdAt: item.createdAt.toISOString(),
        unread: item.userId === null ? !globalReadIds.has(item.id) : !item.readAt,
      }));
    return {
      unreadCount: visible.filter((item) => item.unread).length,
      messages: visible.slice(0, 10),
    };
  }

  if (intent === "quota") {
    return getCampusAssistantQuotaStatus(userId);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      nickname: true,
      college: true,
      createdAt: true,
      postCount: true,
      replyCount: true,
      forumEnabled: true,
      forumEnabledAt: true,
      anonymousCredits: true,
      anonymousWeekKey: true,
      anonymousCreditsFrozen: true,
    },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  const trust = buildUserTrustSnapshot(user);
  return {
    nickname: user.nickname,
    college: user.college,
    postCount: user.postCount,
    replyCount: user.replyCount,
    reputation: trust.reputation,
    level: trust.reputationLevel.level,
    levelName: trust.reputationLevel.name,
    nextLevel: trust.reputationLevel.nextLevel,
  };
}

export async function queryCampusAssistantSiteTool(input: {
  tool: CampusAssistantSiteIntent;
  userId: number;
  client?: LoginClient;
}) {
  try {
    return {
      status: "ready" as const,
      data: await loadSiteTool(input.tool, input.userId, input.client ?? "web"),
    };
  } catch (error) {
    console.warn(
      `[campus-assistant] site tool ${input.tool} failed`,
      error instanceof Error ? error.message : error,
    );
    return {
      status: "unavailable" as const,
      message: "站点数据暂时无法读取，请稍后再试。",
    };
  }
}

function formatAnnouncements(data: unknown) {
  const announcements = (data as {
    announcements?: Array<{ title: string; board: string; createdAt: string }>;
  })?.announcements ?? [];
  if (!announcements.length) return "最近没有查到可显示的校园公告。";
  const lines = announcements.slice(0, 8).map((item) => {
    const date = new Date(item.createdAt).toLocaleDateString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
    });
    return `- ${date} · ${item.board}：${item.title}`;
  });
  return `我查到最近 ${announcements.length} 条校园公告：\n${lines.join("\n")}`;
}

function formatMessages(data: unknown) {
  const record = data as {
    unreadCount?: number;
    messages?: Array<{ title: string; content: string; unread: boolean }>;
  };
  const unreadCount = Math.max(0, Number(record.unreadCount || 0));
  const messages = record.messages ?? [];
  const unread = messages.filter((item) => item.unread);
  if (!unreadCount) return "你当前没有未读消息。";
  const lines = unread.slice(0, 6).map((item) => (
    `- ${item.title}${item.content ? `：${item.content}` : ""}`
  ));
  return `你当前有 ${unreadCount} 条未读消息：\n${lines.join("\n")}`;
}

function formatQuota(data: unknown) {
  const quota = data as {
    level?: number;
    levelName?: string;
    dailyQuota?: number;
    used?: number;
    remaining?: number;
    points?: number;
    totalRemaining?: number;
  };
  return [
    `你当前是 Lv.${Number(quota.level || 0)} ${quota.levelName || ""}。`,
    `今日免费额度：已用 ${Number(quota.used || 0)} / ${Number(quota.dailyQuota || 0)} 次，剩余 ${Number(quota.remaining || 0)} 次。`,
    `AI 点数：${Number(quota.points || 0)} 点；合计还可使用 ${Number(quota.totalRemaining || 0)} 次。`,
  ].join("\n");
}

function formatAccount(data: unknown) {
  const account = data as {
    nickname?: string;
    college?: string;
    postCount?: number;
    replyCount?: number;
    reputation?: number;
    level?: number;
    levelName?: string;
    nextLevel?: { name?: string; need?: number } | null;
  };
  const next = account.nextLevel
    ? `距离“${account.nextLevel.name}”还差 ${Number(account.nextLevel.need || 0)} 点信誉。`
    : "你已经达到当前最高等级。";
  return [
    `${account.nickname || "当前账号"}：Lv.${Number(account.level || 0)} ${account.levelName || ""}，信誉值 ${Number(account.reputation || 0)}。`,
    `已发布 ${Number(account.postCount || 0)} 个帖子、${Number(account.replyCount || 0)} 条回复。`,
    next,
  ].join("\n");
}

function isAnnouncementQuery(text: string) {
  if (/(?:公告|通知).{0,8}(?:在哪|哪里|入口|页面)/u.test(text)) return false;
  return /(?:最近|最新|今天|这周|近期|有什么|有哪些|查一下|看看).{0,10}(?:校园|学校|教务|研究生院|学工处)?(?:公告|通知)/u.test(text)
    || /(?:校园|学校|教务|研究生院|学工处)?(?:公告|通知).{0,10}(?:最近|最新|有什么|有哪些)/u.test(text);
}

function isMessageQuery(text: string) {
  if (/(?:消息中心|消息|通知).{0,8}(?:在哪|哪里|入口|页面|打开)/u.test(text)) return false;
  return /(?:我|我的|有没有|还有|收到|未读|谁).{0,12}(?:未读消息|消息|回复|提醒|站内通知)/u.test(text)
    || /(?:未读消息|站内消息).{0,8}(?:多少|有哪些|有什么)/u.test(text);
}

function isQuotaQuery(text: string) {
  return /(?:额度|ai点数|点数).{0,10}(?:多少|剩余|还有|已用|用了|够不够)/iu.test(text)
    || /(?:还有|剩余|查询|看看|我的).{0,10}(?:ai额度|拾间ai额度|ai点数)/iu.test(text);
}

function isAccountQuery(text: string) {
  return /(?:我的|我).{0,10}(?:账号等级|等级|信誉值|信誉|发了多少帖子|回复了多少)/u.test(text);
}

function notificationVisibleToClient(targetClient: string | null, client: LoginClient) {
  if (!targetClient || targetClient === "all") return true;
  const targets = new Set(targetClient.split(",").map((item) => item.trim()).filter(Boolean));
  const effectiveClient = client === "unknown" ? "web" : client;
  return targets.has(effectiveClient);
}

function normalizeText(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
