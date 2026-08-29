<template>
  <div class="assistant-page" :class="{ 'assistant-page--embedded': embedded }">
    <section
      class="assistant-shell cpu-card"
      :class="{ 'is-composer-focused': composerFocused }"
    >
      <div class="assistant-head">
        <span class="assistant-mark">
          <el-icon v-if="embedded"><ChatDotRound /></el-icon>
          <template v-else>拾</template>
        </span>
        <div class="assistant-head-copy">
          <h1>拾间AI</h1>
          <p>问功能、找入口，也可以直接聊天</p>
        </div>
        <div class="assistant-head-actions">
          <button type="button" aria-label="查看历史对话" :disabled="!auth.isLoggedIn" @click="historyOpen = true">
            <el-icon><Clock /></el-icon>
          </button>
          <button type="button" aria-label="新建对话" :disabled="!messages.length" @click="startNewConversation">
            <el-icon><Plus /></el-icon>
          </button>
          <button v-if="embedded" type="button" aria-label="在完整页面打开拾间AI" @click="openFullPage">
            <el-icon><FullScreen /></el-icon>
          </button>
          <button v-if="embedded" type="button" aria-label="关闭拾间AI" @click="emit('close')">
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </div>

      <div v-if="!auth.isLoggedIn" class="assistant-auth-gate">
        <span class="auth-gate-icon"><el-icon><Lock /></el-icon></span>
        <strong>登录后使用拾间 AI</strong>
        <p>登录后即可开始对话；历史记录和每日额度会跟随账号同步。</p>
        <el-button type="primary" round @click="goLogin">登录并继续</el-button>
      </div>

      <div v-else-if="!messages.length" class="assistant-welcome">
        <strong>想做什么？直接告诉我。</strong>
        <span>可以询问站内功能、校园服务和操作步骤，也可以直接聊天。</span>
        <small>
          拾间AI不会读取你的课表、成绩或其他个人数据；涉及本人数据时会引导你进入对应页面自行查看。
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">查看隐私说明</a>
        </small>
        <div class="welcome-prompts">
          <button v-for="prompt in welcomePrompts" :key="prompt" type="button" @click="sendPrompt(prompt)">
            {{ prompt }}
          </button>
        </div>
      </div>

      <div
        v-else
        ref="conversationRef"
        class="conversation"
        aria-live="polite"
        @scroll.passive="handleConversationScroll"
      >
        <article
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="`message--${message.role}`"
        >
          <div class="message-label">{{ message.role === "user" ? "你" : "拾间AI" }}</div>
          <div class="message-bubble">
            <template v-if="message.content">
              <p v-if="message.role === 'user'" class="user-message-content">
                {{ message.content }}
              </p>
              <div
                v-else
                class="message-markdown"
                :class="{ 'is-streaming': message.streaming }"
                v-html="renderAssistantMarkdown(message.content)"
              ></div>
            </template>
            <div v-if="message.role === 'assistant' && message.images?.length" class="generated-images">
              <button
                v-for="(image, index) in message.images"
                :key="image.url"
                type="button"
                :aria-label="`查看图片 ${index + 1}`"
                @click="openGeneratedImages(message.images || [], index)"
              >
                <img :src="image.url" :alt="image.alt" loading="lazy" />
              </button>
            </div>
            <div v-if="message.role === 'assistant' && message.sources?.length" class="assistant-sources">
              <span>参考来源</span>
              <a
                v-for="source in message.sources"
                :key="source.url"
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer nofollow"
              >{{ source.title }}</a>
            </div>
            <div v-if="!message.content && message.streaming" class="assistant-thinking" aria-label="拾间AI正在回答">
              <i></i><i></i><i></i>
              <span>{{ message.streamStatus || "正在生成回答…" }}</span>
            </div>
            <div v-if="message.streaming && message.content" class="assistant-stream-status">
              <i></i>{{ message.streamStatus || "正在生成回答…" }}
            </div>
            <div v-if="message.actions?.length" class="action-list">
              <button
                v-for="action in message.actions"
                :key="action.id"
                type="button"
                class="action-card"
                @click="open(action)"
              >
                <span class="action-icon"><AppIcon :legacy="action.icon" name="link" /></span>
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

      <div v-if="auth.isLoggedIn && assistantError && !assistantLoading" class="assistant-error">
        <span>{{ assistantError }}</span>
        <el-button text type="primary" @click="retryAssistant">重试</el-button>
      </div>

      <div v-if="auth.isLoggedIn" class="assistant-form" @pointerdown.capture="captureConversationAnchor">
        <el-input
          v-model="keywordInput"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          resize="none"
          maxlength="500"
          :placeholder="assistantQuotaExhausted ? '今日额度和点数都已用完' : '给拾间AI发消息'"
          @keydown="handleComposerKeydown"
          @focus="handleComposerFocus"
          @blur="handleComposerBlur"
        />
        <button
          type="button"
          class="composer-send"
          :aria-label="assistantLoading ? '正在回答' : '发送'"
          :disabled="!keywordInput.trim() || assistantLoading || assistantQuotaExhausted"
          @click="submitSearch"
        >
          <el-icon v-if="assistantLoading" class="is-loading"><Loading /></el-icon>
          <el-icon v-else><Promotion /></el-icon>
          <span>发送</span>
        </button>
      </div>
      <p v-if="auth.isLoggedIn" class="assistant-disclaimer">
        内容由 AI 生成，请注意甄别<span v-if="assistantQuota"> · Lv.{{ assistantQuota.level }} · 今日 {{ assistantQuota.remaining }}/{{ assistantQuota.dailyQuota }} · 点数 {{ assistantQuota.points }}</span>
      </p>
    </section>

    <transition name="embedded-history">
      <aside
        v-if="embedded && historyOpen"
        class="embedded-history-panel"
        role="dialog"
        aria-label="历史对话"
      >
        <div class="embedded-history-head">
          <strong>历史对话</strong>
          <button type="button" aria-label="关闭历史对话" @click="historyOpen = false">
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <div class="history-caption">{{ historyCaption }}</div>
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
      </aside>
    </transition>

    <el-drawer
      v-if="!embedded"
      v-model="historyOpen"
      class="assistant-history-drawer"
      direction="ltr"
      size="min(86vw, 360px)"
      title="历史对话"
      append-to-body
    >
      <div class="history-caption">{{ historyCaption }}</div>
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

  </div>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ChatDotRound,
  Clock,
  Close,
  Delete,
  FullScreen,
  Loading,
  Lock,
  Plus,
  Promotion,
  Right,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import {
  searchApi,
  type CampusAssistantAction,
  type CampusAssistantConversation,
  type CampusAssistantGeneratedImage,
  type CampusAssistantMessage,
  type CampusAssistantQuota,
  type CampusAssistantSource,
} from "@/api/search";
import { useAuthStore } from "@/stores/auth";
import { mergeAssistantHistorySessions } from "@/utils/assistantHistorySync";
import { openImageGallery } from "@/utils/imageViewer";
import { renderMarkdown } from "@/utils/markdown";
import { normalizeAiTextControlEscapes } from "@/utils/markdownNormalize";

