export type CommunityBoardType = "normal" | "question" | "market" | "coursereview";

export interface CommunityBoardDefinition {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  type: CommunityBoardType;
  anonymousEnabled?: boolean;
}

export const COMMUNITY_BOARD_DEFS: readonly CommunityBoardDefinition[] = [
  { slug: "general", name: "灌水广场", description: "无主题闲聊，怎么舒服怎么来", icon: "💬", color: "#10b981", type: "normal" },
  { slug: "treehole", name: "树洞", description: "想说的话、烦恼和碎碎念都可以发这里", icon: "🕳️", color: "#6366f1", type: "normal", anonymousEnabled: true },
  { slug: "life", name: "校园生活", description: "食堂 / 校车 / 快递 / 周边吃喝玩乐", icon: "🍜", color: "#f59e0b", type: "normal" },
  { slug: "freshman", name: "新生入学", description: "学长学姐答疑 + 入学攻略", icon: "🌱", color: "#84cc16", type: "normal" },
  { slug: "question", name: "提问广场", description: "提问、悬赏、求助", icon: "❓", color: "#3b82f6", type: "question" },
  { slug: "market", name: "商城", description: "实体商品、电子资料、校园好物", icon: "🛒", color: "#168c78", type: "market" },
  { slug: "coursereview", name: "课程点评", description: "选课参考：难度·给分·收获·推荐度", icon: "📊", color: "#8b5cf6", type: "coursereview" },
];
