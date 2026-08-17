import { createHash } from "node:crypto";
import { checkAiModelAvailability } from "./aiModelCatalog";
import { shouldFallbackToNextProvider } from "./modelFallback";

export type AiJsonApiMode = "chat_completions" | "responses";

export type AiJsonImageDetail = "low" | "high" | "auto" | "original";

export type AiJsonMessagePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: AiJsonImageDetail;
      };
    };

export type AiJsonMessage = {
  role: "system" | "user" | "assistant" | "developer";
  content: string | AiJsonMessagePart[];
};

export type SendAiJsonRequestResult = {
  response: Response;
  mode: AiJsonApiMode;
  errorText: string;
  promptCacheKeyApplied: boolean;
  promptCacheRetentionApplied: boolean;
  /** Number of transient upstream retries made before returning the final response. */
  retryCount: number;
};

export type AiProviderCandidate = {
  serviceId?: string;
  name?: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  /** Optional model override for this provider fallback route. */
  model?: string;
};

/** Keep the primary candidate untouched, but require every fallback to expose the model it will receive. */
export async function filterAiProviderCandidatesByModel(
  providers: AiProviderCandidate[],
  defaultModel: string,
) {
  const normalizedProviders = providers.filter((provider) => String(provider.apiUrl || "").trim());
  if (normalizedProviders.length <= 1) return normalizedProviders;
  const eligible = [normalizedProviders[0]];
  for (const provider of normalizedProviders.slice(1)) {
    const model = String(provider.model || defaultModel || "").trim();
    const availability = await checkAiModelAvailability({
      provider: provider.provider,
      apiUrl: provider.apiUrl,
      apiKey: provider.apiKey,
      model,
    });
    if (availability.status === "available") eligible.push(provider);
  }
  return eligible;
}

const promptCacheKeySupport = new Map<string, boolean>();
const promptCacheRetentionSupport = new Map<string, boolean>();

export function buildAiPromptCacheKey(scope: string, parts: Array<string | number | boolean | null | undefined> = []) {
  const normalizedScope = String(scope || "generic")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "generic";
  const digest = createHash("sha256")
    .update(parts.map((item) => String(item ?? "")).join("\n"))
    .digest("hex")
    .slice(0, 24);
  return `cpu:${normalizedScope}:${digest}`;
}

