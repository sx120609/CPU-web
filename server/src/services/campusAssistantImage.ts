import { randomUUID } from "node:crypto";
import { normalizeAiJsonApiUrl, type AiProviderCandidate } from "./aiJsonApi";
import { normalizeAiImageDataUrl, AI_IMAGE_MAX_SOURCE_BYTES } from "./aiImageValidation";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { saveMediaAsset } from "./mediaStorage";
import { isLocalOrPrivateHost } from "../utils/officePreview";

export const CAMPUS_ASSISTANT_IMAGE_MODEL = "image2";
const DEFAULT_AI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const CAMPUS_ASSISTANT_IMAGE_TIMEOUT_MS = 180_000;

export type CampusAssistantGeneratedImage = {
  url: string;
  alt: string;
};

type GeneratedImageSource = {
  dataUrl?: string;
  url?: string;
  revisedPrompt?: string;
};

export function isCampusAssistantImageGenerationRequest(value: string) {
  const text = String(value || "").trim();
  if (!text || text.length > 2_000) return false;
  if (
    /(?:你|拾间ai).{0,8}(?:能不能|可不可以|会|能|支持|可以).{0,6}(?:生图|生成图片|画图)[吗么不]?[？?]?$/iu.test(text)
    || /(?:是否|能否).{0,4}(?:生图|生成图片)(?:功能|能力)?[吗么]?[？?]?$/u.test(text)
  ) {
    return false;
  }
  if (/(?:图片|图像|生图).{0,10}(?:功能|接口|代码|程序|算法|逻辑|流程|组件|页面|系统|上传|识别|分析|处理)/iu.test(text)) {
    return false;
  }
  const chineseVisual = /(?:图|图片|插画|海报|头像|画像|肖像|人物像|自画像|壁纸|封面|图标|logo|标志|表情包|漫画|照片|画面)/iu.test(text);
  const chineseCreate = /(?:生成|生一张|画(?:一|个|张|幅|出|一下|一幅)?|绘制|制作|设计|创作|做一张|出一张)/u.test(text);
  if (chineseCreate && (chineseVisual || /(?:画|绘制)(?:出来|一下|一幅|一张|一个)/u.test(text))) return true;
  if (/(?:来|给我|帮我|为我)(?:做|整|出)?(?:一张|一幅|几张).{0,80}(?:图|图片|插画|海报|头像|画像|肖像|人物像|自画像|壁纸|封面|漫画|照片)/u.test(text)) return true;
  return /\b(?:generate|draw|create|make|design)\b[\s\S]{0,80}\b(?:image|picture|illustration|poster|avatar|wallpaper|logo|icon|cover|meme|comic|photo)\b/iu.test(text);
}

export function normalizeCampusAssistantImageEndpoint(apiUrl: string) {
  const chatEndpoint = normalizeAiJsonApiUrl(apiUrl, DEFAULT_AI_CHAT_ENDPOINT);
  const url = new URL(chatEndpoint);
  url.pathname = url.pathname
    .replace(/\/(?:chat\/completions|responses)\/?$/iu, "/images/generations")
    .replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function extractCampusAssistantGeneratedImageSource(payload: unknown): GeneratedImageSource | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, any>;
  const candidates = [
    ...(Array.isArray(root.data) ? root.data : []),
    ...(Array.isArray(root.images) ? root.images : []),
  ];
  for (const candidate of candidates) {
    const extracted = extractImageSourceRecord(candidate);
    if (extracted) return extracted;
  }

  const responseOutput = Array.isArray(root.output) ? root.output : [];
  for (const output of responseOutput) {
    const content = Array.isArray(output?.content) ? output.content : [output];
    for (const item of content) {
      const extracted = extractImageSourceRecord(item);
      if (extracted) return extracted;
    }
  }

  const messageContent = root.choices?.[0]?.message?.content;
  if (Array.isArray(messageContent)) {
    for (const item of messageContent) {
      const extracted = extractImageSourceRecord(item);
      if (extracted) return extracted;
    }
  }
  if (typeof messageContent === "string") return extractImageSourceFromText(messageContent);
  return null;
}

