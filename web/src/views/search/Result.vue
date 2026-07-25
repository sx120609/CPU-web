<template>
  <div class="assistant-page">
    <section class="assistant-shell cpu-card">
      <div class="assistant-head">
        <span class="assistant-mark">拾</span>
        <div class="assistant-head-copy">
          <h1>拾间AI</h1>
          <p>问功能、找入口，也可以直接聊天</p>
        </div>
        <div class="assistant-head-actions">
          <button type="button" aria-label="查看历史对话" @click="historyOpen = true">
            <el-icon><Clock /></el-icon>
            <span v-if="sessions.length" class="history-count">{{ sessions.length }}</span>
          </button>
          <button type="button" aria-label="新建对话" :disabled="!messages.length" @click="startNewConversation">
            <el-icon><Plus /></el-icon>
          </button>
        </div>
      </div>

      <div v-if="!messages.length" class="assistant-welcome">
        <strong>想做什么？直接告诉我。</strong>
        <span>例如查询宿舍电费、打开药苑之声、找课表，或者询问具体操作步骤。</span>
        <div class="welcome-prompts">
          <button v-for="prompt in welcomePrompts" :key="prompt" type="button" @click="sendPrompt(prompt)">
            {{ prompt }}
          </button>
        </div>
      </div>

      <div v-else ref="conversationRef" class="conversation" aria-live="polite">
        <article
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="`message--${message.role}`"
        >
          <div class="message-label">{{ message.role === "user" ? "你" : "拾间AI" }}</div>
          <div class="message-bubble">
            <p v-if="message.content">
              {{ message.content }}<span v-if="message.streaming" class="stream-cursor" aria-hidden="true"></span>
            </p>
            <div v-else-if="message.streaming" class="assistant-thinking" aria-label="拾间AI正在回答">
              <i></i><i></i><i></i>
            </div>
            <div v-if="message.actions?.length" class="action-list">
              <button
                v-for="action in message.actions"
                :key="action.id"
                type="button"
                class="action-card"
                @click="open(action)"
              >
                <span class="action-icon">{{ action.icon || "🔗" }}</span>
                <span class="action-copy">
                  <strong>{{ action.label }}</strong>
                  <small>{{ action.description }}</small>
                </span>
                <el-icon><Right /></el-icon>
              </button>
            </div>
            <div v-if="message.suggestions?.length" class="suggestions">
              <button
                v-for="suggestion in message.suggestions"
                :key="suggestion"
                type="button"
                @click="sendPrompt(suggestion)"
              >
                {{ suggestion }}
              </button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="assistantError && !assistantLoading" class="assistant-error">
        <span>{{ assistantError }}</span>
        <el-button text type="primary" @click="retryAssistant">重试</el-button>
      </div>

      <div class="assistant-form">
        <el-input
          v-model="keywordInput"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          resize="none"
          maxlength="500"
          placeholder="给拾间AI发消息"
          @keydown="handleComposerKeydown"
        />
        <button
          type="button"
          class="composer-send"
          :aria-label="assistantLoading ? '正在回答' : '发送'"
          :disabled="!keywordInput.trim() || assistantLoading"
          @click="submitSearch"
        >
          <el-icon v-if="assistantLoading" class="is-loading"><Loading /></el-icon>
          <el-icon v-else><Promotion /></el-icon>
          <span>发送</span>
        </button>
      </div>
    </section>

    <el-drawer
      v-model="historyOpen"
      class="assistant-history-drawer"
      direction="ltr"
      size="min(86vw, 360px)"
      title="历史对话"
      append-to-body
    >
      <div class="history-caption">记录保存在当前设备，最多保留 20 个对话。</div>
      <button type="button" class="history-new" @click="startNewConversation">
        <el-icon><Plus /></el-icon>
        <span>新对话</span>
      </button>
      <div v-if="sessions.length" class="history-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="history-item"
          :class="{ active: session.id === activeSessionId }"
        >
          <button type="button" class="history-open" @click="openConversation(session.id)">
            <strong>{{ session.title }}</strong>
            <span>{{ sessionPreview(session) }}</span>
            <time>{{ formatSessionTime(session.updatedAt) }}</time>
          </button>
          <button type="button" class="history-delete" aria-label="删除此对话" @click="deleteConversation(session.id)">
            <el-icon><Delete /></el-icon>
          </button>
        </div>
      </div>
      <div v-else class="history-empty">
        <el-icon><ChatDotRound /></el-icon>
        <span>还没有历史对话</span>
      </div>
    </el-drawer>

    <div v-if="q" class="related-results">
      <div class="related-head">
        <div>
          <h2>相关站内内容</h2>
          <span v-if="result">找到 {{ resultCount }} 条</span>
        </div>
        <el-button v-if="searchError && !searchLoading" text type="primary" @click="reloadSearch">重新搜索</el-button>
      </div>

      <div v-if="searchLoading && !result" class="cpu-card related-loading">
        <el-skeleton :rows="2" animated />
      </div>
      <div v-else-if="searchError && !result" class="cpu-card related-empty">{{ searchError }}</div>

      <template v-else-if="result">
        <section v-if="result.services.length" class="cpu-card">
          <h3 class="title">🧭 入口与服务（{{ result.services.length }}）</h3>
          <div
            v-for="service in result.services"
            :key="service.id"
            class="svc-row"
            role="button"
            tabindex="0"
            @click="open(service)"
            @keydown.enter.prevent="open(service)"
            @keydown.space.prevent="open(service)"
          >
            <span class="icon">{{ service.icon || "🔗" }}</span>
            <div>
              <div class="s-name">{{ service.name }}</div>
              <div class="s-desc">{{ service.owner }} · {{ service.description }}</div>
            </div>
            <el-icon><Right /></el-icon>
          </div>
        </section>

        <section v-if="result.topics.length" class="cpu-card">
          <h3 class="title">💬 帖子与公告（{{ result.topics.length }}）</h3>
          <TopicListItem v-for="topic in result.topics" :key="topic.id" :topic="topic" />
        </section>

        <section v-if="result.courses.length" class="cpu-card">
          <h3 class="title">📚 课程（{{ result.courses.length }}）</h3>
          <div
            v-for="course in result.courses"
            :key="course.id"
            class="course-row"
            role="button"
            tabindex="0"
            @click="openCourse(course.id)"
            @keydown.enter.prevent="openCourse(course.id)"
            @keydown.space.prevent="openCourse(course.id)"
          >
            <div>
              <div class="c-name">{{ course.code }} · {{ course.name }}</div>
              <div class="c-meta">
                {{ course.teachers?.length ? course.teachers.map((teacher: any) => teacher.name).join("、") : (course.teacher || "—") }}
                · {{ course.ratingCount }} 评价
              </div>
            </div>
            <el-icon><Right /></el-icon>
          </div>
        </section>

        <div v-if="!resultCount && !searchLoading" class="cpu-card related-empty">
          没有更多传统搜索结果，可以继续问拾间AI。
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ChatDotRound,
  Clock,
  Delete,
  Loading,
  Plus,
  Promotion,
  Right,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import {
  searchApi,
  type CampusAssistantAction,
  type CampusAssistantMessage,
  type SearchResult,
} from "@/api/search";
import { useAuthStore } from "@/stores/auth";

