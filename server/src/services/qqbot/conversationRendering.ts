import { normalizeRenderedMessage } from "./messageRendering";

export type QqConversationScene = "post" | "forward-post";
export type QqConversationStep =
  | "await-title"
  | "collect-content"
  | "await-forward-confirm"
  | "await-forward-title"
  | "await-ai-post-confirm"
  | "await-submit-confirm";

type ConversationRenderDeps = {
  resolveBoardDisplayName: (slug?: string | null) => Promise<string>;
};

const QQBOT_DRAFT_PREVIEW_LIMIT = 220;

export function createConversationRenderer(deps: ConversationRenderDeps) {
  async function renderConversationPrompt(conversation: any, assistantHint?: string) {
    const boardDisplayName = conversation.draftBoardSlug ? await deps.resolveBoardDisplayName(conversation.draftBoardSlug) : "";
    const draftPreview = conversation.draftContent
      ? `${conversation.draftContent.slice(0, QQBOT_DRAFT_PREVIEW_LIMIT)}${conversation.draftContent.length > QQBOT_DRAFT_PREVIEW_LIMIT ? "..." : ""}`
      : "";
    const draftStats = buildConversationDraftStats(conversation);
    const normalizedHint = normalizeRenderedMessage(assistantHint || "");
    if (conversation.step === "await-title") {
      const isRetitling = /重新发一个标题|重新标题|改标题|新标题/.test(String(assistantHint || ""));
      return [
        isRetitling ? "请发送新的标题" : "请先发送标题",
        !isRetitling ? "也可以直接说“投稿到树洞”，或者发“树洞：标题”" : "",
        "不想继续就发送“取消”",
        normalizedHint || "",
      ].filter(Boolean).join("\n");
    }
    if (conversation.step === "await-forward-confirm") {
      return [
        "我收到了你回复的那条消息内容",
        "要投稿就回复“是”",
        "不想投稿就回复“否”或“取消”",
        normalizedHint || "",
      ].filter(Boolean).join("\n");
    }
    if (conversation.step === "await-ai-post-confirm") {
      return [
        "投稿确认",
        boardDisplayName ? `投稿区：${boardDisplayName}` : "",
        conversation.draftTitle ? `标题：${conversation.draftTitle}` : "",
        draftStats,
        draftPreview ? `正文预览：${draftPreview}` : "",
        normalizedHint || "",
        "确认发布请回复“确认发布”或“是”",
        "想改标题就回复“改标题”或发“/标题 新标题”",
        "想继续补正文就直接发内容或回复“补充”",
        "想换板块可发“/板块 树洞”",
        "不想发了就回复“取消”",
      ].filter(Boolean).join("\n");
    }
    if (conversation.step === "await-submit-confirm") {
      return [
        "投稿确认",
        boardDisplayName ? `投稿区：${boardDisplayName}` : "",
        conversation.draftTitle ? `标题：${conversation.draftTitle}` : "",
        draftStats,
        draftPreview ? `正文预览：${draftPreview}` : "",
        normalizedHint || "",
        "确认发布请回复“确认发布”或“是”",
        "想改标题请回复“改标题”或发“/标题 新标题”",
        "想换板块可发“/板块 树洞”",
        "想继续补正文就直接发内容",
        "不想发了就回复“取消”",
      ].filter(Boolean).join("\n");
    }
    if (conversation.step === "await-forward-title") {
      return [
        "好的，请发送这篇投稿的标题",
        "正文我会使用刚才那条消息里的内容",
        "不想继续就发送“取消”",
        normalizedHint || "",
      ].filter(Boolean).join("\n");
    }
    if (conversation.step === "collect-content") {
      return [
        `标题已记录：${conversation.draftTitle || "未命名"}`,
        boardDisplayName ? `投稿区：${boardDisplayName}` : "",
        draftStats,
        "接下来请逐条发送正文内容",
        "每发一条我会自动换行拼接",
        "全部完成后发送“结束”",
        "想改标题可回复“改标题”或发“/标题 新标题”",
        "想换板块可发“/板块 树洞”",
        "发送“/状态”可看当前进度，发送“/预览”可看草稿",
        "不想继续就发送“取消”",
        normalizedHint || "",
      ].filter(Boolean).join("\n");
    }
    return "请继续发送内容。";
  }

  async function renderConversationCommandHelp(conversation: any) {
    return [
      await renderConversationStatus(conversation),
      "",
      "现在最适合这样做",
      ...buildConversationStepHelpLines(conversation),
      "",
      "当前阶段常用命令",
      ...buildConversationStepCommandLines(conversation),
      "",
      "通用命令",
      "• /帮助：查看当前投稿流程提示",
      "• /状态 或 /进度：查看当前草稿进度",
      "• /预览 或 /草稿：查看当前草稿预览",
      "• /板块：查看可投稿板块",
      "• 取消：取消这次投稿",
    ].join("\n");
  }

  async function renderConversationStatus(conversation: any) {
    const boardDisplayName = conversation.draftBoardSlug ? await deps.resolveBoardDisplayName(conversation.draftBoardSlug) : "未指定";
    const nextStep = describeConversationStep(conversation.step);
    const draftStats = buildConversationDraftStats(conversation);
    const recentSummary = buildConversationRecentSummaryLines(conversation);
    return [
      "当前投稿进度",
      `阶段：${nextStep}`,
      `投稿区：${boardDisplayName}`,
      conversation.draftTitle ? `标题：${conversation.draftTitle}` : "标题：未填写",
      draftStats || "正文概况：还没有正文",
      ...recentSummary,
      `下一步：${describeConversationNextAction(conversation.step, conversation)}`,
      `快捷操作：${describeConversationQuickActions(conversation.step, conversation)}`,
    ].join("\n");
  }

  async function renderConversationDraftPreview(conversation: any) {
    const boardDisplayName = conversation.draftBoardSlug ? await deps.resolveBoardDisplayName(conversation.draftBoardSlug) : "未指定";
    const content = String(conversation.draftContent || "").trim();
    const recentSummary = buildConversationRecentSummaryLines(conversation);
    return [
      "当前草稿预览",
      `投稿区：${boardDisplayName}`,
      conversation.draftTitle ? `标题：${conversation.draftTitle}` : "标题：未填写",
      buildConversationDraftStats(conversation) || "正文概况：还没有正文",
      ...recentSummary,
      `可直接操作：${describeConversationQuickActions(conversation.step, conversation)}`,
      "正文：",
      content || "还没有正文",
    ].join("\n");
  }

  function renderConversationStageNudge(conversation: any, intro: string) {
    return [
      intro,
      `下一步：${describeConversationNextAction(conversation.step, conversation)}`,
      `可直接操作：${describeConversationQuickActions(conversation.step, conversation)}`,
      "如果想看更完整的当前阶段提示，可发送“/帮助”。",
    ].join("\n");
  }

  return {
    renderConversationCommandHelp,
    renderConversationDraftPreview,
    renderConversationPrompt,
    renderConversationStageNudge,
    renderConversationStatus,
  };
}