const { embedded = false } = defineProps<{
  embedded?: boolean;
}>();
const emit = defineEmits<{
  close: [];
}>();

type ConversationMessage = CampusAssistantMessage & {
  id: number;
  actions?: CampusAssistantAction[];
  suggestions?: string[];
  images?: CampusAssistantGeneratedImage[];
  sources?: CampusAssistantSource[];
  streaming?: boolean;
  streamStatus?: string;
};

type ConversationSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ConversationMessage[];
};

const HISTORY_KEY = "campus-assistant-history:v1";
const ACTIVE_HISTORY_KEY = "campus-assistant-active:v1";
const DELETED_HISTORY_KEY = "campus-assistant-deleted:v1";
const LEGACY_HISTORY_OWNER_KEY = "campus-assistant-history-owner:v1";
const NEW_SESSION_SENTINEL = "__new__";
const MAX_SESSIONS = 20;
const MAX_MESSAGES_PER_SESSION = 60;
const MAX_LOCAL_TOMBSTONES = 500;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const q = ref(embedded ? "" : ((route.query.q as string) ?? ""));
const keywordInput = ref("");
const assistantLoading = ref(false);
const assistantError = ref("");
const assistantQuota = ref<CampusAssistantQuota | null>(null);
const historyOpen = ref(false);
const cloudSyncState = ref<"local" | "syncing" | "ready" | "error">(
  auth.isLoggedIn ? "syncing" : "local",
);
const conversationRef = ref<HTMLElement | null>(null);
const sessions = ref<ConversationSession[]>(loadSessions());
const restoredSession = restoreActiveSession(sessions.value);
const activeSessionId = ref(restoredSession?.id || "");
const messages = ref<ConversationMessage[]>(cloneMessages(restoredSession?.messages || []));
let assistantSeq = 0;
let messageSeq = messages.value.reduce((max, item) => Math.max(max, item.id), 0);
let assistantController: AbortController | null = null;
let scrollFrame = 0;
let cloudSyncTimer = 0;
let pendingCloudSession: ConversationSession | null = null;
let firstRouteSync = true;
let conversationAnchorScrollTop: number | null = null;
let conversationAnchorBottomGap: number | null = null;
let conversationAnchorLockUntil = 0;
let conversationAnchorFrame = 0;
let conversationAnchorReleaseTimer = 0;
const composerFocused = ref(false);
let conversationAnchorRestoring = false;
const conversationAnchorTimers: number[] = [];
const CONVERSATION_BOTTOM_ANCHOR_THRESHOLD = 36;

const welcomePrompts = ["宿舍电费在哪里查？", "怎么打开药苑之声？", "AI 额度怎么计算？"];
const assistantQuotaExhausted = computed(() => (
  assistantQuota.value !== null && assistantQuota.value.totalRemaining <= 0
));
const historyCaption = computed(() => {
  if (!auth.isLoggedIn) return "记录保存在当前设备；登录后可同步到账号，最多保留 20 个对话。";
  if (cloudSyncState.value === "syncing") return "正在同步当前账号的历史对话…";
  if (cloudSyncState.value === "error") return "云同步暂时不可用，本机记录已保留。";
  return "已与当前账号同步，最多保留 20 个对话。";
});

onMounted(() => {
  if (auth.isLoggedIn) {
    void hydrateCloudSessions();
    void loadAssistantQuota();
  }
  window.visualViewport?.addEventListener("resize", handleComposerViewportChange);
});

watch(() => auth.isLoggedIn, (loggedIn) => {
  if (!loggedIn) {
    assistantQuota.value = null;
    historyOpen.value = false;
    cancelActiveAssistant();
    return;
  }
  void hydrateCloudSessions();
  void loadAssistantQuota();
});

