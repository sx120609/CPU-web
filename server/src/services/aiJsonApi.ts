import { createHash } from "node:crypto";
import { checkAiModelAvailability } from "./aiModelCatalog";
import { shouldFallbackToNextProvider } from "./modelFallback";
import {
  isAiProviderBusyError,
  runWithAiProviderIsolation,
} from "./aiUpstreamScheduler";

export { isAiProviderBusyError } from "./aiUpstreamScheduler";

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
  /** True only when the upstream accepted a web-search request. */
  webSearchApplied?: boolean;
  /** Actual endpoint used when web search temporarily switches Chat Completions to Responses. */
  effectiveEndpoint?: string;
  /** Number of transient upstream retries made before returning the final response. */
  retryCount: number;
};

export type AiWebSearchSource = {
  title: string;
  url: string;
};

export type AiJsonCompletionMetadata = {
  finishReason: string | null;
  doneReason: string | null;
  done: boolean | null;
  promptEvalCount: number | null;
  evalCount: number | null;
  totalDurationMs: number | null;
  loadDurationMs: number | null;
  promptEvalDurationMs: number | null;
  evalDurationMs: number | null;
};

export type AiProviderCandidate = {
  serviceId?: string;
  name?: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  assistantContextMaxMessages?: number;
  assistantContextMaxCharsPerMessage?: number;
  /** Optional model override for this provider fallback route. */
  model?: string;
};

export type AiJsonMessagesResolver = (
  provider: AiProviderCandidate,
  model: string,
) => AiJsonMessage[];

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
export const AI_UPSTREAM_TIMEOUT_MS = 90_000;
const AI_RESPONSE_BODY_TIMEOUT_MS = 120_000;
const AI_RESPONSE_BODY_CLOSED = Symbol("ai-response-body-closed");

type TrackedAiResponse = Response & {
  [AI_RESPONSE_BODY_CLOSED]?: Promise<void>;
};

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
  provider?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  messages: AiJsonMessage[];
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  maxTransientRetries?: number;
  stream?: boolean;
  /** Use Ollama's native JSON endpoint for text-only, non-streaming requests. */
  preferNativeOllama?: boolean;
  /** Enable Ollama's private thinking channel when the caller can afford it. */
  ollamaThink?: boolean;
  /** Ask a compatible remote upstream to use its hosted web-search capability. */
  webSearch?: boolean;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  if (input.preferNativeOllama && !input.stream && isOllamaProvider(input.provider)) {
    return retryBusyOllamaRequest(input, () => sendNativeOllamaJsonRequest(input));
  }
  const execute = async (endpoint: string, webSearch: boolean) => {
    const mode = detectAiJsonApiMode(endpoint);
    const body = buildAiJsonRequestBody({
      mode,
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      messages: input.messages,
      stream: input.stream,
      webSearch,
    });
    const result = await retryBusyOllamaRequest(input, () => sendAiUpstreamRequest({
      endpoint,
      apiKey: input.apiKey,
      provider: input.provider,
      body,
      promptCacheKey: input.promptCacheKey,
      enablePromptCacheRetention: input.enablePromptCacheRetention,
      maxTransientRetries: input.maxTransientRetries,
      signal: input.signal,
    }));
    return {
      ...result,
      webSearchApplied: webSearch,
      effectiveEndpoint: endpoint,
    };
  };

  if (input.webSearch && !isOllamaEndpoint(input.provider, input.endpoint)) {
    for (const endpoint of buildAiWebSearchEndpointAttempts(input.endpoint)) {
      const result = await execute(endpoint, true);
      if (result.response.ok || !shouldRetryWithoutAiWebSearch(result.response.status, result.errorText)) {
        return result;
      }
      if (result.response.body) await result.response.body.cancel().catch(() => undefined);
    }
  }
  return execute(input.endpoint, false);
}

