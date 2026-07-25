import type { FeatureKey } from "./siteSettings";
import { getSiteConfig } from "./siteSettings";
import { requestAiJson } from "./topicAiReview";
import { normalizeAiJsonApiUrl, readAiJsonTextStream, sendAiJsonRequest } from "./aiJsonApi";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";

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

type CampusAssistantKnowledge = {
  relatedActionIds: string[];
  fact: string;
};

const DEFAULT_REVIEW_API_URL = "https://api.deepseek.com/chat/completions";
const RESTRICTED_PUBLIC_TOPIC_REPLY: CampusAssistantResponse = {
  answer: "这个话题不适合在本站展开。拾间AI主要用于校园服务、学习与日常问答，你可以换个问题。",
  actions: [],
  suggestions: ["怎么查课表？", "打开校园服务", "怎么查宿舍电费？"],
  fallback: false,
};
const RESTRICTED_PUBLIC_TOPIC_TERMS = [
  "六四事件",
  "六四风波",
  "八九民运",
  "8964",
  "1989年6月4日",
  "天安门事件",
  "天安门抗议",
];

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

const CAMPUS_ASSISTANT_KNOWLEDGE: CampusAssistantKnowledge[] = [
  {
    relatedActionIds: ["home", "profile", "jwxt"],
    fact: "账号与登录：站内使用学校统一认证登录，登录成功后会创建或关联站内账号。个人中心用于管理账号、QQ 绑定、外观等设置；教务数据应进入“教务数据”页面查看，AI 不能代查个人成绩。",
  },
  {
    relatedActionIds: ["jwxt"],
    fact: "教务数据：页面提供正式成绩、期中成绩、学业完成情况和培养方案。成绩页可按学期和课程性质筛选，并提供自定义 GPA 选择；具体结果始终以页面实时数据为准。",
  },
  {
    relatedActionIds: ["schedule"],
    fact: "课表：支持日视图、周视图、学期和周次切换。移动端可按课表页提示安装到桌面；没有自动提示时可使用页面右上角的下载按钮。课程日期按所选学期和周次计算。",
  },
  {
    relatedActionIds: ["dorm-electric"],
    fact: "宿舍电费：登录后可查询当前账号关联宿舍的剩余金额、估算电量和抄表时间。站内只负责查询，不直接缴费；查不到可能是学号未关联宿舍或校园电费系统暂时不可用。",
  },
  {
    relatedActionIds: ["dorm-electric"],
    fact: "宿舍购电：先在中国建设银行 APP 搜索“校园卡充值”，选择“中国药科大学”充值校园卡；再到企业微信→工作台→校园卡务完成购电。校园卡务加载可能较慢，每日 23:30 至次日 02:00 系统盘点，无法充值或购电。",
  },
  {
    relatedActionIds: ["voicehub"],
    fact: "药苑之声点歌：进入药苑之声后打开点歌入口，输入歌曲名称搜索，可在网易云音乐、QQ 音乐或哔哩哔哩结果中选择投稿；启用时还可选择期望播出时段。点歌需要登录，提交后由管理员审核和排期。",
  },
  {
    relatedActionIds: ["voicehub"],
    fact: "药苑之声点歌表单没有“对收听者说的话”、留言或寄语字段，不要指导用户填写这些内容。若歌曲已在列表且尚未排期或播放，用户通常应为已有歌曲投票；已排期或已播放歌曲不能按普通新歌重复投票。",
  },
  {
    relatedActionIds: ["voicehub"],
    fact: "药苑之声还提供歌曲列表、播出排期、节目投票和播放信息；歌曲是否已播放取决于它是否已经排期且排期日期已经过去，不应仅因历史导入或歌曲存在就判断为已播放。",
  },
  {
    relatedActionIds: ["announcements"],
    fact: "校园公告：汇总教务处、学工处、研究生院等学校公开来源的通知，适合查公开公告；发布时间、报名要求和最新政策应以公告详情及学校原始页面为准。",
  },
  {
    relatedActionIds: ["lost-found"],
    fact: "失物招领：可按校区、地点、时间和认领状态浏览或发布信息。面向普通用户展示时会保护学号等敏感字段；管理员在授权后台仍可查看原始数据以便核验和处理。",
  },
  {
    relatedActionIds: ["forum"],
    fact: "校园论坛：用于校园讨论、提问和经验分享，支持帖子、回复与站内消息提醒；是否开放以当前账号和功能开关为准。",
  },
  {
    relatedActionIds: ["course-review"],
    fact: "课程点评：用于查看课程和教师评价，帮助了解修读体验；评价来自用户分享，不等同于学校官方结论。",
  },
  {
    relatedActionIds: ["market"],
    fact: "校园商城：用于发布和浏览校内二手、求购与交换信息；交易应在确认物品和对方身份后谨慎完成，平台页面展示为准。",
  },
  {
    relatedActionIds: ["school-calendar"],
    fact: "药大校历：保留学校官方校历原图，并将学期、假期和关键日期整理为便于查看的卡片。具体临时调整仍以学校最新通知为准。",
  },
  {
    relatedActionIds: ["pdf-tools"],
    fact: "PDF 工具：可在浏览器本地完成 PDF 合并、拆分、压缩、转图片和提取文字，常规处理不需要把文件上传到服务器。",
  },
  {
    relatedActionIds: ["file-collect"],
    fact: "文件收集：发起者可创建作业、材料或照片收集任务并分享提交链接；系统支持字段校验、文件命名、提交统计和批量下载。",
  },
  {
    relatedActionIds: ["questionnaire"],
    fact: "在线问卷：用于创建、分享、填写和统计轻量问卷；是否需要登录由问卷发起者的设置决定。",
  },
  {
    relatedActionIds: ["grade-check"],
    fact: "成绩表核对：发起者上传带学号字段的 Excel 后，学生登录并按本人学号查看对应记录；它与学校教务成绩页面不是同一功能。",
  },
  {
    relatedActionIds: ["cpu-network"],
    fact: "CPU 网络连接助手：提供 Windows 校园网连接工具的下载与使用入口，不是浏览器内直接修改网络设置。",
  },
  {
    relatedActionIds: ["feedback"],
    fact: "需求反馈：用于提交功能建议、使用问题和校园工具需求，提交后由站点维护者在后台处理。",
  },
  {
    relatedActionIds: ["messages", "profile"],
    fact: "通知与 QQ：消息中心查看站内通知、回复提醒和系统消息；个人中心可绑定 QQBot，以便在 QQ 同步接收部分站内通知。绑定入口不在消息列表首页。",
  },
];