type ConversationMessage = CampusAssistantMessage & {
  id: number;
  actions?: CampusAssistantAction[];
  suggestions?: string[];
  streaming?: boolean;
};

type ConversationSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ConversationMessage[];
};

const HISTORY_KEY = "campus-assistant-history:v1";
const ACTIVE_HISTORY_KEY = "campus-assistant-active:v1";
const MAX_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 60;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const q = ref((route.query.q as string) ?? "");
const keywordInput = ref("");
const result = ref<SearchResult | null>(null);
const searchLoading = ref(false);
const searchError = ref("");
const assistantLoading = ref(false);
const assistantError = ref("");
const historyOpen = ref(false);
const conversationRef = ref<HTMLElement | null>(null);
const sessions = ref<ConversationSession[]>(loadSessions());
const restoredSession = restoreActiveSession(sessions.value);
const activeSessionId = ref(restoredSession?.id || "");
const messages = ref<ConversationMessage[]>(cloneMessages(restoredSession?.messages || []));
let searchSeq = 0;
let assistantSeq = 0;
let messageSeq = messages.value.reduce((max, item) => Math.max(max, item.id), 0);
let assistantController: AbortController | null = null;
let scrollFrame = 0;
let firstRouteSync = true;

const welcomePrompts = ["怎么查宿舍电费？", "打开药苑之声", "我的课表在哪里？"];
const resultCount = computed(() => (
  (result.value?.topics.length ?? 0)
  + (result.value?.courses.length ?? 0)
  + (result.value?.services.length ?? 0)
));