async function retryBusyOllamaRequest<T>(
  input: { maxTransientRetries?: number; signal?: AbortSignal },
  run: () => Promise<T>,
) {
  const configuredRetries = Number(input.maxTransientRetries);
  const maxRetries = Number.isFinite(configuredRetries)
    ? Math.max(0, Math.min(3, Math.floor(configuredRetries)))
    : 3;
  let retryCount = 0;
  while (true) {
    try {
      return await run();
    } catch (error) {
      if (
        !isAiProviderBusyError(error)
        || retryCount >= maxRetries
        || input.signal?.aborted
      ) {
        throw error;
      }
      retryCount += 1;
      await waitForTransientRetry(retryCount, input.signal);
    }
  }
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
  messages: AiJsonMessage[] | AiJsonMessagesResolver;
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  maxTransientRetries?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Use Ollama's native JSON endpoint for text-only, non-streaming requests. */
  preferNativeOllama?: boolean;
  /** Enable Ollama's private thinking channel when the caller can afford it. */
  ollamaThink?: boolean;
  webSearch?: boolean;
  signal?: AbortSignal;
  /** Give a congested primary Ollama route a short budget before trying a configured remote fallback. */
  primaryOllamaTimeoutMs?: number;
}): Promise<SendAiJsonRequestWithFallbackResult> {
  let lastError: unknown = null;
  let lastResponseResult: SendAiJsonRequestWithFallbackResult | null = null;
  const configuredProviders = input.providers.filter((provider) => String(provider.apiUrl || "").trim());
  const providers = input.webSearch
    ? [...configuredProviders].sort((left, right) => Number(isOllamaEndpoint(left.provider, left.apiUrl)) - Number(isOllamaEndpoint(right.provider, right.apiUrl)))
    : configuredProviders;
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
    const messages = typeof input.messages === "function"
      ? input.messages(provider, model)
      : input.messages;
    const primaryOllamaTimeoutMs = index === 0 && isOllamaEndpoint(provider.provider, provider.apiUrl)
      ? normalizeAiUpstreamTimeoutMs(input.primaryOllamaTimeoutMs)
      : null;
    const providerDeadline = primaryOllamaTimeoutMs
      ? createAiUpstreamDeadline(input.signal, primaryOllamaTimeoutMs)
      : null;
    try {
      const result = await sendAiJsonRequest({
        endpoint,
        apiKey: provider.apiKey,
        provider: provider.provider,
        model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        messages,
        promptCacheKey: input.promptCacheKey,
        enablePromptCacheRetention: input.enablePromptCacheRetention,
        maxTransientRetries: input.maxTransientRetries,
        stream: input.stream,
        preferNativeOllama: input.preferNativeOllama,
        ollamaThink: input.ollamaThink,
        webSearch: input.webSearch,
        signal: providerDeadline?.signal ?? input.signal,
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
      const effectiveError = providerDeadline?.didTimeout()
        ? createAiUpstreamTimeoutError(primaryOllamaTimeoutMs ?? undefined)
        : error;
      if (!isTransientAiUpstreamError(effectiveError, input.signal)) throw effectiveError;
      lastError = effectiveError;
      if (index >= providers.length - 1) throw effectiveError;
    } finally {
      providerDeadline?.dispose();
    }
  }
  if (lastResponseResult) return lastResponseResult;
  throw lastError instanceof Error ? lastError : new Error("没有可用的 AI 服务");
}

function isOllamaProvider(provider: string | undefined) {
  return String(provider || "").trim().toLowerCase() === "ollama";
}

function isOllamaEndpoint(provider: string | undefined, endpoint: string) {
  if (isOllamaProvider(provider)) return true;
  try {
    return new URL(endpoint).port === "11434";
  } catch {
    return false;
  }
}

async function sendNativeOllamaJsonRequest(input: {
  endpoint: string;
  apiKey: string;
  provider?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  messages: AiJsonMessage[];
  maxTransientRetries?: number;
  ollamaThink?: boolean;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  // The campus assistant is text-only. Keep image requests on the compatible
  // endpoint because native Ollama expects image bytes in a different shape.
  if (input.messages.some((message) => typeof message.content !== "string")) {
    return sendAiJsonRequest({ ...input, preferNativeOllama: false });
  }

  const options: Record<string, unknown> = {};
  if (input.temperature !== undefined) options.temperature = input.temperature;
  if (Number.isFinite(input.maxTokens) && Number(input.maxTokens) > 0) {
    options.num_predict = Math.floor(Number(input.maxTokens));
  }
  const upstream = await sendAiUpstreamRequest({
    endpoint: normalizeOllamaChatEndpoint(input.endpoint),
    apiKey: input.apiKey,
    provider: input.provider,
    maxTransientRetries: input.maxTransientRetries,
    signal: input.signal,
    body: {
      model: input.model,
      messages: input.messages.map(toNativeOllamaMessage),
      stream: false,
      // Ollama 0.32.x with Qwen's thinking channel can close a JSON object
      // early when its JSON grammar is enabled. The prompt still requires a
      // JSON object, and the caller validates/repairs it after parsing. Keep
      // the grammar for ordinary requests, but do not combine it with think.
      ...(input.ollamaThink === true ? {} : { format: "json" }),
      think: input.ollamaThink === true,
      ...(Object.keys(options).length ? { options } : {}),
    },
  });
  if (!upstream.response.ok) return upstream;

  let native: any;
  try {
    native = await upstream.response.json();
  } catch (error) {
    return {
      ...upstream,
      response: createAiJsonErrorResponse("Ollama 原生接口返回了无效 JSON", 502),
      errorText: error instanceof Error ? error.message : String(error),
    };
  }

  const content = typeof native?.message?.content === "string"
    ? native.message.content
    : "";
  if (!content.trim()) {
    return {
      ...upstream,
      response: createAiJsonErrorResponse("Ollama 原生接口没有返回 assistant 内容", 502),
      errorText: "Ollama 原生接口没有返回 assistant 内容",
    };
  }

  const wrapped = {
    id: native?.created_at ? `ollama-${native.created_at}` : "ollama-native-chat",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: native?.model || input.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: native?.done_reason || (native?.done === false ? null : "stop"),
    }],
    ...(Number.isFinite(Number(native?.prompt_eval_count)) || Number.isFinite(Number(native?.eval_count))
      ? {
          usage: {
            prompt_tokens: toNullableInteger(native?.prompt_eval_count) ?? 0,
            completion_tokens: toNullableInteger(native?.eval_count) ?? 0,
            total_tokens: (toNullableInteger(native?.prompt_eval_count) ?? 0)
              + (toNullableInteger(native?.eval_count) ?? 0),
          },
        }
      : {}),
    x_cpu_ollama: {
      done: typeof native?.done === "boolean" ? native.done : null,
      done_reason: typeof native?.done_reason === "string" ? native.done_reason : null,
      prompt_eval_count: toNullableInteger(native?.prompt_eval_count),
      eval_count: toNullableInteger(native?.eval_count),
      total_duration: toNullableInteger(native?.total_duration),
      load_duration: toNullableInteger(native?.load_duration),
      prompt_eval_duration: toNullableInteger(native?.prompt_eval_duration),
      eval_duration: toNullableInteger(native?.eval_duration),
    },
  };
  return {
    ...upstream,
    response: new Response(JSON.stringify(wrapped), {
      status: upstream.response.status,
      statusText: upstream.response.statusText,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

function normalizeOllamaChatEndpoint(endpoint: string) {
  const normalized = String(endpoint || "").trim().replace(/\/+$/, "");
  if (/\/api\/chat$/i.test(normalized)) return normalized;
  return normalized.replace(/\/v1\/(?:chat\/completions|responses)$/i, "/api/chat");
}

function toNativeOllamaMessage(message: AiJsonMessage) {
  return {
    role: message.role === "developer" ? "system" : message.role,
    content: String(message.content),
  };
}

function createAiJsonErrorResponse(message: string, status: number) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: "upstream_error",
    },
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function sendAiUpstreamRequest(input: {
  endpoint: string;
  apiKey: string;
  provider?: string;
  body: Record<string, unknown>;
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  /** Retries for transient provider failures. A value of 3 means at most four total attempts. */
  maxTransientRetries?: number;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  // Reject malformed payloads before entering the Ollama queue. Otherwise an
  // invalid image/message request can wait behind a long model task and be
  // reported as AI_PROVIDER_BUSY instead of the actionable validation error.
  validateAiRequestBody(input.body, detectAiJsonApiMode(input.endpoint));
  const shouldSerializeResponse = isOllamaEndpoint(input.provider, input.endpoint);
  return runWithAiProviderIsolation({
    provider: input.provider,
    endpoint: input.endpoint,
    signal: input.signal,
    run: () => sendAiUpstreamRequestUnisolated(input),
    // Ollama starts a model task before the HTTP body is consumed. Holding only
    // streams left native/non-streaming callers free to start a second task
    // while the first response.json() was still running.
    holdActiveUntil: shouldSerializeResponse
      ? (result) => waitForAiResponseBodyClosed(result.response)
      : undefined,
  });
}

async function sendAiUpstreamRequestUnisolated(input: {
  endpoint: string;
  apiKey: string;
  provider?: string;
  body: Record<string, unknown>;
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  maxTransientRetries?: number;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  const deadline = createAiUpstreamDeadline(input.signal);
  try {
    return await sendAiUpstreamRequestWithSignal({ ...input, signal: deadline.signal });
  } catch (error) {
    if (!input.signal?.aborted && deadline.signal.aborted) throw createAiUpstreamTimeoutError();
    throw error;
  } finally {
    deadline.dispose();
  }
}

async function sendAiUpstreamRequestWithSignal(input: {
  endpoint: string;
  apiKey: string;
  provider?: string;
  body: Record<string, unknown>;
  promptCacheKey?: string | null;
  enablePromptCacheRetention?: boolean;
  maxTransientRetries?: number;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  const mode = detectAiJsonApiMode(input.endpoint);
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
    response: trackAiResponseBody(
      finalResult.response,
      isOllamaEndpoint(input.provider, input.endpoint),
    ),
    mode,
    errorText: finalResult.errorText,
    promptCacheKeyApplied,
    promptCacheRetentionApplied,
    retryCount,
  };
}

function trackAiResponseBody(response: Response, shouldTrack: boolean) {
  if (!shouldTrack || !response.body) return response;
  const source = response.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let settled = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const settle = () => {
    if (settled) return;
    settled = true;
    resolveClosed();
  };
  const timeout = setTimeout(() => {
    const error = new Error(`AI 上游响应体超过 ${Math.round(AI_RESPONSE_BODY_TIMEOUT_MS / 1000)} 秒，已取消`);
    error.name = "TimeoutError";
    (error as Error & { code?: string }).code = "AI_RESPONSE_BODY_TIMEOUT";
    void reader?.cancel(error).catch(() => undefined);
    streamController?.error(error);
    settle();
  }, AI_RESPONSE_BODY_TIMEOUT_MS);
  timeout.unref?.();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      reader = source.getReader();
    },
    async pull(controller) {
      try {
        const result = await reader!.read();
        if (result.done) {
          clearTimeout(timeout);
          settle();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        clearTimeout(timeout);
        settle();
        controller.error(error);
      }
    },
    cancel(reason) {
      clearTimeout(timeout);
      settle();
      void reader?.cancel(reason).catch(() => undefined);
    },
  });
  const tracked = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }) as TrackedAiResponse;
  Object.defineProperty(tracked, AI_RESPONSE_BODY_CLOSED, {
    configurable: false,
    enumerable: false,
    value: closed,
  });
  return tracked;
}

async function waitForAiResponseBodyClosed(response: Response) {
  if (!response.body) return;
  const closed = (response as TrackedAiResponse)[AI_RESPONSE_BODY_CLOSED];
  if (closed) {
    await closed;
    return;
  }
  await response.body.cancel().catch(() => undefined);
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

export function buildAiWebSearchEndpointAttempts(endpoint: string) {
  const normalized = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!normalized) return [];
  if (/\/responses$/iu.test(normalized)) return [normalized];
  if (/\/chat\/completions$/iu.test(normalized)) {
    return [
      normalized.replace(/\/chat\/completions$/iu, "/responses"),
      normalized,
    ];
  }
  return [normalized];
}

function shouldRetryWithoutAiWebSearch(status: number, responseText: string) {
  if (![400, 404, 405, 415, 422].includes(status)) return false;
  if ([404, 405].includes(status)) return true;
  const text = String(responseText || "").toLowerCase();
  if (!text) return true;
  return /(?:web[_ -]?search|web_search_options|tool_choice|tools?|unsupported|not supported|unknown (?:field|parameter)|unrecognized|extra inputs?|responses? endpoint|response_format)/iu.test(text);
}

function buildAiJsonRequestBody(input: {
  mode: AiJsonApiMode;
  model: string;
  temperature?: number;
  maxTokens?: number;
  messages: AiJsonMessage[];
  stream?: boolean;
  webSearch?: boolean;
}) {
  const body: Record<string, unknown> = {
    model: input.model,
  };
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (Number.isFinite(input.maxTokens) && Number(input.maxTokens) > 0) {
    body[input.mode === "responses" ? "max_output_tokens" : "max_tokens"] = Math.floor(Number(input.maxTokens));
  }
  if (input.stream) body.stream = true;
  if (input.mode === "responses") {
    body.input = input.messages.map(toResponsesInputMessage);
    if (input.webSearch) {
      // sub2api and some Responses-compatible relays reject Web Search when
      // JSON mode is enabled. The caller's system prompt still requires a
      // JSON object, and the campus-assistant parser already tolerates fenced
      // or wrapped JSON, so keep tool use available instead of silently
      // downgrading to an offline answer.
      body.tools = [{
        type: "web_search",
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          country: "CN",
          region: "Jiangsu",
          city: "Nanjing",
          timezone: "Asia/Shanghai",
        },
      }];
      body.tool_choice = "required";
      body.include = ["web_search_call.action.sources"];
    } else {
      body.text = { format: { type: "json_object" } };
    }
  } else {
    body.messages = input.messages.map(toChatCompletionsMessage);
    body.response_format = { type: "json_object" };
    if (input.webSearch) {
      body.web_search_options = {
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          country: "CN",
          region: "Jiangsu",
          city: "Nanjing",
          timezone: "Asia/Shanghai",
        },
      };
    }
  }
  return body;
}