watch(() => route.query.q, async (value) => {
  if (embedded) return;
  const keyword = String(value ?? "").trim();
  q.value = keyword;
  keywordInput.value = "";
  const isRestoredQuery = firstRouteSync
    && keyword
    && [...messages.value].reverse().find((item) => item.role === "user")?.content === keyword;
  firstRouteSync = false;
  if (!keyword) {
    scrollConversation();
    return;
  }
  if (isRestoredQuery) {
    scrollConversation();
    return;
  }
  await runQuery(keyword);
}, { immediate: true });

async function submitSearch() {
  if (!auth.isLoggedIn) {
    await goLogin();
    return;
  }
  if (assistantQuotaExhausted.value) {
    ElMessage.warning("今天的拾间 AI 额度和点数都已用完，日额度会在明天 00:00 自动恢复");
    return;
  }
  const keyword = keywordInput.value.trim();
  if (!keyword || assistantLoading.value) return;
  keywordInput.value = "";
  if (embedded) {
    q.value = keyword;
    await runQuery(keyword);
    return;
  }
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

async function openFullPage() {
  await router.push({ name: "search" });
  emit("close");
}

async function runQuery(keyword: string) {
  if (!auth.isLoggedIn) return;
  const history = messages.value
    .slice(-MAX_MESSAGES_PER_SESSION)
    .map(({ role, content }) => ({ role, content }));
  ensureActiveConversation(keyword);
  messages.value.push({ id: ++messageSeq, role: "user", content: keyword });
  persistActiveConversation();
  scrollConversation();
  await askAssistant(keyword, history);
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
    streamStatus: "正在连接 AI 服务…",
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
        assistantMessage.streamStatus = "正在生成回答…";
        scrollConversation();
      },
      onHeartbeat: (elapsedMs) => {
        if (seq !== assistantSeq) return;
        const seconds = Math.floor(elapsedMs / 1000);
        assistantMessage.streamStatus = seconds >= 5
          ? `仍在生成，已等待 ${seconds} 秒…`
          : "正在生成回答…";
        scrollConversation();
      },
    });
    if (seq !== assistantSeq) return;
    assistantMessage.content = normalizeAiTextControlEscapes(next.answer);
    assistantMessage.actions = next.actions;
    assistantMessage.suggestions = next.suggestions;
    assistantMessage.images = normalizeGeneratedImages(next.images);
    assistantMessage.sources = normalizeAssistantSources(next.sources);
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
      void loadAssistantQuota();
    }
  }
}

async function loadAssistantQuota() {
  if (!auth.isLoggedIn) {
    assistantQuota.value = null;
    return;
  }
  try {
    assistantQuota.value = await searchApi.assistantQuota({
      suppressErrorMessage: true,
      suppressAuthMessage: true,
      suppressAuthRedirect: true,
    });
  } catch {
    assistantQuota.value = null;
  }
}

async function goLogin() {
  const redirect = embedded ? "/search" : route.fullPath;
  await router.push({ name: "login", query: { redirect } });
  if (embedded) emit("close");
}

async function retryAssistant() {
  if (assistantQuotaExhausted.value) {
    ElMessage.warning("今天的拾间 AI 额度和点数都已用完，日额度会在明天 00:00 自动恢复");
    return;
  }
  const keyword = [...messages.value].reverse().find((item) => item.role === "user")?.content.trim() || q.value.trim();
  if (!keyword || assistantLoading.value) return;
  const history = messages.value
    .filter((item, index) => !(index === messages.value.length - 1 && item.role === "user"))
    .slice(-12)
    .map(({ role, content }) => ({ role, content }));
  await askAssistant(keyword, history);
}

function handleComposerKeydown(event: Event | KeyboardEvent) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void submitSearch();
}

function captureConversationAnchor() {
  if (!isMobileComposerViewport()) return;
  const element = conversationRef.value;
  if (!element) return;
  rememberConversationAnchor(element);
}

function handleComposerFocus() {
  if (!isMobileComposerViewport()) return;
  if (conversationAnchorScrollTop === null) captureConversationAnchor();
  composerFocused.value = true;
  conversationAnchorLockUntil = performance.now() + 520;
  window.clearTimeout(conversationAnchorReleaseTimer);
  scheduleConversationAnchorRestore();
}

function handleComposerBlur() {
  if (!composerFocused.value) return;
  conversationAnchorLockUntil = performance.now() + 420;
  scheduleConversationAnchorRestore();
  window.clearTimeout(conversationAnchorReleaseTimer);
  conversationAnchorReleaseTimer = window.setTimeout(() => {
    releaseConversationAnchor();
  }, 460);
}

function handleComposerViewportChange() {
  if (!composerFocused.value || conversationAnchorScrollTop === null) return;
  scheduleConversationAnchorRestore();
}

function handleConversationScroll() {
  if (
    !composerFocused.value
    || conversationAnchorRestoring
    || performance.now() < conversationAnchorLockUntil
  ) return;
  const element = conversationRef.value;
  if (element) rememberConversationAnchor(element);
}

function rememberConversationAnchor(element: HTMLElement) {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const scrollTop = Math.max(0, Math.min(element.scrollTop, maxScrollTop));
  const bottomGap = Math.max(0, maxScrollTop - scrollTop);
  conversationAnchorScrollTop = scrollTop;
  conversationAnchorBottomGap = bottomGap <= CONVERSATION_BOTTOM_ANCHOR_THRESHOLD
    ? bottomGap
    : null;
}

