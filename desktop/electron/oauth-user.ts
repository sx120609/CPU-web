import type { OAuthSession, OAuthUser } from "./oauth-store";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const firstValue = (records: Record<string, unknown>[], keys: string[]): unknown => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
};

const asOptionalText = (value: unknown): string | undefined => {
  if (value === undefined || value === null || typeof value === "object") return undefined;
  const text = String(value);
  return text === "" ? undefined : text;
};

// Number(x) || undefined 会把 0 吞成"无数据"，额度用尽的用户会以为接口挂了
const asOptionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const NAME_KEYS = ["username", "preferred_username", "name", "nickname", "login"];

export const normalizeOAuthUser = (payload: unknown): OAuthUser | undefined => {
  const root = asRecord(payload);
  // 服务端统一响应是 { code, data, message }，用户信息在 data 里
  const records = [asRecord(root.data), asRecord(root.user), asRecord(root.profile), root];
  const userObject = records.map((record) => asRecord(record.user)).find((record) => Object.keys(record).length > 0);
  const nested = userObject ? [userObject] : [];
  const name = firstValue(records, NAME_KEYS) ?? firstValue(nested, NAME_KEYS);
  const sub = firstValue(records, ["sub", "id", "userId"]) ?? firstValue(nested, ["id"]);
  if (name === undefined && sub === undefined) return undefined;
  // 信誉相关的结构挂在 data.user 下面：
  //   user.reputationBreakdown = { agePoints, postPoints, replyPoints, forumPoints, caps }
  //   user.reputationLevel     = { level, name, nextLevel: { name, need } | null }
  const breakdown = asRecord(userObject?.reputationBreakdown);
  const nextLevel = asRecord(asRecord(userObject?.reputationLevel).nextLevel);

  return {
    sub: asOptionalText(sub),
    user: asOptionalText(name),
    nickname: asOptionalText(userObject?.nickname),
    name: asOptionalText(userObject?.name),
    username: asOptionalText(userObject?.username),
    level: asOptionalText(firstValue(records, ["level"])),
    levelName: asOptionalText(firstValue(records, ["levelName", "level_name"])),
    aiBalance: asOptionalNumber(firstValue(records, ["aiBalance", "ai_balance"])),
    dailyQuota: asOptionalNumber(firstValue(records, ["dailyQuota", "daily_quota"])),
    usedToday: asOptionalNumber(firstValue(records, ["usedToday", "used_today"])),
    dailyRemaining: asOptionalNumber(firstValue(records, ["dailyRemaining", "daily_remaining"])),
    assistantPoints: asOptionalNumber(firstValue(records, ["assistantPoints", "assistant_points"])),
    reputation: asOptionalNumber(userObject?.reputation),
    nextLevelNeed: asOptionalNumber(nextLevel.need),
    nextLevelName: asOptionalText(nextLevel.name),
    agePoints: asOptionalNumber(breakdown.agePoints),
    postPoints: asOptionalNumber(breakdown.postPoints),
    replyPoints: asOptionalNumber(breakdown.replyPoints),
    forumPoints: asOptionalNumber(breakdown.forumPoints)
  };
};

/**
 * token 可以缓存，用户资料不能缓存 30 天。每次账号面板要状态时都用现有 token
 * 拉一次 userinfo，并把新快照写回安全存储；旧客户端留下的缺字段快照会自动迁移。
 */
export const refreshOAuthUser = async (
  session: OAuthSession,
  load: (session: OAuthSession) => Promise<OAuthUser | undefined>,
  persist: (session: OAuthSession) => Promise<void>
): Promise<OAuthUser | undefined> => {
  const user = await load(session);
  if (!user) return undefined;
  session.user = user;
  await persist(session);
  return user;
};