export function extractAiJsonWebSearchSources(payload: unknown): AiWebSearchSource[] {
  const sources: AiWebSearchSource[] = [];
  const seen = new Set<string>();
  const add = (urlValue: unknown, titleValue?: unknown) => {
    const url = String(urlValue || "").trim();
    if (!/^https?:\/\/[^\s<>"']+$/iu.test(url) || seen.has(url)) return;
    seen.add(url);
    let title = String(titleValue || "").trim().replace(/\s+/gu, " ").slice(0, 120);
    if (!title) {
      try {
        title = new URL(url).hostname.replace(/^www\./iu, "");
      } catch {
        title = "网页来源";
      }
    }
    sources.push({ title, url });
  };
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  for (const output of Array.isArray(root.output) ? root.output : []) {
    for (const source of Array.isArray(output?.action?.sources) ? output.action.sources : []) {
      add(source?.url, source?.title || source?.name);
    }
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        add(annotation?.url || annotation?.url_citation?.url, annotation?.title || annotation?.url_citation?.title);
      }
    }
  }
  const message = root.choices?.[0]?.message;
  for (const annotation of Array.isArray(message?.annotations) ? message.annotations : []) {
    add(annotation?.url || annotation?.url_citation?.url, annotation?.title || annotation?.url_citation?.title);
  }
  for (const citation of Array.isArray(root.citations) ? root.citations : []) {
    add(citation?.url, citation?.title || citation?.name);
  }
  return sources.slice(0, 8);
}