function scheduleConversationAnchorRestore() {
  clearConversationAnchorTimers();
  for (const delay of [0, 90, 220, 380]) {
    conversationAnchorTimers.push(window.setTimeout(restoreConversationAnchor, delay));
  }
}

function restoreConversationAnchor() {
  if (conversationAnchorScrollTop === null) return;
  if (conversationAnchorFrame) cancelAnimationFrame(conversationAnchorFrame);
  conversationAnchorFrame = requestAnimationFrame(() => {
    conversationAnchorFrame = 0;
    void nextTick(() => {
      const element = conversationRef.value;
      if (!element || conversationAnchorScrollTop === null) return;
      conversationAnchorRestoring = true;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const targetScrollTop = conversationAnchorBottomGap === null
        ? Math.min(conversationAnchorScrollTop, maxScrollTop)
        : Math.max(0, maxScrollTop - conversationAnchorBottomGap);
      element.scrollTop = targetScrollTop;
      if (conversationAnchorBottomGap !== null) {
        conversationAnchorScrollTop = targetScrollTop;
      }
      requestAnimationFrame(() => {
        conversationAnchorRestoring = false;
      });
    });
  });
}

function releaseConversationAnchor() {
  composerFocused.value = false;
  conversationAnchorScrollTop = null;
  conversationAnchorBottomGap = null;
  conversationAnchorLockUntil = 0;
  conversationAnchorRestoring = false;
  window.clearTimeout(conversationAnchorReleaseTimer);
  conversationAnchorReleaseTimer = 0;
  clearConversationAnchorTimers();
  if (conversationAnchorFrame) cancelAnimationFrame(conversationAnchorFrame);
  conversationAnchorFrame = 0;
}

function clearConversationAnchorTimers() {
  while (conversationAnchorTimers.length) {
    window.clearTimeout(conversationAnchorTimers.pop());
  }
}

function isMobileComposerViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

async function startNewConversation() {
  cancelActiveAssistant();
  messages.value = [];
  activeSessionId.value = "";
  assistantError.value = "";
  q.value = "";
  historyOpen.value = false;
  markNewSession();
  if (!embedded && route.query.q) await router.replace({ name: "search" });
}

async function openConversation(sessionId: string) {
  const session = sessions.value.find((item) => item.id === sessionId);
  if (!session) return;
  cancelActiveAssistant();
  activeSessionId.value = session.id;
  messages.value = cloneMessages(session.messages);
  messageSeq = messages.value.reduce((max, item) => Math.max(max, item.id), messageSeq);
  assistantError.value = "";
  q.value = "";
  historyOpen.value = false;
  rememberActiveSession(session.id);
  scrollConversation();
  if (!embedded && route.query.q) await router.replace({ name: "search" });
}

async function deleteConversation(sessionId: string) {
  recordConversationDeletion(sessionId);
  if (pendingCloudSession?.id === sessionId) {
    pendingCloudSession = null;
    window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = 0;
  }
  sessions.value = sessions.value.filter((item) => item.id !== sessionId);
  writeSessions();
  if (activeSessionId.value === sessionId) await startNewConversation();
  if (auth.isLoggedIn) {
    void syncConversationDeletion(sessionId).catch(() => {});
  }
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
  queueCloudSync(session);
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
      if (!element) return;
      const lastMessage = element.querySelector<HTMLElement>(".message:last-of-type");
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const lastMessageScrollTop = lastMessage
        ? Math.max(0, lastMessage.offsetTop + lastMessage.offsetHeight - element.clientHeight + 12)
        : element.scrollHeight;
      element.scrollTop = composerFocused.value && conversationAnchorBottomGap !== null
        ? Math.max(0, maxScrollTop - conversationAnchorBottomGap)
        : lastMessageScrollTop;
      if (composerFocused.value) {
        rememberConversationAnchor(element);
      }
    });
  });
}

function loadSessions(): ConversationSession[] {
  try {
    migrateLegacyHistoryForCurrentUser();
    const deletedIds = new Set(Object.keys(readConversationDeletions()));
    const parsed = JSON.parse(localStorage.getItem(currentHistoryKey()) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && Array.isArray(item.messages))
      .filter((item) => !deletedIds.has(item.id))
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
  try { activeId = localStorage.getItem(currentActiveHistoryKey()) || ""; } catch { /* ignore */ }
  if (activeId === NEW_SESSION_SENTINEL) return null;
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
      content: (item.role === "assistant" ? normalizeAiTextControlEscapes(item.content) : item.content).slice(0, 4000),
      actions: Array.isArray(item.actions) ? item.actions.slice(0, 3).map((action) => ({ ...action })) : undefined,
      suggestions: Array.isArray(item.suggestions) ? item.suggestions.slice(0, 3).map(String) : undefined,
      images: normalizeGeneratedImages(item.images),
      sources: normalizeAssistantSources(item.sources),
    }));
}

function renderAssistantMarkdown(content: string) {
  return renderMarkdown(normalizeAiTextControlEscapes(content));
}

function normalizeGeneratedImages(value: unknown): CampusAssistantGeneratedImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value
    .filter((item): item is CampusAssistantGeneratedImage => (
      Boolean(item)
      && typeof item.url === "string"
      && /^\/uploads\/assistant-generated\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg)$/u.test(item.url)
      && typeof item.alt === "string"
    ))
    .slice(0, 1)
    .map((item) => ({
      url: item.url,
      alt: item.alt.trim().slice(0, 200) || "拾间AI生成的图片",
    }));
  return images.length ? images : undefined;
}

