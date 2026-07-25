import type { FeatureKey } from "./siteSettings";
import { getSiteConfig } from "./siteSettings";
import { requestAiJson } from "./topicAiReview";

export type CampusAssistantAction = {
  id: string;
  label: string;
  description: string;
  url: string;
  icon: string;
  owner: string;
  requireLogin: boolean;
};

export type CampusAssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CampusAssistantResponse = {
  answer: string;
  actions: CampusAssistantAction[];
  suggestions: string[];
  fallback: boolean;
};

type CampusAssistantRoute = CampusAssistantAction & {
  keywords: string[];
  feature?: FeatureKey;
  requireForumAccess?: boolean;
};

type CampusAssistantContext = {
  features: Record<FeatureKey, boolean>;
  forumAccessEnabled: boolean;
  loggedIn: boolean;
};

const CAMPUS_ASSISTANT_ROUTES: CampusAssistantRoute[] = [
  {
    id: "home",
    label: "首页",
    description: "查看校园公告、常用服务和站内内容",
    url: "/home",
    icon: "🏠",
    owner: "药大拾间",
    requireLogin: false,
    keywords: ["首页", "主页", "回首页", "校园入口"],
  },
  {
    id: "jwxt",
    label: "教务数据",
    description: "查看成绩、期中成绩、学业完成情况和培养方案",
    url: "/jwxt",
    icon: "🎓",
    owner: "教务",
    requireLogin: true,
    keywords: ["教务", "成绩", "期中成绩", "学业完成", "培养方案", "gpa", "绩点"],
  },
  {
    id: "schedule",
    label: "课表",
    description: "查看日课表、周课表、学期周次和课程安排",
    url: "/schedule",
    icon: "📅",
    owner: "教务",
    requireLogin: true,
    keywords: ["课表", "课程表", "上课", "课程安排", "周次", "今天的课"],
  },
  {
    id: "services",
    label: "校园服务",
    description: "集中查看校园入口、校园小工具和教务服务",
    url: "/services",
    icon: "🧭",
    owner: "药大拾间",
    requireLogin: false,
    keywords: ["校园服务", "服务", "办事", "校园入口"],
  },
  {
    id: "dorm-electric",
    label: "宿舍电费查询",
    description: "查询本宿舍剩余金额、电量和抄表时间",
    url: "/services?open=electric",
    icon: "💡",
    owner: "校园服务",
    requireLogin: true,
    feature: "electric",
    keywords: ["电费", "宿舍电费", "查电费", "剩余电量", "电量", "电余额", "购电", "交电费"],
  },
  {
    id: "cpu-network",
    label: "CPU 网络连接助手",
    description: "下载并使用 Windows 校园网连接工具",
    url: "/services?open=network",
    icon: "📶",
    owner: "校园服务",
    requireLogin: false,
    keywords: ["校园网", "网络连接", "网络助手", "cpu网络", "windows校园网"],
  },
  {
    id: "voicehub",
    label: "药苑之声",
    description: "查看校园广播排期、点歌、投票和播放信息",
    url: "/services/tools/voicehub",
    icon: "🎙️",
    owner: "校园广播",
    requireLogin: false,
    keywords: ["药苑之声", "药院之声", "广播站", "点歌", "歌曲排期", "歌曲投票", "校园广播"],
  },
  {
    id: "announcements",
    label: "校园公告",
    description: "查看教务处、学工处、研究生院等公开通知",
    url: "/announcements",
    icon: "📢",
    owner: "学校公开信息",
    requireLogin: false,
    keywords: ["公告", "通知", "教务处通知", "学校通知", "研究生通知"],
  },
  {
    id: "lost-found",
    label: "失物招领",
    description: "查找或发布校园失物与招领信息",
    url: "/lost-found",
    icon: "🧭",
    owner: "校园互助",
    requireLogin: false,
    keywords: ["失物招领", "丢东西", "捡到", "寻物", "认领"],
  },
  {
    id: "forum",
    label: "校园论坛",
    description: "浏览校园讨论、提问和经验分享",
    url: "/forum",
    icon: "💬",
    owner: "校园社区",
    requireLogin: false,
    feature: "forum",
    requireForumAccess: true,
    keywords: ["论坛", "帖子", "讨论", "校园社区", "提问"],
  },
  {
    id: "course-review",
    label: "课程点评",
    description: "查看课程和教师评价",
    url: "/coursereview",
    icon: "📚",
    owner: "校园社区",
    requireLogin: false,
    feature: "coursereview",
    requireForumAccess: true,
    keywords: ["课评", "课程点评", "老师评价", "课程评价", "选课评价"],
  },
  {
    id: "market",
    label: "校园商城",
    description: "查看和发布校内二手、求购与交换信息",
    url: "/market",
    icon: "🛍️",
    owner: "校园社区",
    requireLogin: false,
    feature: "market",
    requireForumAccess: true,
    keywords: ["商城", "二手", "闲置", "求购", "卖东西", "买东西"],
  },
  {
    id: "school-calendar",
    label: "药大校历",
    description: "查看官方校历、学期安排、假期和关键节点",
    url: "/services/tools/school_calendar",
    icon: "🗓️",
    owner: "校园小工具",
    requireLogin: false,
    keywords: ["校历", "放假", "开学", "学期安排", "假期"],
  },
  {
    id: "pdf-tools",
    label: "PDF 工具",
    description: "在浏览器本地合并、拆分、压缩和转换 PDF",
    url: "/services/tools/pdf_tools",
    icon: "📄",
    owner: "校园小工具",
    requireLogin: false,
    keywords: ["pdf", "合并pdf", "拆分pdf", "压缩pdf", "转图片", "提取文字"],
  },
  {
    id: "file-collect",
    label: "文件收集",
    description: "创建或进入作业、材料和照片收集任务",
    url: "/services/tools/file_collect",
    icon: "📁",
    owner: "校园小工具",
    requireLogin: false,
    keywords: ["文件收集", "收作业", "交材料", "提交文件", "作业收集"],
  },
  {
    id: "questionnaire",
    label: "在线问卷",
    description: "创建、填写和统计轻量问卷",
    url: "/services/tools/questionnaire",
    icon: "📝",
    owner: "校园小工具",
    requireLogin: false,
    keywords: ["问卷", "在线问卷", "调查", "填写问卷"],
  },
  {
    id: "grade-check",
    label: "成绩表核对",
    description: "上传表格后按学号开放个人记录查询",
    url: "/services/tools/grade_check",
    icon: "📊",
    owner: "校园小工具",
    requireLogin: true,
    keywords: ["成绩表核对", "表格核对", "按学号查询", "成绩核对"],
  },
  {
    id: "feedback",
    label: "需求反馈",
    description: "提交功能建议、使用问题和校园工具需求",
    url: "/services/tools/feedback",
    icon: "🗨️",
    owner: "校园小工具",
    requireLogin: false,
    keywords: ["反馈", "提建议", "功能建议", "报错", "问题反馈"],
  },
  {
    id: "messages",
    label: "消息中心",
    description: "查看站内通知、回复提醒和系统消息",
    url: "/messages",
    icon: "✉️",
    owner: "药大拾间",
    requireLogin: true,
    keywords: ["消息", "通知消息", "回复提醒", "站内信"],
  },
  {
    id: "profile",
    label: "个人中心",
    description: "管理账号、QQ 绑定、外观和个人设置",
    url: "/profile",
    icon: "👤",
    owner: "药大拾间",
    requireLogin: true,
    keywords: ["个人中心", "我的", "账号设置", "qq绑定", "外观设置"],
  },
];

