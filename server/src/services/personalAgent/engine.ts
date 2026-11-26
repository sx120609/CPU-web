import { z } from "zod";
import {
  allowsPlainTextAssistantAnswer,
  assistantSchoolOf,
  buildCampusKnowledgeInstruction,
  containsRestrictedPublicTopic,
  extractPartialJsonStringValue,
  guardCampusAssistantResponse,
  isCampusAssistantPublicTopicRestricted,
  isQwenAssistantModel,
  listCampusAssistantActions,
  loadCampusAssistantKnowledge,
  localizeAssistantText,
  normalizeAssistantResponse,
  parseAssistantJson,
  restrictedPublicTopicReply,
  type CampusAssistantAction,
  type CampusAssistantContext,
  type CampusAssistantMessage,
} from "../campusAssistant";
import { isSchoolModuleEnabled } from "../../schools/modules";
import { executeDepartmentContactToolQueries } from "../departmentContactsAssistant";
import {
  buildAiPromptCacheKey,
  normalizeAiJsonApiUrl,
  readAiJsonTextStream,
  sendAiJsonRequestWithProviderFallback,
  type AiProviderCandidate,
} from "../aiJsonApi";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "../aiReviewLog";
import { resolveModelCandidates } from "../modelFallback";
import {
  getSiteConfig,
  isAiProviderReady,
  resolveAiServiceCandidatesForScene,
} from "../siteSettings";
import { academicTools } from "./academicTools";
import { campusLifeTools } from "./campusLifeTools";
import { communityTools } from "./communityTools";
import { scheduleTools } from "./scheduleTools";
import {
  MEMORY_CATEGORY_LABELS,
  PERSONAL_AGENT_SCOPE_KEYS,
  PERSONAL_AGENT_SCOPE_LABELS,
  personalAgentStore,
  type PersonalAgentMemory,
} from "./store";
import {
  JwxtReauthRequiredError,
  personalAgentProposalSchema,
  shanghaiNowParts,
  type PersonalAgentMemoryChange,
  type PersonalAgentProposal,
  type PersonalAgentStepEvent,
  type PersonalAgentToolContext,
  type PersonalAgentToolDefinition,
} from "./types";

export type PersonalAgentStoreLike = ReturnType<typeof import("./store").createPersonalAgentStore>;

const MAX_TOOL_ROUNDS = 4;
const MAX_TOOLS_PER_ROUND = 4;
const MAX_PROPOSALS = 6;
const MAX_OUTPUT_TOKENS = 8_000;
const DEFAULT_API_URL = "https://api.deepseek.com/chat/completions";

const departmentContactsSchema = z.object({
  query: z.string().trim().min(1).max(120).describe("要查询的学校部门或办事窗口关键词，如 教务处学籍科 / 校园卡补办 / 宿舍报修"),
  campus: z.string().trim().max(30).optional().describe("可选校区：江宁 或 玄武门"),
}).strict();

const departmentContactTool: PersonalAgentToolDefinition<typeof departmentContactsSchema> = {
  name: "campus_department_contacts",
  scope: "community",
  label: (args) => `正在查询学校部门联系方式「${args?.query || ""}」…`,
  description: "查询学校公开部门办公电话、邮箱、窗口位置与办事指引（仅在需要具体部门电话/办公点时调用）。",
  schema: departmentContactsSchema,
  async execute(args, ctx) {
    if (!isSchoolModuleEnabled(ctx.schoolId, "departmentContacts")) {
      return { ok: false, message: "本校暂未开放部门通讯录检索" };
    }
    const res = executeDepartmentContactToolQueries([{
      q: args.query,
      ...(args.campus === "江宁" || args.campus === "玄武门" ? { campus: args.campus } : {}),
    }]);
    const contacts = res.results.flatMap((r) => r.contacts).slice(0, 6).map((c) => ({
      department: c.department,
      office: c.office,
      campus: c.campus,
      purpose: c.purpose.slice(0, 220),
      phones: c.phones.map((p) => p.number),
      emails: c.emails.slice(0, 2),
      onlineUrl: c.onlineUrl,
      note: c.note.slice(0, 160),
    }));
    return { ok: true, contacts };
  },
};