function openGeneratedImages(images: CampusAssistantGeneratedImage[], index: number) {
  openImageGallery(images.map((image, imageIndex) => ({
    src: image.url,
    title: image.alt || `拾间AI生成图片 ${imageIndex + 1}`,
    alt: image.alt,
  })), index, { className: "cpu-ai-image-viewer" });
}

function normalizeAssistantSources(value: unknown): CampusAssistantSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const sources = value
    .filter((item): item is CampusAssistantSource => Boolean(
      item
      && typeof item.url === "string"
      && /^https?:\/\/[^\s<>"']+$/iu.test(item.url)
      && typeof item.title === "string",
    ))
    .map((item) => ({
      url: item.url.trim().slice(0, 500),
      title: item.title.trim().slice(0, 120) || "网页来源",
    }))
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, 5);
  return sources.length ? sources : undefined;
}

function writeSessions() {
  try { localStorage.setItem(currentHistoryKey(), JSON.stringify(sessions.value)); } catch { /* ignore */ }
}

function rememberActiveSession(sessionId: string) {
  try { localStorage.setItem(currentActiveHistoryKey(), sessionId); } catch { /* ignore */ }
}

function markNewSession() {
  try { localStorage.setItem(currentActiveHistoryKey(), NEW_SESSION_SENTINEL); } catch { /* ignore */ }
}

async function hydrateCloudSessions() {
  cloudSyncState.value = "syncing";
  try {
    const cloudSessions = await searchApi.listAssistantConversations({
      suppressErrorMessage: true,
    });

    for (const item of cloudSessions) {
      if (item.deletedAt) recordConversationDeletion(item.id, item.deletedAt);
    }
    const deletedIds = new Set(Object.keys(readConversationDeletions()));
    // Re-read current state after the request. A conversation may have been
    // deleted while the cloud list was in flight, so the pre-request snapshot
    // must never be merged back in.
    const localSessions = sessions.value
      .filter((item) => !deletedIds.has(item.id))
      .map(toCloudConversation);
    const liveCloudSessions = cloudSessions
      .filter((item) => !item.deletedAt && !deletedIds.has(item.id))
      .map(normalizeConversationSession)
      .filter((item): item is ConversationSession => Boolean(item));
    sessions.value = mergeAssistantHistorySessions(
      localSessions.map(normalizeConversationSession).filter((item): item is ConversationSession => Boolean(item)),
      liveCloudSessions,
      deletedIds,
      MAX_SESSIONS,
    );
    writeSessions();

    const activeMarker = readActiveSessionMarker();
    if (!messages.value.length && activeMarker !== NEW_SESSION_SENTINEL) {
      const restored = restoreActiveSession(sessions.value);
      if (restored) {
        activeSessionId.value = restored.id;
        messages.value = cloneMessages(restored.messages);
        messageSeq = messages.value.reduce((max, item) => Math.max(max, item.id), messageSeq);
        rememberActiveSession(restored.id);
        scrollConversation();
      }
    }

    const cloudMap = new Map(
      cloudSessions
        .filter((item) => !item.deletedAt)
        .map((item) => [item.id, item.updatedAt]),
    );
    for (const local of localSessions) {
      if ((cloudMap.get(local.id) ?? -1) >= local.updatedAt) continue;
      const saved = await searchApi.saveAssistantConversation(local, {
        suppressErrorMessage: true,
      });
      applyCloudSaveResult(saved);
    }
    const staleCloudIds = cloudSessions
      .filter((item) => !item.deletedAt && deletedIds.has(item.id))
      .map((item) => item.id);
    if (staleCloudIds.length) {
      await Promise.allSettled(staleCloudIds.map((id) => syncConversationDeletion(id)));
    }
    cloudSyncState.value = "ready";
  } catch {
    cloudSyncState.value = "error";
  }
}

function queueCloudSync(session: ConversationSession) {
  if (!auth.isLoggedIn || !session.messages.length || isConversationDeleted(session.id)) return;
  pendingCloudSession = normalizeConversationSession(toCloudConversation(session));
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    cloudSyncTimer = 0;
    void flushCloudSync();
  }, 240);
}

async function flushCloudSync() {
  if (!auth.isLoggedIn || !pendingCloudSession) return;
  const pending = pendingCloudSession;
  pendingCloudSession = null;
  if (isConversationDeleted(pending.id)) return;
  try {
    const saved = await searchApi.saveAssistantConversation(toCloudConversation(pending), {
      suppressErrorMessage: true,
    });
    applyCloudSaveResult(saved);
    cloudSyncState.value = "ready";
  } catch {
    cloudSyncState.value = "error";
  }
}

function toCloudConversation(session: ConversationSession): CampusAssistantConversation {
  return {
    id: session.id,
    title: session.title.slice(0, 80) || "历史对话",
    updatedAt: session.updatedAt,
    messages: cloneMessages(session.messages)
      .filter((item) => item.content.trim())
      .slice(-MAX_MESSAGES_PER_SESSION)
      .map(({ streaming: _streaming, ...item }) => item),
  };
}

function normalizeConversationSession(input: CampusAssistantConversation): ConversationSession | null {
  if (!input || input.deletedAt || typeof input.id !== "string" || !Array.isArray(input.messages)) return null;
  const normalizedMessages = cloneMessages(input.messages);
  if (!normalizedMessages.length) return null;
  return {
    id: input.id,
    title: String(input.title || "").slice(0, 80) || "历史对话",
    updatedAt: Number(input.updatedAt) || Date.now(),
    messages: normalizedMessages,
  };
}