export function listCampusAssistantActions(context: CampusAssistantContext): CampusAssistantAction[] {
  return CAMPUS_ASSISTANT_ROUTES
    .filter((item) => !item.feature || context.features[item.feature])
    .filter((item) => !item.requireForumAccess || context.forumAccessEnabled)
    .map(({ keywords: _keywords, feature: _feature, requireForumAccess: _requireForumAccess, ...action }) => action);
}

export function listCampusAssistantKnowledge(actionIds: Iterable<string>) {
  const availableActionIds = new Set(actionIds);
  return CAMPUS_ASSISTANT_KNOWLEDGE
    .filter((item) => item.relatedActionIds.some((id) => availableActionIds.has(id)))
    .map((item) => item.fact);
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
  if (isCampusAssistantPublicTopicRestricted(message, input.history)) {
    return cloneRestrictedPublicTopicReply();
  }
  const availableActions = listCampusAssistantActions(input.context);
  const deterministicActions = searchCampusAssistantActions(message, input.context, 3);
  const config = getSiteConfig();
  if (!config.aiReviewEnabled || !config.aiReviewApiKey.trim()) {
    return fallbackAssistantResponse(deterministicActions, false);
  }

  try {
    const result = await requestAiJson(buildAssistantMessages(
      message,
      input.history,
      availableActions,
      input.context.loggedIn,
    ), {
      promptCacheScope: "campus-assistant",
    });
    const parsed = parseAssistantJson(result.content);
    return guardCampusAssistantResponse(
      normalizeAssistantResponse(parsed, availableActions, deterministicActions),
    );
  } catch (error) {
    console.warn("[campus-assistant] AI request failed", error instanceof Error ? error.message : error);
    return fallbackAssistantResponse(deterministicActions, true);
  }
}