export function extractAiJsonCompletionMetadata(json: any, mode: AiJsonApiMode): AiJsonCompletionMetadata {
  const choice = mode === "chat_completions" ? json?.choices?.[0] : null;
  const usage = json?.usage;
  const ollama = json?.x_cpu_ollama;
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const doneReason = typeof ollama?.done_reason === "string" ? ollama.done_reason : null;
  return {
    finishReason,
    doneReason,
    done: typeof ollama?.done === "boolean" ? ollama.done : null,
    promptEvalCount: toNullableInteger(ollama?.prompt_eval_count ?? usage?.prompt_tokens),
    evalCount: toNullableInteger(ollama?.eval_count ?? usage?.completion_tokens),
    totalDurationMs: nanosecondsToMilliseconds(ollama?.total_duration),
    loadDurationMs: nanosecondsToMilliseconds(ollama?.load_duration),
    promptEvalDurationMs: nanosecondsToMilliseconds(ollama?.prompt_eval_duration),
    evalDurationMs: nanosecondsToMilliseconds(ollama?.eval_duration),
  };
}

function toNullableInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
}

function nanosecondsToMilliseconds(value: unknown) {
  const number = toNullableInteger(value);
  return number === null ? null : Math.round((number / 1_000_000) * 100) / 100;
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
  onMetadata?: (metadata: AiJsonCompletionMetadata) => void | Promise<void>,
) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.body || contentType.includes("application/json")) {
    const json = await response.json();
    const content = extractAiJsonTextResponse(json, mode);
    if (onMetadata) await onMetadata(extractAiJsonCompletionMetadata(json, mode));
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
    const metadata = extractAiJsonCompletionMetadata(payload, mode);
    if (onMetadata && (metadata.finishReason || metadata.doneReason || metadata.done !== null)) {
      await onMetadata(metadata);
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
  if (isAiProviderBusyError(error)) return !signal?.aborted;
  if (signal?.aborted) return false;
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError") return false;
  if (name === "TimeoutError") return isAiUpstreamTimeoutError(error);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "");
  return /fetch failed|network|socket|econn|etimedout|eai_again|enotfound|temporarily unavailable/i.test(message);
}