function readActiveSessionMarker() {
  try { return localStorage.getItem(currentActiveHistoryKey()) || ""; } catch { return ""; }
}

function currentHistoryKey() {
  return auth.user?.id ? `${HISTORY_KEY}:user:${auth.user.id}` : HISTORY_KEY;
}

function currentActiveHistoryKey() {
  return auth.user?.id ? `${ACTIVE_HISTORY_KEY}:user:${auth.user.id}` : ACTIVE_HISTORY_KEY;
}

function currentDeletedHistoryKey() {
  return auth.user?.id ? `${DELETED_HISTORY_KEY}:user:${auth.user.id}` : DELETED_HISTORY_KEY;
}

function readConversationDeletions(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(currentDeletedHistoryKey()) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([id, timestamp]) => id && Number.isFinite(Number(timestamp)))
        .map(([id, timestamp]) => [id, Number(timestamp)]),
    );
  } catch {
    return {};
  }
}

function recordConversationDeletion(sessionId: string, deletedAt = Date.now()) {
  const current = readConversationDeletions();
  current[sessionId] = Math.max(current[sessionId] || 0, deletedAt);
  const entries = Object.entries(current)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LOCAL_TOMBSTONES);
  try {
    localStorage.setItem(currentDeletedHistoryKey(), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A failed persistence write must not block the optimistic local removal.
  }
}

function isConversationDeleted(sessionId: string) {
  return Boolean(readConversationDeletions()[sessionId]);
}

async function syncConversationDeletion(sessionId: string) {
  try {
    const result = await searchApi.deleteAssistantConversation(sessionId, {
      suppressErrorMessage: true,
    });
    recordConversationDeletion(sessionId, result.deletedAt || Date.now());
    cloudSyncState.value = "ready";
  } catch {
    cloudSyncState.value = "error";
    throw new Error("history deletion sync failed");
  }
}

function applyCloudSaveResult(saved: CampusAssistantConversation) {
  if (!saved.deletedAt) return;
  recordConversationDeletion(saved.id, saved.deletedAt);
  sessions.value = sessions.value.filter((item) => item.id !== saved.id);
  writeSessions();
  if (activeSessionId.value === saved.id) void startNewConversation();
}