export const ALL_PERSONAL_AGENT_TOOLS: PersonalAgentToolDefinition<any>[] = [
  ...academicTools,
  ...scheduleTools,
  ...campusLifeTools,
  ...communityTools,
  departmentContactTool,
];

const TOOL_MAP = new Map<string, PersonalAgentToolDefinition<any>>(
  ALL_PERSONAL_AGENT_TOOLS.map((tool) => [tool.name, tool]),
);

const rawToolCallSchema = z.object({
  tool: z.string().trim().min(1).max(60),
  args: z.record(z.unknown()).optional().default({}),
});

export interface PersonalAgentResponse {
  answer: string;
  actions: CampusAssistantAction[];
  suggestions: string[];
  proposals: PersonalAgentProposal[];
  steps: PersonalAgentStepEvent[];
  memoryChanges: PersonalAgentMemoryChange[];
  fallback: boolean;
}

export function extractRequestedToolCalls(parsed: unknown): Array<{ tool: string; args: Record<string, unknown> }> {
  if (!parsed || typeof parsed !== "object") return [];
  const rawCalls = (parsed as Record<string, unknown>).toolCalls;
  if (!Array.isArray(rawCalls) || !rawCalls.length) return [];
  const valid: Array<{ tool: string; args: Record<string, unknown> }> = [];
  for (const item of rawCalls.slice(0, MAX_TOOLS_PER_ROUND)) {
    const check = rawToolCallSchema.safeParse(item);
    if (!check.success) continue;
    if (!TOOL_MAP.has(check.data.tool)) continue;
    valid.push(check.data);
  }
  return valid;
}

export function sanitizePersonalAgentProposals(
  rawProposals: unknown,
  ctx: PersonalAgentToolContext,
): PersonalAgentProposal[] {
  const out: PersonalAgentProposal[] = [];
  if (Array.isArray(rawProposals)) {
    for (const raw of rawProposals.slice(0, 10)) {
      const parsed = personalAgentProposalSchema.safeParse(raw);
      if (!parsed.success) continue;
      const item = parsed.data;
      if (item.type === "permission.enable" || item.type === "jwxt.reauth") continue;
      if (item.type === "agenda.create") {
        if (containsRestrictedPublicTopic(`${item.item.title} ${item.item.note} ${item.item.location}`)) continue;
        if (!item.item.date) {
          item.item.start = "";
          item.item.end = "";
        }
        if (item.item.end && (!item.item.start || item.item.end <= item.item.start)) {
          item.item.end = "";
        }
      }
      if (item.type === "forum.post" && containsRestrictedPublicTopic(`${item.title} ${item.content}`)) continue;
      if ((item.type === "forum.reply" || item.type === "dm.send") && containsRestrictedPublicTopic(item.content)) continue;
      if (item.type === "lostfound.post") {
        if (containsRestrictedPublicTopic(`${item.itemName} ${item.description} ${item.location}`)) continue;
        if (item.kind === "found" && item.storageLocation.trim().length < 2) continue;
      }
      out.push(item);
      if (out.length >= MAX_PROPOSALS) break;
    }
  }

  for (const scope of ctx.blockedScopes) {
    const meta = PERSONAL_AGENT_SCOPE_LABELS[scope];
    if (meta && !out.some((p) => p.type === "permission.enable" && p.scope === scope)) {
      out.push({
        type: "permission.enable",
        scope,
        title: `开启「${meta.title}」授权`,
        hint: meta.hint,
      });
    }
  }

  if (ctx.needsManualJwxtReauth && !out.some((p) => p.type === "jwxt.reauth")) {
    out.push({
      type: "jwxt.reauth",
      reason: "需要恢复学校统一认证登录状态，才能继续实时读取课表、成绩或图书馆数据",
    });
  }

  return out;
}