watch(() => route.query.q, async (value) => {
  const keyword = String(value ?? "").trim();
  q.value = keyword;
  keywordInput.value = "";
  const isRestoredQuery = firstRouteSync
    && keyword
    && [...messages.value].reverse().find((item) => item.role === "user")?.content === keyword;
  firstRouteSync = false;
  if (!keyword) {
    result.value = null;
    searchError.value = "";
    scrollConversation();
    return;
  }
  if (isRestoredQuery) {
    await reloadSearch();
    scrollConversation();
    return;
  }
  await runQuery(keyword);
}, { immediate: true });

async function submitSearch() {
  const keyword = keywordInput.value.trim();
  if (!keyword || assistantLoading.value) return;
  keywordInput.value = "";
  if (keyword === q.value) {
    await runQuery(keyword);
    return;
  }
  await router.push({ name: "search", query: { q: keyword } });
}

async function sendPrompt(prompt: string) {
  if (assistantLoading.value) return;
  keywordInput.value = prompt;
  await submitSearch();
}

async function runQuery(keyword: string) {
  const history = messages.value
    .slice(-8)
    .map(({ role, content }) => ({ role, content }));
  ensureActiveConversation(keyword);
  messages.value.push({ id: ++messageSeq, role: "user", content: keyword });
  persistActiveConversation();
  scrollConversation();
  await Promise.allSettled([
    reloadSearch(),
    askAssistant(keyword, history),
  ]);
}

async function reloadSearch() {
  const keyword = q.value.trim();
  if (!keyword) return;
  const seq = ++searchSeq;
  searchLoading.value = true;
  searchError.value = "";
  try {
    const next = await searchApi.search(keyword, { suppressErrorMessage: true });
    if (seq === searchSeq) result.value = next;
  } catch (error) {
    if (seq === searchSeq) searchError.value = normalizeRequestError(error, "相关内容搜索失败");
  } finally {
    if (seq === searchSeq) searchLoading.value = false;
  }
}

async function askAssistant(keyword: string, history: CampusAssistantMessage[]) {
  const seq = ++assistantSeq;
  assistantController?.abort();
  assistantController = new AbortController();
  const controller = assistantController;
  const assistantMessageId = ++messageSeq;
  messages.value.push({
    id: assistantMessageId,
    role: "assistant",
    content: "",
    streaming: true,
  });
  const assistantMessage = messages.value.find((item) => item.id === assistantMessageId)!;
  scrollConversation();
  assistantLoading.value = true;
  assistantError.value = "";
  try {
    const next = await searchApi.streamAssistant(keyword, history, {
      signal: controller.signal,
      onDelta: (delta) => {
        if (seq !== assistantSeq) return;
        assistantMessage.content += delta;
        scrollConversation();
      },
    });
    if (seq !== assistantSeq) return;
    assistantMessage.content = next.answer;
    assistantMessage.actions = next.actions;
    assistantMessage.suggestions = next.suggestions;
    assistantMessage.streaming = false;
    persistActiveConversation();
    scrollConversation();
  } catch (error) {
    if (seq !== assistantSeq || controller.signal.aborted) return;
    messages.value = messages.value.filter((item) => item.id !== assistantMessage.id);
    persistActiveConversation();
    assistantError.value = normalizeRequestError(error, "拾间AI暂时不可用");
  } finally {
    if (seq === assistantSeq) {
      assistantLoading.value = false;
      if (assistantController === controller) assistantController = null;
    }
  }
}

