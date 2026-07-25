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
};

const promptCacheKeySupport = new Map<string, boolean>();
const promptCacheRetentionSupport = new Map<string, boolean>();

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
  stream?: boolean;
  signal?: AbortSignal;
}): Promise<SendAiJsonRequestResult> {
  const mode = detectAiJsonApiMode(input.endpoint);
  const supportKey = `${mode}:${input.endpoint}`;
  const promptCacheKey = String(input.promptCacheKey || "").trim();
  let promptCacheKeyApplied = Boolean(promptCacheKey) && (promptCacheKeySupport.get(supportKey) ?? true);
  let promptCacheRetentionApplied = mode === "responses"
    && promptCacheKeyApplied
    && input.enablePromptCacheRetention !== false
    && (promptCacheRetentionSupport.get(supportKey) ?? true);

  let response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    signal: input.signal,
    body: JSON.stringify(buildAiJsonRequestBody({
      mode,
      model: input.model,
      temperature: input.temperature,
      messages: input.messages,
      promptCacheKey: promptCacheKeyApplied ? promptCacheKey : "",
      promptCacheRetentionApplied,
      stream: input.stream,
    })),
  });
  let errorText = response.ok ? "" : await response.clone().text().catch(() => "");

  if (!response.ok && promptCacheRetentionApplied && shouldDisablePromptCacheRetention(response.status, errorText)) {
    promptCacheRetentionSupport.set(supportKey, false);
    promptCacheRetentionApplied = false;
    response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: input.signal,
      body: JSON.stringify(buildAiJsonRequestBody({
        mode,
        model: input.model,
        temperature: input.temperature,
        messages: input.messages,
        promptCacheKey: promptCacheKeyApplied ? promptCacheKey : "",
        promptCacheRetentionApplied,
        stream: input.stream,
      })),
    });
    errorText = response.ok ? "" : await response.clone().text().catch(() => "");
  }

  if (!response.ok && promptCacheKeyApplied && shouldDisablePromptCacheKey(response.status, errorText)) {
    promptCacheKeySupport.set(supportKey, false);
    promptCacheRetentionSupport.set(supportKey, false);
    promptCacheKeyApplied = false;
    promptCacheRetentionApplied = false;
    response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: input.signal,
      body: JSON.stringify(buildAiJsonRequestBody({
        mode,
        model: input.model,
        temperature: input.temperature,
        messages: input.messages,
        promptCacheKey: "",
        promptCacheRetentionApplied: false,
        stream: input.stream,
      })),
    });
    errorText = response.ok ? "" : await response.clone().text().catch(() => "");
  }

  return {
    response,
    mode,
    errorText,
    promptCacheKeyApplied,
    promptCacheRetentionApplied,
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
  promptCacheKey: string;
  promptCacheRetentionApplied: boolean;
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
  if (input.promptCacheKey) {
    body.prompt_cache_key = input.promptCacheKey;
    if (input.mode === "responses" && input.promptCacheRetentionApplied) {
      body.prompt_cache_retention = "24h";
    }
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
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) await consumeEvent(block);
    if (done) break;
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

  const content = payload?.choices?.[0]?.delta?.content;
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