function summarizeToolCatalogPrompt() {
  return ALL_PERSONAL_AGENT_TOOLS.map((tool) => {
    const shape = tool.schema instanceof z.ZodObject ? Object.keys(tool.schema.shape) : [];
    return `- ${tool.name} [需开启权限:${tool.scope}]: ${tool.description} 参数键: ${shape.length ? shape.join(", ") : "无({})"}`;
  }).join("\n");
}

export function buildPersonalAgentSystemPrompt(input: {
  schoolContext: Pick<CampusAssistantContext, "schoolId">;
  ctx: PersonalAgentToolContext;
  memories: PersonalAgentMemory[];
  catalog: Array<Pick<CampusAssistantAction, "id" | "label" | "description">>;
  knowledgeText: string;
  executedRounds: Array<{ round: number; results: Array<{ tool: string; args: unknown; result: unknown }> }>;
  allowMoreTools: boolean;
}) {
  const school = assistantSchoolOf(input.schoolContext);
  const nowInfo = shanghaiNowParts(input.ctx.now);
  const scopeSummary = PERSONAL_AGENT_SCOPE_KEYS.map((key) => (
    `${key}(${PERSONAL_AGENT_SCOPE_LABELS[key].title})=${input.ctx.permissions[key] ? "已授权" : "未授权"}`
  )).join("，");

  const memoryBlock = input.ctx.permissions.memory
    ? (input.memories.length
      ? input.memories.map((m) => `[id=${m.id}|${MEMORY_CATEGORY_LABELS[m.category]}] ${m.content}`).join("\n")
      : "（暂无已保存的个人记忆）")
    : "（用户已关闭跨会话个人记忆开关）";

  const toolResultsBlock = input.executedRounds.length
    ? `\n【本轮已执行的真实工具结果（请严格据此回答，绝不编造）】\n${JSON.stringify(input.executedRounds)}`
    : "";

  const baseRules = [
    `你是“药大拾间”的深度个人校园智能体“拾间AI Agent”，服务于中国药科大学师生（独立非官方学生自研平台，不代表学校官方）。`,
    `当前用户昵称：${input.ctx.nickname || "同学"}，学校统一认证绑定：${input.ctx.studentSso ? "已绑定学号" : "站内独立账号"}。`,
    `当前数据域授权状态：${scopeSummary}。`,
    "【核心铁律：真实取数与确定性精算】",
    "1. 凡涉及用户本人的课表、日程待办、空课时间、情侣/宿舍共同空闲、成绩与绩点(GPA)、重修刷分提升、考试考场、毕业学分缺口、培养方案、四六级、空教室、宿舍电费、图书馆借阅、平时分核对单、问卷/文件收集任务、我的消息私信，以及站内实时公告/热帖/课程点评/失物招领，**必须先通过 toolCalls 调用对应工具获取真实结果后再作答**，严禁凭空猜测或让用户自己去翻页面。",
    "2. 若某个权限域当前显示“未授权”，但用户明确问到了该域的问题，你仍然可以调用对应工具一次——服务端会安全拦截并自动在前端生成「一键开启该项授权」的交互卡片；此时你在 answer 中温和说明需点下方卡片开启该项数据授权即可。",
    "3. 工具返回的 GPA、加权分、必修绩点、重修模拟增幅、学分缺口、共同空课节次已经由服务端确定性代码精确计算完毕，**请直接引用工具给出的数字与明细，不要自己重新心算加权平均**。",
    input.allowMoreTools
      ? `4. 需要调用工具时：在 JSON 第一个字段 toolCalls 中填入 1~${MAX_TOOLS_PER_ROUND} 个并行工具请求（不要重复调用已成功执行过的相同工具和参数），同时将 answer 设为空字符串 ""，proposals 和 memoryOps 设为空数组 []。拿到足够数据准备给出最终答复时：toolCalls 必须设为 []，并完整填写 answer。`
      : "4. 已达最大工具轮次，本轮**禁止再输出任何 toolCalls（必须为 []）**，请立即基于已有工具结果给出准确答复；缺失的数据如实说明。",
    "【可用工具清单】",
    summarizeToolCatalogPrompt(),
    "【代办动作提案（proposals）】",
    "当用户要求添加/修改/完成/删除个人日程，或要求代写发帖、回帖、发布失物招领、发私信、全部已读时，在最终回复的 proposals 数组中生成结构化提案卡片（发帖/回帖/失物招领/私信会先展示可编辑预览卡片由用户确认后才真正发出，因此 answer 里请说“已为你准备好草稿/日程卡片，确认即可生效”，绝不能说“已经发出去了”）：",
    '- 新建日程：{"type":"agenda.create","item":{"kind":"event","title":"标题","date":"YYYY-MM-DD或空","start":"HH:mm或空","end":"HH:mm或空","location":"","note":"","remind":15,"repeat":"none|daily|weekdays|weekly|monthly"},"conflictHint":"若与某节课冲突写明，否则空"}',
    '- 修改日程（id 必须取自工具读到的真实日程 id）：{"type":"agenda.update","id":"日程id","title":"原日程标题","changes":{"date":"...","start":"..."}}',
    '- 完成/删除日程：{"type":"agenda.complete","id":"日程id","title":"标题","date":"YYYY-MM-DD或空"} 或 {"type":"agenda.delete","id":"日程id","title":"标题"}',
    '- 论坛发帖草稿（board 必须取自 postableBoards 的 slug）：{"type":"forum.post","board":"slug","boardName":"板块名","title":"自然真实的标题","content":"自然口吻正文","anonymous":false}',
    '- 帖子回复草稿：{"type":"forum.reply","topicId":123,"topicTitle":"原帖标题","content":"回复正文","anonymous":false}',
    '- 失物招领草稿：{"type":"lostfound.post","kind":"lost|found","itemName":"物品","description":"特征","campus":"江宁校区|玄武门校区","location":"地点","happenedAt":"YYYY-MM-DDTHH:mm","storageLocation":"招领必填存放处","contact":"联系方式(未知则先在answer里问用户，不要编造)"}',
    '- 私信草稿：{"type":"dm.send","userId":456,"name":"对方昵称","content":"私信内容"}；全部通知标为已读：{"type":"messages.readAll"}',
    "【跨会话个人记忆（memoryOps）】",
    input.ctx.permissions.memory
      ? '当用户在对话中透露了值得长期记住的个人背景、目标或偏好（如所在校区、年级专业、准备保研/考研/出国、固定组会时间、自习楼栋偏好，或明确说“记住…”“忘掉…”），可在最终回复的 memoryOps 中附带最多 2 条操作：新增/更新 {"op":"upsert","category":"academic|goal|campus|schedule|preference|note","content":"简明事实(≤100字)"} 或删除 {"op":"delete","id":"已有记忆id"}。不要把一次性临时问题或敏感成绩数字存进长期记忆。'
      : "用户已关闭个人记忆，memoryOps 必须始终为 []。",
    "【表达与合规规范】",
    "- 回答清晰有条理，善用简短分点与加粗重点结论（列举课表、成绩趋势或空课方案时层次分明），语气像熟悉药大校园的贴心学长/私人助理，拒绝空洞套话。",
    "- 仅在用户需要跳转页面时从 catalog 中挑最多 3 个 actionIds，严禁编造 catalog 之外的 id。",
    "- 严格遵守中国法律法规；不提供违法违规内容，不展开政治敏感议题或敏感历史事件讨论。",
    "- **必须只输出一个合法的 JSON 对象，不要用 Markdown 代码块包裹，字段顺序严格固定如下（toolCalls 必须在最前，以便流式输出 answer）**：",
    '{"toolCalls":[],"answer":"中文完整答复（支持Markdown排版）","proposals":[],"memoryOps":[],"actionIds":[],"suggestions":["最多3个贴合当前个人场景的追问建议"]}',
    `【当前北京时间】${nowInfo.date} ${nowInfo.time}（${nowInfo.weekday}），所有“今天/明天/今晚/这周”均以此为准换算精确日期。`,
    `【用户已保存的个人记忆】\n${memoryBlock}`,
    `catalog=${JSON.stringify(input.catalog)}`,
  ];

  const localized = localizeAssistantText(baseRules.join("\n"), school);
  return localized
    + (input.knowledgeText ? `\n${input.knowledgeText}` : "")
    + toolResultsBlock;
}