function migrateLegacyHistoryForCurrentUser() {
  const userId = auth.user?.id;
  if (!userId) return;
  const scopedHistoryKey = currentHistoryKey();
  if (localStorage.getItem(scopedHistoryKey)) return;
  const owner = localStorage.getItem(LEGACY_HISTORY_OWNER_KEY);
  if (owner && owner !== String(userId)) return;
  const legacyHistory = localStorage.getItem(HISTORY_KEY);
  if (!legacyHistory) return;
  localStorage.setItem(scopedHistoryKey, legacyHistory);
  const legacyActive = localStorage.getItem(ACTIVE_HISTORY_KEY);
  if (legacyActive) localStorage.setItem(currentActiveHistoryKey(), legacyActive);
  localStorage.setItem(LEGACY_HISTORY_OWNER_KEY, String(userId));
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

onBeforeUnmount(() => {
  cancelActiveAssistant();
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  releaseConversationAnchor();
  window.visualViewport?.removeEventListener("resize", handleComposerViewportChange);
  window.clearTimeout(cloudSyncTimer);
  if (pendingCloudSession) void flushCloudSync();
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
  transform: none;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}
.assistant-shell:hover {
  transform: none;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
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
.assistant-welcome > small {
  max-width: 680px;
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.65;
}
.assistant-welcome > small a {
  color: var(--cpu-primary);
  text-decoration: none;
}
.assistant-auth-gate {
  display: flex;
  flex: 1;
  min-height: 300px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  padding: 32px 20px;
  text-align: center;
}
.assistant-auth-gate .auth-gate-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 16px;
  color: var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 10%, var(--cpu-card));
  font-size: 22px;
}
.assistant-auth-gate strong {
  color: var(--cpu-text);
  font-size: 20px;
}
.assistant-auth-gate p {
  max-width: 360px;
  margin: 0 0 6px;
  color: var(--cpu-text-secondary);
  line-height: 1.65;
  font-size: 13px;
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
  align-self: stretch;
  width: 100%;
  max-width: 100%;
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
.message--user .message-label {
  display: none;
}
.message--user .message-bubble {
  min-width: 0;
  padding: 2px 0;
  border: 0;
  border-radius: 0;
  color: var(--cpu-primary);
  background: transparent;
  box-shadow: none;
  text-align: right;
}
.message--user .message-bubble p {
  font-weight: 700;
}
.message--assistant .message-bubble {
  min-width: 0;
  padding: 0 2px;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.message-bubble p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
  font-size: 14px;
}
.message-markdown {
  max-width: 100%;
  overflow-x: auto;
  overflow-wrap: anywhere;
  line-height: 1.7;
  font-size: 14px;
}
.message-markdown :deep(> :first-child) {
  margin-top: 0;
}
.message-markdown :deep(> :last-child) {
  margin-bottom: 0;
}
.generated-images {
  display: grid;
  width: min(100%, 640px);
  margin-top: 12px;
}
.generated-images button {
  display: block;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface-subtle);
  cursor: zoom-in;
}
.generated-images img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 720px;
  object-fit: contain;
}
.assistant-sources {
  display: flex;
  max-width: 720px;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
}
.assistant-sources > span {
  color: var(--cpu-text-muted);
}
.assistant-sources a {
  max-width: min(100%, 280px);
  overflow: hidden;
  padding: 4px 8px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  color: var(--cpu-primary);
  background: var(--cpu-surface-subtle);
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assistant-sources a:hover {
  border-color: var(--cpu-primary);
}
.message-markdown :deep(p) {
  margin: 0.65em 0;
  white-space: normal;
}
.message-markdown :deep(h1),
.message-markdown :deep(h2),
.message-markdown :deep(h3),
.message-markdown :deep(h4) {
  margin: 1em 0 0.45em;
  line-height: 1.35;
}
.message-markdown :deep(h1) { font-size: 1.35em; }
.message-markdown :deep(h2) { font-size: 1.22em; }
.message-markdown :deep(h3) { font-size: 1.1em; }
.message-markdown :deep(ul),
.message-markdown :deep(ol) {
  margin: 0.65em 0;
  padding-left: 1.5em;
}
.message-markdown :deep(li + li) {
  margin-top: 0.3em;
}
.message-markdown :deep(blockquote) {
  margin: 0.75em 0;
  padding: 0.2em 0 0.2em 0.85em;
  border-left: 3px solid var(--cpu-primary);
  color: var(--cpu-text-secondary);
}
.message-markdown :deep(a) {
  color: var(--cpu-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.message-markdown :deep(code) {
  padding: 0.12em 0.35em;
  border-radius: 5px;
  background: var(--cpu-surface);
  font-family: var(--cpu-font-mono);
  font-size: 0.92em;
}
.message-markdown :deep(pre) {
  max-width: 100%;
  margin: 0.75em 0;
  overflow-x: auto;
  padding: 11px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 9px;
  background: var(--cpu-surface);
}
.message-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
  white-space: pre;
}
.message-markdown :deep(table) {
  width: 100%;
  margin: 0.75em 0;
  border-collapse: collapse;
}
.message-markdown :deep(th),
.message-markdown :deep(td) {
  padding: 6px 8px;
  border: 1px solid var(--cpu-border-soft);
  text-align: left;
}
.message-markdown :deep(.katex-display) {
  max-width: 100%;
  margin: 0.85em 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.25em 0;
  color: var(--cpu-text);
  text-align: left;
}
.message-markdown :deep(.katex-display > .katex) {
  text-align: left;
}
.message-markdown :deep(.katex) {
  color: inherit;
  font-size: 1.02em;
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
  align-items: center;
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
.assistant-thinking span {
  margin-left: 5px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.assistant-stream-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  color: var(--cpu-text-muted);
  font-size: 11px;
}
.assistant-stream-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--cpu-primary);
  animation: thinking 1s infinite ease-in-out;
}
.message-markdown.is-streaming :deep(> p:last-child)::after,
.message-markdown.is-streaming :deep(> h1:last-child)::after,
.message-markdown.is-streaming :deep(> h2:last-child)::after,
.message-markdown.is-streaming :deep(> h3:last-child)::after,
.message-markdown.is-streaming :deep(> h4:last-child)::after,
.message-markdown.is-streaming :deep(> blockquote:last-child)::after,
.message-markdown.is-streaming :deep(> ul:last-child > li:last-child)::after,
.message-markdown.is-streaming :deep(> ol:last-child > li:last-child)::after {
  content: "";
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
.assistant-disclaimer {
  margin: -8px 0 0;
  color: var(--cpu-text-muted);
  text-align: center;
  font-size: 11px;
  line-height: 1.4;
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

.assistant-page--embedded {
  position: relative;
  max-width: none;
  overflow: hidden;
}
.assistant-page--embedded .assistant-shell {
  height: 100%;
  min-height: 0;
  gap: 12px;
  padding: 18px 16px 13px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.assistant-page--embedded .assistant-head {
  padding-bottom: 13px;
  border-bottom: 1px solid color-mix(in srgb, var(--cpu-primary) 20%, var(--cpu-border-soft));
}
.assistant-page--embedded .assistant-mark {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(145deg, var(--cpu-primary), var(--cpu-primary-dark));
  box-shadow: 0 7px 18px color-mix(in srgb, var(--cpu-primary-dark) 25%, transparent);
}
.assistant-page--embedded .assistant-mark .el-icon {
  font-size: 19px;
}
.assistant-page--embedded .assistant-head h1 {
  color: var(--cpu-text);
  font-size: 18px;
}
.assistant-page--embedded .assistant-head p {
  margin-top: 1px;
  font-size: 11px;
}
.assistant-page--embedded .assistant-welcome {
  padding: 24px 4px 14px;
}
.assistant-page--embedded .assistant-welcome strong {
  font-size: 18px;
}
.assistant-page--embedded .conversation {
  min-height: 0;
  max-height: none;
  padding-right: 3px;
  scrollbar-gutter: auto;
}
.assistant-page--embedded .message {
  max-width: 100%;
}
.assistant-page--embedded .message-label {
  display: none;
}
.assistant-page--embedded .assistant-form {
  gap: 6px;
  padding-top: 10px;
  border-top-color: color-mix(in srgb, var(--cpu-primary) 18%, var(--cpu-border-soft));
}
.assistant-page--embedded .assistant-form :deep(.el-textarea__inner) {
  min-height: 46px !important;
  padding: 12px 14px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--cpu-primary) 3%, var(--cpu-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--cpu-primary) 18%, var(--cpu-border-soft)) inset;
}
.assistant-page--embedded .composer-send {
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(145deg, var(--cpu-primary), var(--cpu-primary-dark));
  box-shadow: 0 7px 18px color-mix(in srgb, var(--cpu-primary-dark) 22%, transparent);
}
.assistant-page--embedded .composer-send span {
  display: none;
}
.assistant-page--embedded .assistant-disclaimer {
  margin: -5px 0 0;
  font-size: 10px;
}

:global(html[data-theme="dark"]) .assistant-page--embedded .assistant-form :deep(.el-textarea__inner) {
  background: color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-surface));
}