async function retryAssistant() {
  const keyword = [...messages.value].reverse().find((item) => item.role === "user")?.content.trim() || q.value.trim();
  if (!keyword || assistantLoading.value) return;
  const history = messages.value
    .filter((item, index) => !(index === messages.value.length - 1 && item.role === "user"))
    .slice(-8)
    .map(({ role, content }) => ({ role, content }));
  await askAssistant(keyword, history);
}

function handleComposerKeydown(event: Event | KeyboardEvent) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void submitSearch();
}

async function startNewConversation() {
  cancelActiveAssistant();
  messages.value = [];
  activeSessionId.value = "";
  assistantError.value = "";
  result.value = null;
  q.value = "";
  historyOpen.value = false;
  try { localStorage.removeItem(ACTIVE_HISTORY_KEY); } catch { /* ignore */ }
  if (route.query.q) await router.replace({ name: "search" });
}

async function openConversation(sessionId: string) {
  const session = sessions.value.find((item) => item.id === sessionId);
  if (!session) return;
  cancelActiveAssistant();
  if (route.query.q) await router.replace({ name: "search" });
  activeSessionId.value = session.id;
  messages.value = cloneMessages(session.messages);
  messageSeq = messages.value.reduce((max, item) => Math.max(max, item.id), messageSeq);
  assistantError.value = "";
  result.value = null;
  q.value = "";
  historyOpen.value = false;
  rememberActiveSession(session.id);
  scrollConversation();
}

async function deleteConversation(sessionId: string) {
  sessions.value = sessions.value.filter((item) => item.id !== sessionId);
  writeSessions();
  if (activeSessionId.value === sessionId) await startNewConversation();
}

function sessionPreview(session: ConversationSession) {
  return [...session.messages].reverse().find((item) => item.content.trim())?.content.trim() || "空对话";
}

function formatSessionTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function ensureActiveConversation(firstMessage: string) {
  if (activeSessionId.value && sessions.value.some((item) => item.id === activeSessionId.value)) return;
  const id = createSessionId();
  const session: ConversationSession = {
    id,
    title: firstMessage.trim().slice(0, 28) || "新对话",
    updatedAt: Date.now(),
    messages: [],
  };
  sessions.value.unshift(session);
  activeSessionId.value = id;
  rememberActiveSession(id);
}

function persistActiveConversation() {
  const session = sessions.value.find((item) => item.id === activeSessionId.value);
  if (!session) return;
  const storedMessages = messages.value
    .filter((item) => item.content.trim())
    .slice(-MAX_MESSAGES_PER_SESSION)
    .map(({ streaming: _streaming, ...item }) => ({ ...item }));
  session.messages = cloneMessages(storedMessages);
  session.updatedAt = Date.now();
  session.title = storedMessages.find((item) => item.role === "user")?.content.trim().slice(0, 28) || session.title;
  sessions.value = [
    session,
    ...sessions.value.filter((item) => item.id !== session.id),
  ].slice(0, MAX_SESSIONS);
  writeSessions();
  rememberActiveSession(session.id);
}

function cancelActiveAssistant() {
  assistantSeq += 1;
  assistantController?.abort();
  assistantController = null;
  assistantLoading.value = false;
}

function scrollConversation() {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    void nextTick(() => {
      const element = conversationRef.value;
      if (element) element.scrollTop = element.scrollHeight;
    });
  });
}

