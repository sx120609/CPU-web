import { getSiteConfig } from "./siteSettings";
import { getSponsorConfig } from "./sponsor";
import { nextCampusAssistantResetAt } from "./campusAssistantQuota";

/**
 * 拾间 AI 额度规则的对外快照。
 *
 * 存在的理由：这套规则**全部可以被管理员在后台改**（档位表、每帖多少分、
 * 各项上限、赞助兑换比例都是 siteSetting 里的值，默认常量只是初值）。
 * 把 "发一帖 +4 分"、"Lv.3 每天 30 次" 这类数字硬写进前端文案，后台一改
 * 我们就在骗用户 —— 所以让服务端下发当前生效的值，界面照着渲染。
 *
 * 这里只暴露规则本身，不含任何用户数据，可以公开读。
 */
export type AiQuotaRules = {
  /** 等级 -> 每日免费次数 */
  dailyQuotas: { level: number; quota: number }[];
  /** 信誉分 -> 等级 */
  levels: { level: number; name: string; minReputation: number }[];
  /** 信誉分怎么来的 */
  reputation: {
    accountAgeDaysPerStep: number;
    accountAgePointsPerStep: number;
    accountAgePointsCap: number;
    postPointsPerTopic: number;
    postPointsCap: number;
    replyPointsPerReply: number;
    replyPointsCap: number;
    /** @deprecated 论坛已默认开放；固定为 0 仅兼容旧客户端。 */
    forumEnabledBonus: number;
    /** 各项上限相加得到的理论最高分 */
    maxReputation: number;
  };
  /** 赞助 1 元换多少 AI 点数；0 表示当前关闭该奖励 */
  assistantPointsPerYuan: number;
  /** 下一次日额度重置的时刻（北京时间次日 00:00） */
  nextResetAt: string;
};

export async function getAiQuotaRules(): Promise<AiQuotaRules> {
  const site = getSiteConfig();
  const sponsor = await getSponsorConfig();

  return {
    dailyQuotas: site.assistantDailyQuotas.map((item) => ({ level: item.level, quota: item.quota })),
    levels: site.reputationLevels.map((item) => ({
      level: item.level,
      name: item.name,
      minReputation: item.minReputation,
    })),
    reputation: {
      accountAgeDaysPerStep: site.accountAgeDaysPerStep,
      accountAgePointsPerStep: site.accountAgePointsPerStep,
      accountAgePointsCap: site.accountAgePointsCap,
      postPointsPerTopic: site.postPointsPerTopic,
      postPointsCap: site.postPointsCap,
      replyPointsPerReply: site.replyPointsPerReply,
      replyPointsCap: site.replyPointsCap,
      forumEnabledBonus: 0,
      maxReputation:
        site.accountAgePointsCap + site.postPointsCap + site.replyPointsCap,
    },
    assistantPointsPerYuan: sponsor.assistantPointsPerYuan,
    nextResetAt: nextCampusAssistantResetAt().toISOString(),
  };
}