export function detectAiJsonApiMode(endpoint: string): AiJsonApiMode {
  const normalized = String(endpoint || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  return /\/responses$/i.test(normalized) ? "responses" : "chat_completions";
}

export function normalizeAiJsonApiUrl(input: string, fallbackEndpoint: string) {
  const fallback = String(fallbackEndpoint || "").trim() || "https://api.openai.com/v1/chat/completions";
  const normalizedFallback = normalizeNonEmptyAiJsonApiUrl(fallback, detectAiJsonApiMode(fallback));
  const raw = String(input || "").trim();
  if (!raw) return normalizedFallback;
  return normalizeNonEmptyAiJsonApiUrl(raw, detectAiJsonApiMode(normalizedFallback));
}

export async function sendAiJsonRequest(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature?: number;
  messages: AiJsonMessage[];
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  maxTransientRetries?: number;
  stream?: boolean;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  const mode = detectAiJsonApiMode(input.endpoint);
  const body = buildAiJsonRequestBody({
    mode,
    model: input.model,
    temperature: input.temperature,
    messages: input.messages,
    stream: input.stream,
  });
  return sendAiUpstreamRequest({
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    body,
    promptCacheKey: input.promptCacheKey,
    enablePromptCacheRetention: input.enablePromptCacheRetention,
    maxTransientRetries: input.maxTransientRetries,
    signal: input.signal,
  });
}

export type SendAiJsonRequestWithFallbackResult = SendAiJsonRequestResult & {
  provider: AiProviderCandidate;
  endpoint: string;
};

/** Try the configured providers in order while preserving the final response shape. */
export async function sendAiJsonRequestWithProviderFallback(input: {
  providers: AiProviderCandidate[];
  fallbackEndpoint: string;
  model: string;
  temperature?: number;
  messages: AiJsonMessage[];
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  maxTransientRetries?: number;
  stream?: boolean;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestWithFallbackResult> {
  let lastError: unknown = null;
  let lastResponseResult: SendAiJsonRequestWithFallbackResult | null = null;
  const providers = input.providers.filter((provider) => String(provider.apiUrl || "").trim());
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const model = String(provider.model || input.model || "").trim();
    if (index > 0) {
      const eligible = await filterAiProviderCandidatesByModel([providers[0], provider], input.model);
      if (eligible.length < 2) {
        lastError = new Error(`跳过回退服务 ${provider.name || provider.provider}：未确认支持模型 ${model}`);
        continue;
      }
    }
    const endpoint = normalizeAiJsonApiUrl(provider.apiUrl, input.fallbackEndpoint);
    try {
      const result = await sendAiJsonRequest({
        endpoint,
        apiKey: provider.apiKey,
        model,
        temperature: input.temperature,
        messages: input.messages,
        promptCacheKey: input.promptCacheKey,
        enablePromptCacheRetention: input.enablePromptCacheRetention,
        maxTransientRetries: input.maxTransientRetries,
        stream: input.stream,
        signal: input.signal,
      });
      if (result.response.ok || index >= providers.length - 1) {
        return { ...result, provider, endpoint };
      }
      const text = result.errorText || await result.response.clone().text().catch(() => "");
      if (!shouldFallbackToNextProvider(result.response.status, text)) {
        return { ...result, provider, endpoint };
      }
      lastResponseResult = { ...result, provider, endpoint };
      if (result.response.body) {
        await result.response.body.cancel().catch(() => undefined);
      }
      lastError = new Error(`AI 服务 ${provider.name || provider.provider} 返回 HTTP ${result.response.status}`);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (!isTransientAiUpstreamError(error, input.signal)) throw error;
      lastError = error;
      if (index >= providers.length - 1) throw error;
    }
  }
  if (lastResponseResult) return lastResponseResult;
  throw lastError instanceof Error ? lastError : new Error("没有可用的 AI 服务");
}

export async function sendAiUpstreamRequest(input: {
  endpoint: string;
  apiKey: string;
  body: Record<string, unknown>;
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  /** Retries for transient provider failures. A value of 3 means at most four total attempts. */
  maxTransientRetries?: number;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  const mode = detectAiJsonApiMode(input.endpoint);
  validateAiRequestBody(input.body, mode);
  const supportKey = `${mode}:${input.endpoint}`;
  const promptCacheKey = String(input.promptCacheKey || "").trim();
  let promptCacheKeyApplied = Boolean(promptCacheKey) && (promptCacheKeySupport.get(supportKey) ?? true);
  let promptCacheRetentionApplied = promptCacheKeyApplied
    && input.enablePromptCacheRetention !== false
    && (promptCacheRetentionSupport.get(supportKey) ?? true);
  const configuredRetries = Number(input.maxTransientRetries);
  const maxTransientRetries = Number.isFinite(configuredRetries)
    ? Math.max(0, Math.min(3, Math.floor(configuredRetries)))
    : 3;

  const execute = () => fetch(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(String(input.apiKey || "").trim()
        ? { Authorization: `Bearer ${String(input.apiKey).trim()}` }
        : {}),
    },
    signal: input.signal,
    body: JSON.stringify(withPromptCacheOptions(
      input.body,
      promptCacheKeyApplied ? promptCacheKey : "",
      promptCacheRetentionApplied,
    )),
  });

  const executeWithPromptCacheFallback = async () => {
    let response = await execute();
    let errorText = response.ok ? "" : await response.clone().text().catch(() => "");

    if (!response.ok && promptCacheRetentionApplied && shouldDisablePromptCacheRetention(response.status, errorText)) {
      promptCacheRetentionSupport.set(supportKey, false);
      promptCacheRetentionApplied = false;
      response = await execute();
      errorText = response.ok ? "" : await response.clone().text().catch(() => "");
    }

    if (!response.ok && promptCacheKeyApplied && shouldDisablePromptCacheKey(response.status, errorText)) {
      promptCacheKeySupport.set(supportKey, false);
      promptCacheRetentionSupport.set(supportKey, false);
      promptCacheKeyApplied = false;
      promptCacheRetentionApplied = false;
      response = await execute();
      errorText = response.ok ? "" : await response.clone().text().catch(() => "");
    }

    return { response, errorText };
  };

  let retryCount = 0;
  let finalResult: { response: Response; errorText: string } | null = null;
  while (!finalResult) {
    try {
      const attempt = await executeWithPromptCacheFallback();
      if (
        attempt.response.ok
        || retryCount >= maxTransientRetries
        || !shouldRetryTransientUpstreamStatus(attempt.response.status)
      ) {
        finalResult = attempt;
        break;
      }
      retryCount += 1;
      if (attempt.response.body) {
        await attempt.response.body.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (
        retryCount >= maxTransientRetries
        || !shouldRetryTransientUpstreamError(error, input.signal)
      ) {
        throw error;
      }
      retryCount += 1;
    }

    await waitForTransientRetry(retryCount, input.signal);
  }

  return {
    response: finalResult.response,
    mode,
    errorText: finalResult.errorText,
    promptCacheKeyApplied,
    promptCacheRetentionApplied,
    retryCount,
  };
}

export function extractAiJsonTextResponse(json: any, mode: AiJsonApiMode) {
  if (mode === "chat_completions") {
    return extractChatCompletionsText(json);
  }
  return extractResponsesText(json);
}

function normalizeNonEmptyAiJsonApiUrl(raw: string, defaultMode: AiJsonApiMode) {
  const normalized = String(raw || "").trim().replace(/\/+$/, "");
  if (/\/responses$/i.test(normalized) || /\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}${defaultMode === "responses" ? "/responses" : "/chat/completions"}`;
  }
  if (/^https?:\/\/[^/]+$/i.test(normalized)) {
    return `${normalized}/v1${defaultMode === "responses" ? "/responses" : "/chat/completions"}`;
  }
  return normalized;
}

function buildAiJsonRequestBody(input: {
  mode: AiJsonApiMode;
  model: string;
  temperature?: number;
  messages: AiJsonMessage[];
  stream?: boolean;
}) {
  const body: Record<string, unknown> = {
    model: input.model,
  };
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.stream) body.stream = true;
  if (input.mode === "responses") {
    body.input = input.messages.map(toResponsesInputMessage);
    body.text = { format: { type: "json_object" } };
  } else {
    body.messages = input.messages.map(toChatCompletionsMessage);
    body.response_format = { type: "json_object" };
  }
  return body;
}

function withPromptCacheOptions(
  input: Record<string, unknown>,
  promptCacheKey: string,
  promptCacheRetentionApplied: boolean,
) {
  const body = { ...input };
  delete body.prompt_cache_key;
  delete body.prompt_cache_retention;
  if (promptCacheKey) {
    body.prompt_cache_key = promptCacheKey;
    if (promptCacheRetentionApplied) body.prompt_cache_retention = "24h";
  }
  return body;
}

export async function readAiJsonTextStream(
  response: Response,
  mode: AiJsonApiMode,
  onDelta: (delta: string) => void | Promise<void>,
) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.body || contentType.includes("application/json")) {
    const json = await response.json();
    const content = extractAiJsonTextResponse(json, mode);
    if (content) await onDelta(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  const consumeEvent = async (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const delta = extractAiJsonStreamDelta(payload, mode);
    if (!delta) return;
    content += delta;
    await onDelta(delta);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) await consumeEvent(block);
    if (done) {
      buffer += decoder.decode();
      break;
    }
  }
  if (buffer.trim()) await consumeEvent(buffer);
  return content;
}

function extractAiJsonStreamDelta(payload: any, mode: AiJsonApiMode) {
  if (mode === "responses") {
    if (
      (payload?.type === "response.output_text.delta" || payload?.type === "response.refusal.delta")
      && typeof payload?.delta === "string"
    ) {
      return payload.delta;
    }
    if (typeof payload?.delta?.text === "string") return payload.delta.text;
    return "";
  }

  const choice = payload?.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item: any) => typeof item?.text === "string" ? item.text : "")
    .join("");
}

function toResponsesInputMessage(message: AiJsonMessage) {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content,
    };
  }
  return {
    role: message.role,
    content: message.content.map((part) => {
      if (part.type === "text") {
        return {
          type: "input_text",
          text: part.text,
        };
      }
      return {
        type: "input_image",
        image_url: part.image_url.url,
        detail: part.image_url.detail || "auto",
      };
    }),
  };
}

function toChatCompletionsMessage(message: AiJsonMessage) {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content,
    };
  }
  return {
    role: message.role,
    content: message.content.map((part) => {
      if (part.type === "text") {
        return {
          type: "text",
          text: part.text,
        };
      }
      return {
        type: "image_url",
        image_url: {
          url: part.image_url.url,
          ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
        },
      };
    }),
  };
}

function validateAiRequestBody(body: Record<string, unknown>, mode: AiJsonApiMode) {
  const model = String(body.model || "").trim();
  if (!model) throw new Error("AI 请求体无效：model 不能为空");
  if (mode === "chat_completions") {
    validateChatMessages(body.messages);
    return;
  }
  validateResponsesInput(body.input);
}

function validateChatMessages(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("AI 请求体无效：messages 不能为空");
  }
  value.forEach((message, index) => {
    if (!message || typeof message !== "object") {
      throw new Error(`AI 请求体无效：messages[${index}] 不是对象`);
    }
    const item = message as Record<string, unknown>;
    if (!String(item.role || "").trim()) {
      throw new Error(`AI 请求体无效：messages[${index}].role 不能为空`);
    }
    validateMessageContent(item.content, `messages[${index}].content`);
  });
}

function validateResponsesInput(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("AI 请求体无效：input 不能为空");
  }
  value.forEach((message, index) => {
    if (!message || typeof message !== "object") {
      throw new Error(`AI 请求体无效：input[${index}] 不是对象`);
    }
    const item = message as Record<string, unknown>;
    if (!String(item.role || "").trim()) {
      throw new Error(`AI 请求体无效：input[${index}].role 不能为空`);
    }
    validateMessageContent(item.content, `input[${index}].content`, true);
  });
}

function validateMessageContent(value: unknown, path: string, responses = false) {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`AI 请求体无效：${path} 不能为空`);
    return;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`AI 请求体无效：${path} 不能为空`);
  }
  value.forEach((part, index) => {
    if (!part || typeof part !== "object") {
      throw new Error(`AI 请求体无效：${path}[${index}] 不是对象`);
    }
    const item = part as Record<string, unknown>;
    const type = String(item.type || "").trim();
    if (responses) {
      if (type === "input_text") {
        if (!String(item.text || "").trim()) throw new Error(`AI 请求体无效：${path}[${index}].text 不能为空`);
        return;
      }
      if (type === "input_image") {
        validateAiImageUrl(item.image_url, `${path}[${index}].image_url`);
        return;
      }
    } else {
      if (type === "text") {
        if (!String(item.text || "").trim()) throw new Error(`AI 请求体无效：${path}[${index}].text 不能为空`);
        return;
      }
      if (type === "image_url") {
        const image = item.image_url;
        if (!image || typeof image !== "object") throw new Error(`AI 请求体无效：${path}[${index}].image_url 不能为空`);
        validateAiImageUrl((image as Record<string, unknown>).url, `${path}[${index}].image_url.url`);
        return;
      }
    }
    throw new Error(`AI 请求体无效：${path}[${index}].type 不受支持`);
  });
}

function validateAiImageUrl(value: unknown, path: string) {
  const url = String(value || "").trim();
  if (/^https?:\/\//i.test(url)) return;
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(url)) return;
  throw new Error(`AI 请求体无效：${path} 不是有效的图片 Data URL 或 http(s) URL`);
}

function shouldRetryTransientUpstreamStatus(status: number) {
  return status === 408
    || status === 409
    || status === 425
    || status === 429
    || status === 529
    || status >= 500;
}

export function isTransientAiUpstreamError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return false;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "");
  return /fetch failed|network|socket|econn|etimedout|eai_again|enotfound|temporarily unavailable/i.test(message);
}

function shouldRetryTransientUpstreamError(error: unknown, signal?: AbortSignal) {
  return isTransientAiUpstreamError(error, signal);
}

async function waitForTransientRetry(retryCount: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("AI 请求已取消");
    error.name = "AbortError";
    throw error;
  }
  const delayMs = Math.min(1_200, 180 * (2 ** Math.max(0, retryCount - 1)));
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const error = new Error("AI 请求已取消");
      error.name = "AbortError";
      reject(error);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function shouldDisablePromptCacheKey(status: number, responseText: string) {
  if (status !== 400 && status !== 422) return false;
  const text = String(responseText || "").toLowerCase();
  return text.includes("prompt_cache_key")
    && (
      text.includes("unknown")
      || text.includes("unsupported")
      || text.includes("not allowed")
      || text.includes("extra inputs")
      || text.includes("unrecognized")
      || text.includes("unexpected")
      || text.includes("invalid")
    );
}

function shouldDisablePromptCacheRetention(status: number, responseText: string) {
  if (status !== 400 && status !== 422) return false;
  const text = String(responseText || "").toLowerCase();
  return text.includes("prompt_cache_retention")
    && (
      text.includes("unknown")
      || text.includes("unsupported")
      || text.includes("not allowed")
      || text.includes("extra inputs")
      || text.includes("unrecognized")
      || text.includes("unexpected")
      || text.includes("invalid")
    );
}

function extractChatCompletionsText(json: any) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("\n");
  }
  return "";
}

function extractResponsesText(json: any) {
  if (typeof json?.output_text === "string") return json.output_text;
  const output = Array.isArray(json?.output) ? json.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item?.text === "string") {
      chunks.push(item.text);
    }
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (typeof part?.text === "string") {
        chunks.push(part.text);
        continue;
      }
      if (typeof part?.content === "string") {
        chunks.push(part.content);
      }
    }
  }
  return chunks.join("\n");
}
