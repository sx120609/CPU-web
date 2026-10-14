const ANTHROPIC_API_VERSION = "2023-06-01";

/** 地址以 /messages 结尾的服务按 Claude（Anthropic Messages）协议对待，模型目录也跟着换请求头。 */
export function isAnthropicMessagesUrl(url: string) {
  const normalized = String(url || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  return /\/messages$/i.test(normalized);
}

export function isOfficialAnthropicUrl(url: string) {
  try {
    return /(?:^|\.)anthropic\.com$/i.test(new URL(String(url || "").trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * Claude 官方接口用 x-api-key 认证，Bearer 会被当成 OAuth 令牌拒掉；
 * 中转站大多两种都收，所以官方地址以外两种一起带。
 */
export function buildAiUpstreamAuthHeaders(url: string, apiKey: string, anthropic: boolean): Record<string, string> {
  const key = String(apiKey || "").trim();
  if (!anthropic) return key ? { Authorization: `Bearer ${key}` } : {};
  return {
    "anthropic-version": ANTHROPIC_API_VERSION,
    ...(key ? { "x-api-key": key } : {}),
    ...(key && !isOfficialAnthropicUrl(url) ? { Authorization: `Bearer ${key}` } : {}),
  };
}
