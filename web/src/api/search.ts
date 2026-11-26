import {
  COOKIE_SESSION_MARKER,
  getCsrfToken,
  getToken,
  request,
  type RequestOptions,
} from "./request";
import { getJwxtToken, JWXT_COOKIE_SESSION_MARKER } from "./jwxt";
import { detectAnalyticsClient } from "@/utils/clientInfo";

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

export interface CampusAssistantGeneratedImage {
  url: string;
  alt: string;
}

export interface CampusAssistantSource {
  title: string;
  url: string;
}

export interface CampusAssistantResponse {
  answer: string;
  actions: CampusAssistantAction[];
  suggestions: string[];
  fallback: boolean;
  images?: CampusAssistantGeneratedImage[];
  sources?: CampusAssistantSource[];
}

export type PersonalAgentScopeKey =
  | "schedule"
  | "academic"
  | "collab"
  | "campusLife"
  | "community"
  | "messages";

export interface PersonalAgentPermissions {
  enabled: boolean;
  schedule: boolean;
  academic: boolean;
  collab: boolean;
  campusLife: boolean;
  community: boolean;
  messages: boolean;
  memory: boolean;
}

export type PersonalAgentMemoryCategory =
  | "academic"
  | "goal"
  | "campus"
  | "schedule"
  | "preference"
  | "note";

export interface PersonalAgentMemory {
  id: string;
  category: PersonalAgentMemoryCategory;
  content: string;
  source: "user" | "agent";
  createdAt: number;
  updatedAt: number;
}

export interface PersonalAgentStep {
  id: string;
  tool: string;
  label: string;
  status: "running" | "done" | "blocked" | "error";
  detail?: string;
}

export type PersonalAgentProposal =
  | {
      type: "agenda.create";
      item: {
        kind: "event" | "todo";
        title: string;
        date: string;
        start: string;
        end: string;
        location: string;
        note: string;
        remind: number;
        repeat: "none" | "daily" | "weekdays" | "weekly" | "monthly";
      };
      conflictHint?: string;
    }
  | {
      type: "agenda.update";
      id: string;
      title: string;
      changes: Record<string, any>;
    }
  | {
      type: "agenda.complete";
      id: string;
      title: string;
      date: string;
    }
  | {
      type: "agenda.delete";
      id: string;
      title: string;
    }
  | {
      type: "forum.post";
      board: string;
      boardName?: string;
      title: string;
      content: string;
      anonymous: boolean;
    }
  | {
      type: "forum.reply";
      topicId: number;
      topicTitle?: string;
      content: string;
      parentReplyId?: number;
      anonymous: boolean;
    }
  | {
      type: "lostfound.post";
      kind: "lost" | "found";
      itemName: string;
      description: string;
      campus: string;
      location: string;
      happenedAt: string;
      storageLocation: string;
      contact: string;
    }
  | {
      type: "dm.send";
      userId: number;
      name?: string;
      content: string;
    }
  | {
      type: "messages.readAll";
    }
  | {
      type: "permission.enable";
      scope: PersonalAgentScopeKey;
      title: string;
      hint: string;
    }
  | {
      type: "jwxt.reauth";
      reason: string;
    };

export interface PersonalAgentMemoryChange {
  op: "saved" | "deleted";
  id: string;
  memory?: PersonalAgentMemory;
}

export interface PersonalAgentResponse extends CampusAssistantResponse {
  proposals: PersonalAgentProposal[];
  steps: PersonalAgentStep[];
  memoryChanges: PersonalAgentMemoryChange[];
}

export class JwxtSilentReauthSignal extends Error {
  constructor(message = "需要恢复教务授权") {
    super(message);
    this.name = "JwxtSilentReauthSignal";
  }
}

export interface CampusAssistantQuota {
  level: number;
  levelName: string;
  dailyQuota: number;
  used: number;
  remaining: number;
  points: number;
  totalRemaining: number;
  dateKey: string;
  nextResetAt: string;
}

export interface CampusAssistantStoredMessage extends CampusAssistantMessage {
  id: number;
  actions?: CampusAssistantAction[];
  suggestions?: string[];
  images?: CampusAssistantGeneratedImage[];
  sources?: CampusAssistantSource[];
}

export interface CampusAssistantConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: CampusAssistantStoredMessage[];
  deletedAt?: number;
}

export interface CampusAssistantStreamOptions {
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onHeartbeat?: (elapsedMs: number) => void;
  onDone?: (response: CampusAssistantResponse) => void;
}

export interface PersonalAgentStreamOptions {
  signal?: AbortSignal;
  retriedAfterRecover?: boolean;
  onStep?: (step: PersonalAgentStep) => void;
  onDelta: (delta: string) => void;
  onHeartbeat?: (elapsedMs: number) => void;
  onDone?: (response: PersonalAgentResponse) => void;
}

