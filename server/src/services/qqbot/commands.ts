export function isHelpCommand(text: string) {
  return /^(?:[/／])?(帮助|help|菜单|命令|功能)$/i.test(normalizeCommandKeywordText(text));
}

export function isBoardListCommand(text: string) {
  return /^(?:[/／])?(板块|板块列表|boards?|版块|分区)$/i.test(normalizeCommandKeywordText(text));
}

export function isMyPostsCommand(text: string) {
  return /^(?:[/／])?(我的投稿|我的帖子|最近投稿|最近帖子|recent|mine)$/i.test(normalizeCommandKeywordText(text));
}

export function isStatusCommand(text: string) {
  return /^(?:[/／])?状态$/i.test(normalizeCommandKeywordText(text));
}

export function isConversationStatusCommand(text: string) {
  return /^(?:[/／])?(状态|进度)$/i.test(normalizeCommandKeywordText(text));
}

export function isConversationPreviewCommand(text: string) {
  return /^(?:[/／])?(预览|草稿)$/i.test(normalizeCommandKeywordText(text));
}

export function extractConversationBoardSwitchTarget(text: string) {
  const match = String(text || "").trim().match(/^(?:[/／])?(?:板块|版块|分区|投稿区|改板块|换板块|切换板块)\s+(.+)$/i);
  if (!match) return "";
  return normalizeCommandKeywordText(match[1]);
}

export function extractConversationTitleCommandValue(text: string) {
  const match = String(text || "").trim().match(/^(?:[/／])?(?:标题|改标题|重新标题|换标题|title)\s+([\s\S]+)$/i);
  if (!match) return "";
  return match[1].trim();
}

export function isConversationRetitleCommand(text: string) {
  return /^(?:[/／])?(标题|改标题|重新标题|换标题|title)$/i.test(normalizeCommandKeywordText(text));
}

export function isLikelyConversationCommandMessage(text: string) {
  const normalized = String(text || "").trim();
  if (!normalized.startsWith("/") && !normalized.startsWith("／")) return false;
  if (/[\r\n]/.test(normalized)) return false;
  return normalized.length <= 24;
}

export function isUnbindCommand(text: string) {
  return /^(?:[/／])?(解绑|解除绑定|unbind)$/i.test(normalizeCommandKeywordText(text));
}

export function isCommandMessage(text: string) {
  const normalized = text.trim();
  return normalized.startsWith("/") || normalized.startsWith("／");
}

export function normalizeInboundCommandText(text: string) {
  let normalized = String(text || "").trim();
  if (!normalized) return "";
  for (let index = 0; index < 2; index += 1) {
    const next = normalized.replace(/^(?:@?\s*)?(?:qqbot|药大拾间bot|助手|bot)\s*[，,:：-]?\s*/i, "").trim();
    if (!next || next === normalized) break;
    normalized = next;
  }
  return normalized;
}

export function normalizeCommandKeywordText(text: string) {
  let normalized = String(text || "").trim();
  if (!normalized) return "";
  for (let index = 0; index < 3; index += 1) {
    const next = normalized
      .replace(/[?？!！~～。．,，、…]+$/g, "")
      .replace(/(?:啊|呀|呢|嘛|吧|哈|呗|哦|噢|啦|喔|哇)+$/g, "")
      .trim();
    if (!next || next === normalized) break;
    normalized = next;
  }
  return normalized;
}

export function isPrivatePlainCommand(text: string, keyword: string) {
  const normalized = text.trim();
  return !isCommandMessage(normalized) && normalized === keyword;
}

export function extractFinishCommandPayload(text: string) {
  const finishRegex = /(^|\n)\s*(?:[/／])?(结束|完成|提交)(?:\s|$)/m;
  const normalized = String(text || "").trim();
  if (!finishRegex.test(normalized)) return null;
  return String(text || "").replace(finishRegex, "$1").trim();
}

export function isConfirmPublishMessage(text: string) {
  const normalized = normalizeShortReplyText(text);
  return /^(是|是的|确认|确认发布|发布|发吧|就这样|没问题)$/.test(normalized) || /^[/／](发布|确认发布)(?:\s|$)/i.test(String(text || "").trim());
}

export function isCancelMessage(text: string) {
  const raw = String(text || "").trim();
  const normalized = normalizeShortReplyText(raw);
  return /^[/／]取消(?:\s|$)/.test(raw)
    || /^(取消|算了|不发了|我不发了|先不发了|不要发了|不投了|我不投了|先不投了|不了|不用了)$/.test(normalized);
}

export function normalizeShortReplyText(text: string) {
  return normalizeCommandKeywordText(String(text || "").trim()).replace(/\s+/g, "");
}

export function isGreetingMessage(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /^(你好|您好|哈喽|hello|hi|嗨|在吗|有人吗|bot|qqbot)[!！。?？ ]*$/.test(normalized);
}