export async function streamCampusAssistant(input: {
  message: string;
  history: CampusAssistantMessage[];
  context: CampusAssistantContext;
  signal?: AbortSignal;
}, onAnswerDelta: (delta: string) => void | Promise<void>): Promise<CampusAssistantResponse> {
  const message = input.message.trim();
  if (isCampusAssistantPublicTopicRestricted(message, input.history)) {
    return cloneRestrictedPublicTopicReply();
  }
  const availableActions = listCampusAssistantActions(input.context);
  const deterministicActions = searchCampusAssistantActions(message, input.context, 3);
  const config = getSiteConfig();
  if (!config.aiReviewEnabled || !config.aiReviewApiKey.trim()) {
    return fallbackAssistantResponse(deterministicActions, false);
  }

  const endpoint = normalizeAiJsonApiUrl(config.aiReviewApiUrl, DEFAULT_REVIEW_API_URL);
  const candidates = resolveModelCandidates(config.aiReviewModel, config.aiReviewFallbackModels);
  const messages = buildAssistantMessages(message, input.history, availableActions, input.context.loggedIn);
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    try {
      const result = await sendAiJsonRequest({
        endpoint,
        apiKey: config.aiReviewApiKey,
        model,
        temperature: 0.1,
        messages,
        stream: true,
        signal: input.signal,
      });
      if (!result.response.ok) {
        const errorText = result.errorText || await result.response.text().catch(() => "");
        if (index < candidates.length - 1 && shouldFallbackToNextModel(result.response.status, errorText)) {
          lastError = new Error(`模型 ${model} 暂时不可用`);
          continue;
        }
        throw new Error(`AI 请求失败：${result.response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}`);
      }

      let rawContent = "";
      let emittedAnswer = "";
      let restrictedOutput = false;
      const content = await readAiJsonTextStream(result.response, result.mode, async (delta) => {
        rawContent += delta;
        const visible = extractPartialJsonStringValue(rawContent, "answer") || "";
        if (containsRestrictedPublicTopic(visible)) {
          restrictedOutput = true;
          return;
        }
        if (restrictedOutput) return;
        if (visible.startsWith(emittedAnswer) && visible.length > emittedAnswer.length) {
          await onAnswerDelta(visible.slice(emittedAnswer.length));
          emittedAnswer = visible;
        }
      });
      if (restrictedOutput) return cloneRestrictedPublicTopicReply();
      const parsed = parseAssistantJson(content);
      return guardCampusAssistantResponse(
        normalizeAssistantResponse(parsed, availableActions, deterministicActions),
      );
    } catch (error) {
      if (input.signal?.aborted) throw error;
      lastError = error;
      if (index < candidates.length - 1) continue;
    }
  }

  console.warn("[campus-assistant] streaming AI request failed", lastError instanceof Error ? lastError.message : lastError);
  return fallbackAssistantResponse(deterministicActions, true);
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
  const candidateIds = deterministicActions.length
    ? deterministicActions.map((item) => item.id)
    : requestedIds;
  const actions: CampusAssistantAction[] = [];
  const seen = new Set<string>();
  for (const id of candidateIds) {
    const action = actionMap.get(id);
    if (!action || seen.has(id)) continue;
    seen.add(id);
    actions.push(action);
    if (actions.length >= 3) break;
  }
  const answer = String(value.answer || "").trim().slice(0, 4000)
    || (actions.length ? "我找到了这些相关入口，可以直接打开。" : "我暂时没有找到合适的答案，可以换一种说法再问我。");
  const suggestions = Array.isArray(value.suggestions)
    ? value.suggestions
      .map((item) => String(item || "").trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 3)
    : [];
  return { answer, actions, suggestions, fallback: false };
}

