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

export function normalizeCampusAssistantImageChatEndpoint(apiUrl: string) {
  const endpoint = normalizeAiJsonApiUrl(apiUrl, DEFAULT_AI_CHAT_ENDPOINT);
  const url = new URL(endpoint);
  url.pathname = url.pathname
    .replace(/\/(?:responses|images\/generations)\/?$/iu, "/chat/completions")
    .replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function normalizeCampusAssistantImageResponsesEndpoint(apiUrl: string) {
  const endpoint = normalizeAiJsonApiUrl(apiUrl, DEFAULT_AI_CHAT_ENDPOINT);
  const url = new URL(endpoint);
  url.pathname = url.pathname
    .replace(/\/(?:chat\/completions|images\/generations)\/?$/iu, "/responses")
    .replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildCampusAssistantImageRequestAttempts(apiUrl: string, prompt: string) {
  return [
    {
      protocol: "images" as const,
      endpoint: normalizeCampusAssistantImageEndpoint(apiUrl),
      body: {
        model: CAMPUS_ASSISTANT_IMAGE_MODEL,
        prompt,
        n: 1,
      },
    },
    {
      protocol: "chat_completions" as const,
      endpoint: normalizeCampusAssistantImageChatEndpoint(apiUrl),
      body: {
        model: CAMPUS_ASSISTANT_IMAGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      },
    },
    {
      protocol: "responses" as const,
      endpoint: normalizeCampusAssistantImageResponsesEndpoint(apiUrl),
      body: {
        model: CAMPUS_ASSISTANT_IMAGE_MODEL,
        input: [{
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        }],
        stream: false,
      },
    },
  ];
}

export function shouldStopCampusAssistantImageRequestAttempts(status: number) {
  return [401, 403, 429].includes(status);
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
  if (typeof root.output_text === "string") return extractImageSourceFromText(root.output_text);
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
  const providers = input.providers.filter((provider) => (
    String(provider.apiUrl || "").trim()
    && String(provider.provider || "").trim().toLowerCase() !== "ollama"
  ));
  if (!providers.length) throw new Error("没有可用的生图上游");

  const providerErrors: string[] = [];
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
      const detail = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${String(provider.name || provider.provider || "上游").trim() || "上游"}: ${detail}`);
      await finishAiReviewLogError(logId, detail);
      if (input.signal?.aborted) throw error;
    }
  }
  throw new Error(providerErrors.join("；") || "生图上游暂时不可用");
}

async function requestGeneratedImage(
  provider: AiProviderCandidate,
  prompt: string,
  signal?: AbortSignal,
) {
  const attempts = buildCampusAssistantImageRequestAttempts(provider.apiUrl, prompt);
  const errors: string[] = [];
  for (const attempt of attempts) {
    const response = await fetchWithTimeout(attempt.endpoint, {
      method: "POST",
      headers: buildProviderHeaders(provider.apiKey),
      body: JSON.stringify(attempt.body),
    }, signal);
    const text = await response.text();
    if (response.ok) {
      const source = extractCampusAssistantGeneratedImageSource(parseJson(text));
      if (source) return source;
      errors.push(`${attempt.protocol} 未返回可识别的图片`);
      continue;
    }
    errors.push(`${attempt.protocol} ${response.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
    // A relay may expose image2 through only one compatible protocol. A 5xx
    // from Chat Completions must not prevent trying the same upstream's
    // Responses endpoint; stop only when credentials or rate limits make all
    // protocol variants inapplicable.
    if (shouldStopCampusAssistantImageRequestAttempts(response.status)) break;
  }
  throw new Error(`image2 生图请求失败：${errors.join("；")}`);
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
  if (typeof record.text === "string") return extractImageSourceFromText(record.text);
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