function loadSessions(): ConversationSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && Array.isArray(item.messages))
      .map((item) => ({
        id: item.id,
        title: item.title.slice(0, 28) || "历史对话",
        updatedAt: Number(item.updatedAt) || 0,
        messages: cloneMessages(item.messages),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

function restoreActiveSession(items: ConversationSession[]) {
  let activeId = "";
  try { activeId = localStorage.getItem(ACTIVE_HISTORY_KEY) || ""; } catch { /* ignore */ }
  return items.find((item) => item.id === activeId) || items[0] || null;
}

function cloneMessages(items: unknown[]): ConversationMessage[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is ConversationMessage => (
      Boolean(item)
      && typeof (item as ConversationMessage).id === "number"
      && ["user", "assistant"].includes((item as ConversationMessage).role)
      && typeof (item as ConversationMessage).content === "string"
    ))
    .map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content.slice(0, 1600),
      actions: Array.isArray(item.actions) ? item.actions.slice(0, 3).map((action) => ({ ...action })) : undefined,
      suggestions: Array.isArray(item.suggestions) ? item.suggestions.slice(0, 3).map(String) : undefined,
    }));
}

function writeSessions() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions.value)); } catch { /* ignore */ }
}

function rememberActiveSession(sessionId: string) {
  try { localStorage.setItem(ACTIVE_HISTORY_KEY, sessionId); } catch { /* ignore */ }
}

function createSessionId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRequestError(error: unknown, fallback: string) {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500) return response.data?.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function open(item: any) {
  const url = typeof item?.url === "string" ? item.url.trim() : "";
  if (!url) {
    ElMessage.warning("该入口暂未配置链接");
    return;
  }
  if ((item?.requireLogin || item?.needSso) && !auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: url } });
    return;
  }
  if (url.startsWith("/")) {
    router.push(url);
    return;
  }
  if (url.startsWith("tel:") || url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  if (/^https?:\/\//i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  ElMessage.warning("该入口链接格式暂不支持");
}

function openCourse(id: number) {
  router.push(`/coursereview/${id}`);
}

onBeforeUnmount(() => {
  cancelActiveAssistant();
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});
</script>

<style scoped>
.assistant-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  height: 100%;
  min-height: 0;
  max-width: 920px;
  margin: 0 auto;
  overflow-y: auto;
}
.cpu-card {
  color: var(--cpu-text);
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.assistant-shell {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  gap: 16px;
  min-height: min(560px, 100%);
  padding: 20px;
}
.assistant-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.assistant-head-copy {
  flex: 1;
  min-width: 0;
}
.assistant-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.assistant-head-actions button {
  position: relative;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface);
  cursor: pointer;
  font: inherit;
}
.assistant-head-actions button:hover {
  color: var(--cpu-primary);
  border-color: var(--cpu-primary);
}
.assistant-head-actions button:disabled {
  opacity: 0.4;
  cursor: default;
}
.history-count {
  position: absolute;
  top: -5px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 2px solid var(--cpu-card);
  border-radius: 999px;
  color: #fff;
  background: var(--cpu-primary);
  box-sizing: border-box;
  font-size: 9px;
  line-height: 12px;
}
.assistant-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  color: #fff;
  background: linear-gradient(135deg, #0f8f78, #17aa8d);
  box-shadow: 0 7px 18px rgba(22, 135, 118, 0.22);
  font-size: 18px;
  font-weight: 800;
}
.assistant-head h1 {
  margin: 0;
  font-size: 21px;
}
.assistant-head p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.assistant-welcome {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 24px 4px;
  color: var(--cpu-text);
}
.assistant-welcome strong {
  font-size: 20px;
}
.assistant-welcome > span {
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.welcome-prompts,
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.welcome-prompts button,
.suggestions button {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  padding: 7px 11px;
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface-subtle);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.welcome-prompts button:hover,
.suggestions button:hover {
  color: var(--cpu-primary);
  border-color: var(--cpu-primary);
}
.conversation {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 160px;
  max-height: min(56vh, 560px);
  overflow-y: auto;
  padding: 2px 4px 8px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.message {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-width: 86%;
}
.message--user {
  align-self: flex-end;
  align-items: flex-end;
}
.message--assistant {
  align-self: flex-start;
}
.message-label {
  color: var(--cpu-text-muted);
  font-size: 10px;
}
.message-bubble {
  min-width: 64px;
  padding: 11px 13px;
  border-radius: 14px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
}
.message--user .message-bubble {
  color: #fff;
  background: var(--cpu-primary);
  border-color: var(--cpu-primary);
  border-bottom-right-radius: 4px;
}
.message--assistant .message-bubble {
  border-bottom-left-radius: 4px;
}
.message-bubble p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
  font-size: 14px;
}
.action-list {
  display: grid;
  gap: 8px;
  margin-top: 11px;
}
.action-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  color: var(--cpu-text);
  background: var(--cpu-card);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.action-card:hover {
  border-color: var(--cpu-primary);
}
.action-icon {
  flex: 0 0 auto;
  font-size: 21px;
}
.action-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.action-copy strong {
  font-size: 13px;
}
.action-copy small {
  margin-top: 2px;
  color: var(--cpu-text-secondary);
  line-height: 1.45;
  font-size: 11px;
}
.assistant-thinking {
  display: flex;
  gap: 5px;
  padding: 14px 16px;
}
.assistant-thinking i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cpu-text-muted);
  animation: thinking 1s infinite ease-in-out;
}
.assistant-thinking i:nth-child(2) { animation-delay: 0.15s; }
.assistant-thinking i:nth-child(3) { animation-delay: 0.3s; }
.stream-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.1em;
  background: currentColor;
  animation: cursor-blink 0.8s steps(2, start) infinite;
}
@keyframes thinking {
  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}
