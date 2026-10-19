import { z } from "zod";
import {
  allowsPlainTextAssistantAnswer,
  buildCampusKnowledgeInstruction,
  containsRestrictedPublicTopic,
  guardCampusAssistantResponse,
  isCampusAssistantPublicTopicRestricted,
  isQwenAssistantModel,
  listCampusAssistantActions,
  loadCampusAssistantKnowledge,
  normalizeAssistantResponse,
  parseAssistantJson,
  restrictedPublicTopicReply,
  extractPartialJsonStringValue,
  type CampusAssistantAction,
  type CampusAssistantContext,
  type CampusAssistantMessage,
} from "./campusAssistant";
import {
  getSiteConfig,
  isAiProviderReady,
  resolveAiServiceCandidatesForScene,
} from "./siteSettings";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { buildAiPromptCacheKey, normalizeAiJsonApiUrl, readAiJsonTextStream, sendAiJsonRequestWithProviderFallback } from "./aiJsonApi";
import { resolveModelCandidates } from "./modelFallback";

/**
 * 拾间AI 的个人模式：药大拾间 NEXT 把用户本机的课表（未来几天）、他自己的日程、
 * App 当前的设置，以及用户授权的公告热榜随问题一起发来；成绩、考试由模型按需
 * 请求（data.request），App 在用户授权后取回、放进 toolResults 再问一次。模型可以
 * 提议 App 里的操作（日程、上课提醒、主题、布局、导航栏、设置、今天的内容、课表
 * 视图与风格、打开站内页面），都由 App 交给用户确认后才执行。这里只校验并转交，
 * 不保存任何个人数据。
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const TIME = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const AGENDA_ID = z.string().regex(/^[a-z0-9]{6,24}$/u);
const DESTINATION = z.string().regex(/^(?:[a-z]{2,20}|custom:[a-z0-9]{1,12})$/u);
const DATA_SOURCE = z.enum(["grades", "exams"]);
const TODAY_SECTION = z.enum(["next", "today", "todo", "upcoming", "messages", "shortcuts", "announcements", "hot", "countdown", "note"]);
const SETTING_KEY = z.enum(["pureBlack", "haptics", "reduceMotion", "keepScreenOn", "secureScreen", "doubleTapRefresh", "webTheme", "postButton"]);
const KIND = z.enum(["event", "todo"]);
const REPEAT = z.enum(["none", "daily", "weekdays", "weekly", "monthly"]);

export const personalContextSchema = z.object({
  /** The phone's local time, `YYYY-MM-DDTHH:mm`. */
  now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),
  /** False when the user keeps their timetable and agenda to themselves; the lists are then empty. */
  shared: z.boolean().default(true),
  week: z.number().int().min(0).max(60).nullable().default(null),
  courses: z.array(z.object({
    date: DATE,
    start: TIME,
    end: TIME,
    name: z.string().trim().min(1).max(60),
    location: z.string().trim().max(60).default(""),
  }).strict()).max(120).default([]),
  agenda: z.array(z.object({
    id: AGENDA_ID,
    kind: KIND,
    title: z.string().trim().min(1).max(60),
    date: z.union([DATE, z.literal("")]).default(""),
    start: z.union([TIME, z.literal("")]).default(""),
    end: z.union([TIME, z.literal("")]).default(""),
    location: z.string().trim().max(40).default(""),
    remind: z.number().int().min(-1).max(10_080).default(-1),
    repeat: REPEAT.default("none"),
    done: z.boolean().default(false),
  }).strict()).max(150).default([]),
  unread: z.number().int().min(0).max(1_000_000).nullable().default(null),
  /** What else the user lets 拾间AI see: grades and exams on request, the campus feeds up front. */
  allow: z.object({
    academic: z.boolean().default(false),
    campus: z.boolean().default(false),
  }).strict().default({}),
  campus: z.object({
    announcements: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    hot: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  }).strict().default({}),
  /** The app as it is set up now, so a change can start from it. */
  app: z.object({
    tabs: z.array(DESTINATION).max(6).default([]),
    launch: z.string().max(40).default(""),
    accent: z.string().max(20).default(""),
    appearance: z.enum(["system", "light", "dark"]).default("system"),
    scheduleStyle: z.string().max(20).default(""),
    courseRemind: z.number().int().min(-1).max(60).default(-1),
  }).strict().default({}),
  /** Data the app fetched for an earlier data.request in this question. */
  toolResults: z.array(z.object({
    source: DATA_SOURCE,
    semester: z.string().max(20).default(""),
    data: z.string().max(12_000),
  }).strict()).max(3).default([]),
}).strict();

