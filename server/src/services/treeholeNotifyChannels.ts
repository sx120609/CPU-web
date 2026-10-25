import { prisma } from "../prisma";

// 树洞上线时把 treehole 分类加进 QQ 私聊和微信服务号的转发名单，只做一次；
// 之后管理员在后台取消勾选，不会被改回来。QQ 群通知只允许系统和公告两类，树洞消息不会进群。

export const TREEHOLE_NOTIFY_CATEGORY = "treehole";
const BACKFILL_MARKER_KEY = "treehole.notifyChannelsBackfilled";
const BACKFILL_LOCK = -71004;

/** 返回加上 treehole 后的 JSON；已经包含或无法解析时返回 null，表示不用改。 */
export function withTreeholeNotifyCategory(raw: string | null | undefined) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const categories = parsed.map((item) => String(item));
  if (categories.includes(TREEHOLE_NOTIFY_CATEGORY)) return null;
  return JSON.stringify([...categories, TREEHOLE_NOTIFY_CATEGORY]);
}

export async function backfillTreeholeNotifyCategories() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BACKFILL_LOCK}::int, 1::int)`;
    if (await tx.siteSetting.findUnique({ where: { key: BACKFILL_MARKER_KEY } })) return;
    for (const row of await tx.qqBotConfig.findMany({ select: { id: true, notifyCategories: true } })) {
      const next = withTreeholeNotifyCategory(row.notifyCategories);
      if (next) await tx.qqBotConfig.update({ where: { id: row.id }, data: { notifyCategories: next } });
    }
    for (const row of await tx.wechatServiceConfig.findMany({ select: { id: true, notifyCategories: true } })) {
      const next = withTreeholeNotifyCategory(row.notifyCategories);
      if (next) await tx.wechatServiceConfig.update({ where: { id: row.id }, data: { notifyCategories: next } });
    }
    await tx.siteSetting.create({ data: { key: BACKFILL_MARKER_KEY, value: new Date().toISOString() } });
  });
}
