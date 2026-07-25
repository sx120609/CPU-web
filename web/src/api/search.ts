import {
  COOKIE_SESSION_MARKER,
  getCsrfToken,
  getToken,
  request,
  type RequestOptions,
} from "./request";
import { detectClientPlatform } from "@/utils/clientInfo";

export interface SearchResult {
  topics: any[];
  courses: any[];
  services: any[];
}

export interface CampusAssistantAction {
  id: string;
  label: string;
  description: string;
  url: string;
  icon: string;
  owner: string;
  requireLogin: boolean;
}

export interface CampusAssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CampusAssistantResponse {
  answer: string;
  actions: CampusAssistantAction[];
  suggestions: string[];
  fallback: boolean;
}

export interface CampusAssistantStoredMessage extends CampusAssistantMessage {
  id: number;
  actions?: CampusAssistantAction[];
  suggestions?: string[];
}

export interface CampusAssistantConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: CampusAssistantStoredMessage[];
}

export interface CampusAssistantStreamOptions {
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onDone?: (response: CampusAssistantResponse) => void;
}

export const searchApi = {
  search: (q: string, options?: RequestOptions) => request.get<SearchResult>("/search", { q }, options),
  askAssistant: (message: string, history: CampusAssistantMessage[], options?: RequestOptions) =>
    request.post<CampusAssistantResponse>("/search/assistant", { message, history }, options),
  listAssistantConversations: (options?: RequestOptions) =>
    request.get<CampusAssistantConversation[]>("/search/assistant/conversations", undefined, options),
  saveAssistantConversation: (
    conversation: CampusAssistantConversation,
    options?: RequestOptions,
  ) => request.patch<CampusAssistantConversation>(
    `/search/assistant/conversations/${encodeURIComponent(conversation.id)}`,
    {
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages,
    },
    options,
  ),
  deleteAssistantConversation: (id: string, options?: RequestOptions) =>
    request.delete<{ ok: true }>(
      `/search/assistant/conversations/${encodeURIComponent(id)}`,
      options,
    ),
  streamAssistant: (
    message: string,
    history: CampusAssistantMessage[],
    options: CampusAssistantStreamOptions,
  ) => streamAssistant(message, history, options),
};

async function streamAssistant(
  message: string,
  history: CampusAssistantMessage[],
  options: CampusAssistantStreamOptions,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-CPU-Auth-Mode": "cookie",
    "X-CPU-Client": detectClientPlatform(),
  };
  const token = getToken();
  if (token && token !== COOKIE_SESSION_MARKER) headers.Authorization = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;

  const response = await fetch("/api/search/assistant/stream", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({ message, history }),
    signal: options.signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || `请求失败（${response.status}）`);
  }

  const completed: { value: CampusAssistantResponse | null } = { value: null };
  const consumeEvent = (block: string) => {
    if (!block.trim() || block.trimStart().startsWith(":")) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const payload = JSON.parse(dataLines.join("\n"));
    if (event === "delta" && typeof payload?.delta === "string") {
      options.onDelta(payload.delta);
      return;
    }
    if (event === "done") {
      completed.value = payload as CampusAssistantResponse;
      options.onDone?.(completed.value);
      return;
    }
    if (event === "error") throw new Error(payload?.message || "拾间AI暂时不可用");
  };

  if (!response.body) {
    for (const block of (await response.text()).split(/\r?\n\r?\n/)) consumeEvent(block);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) consumeEvent(block);
      if (done) break;
    }
    if (buffer.trim()) consumeEvent(buffer);
  }
  const result = completed.value;
  if (!result) throw new Error("拾间AI响应未完成，请重试");
  return result;
}