export function listCampusAssistantActions(context: CampusAssistantContext): CampusAssistantAction[] {
  return CAMPUS_ASSISTANT_ROUTES
    .filter((item) => !item.feature || context.features[item.feature])
    .filter((item) => !item.requireForumAccess || context.forumAccessEnabled)
    .map(({ keywords: _keywords, feature: _feature, requireForumAccess: _requireForumAccess, ...action }) => action);
}

export function searchCampusAssistantActions(query: string, context: CampusAssistantContext, limit = 6) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [] as CampusAssistantAction[];
  return CAMPUS_ASSISTANT_ROUTES
    .filter((item) => !item.feature || context.features[item.feature])
    .filter((item) => !item.requireForumAccess || context.forumAccessEnabled)
    .map((item) => ({ item, score: scoreRoute(item, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map(({ item }) => {
      const { keywords: _keywords, feature: _feature, requireForumAccess: _requireForumAccess, ...action } = item;
      return action;
    });
}

export function campusActionToSearchService(action: CampusAssistantAction) {
  return {
    id: `assistant:${action.id}`,
    code: `ASSISTANT_${action.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
    name: action.label,
    category: "站内入口",
    owner: action.owner,
    icon: action.icon,
    url: action.url,
    needSso: action.requireLogin,
    requireLogin: action.requireLogin,
    description: action.description,
  };
}

export async function askCampusAssistant(input: {
  message: string;
  history: CampusAssistantMessage[];
  context: CampusAssistantContext;
}): Promise<CampusAssistantResponse> {
  const message = input.message.trim();
  const availableActions = listCampusAssistantActions(input.context);
  const deterministicActions = searchCampusAssistantActions(message, input.context, 3);
  const config = getSiteConfig();
  if (!config.aiReviewEnabled || !config.aiReviewApiKey.trim()) {
    return fallbackAssistantResponse(deterministicActions, false);
  }

  try {
    const catalog = availableActions.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      requireLogin: item.requireLogin,
    }));
    const result = await requestAiJson([
      {
        role: "system",
        content: buildSystemPrompt(catalog, input.context.loggedIn),
      },
      ...input.history.slice(-8).map((item) => ({
        role: item.role,
        content: item.content.slice(0, 1200),
      } as const)),
      {
        role: "user",
        content: message,
      },
    ], {
      promptCacheScope: "campus-assistant",
    });
    const parsed = parseAssistantJson(result.content);
    return normalizeAssistantResponse(parsed, availableActions, deterministicActions);
  } catch (error) {
    console.warn("[campus-assistant] AI request failed", error instanceof Error ? error.message : error);
    return fallbackAssistantResponse(deterministicActions, true);
  }
}

export function normalizeAssistantResponse(
  payload: unknown,
  availableActions: CampusAssistantAction[],
  deterministicActions: CampusAssistantAction[] = [],
): CampusAssistantResponse {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const actionMap = new Map(availableActions.map((item) => [item.id, item]));
  const requestedIds = Array.isArray(value.actionIds)
    ? value.actionIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const actions: CampusAssistantAction[] = [];
  const seen = new Set<string>();
  for (const id of [...requestedIds, ...deterministicActions.map((item) => item.id)]) {
    const action = actionMap.get(id);
    if (!action || seen.has(id)) continue;
    seen.add(id);
    actions.push(action);
    if (actions.length >= 3) break;
  }
  const answer = String(value.answer || "").trim().slice(0, 1600)
    || (actions.length ? "我找到了这些相关入口，可以直接打开。" : "我暂时没有找到合适的答案，可以换一种说法再问我。");
  const suggestions = Array.isArray(value.suggestions)
    ? value.suggestions
      .map((item) => String(item || "").trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 3)
    : [];
  return { answer, actions, suggestions, fallback: false };
}

function fallbackAssistantResponse(actions: CampusAssistantAction[], failed: boolean): CampusAssistantResponse {
  if (actions.length) {
    return {
      answer: failed
        ? "拾间AI暂时没有响应，我先为你匹配到了这些站内入口。"
        : "当前没有启用拾间AI问答，我先为你匹配到了这些站内入口。",
      actions,
      suggestions: [],
      fallback: true,
    };
  }
  return {
    answer: failed
      ? "拾间AI暂时没有响应，请稍后再试。"
      : "拾间AI问答暂未启用，你仍可以搜索课表、电费、药苑之声等站内功能。",
    actions: [],
    suggestions: ["怎么查宿舍电费？", "打开药苑之声", "课表在哪里？"],
    fallback: true,
  };
}

function parseAssistantJson(content: string) {
  const normalized = String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1));
    throw new Error("拾间AI返回格式异常");
  }
}

function buildSystemPrompt(catalog: Array<Pick<CampusAssistantAction, "id" | "label" | "description" | "requireLogin">>, loggedIn: boolean) {
  return [
    "你是“药大拾间”的 AI 助手“拾间AI”，面向中国药科大学学生。",
    "你的首要任务是帮助用户找到站内功能、给出简短可靠的操作指引，也可以进行普通聊天和常识问答。",
    "不要声称已经替用户执行查询、缴费、登录、发帖或其他操作；只能说明步骤并推荐入口。",
    "遇到需要实时数据、个人数据或学校最新政策的问题，要说明需要进入对应页面查看，不要编造。",
    "涉及宿舍电费时：站内可以查询余额；缴费需先在中国建设银行 APP 搜索校园卡充值并选择中国药科大学充值，再到企业微信→工作台→校园卡务完成购电；23:30 至次日 02:00 系统盘点，无法充值或购电。",
    "涉及药苑之声时：可查看广播排期、点歌、投票和播放信息。",
    `用户当前${loggedIn ? "已登录" : "未登录"}。带 requireLogin=true 的入口可以推荐，但要提醒未登录用户先登录。`,
    "你只能从下面的 catalog 中选择 actionIds，绝不能生成 catalog 之外的链接或 action id。",
    "只输出 JSON 对象，不要使用 Markdown 代码块。格式：",
    '{"answer":"简洁中文答复","actionIds":["最多3个catalog id"],"suggestions":["最多3个简短追问建议"]}',
    `catalog=${JSON.stringify(catalog)}`,
  ].join("\n");
}

function normalizeSearchText(value: string) {
  return String(value || "").trim().toLowerCase().replace(/[\s"'“”‘’。，、！？?!.:：;；()[\]{}【】_-]+/g, "");
}

function scoreRoute(item: CampusAssistantRoute, normalizedQuery: string) {
  const normalizedName = normalizeSearchText(item.label);
  if (normalizedName === normalizedQuery) return 120;
  if (normalizedName.includes(normalizedQuery)) return 100;
  if (normalizedQuery.includes(normalizedName)) return 95;
  let score = 0;
  for (const keyword of item.keywords) {
    const normalizedKeyword = normalizeSearchText(keyword);
    if (!normalizedKeyword) continue;
    if (normalizedKeyword === normalizedQuery) score = Math.max(score, 90);
    else if (normalizedKeyword.includes(normalizedQuery)) score = Math.max(score, 75);
    else if (normalizedQuery.includes(normalizedKeyword)) score = Math.max(score, 70);
  }
  const description = normalizeSearchText(`${item.description}${item.owner}`);
  if (description.includes(normalizedQuery) || normalizedQuery.includes(description)) score = Math.max(score, 45);
  return score;
}