function canStreamAnswerFromRawJson(raw: string): boolean {
  // 只有确认 "toolCalls" 已经闭合为空数组 [] 时，才实时向前端流式推送 "answer" 字段，避免工具轮闪出半截过渡话术。
  return /^\s*\{\s*"toolCalls"\s*:\s*\[\s*\]/u.test(raw);
}

function truncateToolResultJson(value: unknown, maxChars = 9_000): unknown {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length <= maxChars) return value;
  return {
    truncated: true,
    preview: `${serialized.slice(0, maxChars)}…(已截断)`,
  };
}

export interface StreamPersonalAgentInput {
  message: string;
  history: CampusAssistantMessage[];
  assistantContext: CampusAssistantContext;
  toolContext: PersonalAgentToolContext;
  store?: PersonalAgentStoreLike;
  usage?: { createdById?: number | null; pointCost?: number };
  onStep?: (step: PersonalAgentStepEvent) => void | Promise<void>;
  onAnswerDelta?: (delta: string) => void | Promise<void>;
  /** 可注入自定义模型调用函数，便于单测确定性验证多轮工具循环。 */
  modelRunner?: (params: {
    systemPrompt: string;
    history: CampusAssistantMessage[];
    message: string;
    round: number;
    allowStream: boolean;
    onRawDelta: (delta: string) => Promise<void>;
  }) => Promise<{ content: string }>;
}

