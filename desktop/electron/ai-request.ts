import { limits } from "./config";

const asText = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`AI 请求的 ${field} 无效`);
  if (value.length > limits.aiTextLength) throw new Error("AI 请求内容过长");
  return value;
};

const asImageUrl = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("AI 请求的图片地址无效");
  if (/^https:\/\//.test(value)) {
    if (value.length > 8192) throw new Error("AI 请求的图片地址过长");
    return value;
  }
  if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(value)) throw new Error("AI 请求的图片地址无效");
  if (value.length > limits.aiImageDataUrlLength) throw new Error("AI 请求的原图过大");
  return value;
};

const sanitizeContentItem = (raw: unknown): Record<string, unknown> => {
  if (typeof raw === "string") return { type: "input_text", text: asText(raw, "content") };
  if (!raw || typeof raw !== "object") throw new Error("AI 请求内容无效");
  const item = raw as Record<string, unknown>;
  if (item.type === "input_text" || item.type === "output_text") return { type: item.type, text: asText(item.text, "text") };
  if (item.type === "input_image") {
    const imageUrl = asImageUrl(item.image_url);
    return { type: "input_image", image_url: imageUrl, detail: item.detail === "low" || item.detail === "high" ? item.detail : "auto" };
  }
  throw new Error("AI 请求包含不支持的内容类型");
};

// 严格白名单：只放行服务端 /api/oauth/v1/responses 接受的字段，
// 其余一律丢弃，避免脚本借这条通道把任意参数透传给上游。
export const sanitizeAiBody = (raw: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI 请求格式无效");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("AI 请求内容无效");
  const body = parsed as Record<string, unknown>;
  if (!Array.isArray(body.input) || body.input.length === 0) throw new Error("AI 请求内容无效");
  if (body.input.length > limits.aiInputItems) throw new Error("AI 请求条目过多");
  const input = body.input.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("AI 请求内容无效");
    const message = entry as Record<string, unknown>;
    if (message.role !== "user" && message.role !== "assistant") throw new Error("AI 请求只接受 user 与 assistant 角色");
    const content = Array.isArray(message.content)
      ? message.content.map(sanitizeContentItem)
      : [sanitizeContentItem(message.content)];
    return { role: message.role, content };
  });
  const sanitized: Record<string, unknown> = { input, stream: false };
  if (typeof body.model === "string" && body.model.length <= 128) sanitized.model = body.model;
  if (typeof body.temperature === "number" && Number.isFinite(body.temperature) && body.temperature >= 0 && body.temperature <= 2) {
    sanitized.temperature = body.temperature;
  }
  if (body.reasoningEffort === "low" || body.reasoningEffort === "high" || body.reasoningEffort === "max") {
    sanitized.reasoningEffort = body.reasoningEffort;
  }
  return sanitized;
};