export async function generateCampusAssistantImage(input: {
  prompt: string;
  providers: AiProviderCandidate[];
  signal?: AbortSignal;
  createdById?: number | null;
}): Promise<CampusAssistantGeneratedImage> {
  const prompt = String(input.prompt || "").trim().slice(0, 2_000);
  if (!prompt) throw new Error("生图描述为空");
  const providers = input.providers.filter((provider) => String(provider.apiUrl || "").trim());
  if (!providers.length) throw new Error("没有可用的生图上游");

  let lastError: unknown = null;
  for (const provider of providers) {
    const endpoint = normalizeCampusAssistantImageEndpoint(provider.apiUrl);
    const started = await startAiReviewLog({
      kind: "campus-assistant",
      targetLabel: "拾间AI 生图",
      provider: provider.provider || "ai-json-api",
      model: CAMPUS_ASSISTANT_IMAGE_MODEL,
      endpoint,
      requestSummary: prompt,
      createdById: input.createdById ?? null,
      pointCost: 0,
    });
    const logId = started?.id ?? null;
    try {
      const source = await requestGeneratedImage(provider, prompt, input.signal);
      const image = await persistGeneratedImage(source, provider, input.signal);
      await finishAiReviewLogSuccess(logId, image.url);
      return image;
    } catch (error) {
      lastError = error;
      await finishAiReviewLogError(logId, error instanceof Error ? error.message : String(error));
      if (input.signal?.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("生图上游暂时不可用");
}

async function requestGeneratedImage(
  provider: AiProviderCandidate,
  prompt: string,
  signal?: AbortSignal,
) {
  const imageEndpoint = normalizeCampusAssistantImageEndpoint(provider.apiUrl);
  const imageResponse = await fetchWithTimeout(imageEndpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider.apiKey),
    body: JSON.stringify({
      model: CAMPUS_ASSISTANT_IMAGE_MODEL,
      prompt,
      n: 1,
    }),
  }, signal);
  const imageText = await imageResponse.text();
  if (imageResponse.ok) {
    const source = extractCampusAssistantGeneratedImageSource(parseJson(imageText));
    if (source) return source;
    throw new Error("生图上游没有返回图片");
  }

  if (![404, 405].includes(imageResponse.status)) {
    throw new Error(`生图请求失败：${imageResponse.status}${imageText ? ` ${imageText.slice(0, 160)}` : ""}`);
  }

  // Some OpenAI-compatible relays expose image-capable models only through
  // chat completions. Keep this compatibility fallback scoped to image2.
  const chatEndpoint = normalizeAiJsonApiUrl(provider.apiUrl, DEFAULT_AI_CHAT_ENDPOINT);
  const chatResponse = await fetchWithTimeout(chatEndpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider.apiKey),
    body: JSON.stringify({
      model: CAMPUS_ASSISTANT_IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  }, signal);
  const chatText = await chatResponse.text();
  if (!chatResponse.ok) {
    throw new Error(`生图请求失败：${chatResponse.status}${chatText ? ` ${chatText.slice(0, 160)}` : ""}`);
  }
  const source = extractCampusAssistantGeneratedImageSource(parseJson(chatText));
  if (!source) throw new Error("image2 没有返回可识别的图片");
  return source;
}

async function persistGeneratedImage(
  source: GeneratedImageSource,
  provider: AiProviderCandidate,
  signal?: AbortSignal,
) {
  const dataUrl = source.dataUrl || await downloadGeneratedImageAsDataUrl(source.url || "", provider.apiUrl, signal);
  const normalized = await normalizeAiImageDataUrl(dataUrl);
  const base64 = normalized.dataUrl.slice(normalized.dataUrl.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  const extension = normalized.mimeType === "image/jpeg" ? "jpg" : "png";
  const now = new Date();
  const relativePath = [
    "assistant-generated",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}.${extension}`,
  ].join("/");
  const saved = await saveMediaAsset({
    relativePath,
    buffer,
    contentType: normalized.mimeType,
    mediaKind: "image",
  });
  return {
    url: saved.url,
    alt: "拾间AI生成的图片",
  } satisfies CampusAssistantGeneratedImage;
}

async function downloadGeneratedImageAsDataUrl(value: string, providerApiUrl: string, signal?: AbortSignal) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("生图上游返回了无效图片地址");
  const providerHost = new URL(normalizeAiJsonApiUrl(providerApiUrl, DEFAULT_AI_CHAT_ENDPOINT)).hostname;
  if (isLocalOrPrivateHost(url.hostname) && url.hostname !== providerHost) {
    throw new Error("生图上游返回了不安全的内部图片地址");
  }
  const response = await fetchWithTimeout(url.toString(), { method: "GET" }, signal);
  if (!response.ok) throw new Error(`下载生成图片失败：${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > AI_IMAGE_MAX_SOURCE_BYTES) throw new Error("生成图片超过 8MB 限制");
  const contentType = String(response.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase();
  if (!/^image\/(?:jpeg|jpg|png|webp|gif)$/u.test(contentType)) throw new Error("生图上游返回的内容不是图片");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > AI_IMAGE_MAX_SOURCE_BYTES) throw new Error("生成图片为空或超过 8MB 限制");
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function extractImageSourceRecord(value: unknown): GeneratedImageSource | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const revisedPrompt = String(record.revised_prompt || record.revisedPrompt || "").trim().slice(0, 2_000) || undefined;
  const base64 = String(record.b64_json || record.base64 || record.image_base64 || "").trim();
  if (base64) return { dataUrl: `data:image/png;base64,${base64}`, revisedPrompt };
  const direct = String(record.url || record.image_url || record.imageUrl || "").trim();
  if (direct.startsWith("data:image/")) return { dataUrl: direct, revisedPrompt };
  if (/^https?:\/\//iu.test(direct)) return { url: direct, revisedPrompt };
  if (record.image_url && typeof record.image_url === "object") {
    const nested = String(record.image_url.url || "").trim();
    if (nested.startsWith("data:image/")) return { dataUrl: nested, revisedPrompt };
    if (/^https?:\/\//iu.test(nested)) return { url: nested, revisedPrompt };
  }
  if (typeof record.content === "string") return extractImageSourceFromText(record.content);
  return null;
}

function extractImageSourceFromText(value: string): GeneratedImageSource | null {
  const text = String(value || "");
  const dataUrl = text.match(/data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}/iu)?.[0];
  if (dataUrl) return { dataUrl };
  const markdownUrl = text.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/iu)?.[1];
  if (markdownUrl) return { url: markdownUrl };
  const plainUrl = text.match(/https?:\/\/[^\s<>"']+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>"']*)?/iu)?.[0];
  return plainUrl ? { url: plainUrl } : null;
}

function buildProviderHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    ...(String(apiKey || "").trim() ? { Authorization: `Bearer ${String(apiKey).trim()}` } : {}),
  };
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  upstreamSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("生图上游响应超时")), CAMPUS_ASSISTANT_IMAGE_TIMEOUT_MS);
  timeout.unref?.();
  const abort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abort();
  else upstreamSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abort);
  }
}