export async function streamCampusPersonalAgent(
  input: StreamPersonalAgentInput,
): Promise<PersonalAgentResponse> {
  const message = input.message.trim();
  if (isCampusAssistantPublicTopicRestricted(message, input.history)) {
    return {
      ...restrictedPublicTopicReply(),
      proposals: [],
      steps: [],
      memoryChanges: [],
    };
  }

  const store = input.store ?? personalAgentStore;
  const availableActions = listCampusAssistantActions(input.assistantContext);
  const catalog = availableActions.map(({ id, label, description }) => ({ id, label, description }));
  const [memories, knowledge] = await Promise.all([
    input.toolContext.permissions.memory ? store.listMemories(input.toolContext.userId) : Promise.resolve([]),
    loadCampusAssistantKnowledge(message, input.history, input.assistantContext),
  ]);
  const knowledgeText = knowledge.length ? buildCampusKnowledgeInstruction(knowledge) : "";
  const history = input.history.slice(-16).map((item) => ({
    role: item.role,
    content: item.content.slice(0, 2_000),
  }));

  let providers: AiProviderCandidate[] = [];
  let candidates: string[] = ["mock-model"];
  let logId: number | null = null;

  if (!input.modelRunner) {
    const config = getSiteConfig();
    providers = resolveAiServiceCandidatesForScene(config, "assistant");
    const primary = providers[0];
    if (!config.aiReviewEnabled || !providers.some((candidate) => isAiProviderReady({
      provider: candidate.provider,
      apiUrl: candidate.apiUrl,
      apiKey: candidate.apiKey,
      model: config.assistantModel,
    }))) {
      return {
        answer: "拾间AI问答暂未启用。",
        actions: [],
        suggestions: [],
        proposals: [],
        steps: [],
        memoryChanges: [],
        fallback: true,
      };
    }
    candidates = resolveModelCandidates(config.assistantModel, "");
    const started = await startAiReviewLog({
      kind: "campus-assistant",
      targetLabel: "拾间AI 深度个人Agent",
      provider: primary.provider || "ai-json-api",
      model: candidates[0] || config.assistantModel,
      endpoint: normalizeAiJsonApiUrl(primary.apiUrl, DEFAULT_API_URL),
      requestSummary: message,
      createdById: input.usage?.createdById ?? null,
      pointCost: input.usage?.pointCost ?? 0,
    });
    logId = started?.id ?? null;
  }

  const steps: PersonalAgentStepEvent[] = [];
  const executedRounds: Array<{ round: number; results: Array<{ tool: string; args: unknown; result: unknown }> }> = [];
  const seenCalls = new Set<string>();
  let stepCounter = 0;

  const callModelOnce = async (round: number, allowMoreTools: boolean): Promise<{ content: string; streamedAnswer: string; restricted: boolean }> => {
    const systemPrompt = buildPersonalAgentSystemPrompt({
      schoolContext: input.assistantContext,
      ctx: input.toolContext,
      memories,
      catalog,
      knowledgeText,
      executedRounds,
      allowMoreTools,
    });

    let raw = "";
    let emitted = "";
    let restricted = false;

    const handleRawDelta = async (delta: string) => {
      raw += delta;
      if (!canStreamAnswerFromRawJson(raw)) return;
      const visible = extractPartialJsonStringValue(raw, "answer") || "";
      if (containsRestrictedPublicTopic(visible)) restricted = true;
      if (restricted) return;
      if (visible.startsWith(emitted) && visible.length > emitted.length) {
        await input.onAnswerDelta?.(visible.slice(emitted.length));
        emitted = visible;
      }
    };

    if (input.modelRunner) {
      const res = await input.modelRunner({
        systemPrompt,
        history,
        message,
        round,
        allowStream: true,
        onRawDelta: handleRawDelta,
      });
      return { content: res.content, streamedAnswer: emitted, restricted };
    }

    let lastError: unknown = null;
    for (const model of candidates) {
      raw = "";
      emitted = "";
      restricted = false;
      try {
        const stream = !isQwenAssistantModel(model);
        const upstream = await sendAiJsonRequestWithProviderFallback({
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
          promptCacheKey: buildAiPromptCacheKey("personal-agent-v1", [model]),
          stream,
          signal: input.toolContext.signal,
        });
        if (!upstream.response.ok) {
          const errorText = upstream.errorText || await upstream.response.text().catch(() => "");
          throw new Error(`AI 请求失败：${upstream.response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}`);
        }
        const content = await readAiJsonTextStream(upstream.response, upstream.mode, handleRawDelta);
        return { content, streamedAnswer: emitted, restricted };
      } catch (err) {
        if (input.toolContext.signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AI 请求失败");
  };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const allowMoreTools = round < MAX_TOOL_ROUNDS;
      const { content, streamedAnswer, restricted } = await callModelOnce(round, allowMoreTools);

      if (restricted) {
        await finishAiReviewLogSuccess(logId, "restricted");
        return {
          ...restrictedPublicTopicReply(),
          proposals: [],
          steps,
          memoryChanges: [],
        };
      }

      const activeModel = candidates[0] || "";
      const parsed = parseAssistantJson(content, { allowPlainText: allowsPlainTextAssistantAnswer(activeModel) });
      const requestedCalls = allowMoreTools ? extractRequestedToolCalls(parsed) : [];
      const freshCalls = requestedCalls.filter((call) => {
        const sig = `${call.tool}:${JSON.stringify(call.args)}`;
        if (seenCalls.has(sig)) return false;
        seenCalls.add(sig);
        return true;
      });

      if (freshCalls.length > 0) {
        const roundResults = await Promise.all(freshCalls.map(async (call) => {
          const def = TOOL_MAP.get(call.tool)!;
          const parsedArgs = def.schema.safeParse(call.args);
          const safeArgs = parsedArgs.success ? parsedArgs.data : {};
          const stepId = `step-${++stepCounter}`;
          const label = def.label(safeArgs);
          const runningStep: PersonalAgentStepEvent = {
            id: stepId,
            tool: call.tool,
            label,
            status: "running",
          };
          steps.push(runningStep);
          await input.onStep?.({ ...runningStep });

          if (!parsedArgs.success) {
            runningStep.status = "error";
            runningStep.detail = "参数格式不合法";
            await input.onStep?.({ ...runningStep });
            return {
              tool: call.tool,
              args: call.args,
              result: { ok: false, errorCode: "INVALID_ARGS", message: parsedArgs.error.issues[0]?.message || "参数校验失败" },
            };
          }

          try {
            const output = await def.execute(parsedArgs.data, input.toolContext);
            const outObj = output && typeof output === "object" ? output as Record<string, unknown> : {};
            if (outObj.ok === false && outObj.errorCode === "PERMISSION_DISABLED") {
              runningStep.status = "blocked";
              runningStep.detail = String(outObj.scopeTitle ? `需开启「${outObj.scopeTitle}」` : "需开启对应授权");
            } else if (outObj.ok === false) {
              runningStep.status = "error";
              runningStep.detail = String(outObj.message || "暂未取到数据").slice(0, 60);
            } else {
              runningStep.status = "done";
            }
            await input.onStep?.({ ...runningStep });
            return {
              tool: call.tool,
              args: parsedArgs.data,
              result: truncateToolResultJson(output),
            };
          } catch (toolErr) {
            if (toolErr instanceof JwxtReauthRequiredError) {
              throw toolErr;
            }
            runningStep.status = "error";
            runningStep.detail = toolErr instanceof Error ? toolErr.message.slice(0, 60) : "查询异常";
            await input.onStep?.({ ...runningStep });
            return {
              tool: call.tool,
              args: parsedArgs.data,
              result: {
                ok: false,
                errorCode: "TOOL_EXECUTION_ERROR",
                message: toolErr instanceof Error ? toolErr.message : "工具执行失败",
              },
            };
          }
        }));

        executedRounds.push({ round: round + 1, results: roundResults });
        continue;
      }

      // 最终答复轮
      const base = guardCampusAssistantResponse(normalizeAssistantResponse(parsed, availableActions));
      if (!base.fallback && base.answer.startsWith(streamedAnswer) && base.answer.length > streamedAnswer.length) {
        await input.onAnswerDelta?.(base.answer.slice(streamedAnswer.length));
      } else if (!base.fallback && !streamedAnswer && base.answer) {
        await input.onAnswerDelta?.(base.answer);
      }

      const rawObj = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      const proposals = base.fallback ? [] : sanitizePersonalAgentProposals(rawObj.proposals, input.toolContext);
      const memoryChanges = !base.fallback && input.toolContext.permissions.memory
        ? await store.applyMemoryOperations(input.toolContext.userId, rawObj.memoryOps, input.toolContext.now)
        : [];

      await finishAiReviewLogSuccess(logId, base.answer);
      return {
        answer: base.answer,
        actions: base.actions,
        suggestions: base.suggestions,
        proposals,
        steps,
        memoryChanges,
        fallback: base.fallback,
      };
    }

    await finishAiReviewLogError(logId, "超出最大工具轮次");
    return {
      answer: "拾间AI本轮查询步骤过多，请缩小问题范围后再试。",
      actions: [],
      suggestions: [],
      proposals: [],
      steps,
      memoryChanges: [],
      fallback: true,
    };
  } catch (error) {
    if (error instanceof JwxtReauthRequiredError) {
      await finishAiReviewLogError(logId, "等待静默恢复教务授权");
      throw error;
    }
    if (input.toolContext.signal?.aborted) {
      await finishAiReviewLogError(logId, "请求已取消");
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error || "AI 请求失败");
    await finishAiReviewLogError(logId, msg);
    console.warn("[personal-agent] AI request failed:", msg);
    return {
      answer: "拾间AI暂时没有响应，请稍后再试。",
      actions: [],
      suggestions: [],
      proposals: [],
      steps,
      memoryChanges: [],
      fallback: true,
    };
  }
}