export const searchApi = {
  search: (q: string, params?: { scope?: "services" }, options?: RequestOptions) =>
    request.get<SearchResult>("/search", { q, ...params }, options),
  askAssistant: (message: string, history: CampusAssistantMessage[], options?: RequestOptions) =>
    request.post<CampusAssistantResponse>("/search/assistant", { message, history }, options),
  assistantQuota: (options?: RequestOptions) =>
    request.get<CampusAssistantQuota>("/search/assistant/quota", undefined, options),
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
    request.delete<{ ok: true; deletedAt?: number }>(
      `/search/assistant/conversations/${encodeURIComponent(id)}`,
      options,
    ),
  streamAssistant: (
    message: string,
    history: CampusAssistantMessage[],
    options: CampusAssistantStreamOptions,
  ) => streamAssistant(message, history, options),
  getPersonalAgentState: (options?: RequestOptions) =>
    request.get<{ permissions: PersonalAgentPermissions; memories: PersonalAgentMemory[] }>(
      "/search/assistant/personal/state",
      undefined,
      options,
    ),
  savePersonalAgentPermissions: (
    patch: Partial<PersonalAgentPermissions>,
    options?: RequestOptions,
  ) => request.put<{ permissions: PersonalAgentPermissions }>(
    "/search/assistant/personal/permissions",
    patch,
    options,
  ),
  upsertPersonalAgentMemory: (
    payload: { id?: string; category: PersonalAgentMemoryCategory; content: string },
    options?: RequestOptions,
  ) => request.post<{ memory: PersonalAgentMemory }>(
    "/search/assistant/personal/memories",
    payload,
    options,
  ),
  deletePersonalAgentMemory: (id: string, options?: RequestOptions) =>
    request.delete<{ deleted: boolean }>(
      `/search/assistant/personal/memories/${encodeURIComponent(id)}`,
      options,
    ),
  clearPersonalAgentMemories: (options?: RequestOptions) =>
    request.delete<{ cleared: number }>("/search/assistant/personal/memories", options),
  streamPersonalAgent: (
    message: string,
    history: CampusAssistantMessage[],
    options: PersonalAgentStreamOptions,
  ) => streamPersonalAgent(message, history, options),
};

function buildSseHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-CPU-Auth-Mode": "cookie",
    "X-CPU-Client": detectAnalyticsClient(),
  };
  const token = getToken();
  if (token && token !== COOKIE_SESSION_MARKER) headers.Authorization = `Bearer ${token}`;
  const jwxtToken = getJwxtToken();
  if (jwxtToken && jwxtToken !== JWXT_COOKIE_SESSION_MARKER) {
    headers["X-Jwxt-Token"] = jwxtToken;
  }
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

async function consumeSseResponse(
  response: Response,
  onEvent: (event: string, payload: any) => void,
) {
  const consumeBlock = (block: string) => {
    if (!block.trim() || block.trimStart().startsWith(":")) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const payload = JSON.parse(dataLines.join("\n"));
    onEvent(event, payload);
  };

  if (!response.body) {
    for (const block of (await response.text()).split(/\r?\n\r?\n/)) consumeBlock(block);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consumeBlock(block);
    if (done) {
      buffer += decoder.decode();
      break;
    }
  }
  if (buffer.trim()) consumeBlock(buffer);
}

async function streamAssistant(
  message: string,
  history: CampusAssistantMessage[],
  options: CampusAssistantStreamOptions,
) {
  const response = await fetch("/api/search/assistant/stream", {
    method: "POST",
    credentials: "include",
    headers: buildSseHeaders(),
    body: JSON.stringify({ message, history }),
    signal: options.signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || `请求失败（${response.status}）`);
  }

  const completed: { value: CampusAssistantResponse | null } = { value: null };
  await consumeSseResponse(response, (event, payload) => {
    if (event === "delta" && typeof payload?.delta === "string") {
      options.onDelta(payload.delta);
      return;
    }
    if (event === "status" || event === "heartbeat") {
      const elapsedMs = Number(payload?.elapsedMs);
      options.onHeartbeat?.(Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0);
      return;
    }
    if (event === "done") {
      completed.value = payload as CampusAssistantResponse;
      options.onDone?.(completed.value);
      return;
    }
    if (event === "error") throw new Error(payload?.message || "拾间AI暂时不可用");
  });

  const result = completed.value;
  if (!result) throw new Error("拾间AI响应未完成，请重试");
  return result;
}

async function streamPersonalAgent(
  message: string,
  history: CampusAssistantMessage[],
  options: PersonalAgentStreamOptions,
) {
  const response = await fetch("/api/search/assistant/personal/stream", {
    method: "POST",
    credentials: "include",
    headers: buildSseHeaders(),
    body: JSON.stringify({
      message,
      history,
      retriedAfterRecover: Boolean(options.retriedAfterRecover),
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || `请求失败（${response.status}）`);
  }

  const completed: { value: PersonalAgentResponse | null } = { value: null };
  await consumeSseResponse(response, (event, payload) => {
    if (event === "step" && payload && typeof payload.id === "string") {
      options.onStep?.(payload as PersonalAgentStep);
      return;
    }
    if (event === "delta" && typeof payload?.delta === "string") {
      options.onDelta(payload.delta);
      return;
    }
    if (event === "status" || event === "heartbeat") {
      const elapsedMs = Number(payload?.elapsedMs);
      options.onHeartbeat?.(Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0);
      return;
    }
    if (event === "jwxt_reauth_needed") {
      throw new JwxtSilentReauthSignal(payload?.message || "需要恢复教务授权");
    }
    if (event === "done") {
      completed.value = payload as PersonalAgentResponse;
      options.onDone?.(completed.value);
      return;
    }
    if (event === "error") throw new Error(payload?.message || "拾间AI暂时不可用");
  });

  const result = completed.value;
  if (!result) throw new Error("拾间AI响应未完成，请重试");
  return result;
}