.embedded-history-panel {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 18px 16px 16px;
  color: var(--cpu-text);
  background:
    linear-gradient(155deg, color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-card)) 0%, var(--cpu-card) 38%);
}
.embedded-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 13px;
  border-bottom: 1px solid color-mix(in srgb, var(--cpu-primary) 20%, var(--cpu-border-soft));
}
.embedded-history-head strong {
  font-size: 18px;
}
.embedded-history-head button {
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
}
.embedded-history-panel .history-list {
  min-height: 0;
  overflow-y: auto;
}
.embedded-history-panel .history-empty {
  min-height: 0;
}
.embedded-history-enter-active,
.embedded-history-leave-active {
  transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.embedded-history-enter-from,
.embedded-history-leave-to {
  opacity: 0;
  transform: translateX(-14px);
}

@media (max-width: 640px) {
  .assistant-page {
    gap: 0;
    margin: 0;
    overflow: hidden;
  }
  .assistant-shell {
    position: relative;
    height: 100%;
    min-height: 0;
    gap: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .assistant-head {
    gap: 8px;
    flex: 0 0 auto;
    padding: 1px 2px 10px;
  }
  .assistant-mark {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    box-shadow: none;
    font-size: 14px;
  }
  .assistant-head h1 {
    font-size: 16px;
  }
  .assistant-head p {
    display: none;
  }
  .assistant-welcome {
    padding: 24px 3px 16px;
  }
  .assistant-welcome strong {
    font-size: 20px;
  }
  .assistant-welcome > span {
    max-width: 310px;
  }
  .assistant-auth-gate {
    min-height: 0;
    padding: 28px 18px;
  }
  .conversation {
    min-height: 0;
    max-height: none;
    gap: 17px;
    padding: 10px 2px 12px;
    scrollbar-width: none;
    scrollbar-gutter: auto;
  }
  .conversation::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
  .assistant-shell.is-composer-focused .conversation {
    padding-bottom: max(
      70px,
      calc(
        var(--layout-keyboard-inset, 0px)
        - var(--layout-mobile-tabbar-reserve, 0px)
        + 70px
      )
    );
  }
  .assistant-shell.is-composer-focused .assistant-form {
    position: absolute;
    z-index: 8;
    right: 0;
    bottom: max(
      8px,
      calc(
        var(--layout-keyboard-inset, 0px)
        - var(--layout-mobile-tabbar-reserve, 0px)
        + 8px
      )
    );
    left: 0;
    margin: 0;
  }
  .message {
    max-width: 82%;
  }
  .message--assistant {
    width: 100%;
    max-width: 100%;
  }
  .message-label {
    display: none;
  }
  .message-bubble {
    padding: 9px 12px;
  }
  .message--assistant .message-bubble {
    padding: 0 2px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .message-bubble p {
    font-size: 14px;
    line-height: 1.7;
  }
  .message--user .message-bubble {
    padding: 2px 1px;
    border: 0;
    border-radius: 0;
    color: var(--cpu-primary);
    background: transparent;
    box-shadow: none;
  }
  .message--user .message-bubble p {
    line-height: 1.5;
  }
  .action-list {
    gap: 6px;
    margin-top: 12px;
  }
  .action-card {
    padding: 9px 10px;
    border-radius: 11px;
    box-shadow: none;
  }
  .action-icon {
    font-size: 19px;
  }
  .action-copy strong {
    font-size: 14px;
  }
  .suggestions {
    flex-wrap: wrap;
    gap: 6px;
    margin: 11px 0 0;
    padding: 0;
    overflow: visible;
  }
  .suggestions button {
    padding: 6px 9px;
    white-space: normal;
    text-align: left;
  }
  .assistant-form {
    gap: 5px;
    flex: 0 0 auto;
    margin: auto 0 0;
    padding: 5px 5px 5px 13px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 18px;
    background: var(--cpu-surface);
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }
  .assistant-disclaimer {
    height: 14px;
    min-height: 14px;
    flex: 0 0 14px;
    overflow: hidden;
    margin: 5px 0 0;
    font-size: 10px;
    line-height: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .assistant-shell.is-composer-focused .assistant-disclaimer {
    position: absolute;
    width: 1px;
    height: 1px;
    min-height: 0;
    margin: 0;
    overflow: hidden;
    clip-path: inset(50%);
    visibility: hidden;
    opacity: 0;
  }
  .assistant-form:focus-within {
    border-color: var(--cpu-primary);
    box-shadow: 0 0 0 3px rgba(20, 143, 123, 0.09);
  }
  .assistant-form :deep(.el-textarea__inner) {
    min-height: 38px !important;
    max-height: 104px;
    padding: 9px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .assistant-form :deep(.el-textarea__inner:focus) {
    border-color: transparent;
    box-shadow: none;
  }
  .composer-send {
    width: 38px;
    height: 38px;
    padding: 0;
    border-radius: 13px;
    font-size: 17px;
  }
  .composer-send span {
    display: none;
  }
}
</style>