export function extractPartialJsonStringValue(source: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escapedKey}"\\s*:\\s*"`).exec(source);
  if (!match) return null;
  let output = "";
  let index = match.index + match[0].length;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') return output;
    if (char !== "\\") {
      output += char;
      index += 1;
      continue;
    }
    if (index + 1 >= source.length) break;
    const escape = source[index + 1];
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escape !== "u") {
      if (!(escape in simpleEscapes)) break;
      output += simpleEscapes[escape];
      index += 2;
      continue;
    }
    const hex = source.slice(index + 2, index + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
    const code = Number.parseInt(hex, 16);
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextEscape = source.slice(index + 6, index + 8);
      const lowHex = source.slice(index + 8, index + 12);
      if (nextEscape !== "\\u" || !/^[0-9a-fA-F]{4}$/.test(lowHex)) break;
      const lowCode = Number.parseInt(lowHex, 16);
      if (lowCode < 0xdc00 || lowCode > 0xdfff) break;
      output += String.fromCodePoint(((code - 0xd800) * 0x400) + lowCode - 0xdc00 + 0x10000);
      index += 12;
      continue;
    }
    output += String.fromCharCode(code);
    index += 6;
  }
  return output;
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

export function isCampusAssistantPublicTopicRestricted(
  message: string,
  history: CampusAssistantMessage[] = [],
) {
  if (containsRestrictedPublicTopic(message)) return true;
  if (!/^(?:继续(?:详细)?说说|继续|接着|详细说说|展开说说|为什么|真的吗|然后呢|再说一点|多讲一点)[？?！!。.\s]*$/u.test(message.trim())) {
    return false;
  }
  const previousUserMessage = [...history].reverse().find((item) => item.role === "user")?.content || "";
  return containsRestrictedPublicTopic(previousUserMessage);
}

function containsRestrictedPublicTopic(value: string) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return false;
  if (RESTRICTED_PUBLIC_TOPIC_TERMS.some((term) => normalized.includes(normalizeSearchText(term)))) {
    return true;
  }
  return /^(?:请|能否|可以|帮我|给我|想)?(?:解释|介绍|讨论|讲讲|说说|评价|了解|查找|搜索|整理)?六四(?:是什么|指什么|事件|风波|运动|真相|历史|资料|经过|背景|结果|影响|原因|吗)?$/u.test(normalized);
}

export function guardCampusAssistantResponse(response: CampusAssistantResponse) {
  if (containsRestrictedPublicTopic(response.answer)) return cloneRestrictedPublicTopicReply();
  return {
    ...response,
    suggestions: response.suggestions.filter((item) => !containsRestrictedPublicTopic(item)),
  };
}

function cloneRestrictedPublicTopicReply(): CampusAssistantResponse {
  return {
    ...RESTRICTED_PUBLIC_TOPIC_REPLY,
    actions: [],
    suggestions: [...RESTRICTED_PUBLIC_TOPIC_REPLY.suggestions],
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
  const knowledge = listCampusAssistantKnowledge(catalog.map((item) => item.id));
  return [
    "你是“药大拾间”的 AI 助手“拾间AI”，面向中国药科大学学生。",
    "你的首要任务是帮助用户找到站内功能、给出可靠的操作指引，也可以进行普通聊天和常识问答。",
    "根据问题难度完整作答：简单问题可以简洁，复杂问题应分段说明背景、步骤和注意事项，不要为了追求短而省略关键解释。",
    "本服务面向中国大陆公众提供。回答必须遵守中国现行法律法规和平台内容规范；不得提供违法犯罪、暴恐极端、色情低俗、赌博毒品、诈骗欺诈、网络攻击、侵害隐私等内容的具体实施方法。遇到此类请求应简短说明不能协助，并尽量提供安全、合法的替代信息。",
    "本站不提供政治敏感议题、敏感历史事件、危害国家安全和社会稳定相关内容的介绍、解释、评价、资料整理或延伸讨论；即使用户声称用于学习、研究、新闻核实或要求中立概述，也应直接简短拒绝，不复述事件细节，不提供搜索词、来源或绕过方式。",
    "如果上下文中的上一轮已触及上述内容，用户以“继续”“详细说说”“为什么”等方式追问时仍须拒绝，不得因措辞变得含糊而恢复回答。",
    "不要把正常的校园学习、生活咨询泛化为违规内容；仅在请求确实触及上述风险时限制回答。",
    "不要声称已经替用户执行查询、缴费、登录、发帖或其他操作；只能说明步骤并推荐入口。",
    "遇到需要实时数据、个人数据或学校最新政策的问题，要说明需要进入对应页面查看，不要编造。",
    "仅当用户最新一条消息明确要求查找、打开或使用某项站内功能时才返回 actionIds；对于“好的”“谢谢”等确认语和普通聊天，不要重复推荐上一轮入口。",
    "回答站内功能、字段和流程时必须以提供的 knowledge 为准；knowledge 没写明的细节要坦率说明不确定，不能按其他产品的常见设计补造。",
    `用户当前${loggedIn ? "已登录" : "未登录"}。带 requireLogin=true 的入口可以推荐，但要提醒未登录用户先登录。`,
    "你只能从下面的 catalog 中选择 actionIds，绝不能生成 catalog 之外的链接或 action id。",
    "只输出 JSON 对象，不要使用 Markdown 代码块。格式：",
    '{"answer":"清晰、完整的中文答复","actionIds":["最多3个catalog id"],"suggestions":["最多3个简短追问建议"]}',
    `knowledge=${JSON.stringify(knowledge)}`,
    `catalog=${JSON.stringify(catalog)}`,
  ].join("\n");
}

function buildAssistantMessages(
  message: string,
  history: CampusAssistantMessage[],
  availableActions: CampusAssistantAction[],
  loggedIn: boolean,
) {
  const catalog = availableActions.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    requireLogin: item.requireLogin,
  }));
  return [
    {
      role: "system" as const,
      content: buildSystemPrompt(catalog, loggedIn),
    },
    ...history.slice(-12).map((item) => ({
      role: item.role,
      content: item.content.slice(0, 2000),
    } as const)),
    {
      role: "user" as const,
      content: message,
    },
  ];
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