export function isAiUpstreamTimeoutError(error: unknown) {
  return error instanceof Error
    && error.name === "TimeoutError"
    && (error as Error & { code?: unknown }).code === "AI_UPSTREAM_TIMEOUT";
}

function shouldRetryTransientUpstreamError(error: unknown, signal?: AbortSignal) {
  return isTransientAiUpstreamError(error, signal);
}

function createAiUpstreamDeadline(parentSignal?: AbortSignal, timeoutMs = AI_UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason || createAiAbortError());
  if (parentSignal?.aborted) controller.abort(parentSignal.reason || createAiAbortError());
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(createAiUpstreamTimeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

function createAiUpstreamTimeoutError(timeoutMs = AI_UPSTREAM_TIMEOUT_MS) {
  const error = new Error(`AI 上游请求超过 ${Math.round(timeoutMs / 1000)} 秒，已取消`);
  error.name = "TimeoutError";
  (error as Error & { code?: string }).code = "AI_UPSTREAM_TIMEOUT";
  return error;
}

function normalizeAiUpstreamTimeoutMs(value: unknown) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  return Math.max(250, Math.min(AI_UPSTREAM_TIMEOUT_MS, Math.floor(timeoutMs)));
}

function createAiAbortError() {
  const error = new Error("AI 请求已取消");
  error.name = "AbortError";
  return error;
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