export type PersonalContext = z.infer<typeof personalContextSchema>;

const itemFields = z.object({
  kind: KIND.default("event"),
  title: z.string().trim().min(1).max(60),
  date: z.union([DATE, z.literal("")]).default(""),
  start: z.union([TIME, z.literal("")]).default(""),
  end: z.union([TIME, z.literal("")]).default(""),
  location: z.string().trim().max(40).default(""),
  note: z.string().max(500).default(""),
  remind: z.number().int().min(-1).max(10_080).default(-1),
  repeat: REPEAT.default("none"),
});

const clientActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agenda.create"), item: itemFields }),
  z.object({ type: z.literal("agenda.update"), id: AGENDA_ID, changes: itemFields.partial() }),
  z.object({ type: z.literal("agenda.complete"), id: AGENDA_ID, date: z.union([DATE, z.literal("")]).default("") }),
  z.object({ type: z.literal("agenda.delete"), id: AGENDA_ID }),
  z.object({ type: z.literal("course.remind"), minutes: z.union([z.literal(-1), z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]) }),
  z.object({ type: z.literal("theme.accent"), value: z.union([z.enum(["brand", "dynamic"]), z.string().regex(/^#[0-9A-Fa-f]{6}$/u)]) }),
  z.object({ type: z.literal("theme.mode"), value: z.enum(["system", "light", "dark"]) }),
  z.object({ type: z.literal("open"), target: z.enum(["today", "schedule", "agenda", "settings"]), date: z.union([DATE, z.literal("")]).default("") }),
  z.object({ type: z.literal("data.request"), source: DATA_SOURCE, semester: z.string().regex(/^(?:\d{4}-\d{4}-[12])?$/u).default("") }),
  z.object({ type: z.literal("layout.preset"), id: z.enum(["today", "assistant", "classic", "community", "minimal"]) }),
  z.object({ type: z.literal("tabs.set"), tabs: z.array(DESTINATION).min(2).max(6), launch: DESTINATION.optional() }),
  z.object({ type: z.literal("setting.set"), key: SETTING_KEY, value: z.boolean() }),
  z.object({ type: z.literal("text.size"), scale: z.number().min(0.85).max(1.3) }),
  z.object({
    type: z.literal("today.add"), section: TODAY_SECTION,
    title: z.string().trim().max(16).default(""), date: z.union([DATE, z.literal("")]).default(""), text: z.string().max(500).default(""),
  }),
  z.object({ type: z.literal("today.remove"), section: TODAY_SECTION }),
  z.object({ type: z.literal("schedule.view"), view: z.enum(["day", "week", "month"]), date: z.union([DATE, z.literal("")]).default("") }),
  z.object({ type: z.literal("schedule.style"), style: z.enum(["classic", "minimal", "grid", "table", "paper", "board"]) }),
  z.object({ type: z.literal("web.open"), path: z.string().regex(/^\/(?!\/)[^\s\\]{0,300}$/u) }),
]);

export type PersonalClientAction = z.infer<typeof clientActionSchema>;

export type PersonalAssistantResponse = {
  answer: string;
  actions: CampusAssistantAction[];
  suggestions: string[];
  clientActions: PersonalClientAction[];
  fallback: boolean;
};

const MAX_CLIENT_ACTIONS = 6;
const MAX_OUTPUT_TOKENS = 6_000;
const DEFAULT_API_URL = "https://api.deepseek.com/chat/completions";

/**
 * Keeps the proposals that are well formed and refer to the user's own items.
 * A data request needs the user's permission, asks for something not fetched
 * yet, and comes alone; a countdown needs its day.
 */
export function sanitizeClientActions(value: unknown, context: PersonalContext): PersonalClientAction[] {
  if (!Array.isArray(value)) return [];
  const ownIds = new Set(context.agenda.map((item) => item.id));
  const fetched = new Set(context.toolResults.map((result) => result.source));
  const result: PersonalClientAction[] = [];
  for (const raw of value.slice(0, 12)) {
    const parsed = clientActionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const action = parsed.data;
    if ((action.type === "agenda.update" || action.type === "agenda.complete" || action.type === "agenda.delete") && !ownIds.has(action.id)) continue;
    if (action.type === "agenda.create") {
      const item = action.item;
      if (containsRestrictedPublicTopic(`${item.title} ${item.note} ${item.location}`)) continue;
      if (!item.date) { item.start = ""; item.end = ""; }
      if (item.end && (!item.start || item.end <= item.start)) item.end = "";
    }
    if (action.type === "data.request") {
      if (!context.allow.academic || fetched.has(action.source)) continue;
      // The app fetches it and asks again; anything else waits for that answer.
      return [action];
    }
    if (action.type === "today.add") {
      if (action.section === "countdown" && !action.date) continue;
      if (containsRestrictedPublicTopic(`${action.title} ${action.text}`)) continue;
    }
    if (action.type === "tabs.set") {
      action.tabs = [...new Set(action.tabs)];
      if (action.tabs.length < 2 || (action.launch && !action.tabs.includes(action.launch))) continue;
    }
    result.push(action);
    if (result.length >= MAX_CLIENT_ACTIONS) break;
  }
  return result;
}

/**
 * A reply that only asks the app to read grades or exams. The app asks again
 * with the data at once, so the question is charged for that answer alone.
 */
export function isDataRequestOnly(response: PersonalAssistantResponse) {
  return !response.fallback
    && response.clientActions.length === 1
    && response.clientActions[0].type === "data.request"
    && response.answer.length <= 60;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function buildPersonalSystemPrompt(
  context: PersonalContext,
  catalog: Array<Pick<CampusAssistantAction, "id" | "label" | "description">>,
) {
  const [day] = context.now.split("T");
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? "";
  return [
    "你是“药大拾间”的 AI 助手“拾间AI”，现在运行在用户手机上的「药大拾间 NEXT」里，处于个人模式：像一位懂校园生活的私人助理，帮中国药科大学的学生安排时间、记事和查找站内功能。",
    "药大拾间是学生自主开发维护的独立、非官方校园服务，不代表学校。",
    "【个人数据】personal 是用户本机随这次提问发来的数据：courses 是按日期展开的课表（已套用调休），agenda 是用户自己记下的日程（有的带时间，有的只有日期，有的还没定日期；done 表示已打勾完成），unread 是站内未读消息数，app 是 App 现在的设置（导航栏 tabs、启动页 launch、主题色、深浅色、课表风格、上课提醒分钟数），改设置时据此判断。可以据此回答“今天/明天有什么课”“这周哪天下午空”“还有哪些待办”，并在安排时间时检查冲突。不要编造 personal 里没有的课程、日程或时间；personal 没有覆盖的日期就说不知道那天的课。shared=false 表示用户没有让 App 带上课表和日程，这时 courses、agenda 为空不代表没课没事；被问到个人安排时，说明需要点拾间AI 页顶部的「可以看到」打开「课表和日程」，但仍可以照常帮他新建日程待办。消息内容看不到，需要时推荐对应入口；成绩和考试按【查成绩和考试】处理。",
    "【公告热榜】allow.campus=true 时 campus 里是站内最新公告标题和论坛热榜标题，用户问最近有什么通知、热帖时据此回答；为 false 时说明需要在「可以看到」里打开「公告与热榜」。",
    "【查成绩和考试】allow.academic=true 时，用户问成绩、绩点、挂科、考试时间地点时，若 toolResults 里还没有对应数据，只给一个操作 {\"type\":\"data.request\",\"source\":\"grades 或 exams\",\"semester\":\"指定学期如 2025-2026-1，否则空\"}，answer 写一句“我去查一下”即可；App 会取回数据放进 toolResults 再问你一次。toolResults 里已有数据时直接据此回答（data 是 JSON），不要再请求同一来源，也不要编造。allow.academic=false 时说明需要在「可以看到」里打开「成绩与考试」，不能猜测成绩或考试。",
    "【操作】用户要求记下、安排、提醒、修改、完成或删除日程，设置上课提醒，换主题色或深浅色，调整拾间的布局、导航栏、设置、今天页面的内容，切换课表视图或风格，或者打开某个页面时，在 clientActions 里给出对应操作。App 会先展示给用户确认，所以 answer 要说“帮你准备好了，确认后就会添加”这类话，绝不能说“已经添加/已经完成”。没有要求操作时 clientActions 为空数组。",
    "操作格式（字段都用英文键）：",
    '- 新建：{"type":"agenda.create","item":{"kind":"event","title":"简短标题","date":"YYYY-MM-DD 或空（还没定日期）","start":"HH:mm 或空（全天）","end":"HH:mm 或空","location":"","note":"","remind":提前提醒的分钟数(-1 不提醒,0 准时),"repeat":"none|daily|weekdays|weekly|monthly"}}',
    '- 修改：{"type":"agenda.update","id":"agenda 里的 id","changes":{只写要改的字段}}',
    '- 标为完成：{"type":"agenda.complete","id":"…","date":"重复日程完成的那天，否则空"}；删除：{"type":"agenda.delete","id":"…"}',
    '- 上课提醒：{"type":"course.remind","minutes":-1|5|10|15|20|30}；主题色：{"type":"theme.accent","value":"brand|dynamic|#RRGGBB"}；深浅色：{"type":"theme.mode","value":"system|light|dark"}；打开：{"type":"open","target":"today|schedule|agenda|settings","date":"可选"}',
    '- 布局方案：{"type":"layout.preset","id":"today|assistant|classic|community|minimal"}（今天优先／个人助理／和正式版一样／社区／极简）；导航栏：{"type":"tabs.set","tabs":["2 到 6 个，可选 dashboard(今天) agenda(日程) assistant(拾间AI) schedule home academic services profile forum messages market announcements lostfound coursereview workshop tools settings"],"launch":"其中之一，可省略"}',
    '- 设置开关：{"type":"setting.set","key":"pureBlack(纯黑深色)|haptics(触感)|reduceMotion(减弱动效)|keepScreenOn(看课表时亮屏)|secureScreen(禁止截屏)|doubleTapRefresh|webTheme(网页跟随主题)|postButton(首页投稿按钮)","value":true|false}；文字大小：{"type":"text.size","scale":0.85 到 1.3}',
    '- 今天页面：添加 {"type":"today.add","section":"countdown(倒计时，需 date)|note(便签，text 为内容)|next|today|todo|upcoming|messages|shortcuts|announcements|hot","title":"","date":"","text":""}，移除 {"type":"today.remove","section":"…"}',
    '- 课表：视图 {"type":"schedule.view","view":"day|week|month","date":"可选，跳到那天"}；风格 {"type":"schedule.style","style":"classic(经典)|minimal(简约)|grid(格子)|table(表格)|paper(素笺)|board(站牌)"}；打开任意站内页面 {"type":"web.open","path":"以 / 开头，如 /forum、/jwxt、/services/tools、/search?q=关键词"}',
    "规则：日程不再区分待办，kind 一律写 event；时间用 24 小时制；用户说“提醒我”时 remind 至少为 0，没提提醒的有时间日程给 remind=15，只有日期的给 0；只说“下午三点”就是 15:00；修改、完成、删除只能引用 agenda 里存在的 id，找不到对应项就在 answer 里说明；信息不足以确定日期或时间时，先在 answer 里问清楚，不要猜。安排的时间和课程或已有日程冲突时，仍给出操作，但在 answer 里点明冲突。一次请求可以给多个操作（最多 6 个），按用户说的顺序排列。",
    "回答简洁自然，直接给结论；列举课程或日程时按时间排列，写清时间和地点。不要用 Markdown 表格。",
    "本服务面向中国大陆公众。回答必须遵守中国现行法律法规；不得提供违法犯罪、色情低俗、赌博毒品、诈骗、网络攻击、侵害隐私等内容的实施方法。本站不提供政治敏感议题、敏感历史事件相关内容的介绍、评价或延伸讨论，遇到时直接简短拒绝；日程标题和备注同样不能包含这类内容。",
    "仅当用户明确想找或打开某项站内功能时，才从 catalog 里选 actionIds（最多 3 个），绝不能生成 catalog 之外的链接或 id。",
    "只输出一个合法 JSON 对象，不要 Markdown 代码块，不要输出思考过程。格式：",
    '{"answer":"中文答复","clientActions":[],"actionIds":[],"suggestions":["最多3个简短追问"]}',
    // What changes with every request comes last, after the cacheable rules.
    `现在是 ${context.now.replace("T", " ")}（${weekday}，北京时间）${context.week ? `，本学期第 ${context.week} 周` : ""}。所有“今天、明天、下周三”都按这个时间换算成具体日期。`,
    `personal=${JSON.stringify(context)}`,
    `catalog=${JSON.stringify(catalog)}`,
  ].join("\n");
}

function fallbackResponse(failed: boolean): PersonalAssistantResponse {
  return {
    answer: failed ? "拾间AI暂时没有响应，请稍后再试。" : "拾间AI问答暂未启用。",
    actions: [],
    suggestions: [],
    clientActions: [],
    fallback: true,
  };
}

export async function streamPersonalAssistant(input: {
  message: string;
  history: CampusAssistantMessage[];
  personal: PersonalContext;
  context: CampusAssistantContext;
  signal?: AbortSignal;
  usage?: { createdById?: number | null; pointCost?: number };
}, onAnswerDelta: (delta: string) => void | Promise<void>): Promise<PersonalAssistantResponse> {
  const message = input.message.trim();
  if (isCampusAssistantPublicTopicRestricted(message, input.history)) {
    return { ...restrictedPublicTopicReply(), clientActions: [] };
  }
  const config = getSiteConfig();
  const providers = resolveAiServiceCandidatesForScene(config, "assistant");
  const provider = providers[0];
  if (!config.aiReviewEnabled || !providers.some((candidate) => isAiProviderReady({
    provider: candidate.provider,
    apiUrl: candidate.apiUrl,
    apiKey: candidate.apiKey,
    model: config.assistantModel,
  }))) {
    return fallbackResponse(false);
  }
  const availableActions = listCampusAssistantActions(input.context);
  const catalog = availableActions.map(({ id, label, description }) => ({ id, label, description }));
  const knowledge = await loadCampusAssistantKnowledge(message, input.history, input.context);
  const history = input.history.slice(-20).map((item) => ({ role: item.role, content: item.content.slice(0, 2_000) }));
  const systemPrompt = buildPersonalSystemPrompt(input.personal, catalog)
    + (knowledge.length ? `\n${buildCampusKnowledgeInstruction(knowledge)}` : "");
  const candidates = resolveModelCandidates(config.assistantModel, "");
  const started = await startAiReviewLog({
    kind: "campus-assistant",
    targetLabel: "拾间AI 个人模式",
    provider: provider.provider || "ai-json-api",
    model: candidates[0] || config.assistantModel,
    endpoint: normalizeAiJsonApiUrl(provider.apiUrl, DEFAULT_API_URL),
    requestSummary: message,
    createdById: input.usage?.createdById ?? null,
    pointCost: input.usage?.pointCost ?? 0,
  });
  const logId = started?.id ?? null;
  let lastError: unknown = null;

  for (const model of candidates) {
    try {
      // Qwen's local stream can stop before closing the JSON object (see streamCampusAssistant).
      const stream = !isQwenAssistantModel(model);
      const result = await sendAiJsonRequestWithProviderFallback({
        providers,
        fallbackEndpoint: DEFAULT_API_URL,
        model,
        temperature: 0.2,
        maxTokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: message },
        ],
        // The rules lead the prompt, so requests share a cached prefix up to the personal data.
        promptCacheKey: buildAiPromptCacheKey("personal-assistant", [model]),
        stream,
        signal: input.signal,
      });
      if (!result.response.ok) {
        const errorText = result.errorText || await result.response.text().catch(() => "");
        throw new Error(`AI 请求失败：${result.response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}`);
      }
      let raw = "";
      let emitted = "";
      let restricted = false;
      const content = await readAiJsonTextStream(result.response, result.mode, async (delta) => {
        raw += delta;
        const visible = extractPartialJsonStringValue(raw, "answer") || "";
        if (containsRestrictedPublicTopic(visible)) restricted = true;
        if (restricted) return;
        if (visible.startsWith(emitted) && visible.length > emitted.length) {
          await onAnswerDelta(visible.slice(emitted.length));
          emitted = visible;
        }
      });
      if (restricted) {
        await finishAiReviewLogSuccess(logId, "restricted");
        return { ...restrictedPublicTopicReply(), clientActions: [] };
      }
      const parsed = parseAssistantJson(content, { allowPlainText: allowsPlainTextAssistantAnswer(model) });
      const base = guardCampusAssistantResponse(normalizeAssistantResponse(parsed, availableActions));
      const response: PersonalAssistantResponse = {
        answer: base.answer,
        actions: base.actions,
        suggestions: base.suggestions,
        clientActions: base.fallback ? [] : sanitizeClientActions((parsed as Record<string, unknown>)?.clientActions, input.personal),
        fallback: base.fallback,
      };
      if (response.answer.startsWith(emitted) && response.answer.length > emitted.length) {
        await onAnswerDelta(response.answer.slice(emitted.length));
      }
      await finishAiReviewLogSuccess(logId, response.answer);
      return response;
    } catch (error) {
      if (input.signal?.aborted) {
        await finishAiReviewLogError(logId, "请求已取消");
        throw error;
      }
      lastError = error;
    }
  }
  await finishAiReviewLogError(logId, lastError instanceof Error ? lastError.message : String(lastError || "AI 请求失败"));
  console.warn("[personal-assistant] AI request failed", lastError instanceof Error ? lastError.message : lastError);
  return fallbackResponse(true);
}