export function parseConversationMetadata(metadata?: string | null) {
  if (!metadata) return {} as Record<string, any>;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}

export function mergeConversationContent(existing: string, next: string) {
  return [existing.trim(), next.trim()].filter(Boolean).join("\n");
}

export function normalizeConversationDraftBlocks(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function getConversationDraftBlocks(conversation: any) {
  const metadata = parseConversationMetadata(conversation?.metadata);
  const blocks = normalizeConversationDraftBlocks(metadata.draftBlocks);
  if (blocks.length) return blocks;
  const normalized = String(conversation?.draftContent || "").trim();
  return normalized ? [normalized] : [];
}

function buildConversationDraftStats(conversation: any) {
  const content = String(conversation?.draftContent || "").trim();
  if (!content) return "";
  const charCount = content.length;
  const lineCount = content.split(/\r?\n/).filter((line) => line.trim()).length;
  const blockCount = getConversationDraftBlocks(conversation).length;
  return `正文概况：${lineCount} 行，${blockCount} 段，约 ${charCount} 字`;
}

function describeConversationStep(step: QqConversationStep) {
  if (step === "await-title") return "等待标题";
  if (step === "collect-content") return "填写正文";
  if (step === "await-forward-confirm") return "确认是否投稿";
  if (step === "await-forward-title") return "为转发内容填写标题";
  if (step === "await-ai-post-confirm") return "确认草稿";
  if (step === "await-submit-confirm") return "确认发布";
  return "进行中";
}

function summarizeConversationDraftBlock(content: string, limit = 32) {
  const normalized = normalizeRenderedMessage(String(content || "").replace(/\s+/g, " ").trim());
  if (!normalized) return "已删除上一段内容";
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function getConversationLastNonEmptyLine(content: string) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function buildConversationRecentSummaryLines(conversation: any) {
  const blocks = getConversationDraftBlocks(conversation);
  const content = String(conversation?.draftContent || "").trim();
  const lines: string[] = [];
  if (blocks.length) {
    lines.push(`最近一段：${summarizeConversationDraftBlock(blocks[blocks.length - 1])}`);
  }
  const lastLine = getConversationLastNonEmptyLine(content);
  if (lastLine) {
    lines.push(`最后一行：${summarizeConversationDraftBlock(lastLine)}`);
  }
  return lines;
}

function buildConversationStepHelpLines(conversation: any) {
  const step = conversation.step as QqConversationStep;
  if (step === "await-title") {
    return [
      "• 直接发送标题",
      "• 也可以发送“树洞：标题”或“投稿到树洞”",
      "• 如果暂时不想发了，直接回复“取消”",
    ];
  }
  if (step === "await-forward-title") {
    return [
      "• 给这条转发内容补一个标题",
      "• 标题发来后就可以进入发布确认",
      "• 如果不想继续，直接回复“取消”",
    ];
  }
  if (step === "await-forward-confirm") {
    return [
      "• 想投稿就回复“是”",
      "• 不想投稿就回复“否”或“取消”",
    ];
  }
  if (step === "collect-content") {
    return [
      "• 直接继续发正文内容",
      "• 写完后发送“结束”进入发布确认",
      "• 想改标题就回复“改标题”或发“/标题 新标题”",
      "• 想换板块就发“/板块 树洞”",
      "• 如果不想继续，直接回复“取消”",
    ];
  }
  if (step === "await-ai-post-confirm") {
    return [
      "• 草稿没问题就回复“确认发布”或“是”",
      "• 想改标题就回复“改标题”或发“/标题 新标题”",
      "• 想补正文就直接发内容或回复“补充”",
    ];
  }
  if (step === "await-submit-confirm") {
    return [
      "• 想发布就回复“确认发布”或“是”",
      "• 想改标题就回复“改标题”或发“/标题 新标题”",
      "• 想补正文就直接发内容或回复“补充”",
      "• 不想发了就直接回复“取消”",
    ];
  }
  return ["• 继续发送内容，或发送“/状态”查看当前进度"];
}

function describeConversationNextAction(step: QqConversationStep, conversation: any) {
  if (step === "await-title") return "发送标题";
  if (step === "await-forward-title") return "给转发内容补一个标题";
  if (step === "await-forward-confirm") return "回复“是”开始投稿，或回复“否/取消”结束";
  if (step === "collect-content") {
    return String(conversation?.draftContent || "").trim()
      ? "继续发正文，或发送“结束”进入发布确认"
      : "开始发送正文内容";
  }
  if (step === "await-ai-post-confirm") return "确认发布，或继续补正文 / 改标题";
  if (step === "await-submit-confirm") return "确认发布，或继续改标题/正文";
  return "继续发送内容";
}

function buildConversationStepCommandLines(conversation: any) {
  const step = conversation.step as QqConversationStep;
  const hasTitle = Boolean(String(conversation?.draftTitle || "").trim());
  if (step === "await-title" || step === "await-forward-title") {
    return [
      "• /板块 树洞：切换当前草稿板块",
      "• /标题 新标题：直接设置标题",
    ].filter(Boolean);
  }
  if (step === "await-forward-confirm") {
    return [
      "• 是：开始投稿",
      "• 否：放弃这条转发内容",
    ];
  }
  if (step === "collect-content") {
    return [
      "• 结束：完成正文输入并进入发布确认",
      hasTitle ? "• /标题 新标题：直接修改当前草稿标题" : "",
      "• /板块 树洞：切换当前草稿板块",
      "• /状态 或 /进度：查看当前草稿进度",
      "• /预览 或 /草稿：查看当前草稿完整预览",
    ].filter(Boolean);
  }
  if (step === "await-ai-post-confirm" || step === "await-submit-confirm") {
    return [
      "• 确认发布：确认按当前草稿继续",
      hasTitle ? "• /标题 新标题：直接修改当前草稿标题" : "",
      "• /板块 树洞：切换当前草稿板块",
      "• /预览 或 /草稿：查看当前草稿完整预览",
    ].filter(Boolean);
  }
  return ["• /状态：查看当前进度"];
}

function describeConversationQuickActions(step: QqConversationStep, conversation: any) {
  if (step === "await-title" || step === "await-forward-title") return "/板块 树洞 / 取消";
  if (step === "await-forward-confirm") return "是 / 否 / 取消";
  if (step === "collect-content") {
    return "结束 / /标题 新标题 / /预览 / 取消";
  }
  if (step === "await-ai-post-confirm" || step === "await-submit-confirm") {
    return "确认发布 / /标题 新标题 / /预览 / 取消";
  }
  return "/帮助 / 取消";
}