@keyframes cursor-blink {
  50% { opacity: 0; }
}
.assistant-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 11px;
  border-radius: 9px;
  color: #b45309;
  background: rgba(245, 158, 11, 0.12);
  font-size: 12px;
}
.assistant-form {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-top: auto;
  padding: 12px 2px 0;
  border-top: 1px solid var(--cpu-border-soft);
}
.assistant-form .el-input {
  flex: 1;
  min-width: 0;
}
.assistant-form :deep(.el-textarea) {
  flex: 1;
  min-width: 0;
}
.assistant-form :deep(.el-textarea__inner) {
  min-height: 44px !important;
  max-height: 112px;
  padding: 11px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 15px;
  color: var(--cpu-text);
  background: var(--cpu-surface);
  box-shadow: none;
  line-height: 20px;
}
.assistant-form :deep(.el-textarea__inner:focus) {
  border-color: var(--cpu-primary);
  box-shadow: 0 0 0 3px rgba(20, 143, 123, 0.1);
}
.composer-send {
  display: inline-flex;
  height: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 17px;
  border: 0;
  border-radius: 14px;
  color: #fff;
  background: var(--cpu-primary);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
}
.composer-send:hover {
  filter: brightness(1.05);
}
.composer-send:disabled {
  opacity: 0.45;
  cursor: default;
  filter: none;
}
.related-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px;
}
.related-results {
  display: contents;
}
.related-head h2 {
  display: inline;
  margin: 0 8px 0 0;
  font-size: 17px;
}
.related-head span {
  color: var(--cpu-text-muted);
  font-size: 11px;
}
.title {
  margin: 0 0 10px;
  font-size: 15px;
}
.course-row,
.svc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  overflow: hidden;
  padding: 11px 4px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  border-radius: 7px;
  cursor: pointer;
}
.course-row:last-child,
.svc-row:last-child {
  border-bottom: none;
}
.course-row:hover,
.svc-row:hover {
  background: var(--cpu-surface-subtle);
}
.course-row:focus-visible,
.svc-row:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.course-row > div,
.svc-row > div {
  flex: 1;
  min-width: 0;
}
.c-name,
.s-name {
  color: var(--cpu-text);
  overflow-wrap: anywhere;
  font-size: 14px;
}
.c-meta,
.s-desc {
  margin-top: 2px;
  color: var(--cpu-text-secondary);
  overflow-wrap: anywhere;
  font-size: 12px;
}
.icon {
  font-size: 20px;
}
.related-loading,
.related-empty {
  color: var(--cpu-text-secondary);
  text-align: center;
  font-size: 13px;
}

:global(.assistant-history-drawer) {
  color: var(--cpu-text);
  background: var(--cpu-card);
}
:global(.assistant-history-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text);
  font-weight: 700;
}
:global(.assistant-history-drawer .el-drawer__body) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}
.history-caption {
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.5;
}
.history-new {
  display: flex;
  width: 100%;
  height: 42px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid rgba(20, 143, 123, 0.35);
  border-radius: 12px;
  color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.08);
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 0;
  overflow-y: auto;
}
.history-item {
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
}
.history-item.active {
  border-color: rgba(20, 143, 123, 0.35);
  background: rgba(20, 143, 123, 0.09);
}
.history-open {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 11px 6px 11px 12px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.history-open strong,
.history-open span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-open strong {
  font-size: 13px;
}
.history-open span {
  margin-top: 3px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
}
.history-open time {
  margin-top: 5px;
  color: var(--cpu-text-muted);
  font-size: 10px;
}
.history-delete {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  margin-right: 6px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  color: var(--cpu-text-muted);
  background: transparent;
  cursor: pointer;
}
.history-delete:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.09);
}
.history-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.history-empty .el-icon {
  font-size: 32px;
}

@media (max-width: 640px) {
  .assistant-page {
    gap: 0;
    margin: 0;
    overflow: hidden;
  }
  .assistant-shell {
    height: 100%;
    min-height: 0;
    padding: 4px 2px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .assistant-head {
    gap: 9px;
    flex: 0 0 auto;
    padding: 0 2px 8px;
  }
  .assistant-mark {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    box-shadow: 0 5px 13px rgba(22, 135, 118, 0.18);
    font-size: 16px;
  }
  .assistant-head h1 {
    font-size: 17px;
  }
  .assistant-head p {
    display: none;
  }
  .assistant-welcome {
    padding: 30px 4px 18px;
  }
  .assistant-welcome strong {
    font-size: 20px;
  }
  .assistant-welcome > span {
    max-width: 310px;
  }
  .conversation {
    min-height: 0;
    max-height: none;
    gap: 20px;
    padding: 12px 2px 14px;
    scrollbar-gutter: auto;
  }
  .message {
    max-width: 88%;
  }
  .message--assistant {
    width: 100%;
    max-width: 100%;
  }
  .message-label {
    display: none;
  }
  .message-bubble {
    padding: 10px 13px;
  }
  .message--assistant .message-bubble {
    padding: 0 2px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .message-bubble p {
    font-size: 15px;
    line-height: 1.7;
  }
  .message--user .message-bubble {
    border-radius: 15px 15px 4px 15px;
  }
  .action-list {
    margin-top: 12px;
  }
  .action-card {
    padding: 10px 11px;
    border-radius: 12px;
    box-shadow: 0 3px 12px rgba(20, 48, 43, 0.04);
  }
  .action-icon {
    font-size: 19px;
  }
  .action-copy strong {
    font-size: 14px;
  }
  .suggestions {
    flex-wrap: nowrap;
    margin: 12px -4px 0;
    padding: 0 4px 3px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .suggestions::-webkit-scrollbar {
    display: none;
  }
  .suggestions button {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .assistant-form {
    gap: 8px;
    flex: 0 0 auto;
    padding: 9px 2px 2px;
    border-top-color: var(--cpu-border-soft);
    background: var(--cpu-bg);
  }
  .assistant-form :deep(.el-textarea__inner) {
    min-height: 46px !important;
    padding: 12px 14px;
    border-radius: 16px;
  }
  .composer-send {
    width: 46px;
    height: 46px;
    padding: 0;
    border-radius: 15px;
    font-size: 19px;
  }
  .composer-send span {
    display: none;
  }
  .related-results {
    display: none;
  }
}
</style>
