<template>
  <div
    class="sj"
    :class="{
      'sj--embedded': embedded,
      'sj--docked': historyDocked,
      'is-composer-focused': composerFocused,
    }"
  >
    <aside
      v-if="auth.isLoggedIn && (historyDocked || historyOpen)"
      class="sj-history"
      :class="{ 'sj-history--overlay': !historyDocked }"
      :role="historyDocked ? undefined : 'dialog'"
      aria-label="历史对话"
    >
      <div class="sj-history-head">
        <strong>历史对话</strong>
        <button v-if="!historyDocked" type="button" class="sj-icon-btn" aria-label="关闭历史对话" @click="historyOpen = false">
          <el-icon><Close /></el-icon>
        </button>
      </div>
      <button type="button" class="sj-history-new" @click="startNewConversation">
        <el-icon><EditPen /></el-icon>
        <span>新对话</span>
      </button>
      <div v-if="sessions.length" class="sj-history-list">
        <section v-for="group in sessionGroups" :key="group.label" class="sj-history-group">
          <h3>{{ group.label }}</h3>
          <div
            v-for="session in group.items"
            :key="session.id"
            class="sj-history-item"
            :class="{ 'is-active': session.id === activeSessionId }"
          >
            <button type="button" class="sj-history-open" :title="session.title" @click="openConversation(session.id)">
              <span class="sj-history-title">{{ session.title }}</span>
              <span class="sj-history-preview">{{ sessionPreview(session) }}</span>
            </button>
            <button type="button" class="sj-history-delete" aria-label="删除此对话" @click="deleteConversation(session.id)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </section>
      </div>
      <div v-else class="sj-history-empty">
        <el-icon><ChatDotRound /></el-icon>
        <span>还没有历史对话</span>
      </div>
      <p class="sj-history-caption">
        <i :class="`is-${cloudSyncState}`"></i>{{ historyCaption }}
      </p>
    </aside>
    <transition name="sj-fade">
      <div
        v-if="auth.isLoggedIn && historyOpen && !historyDocked"
        class="sj-scrim"
        aria-hidden="true"
        @click="historyOpen = false"
      ></div>
    </transition>

    <section class="sj-main">
      <header class="sj-head">
        <button
          v-if="!historyDocked"
          type="button"
          class="sj-icon-btn"
          aria-label="查看历史对话"
          :disabled="!auth.isLoggedIn"
          @click="historyOpen = true"
        >
          <el-icon><Expand /></el-icon>
        </button>
        <div class="sj-head-title">
          <span class="sj-mark sj-mark--sm" aria-hidden="true"><SparkMark /></span>
          <h1>拾间AI</h1>
        </div>
        <div class="sj-head-actions">
          <span
            v-if="assistantQuota"
            class="sj-quota"
            :class="{ 'is-empty': assistantQuotaExhausted }"
            :title="`Lv.${assistantQuota.level} ${assistantQuota.levelName} · 今日已用 ${assistantQuota.used} 次 · 点数 ${assistantQuota.points}`"
          >
            今日 {{ assistantQuota.remaining }}/{{ assistantQuota.dailyQuota }}<template v-if="assistantQuota.points"> · 点数 {{ assistantQuota.points }}</template>
          </span>
          <button type="button" class="sj-icon-btn" aria-label="新建对话" title="新建对话" :disabled="!messages.length" @click="startNewConversation">
            <el-icon><EditPen /></el-icon>
          </button>
          <button v-if="embedded" type="button" class="sj-icon-btn" aria-label="在完整页面打开拾间AI" title="完整页面" @click="openFullPage">
            <el-icon><FullScreen /></el-icon>
          </button>
          <button v-if="embedded" type="button" class="sj-icon-btn" aria-label="关闭拾间AI" @click="emit('close')">
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </header>

      <div v-if="!auth.isLoggedIn" class="sj-stage sj-gate">
        <span class="sj-mark sj-mark--lg" aria-hidden="true"><SparkMark /></span>
        <h2>登录后使用拾间AI</h2>
        <p>登录后即可开始对话，历史记录和每日额度会跟随账号同步。</p>
        <button type="button" class="sj-gate-btn" @click="goLogin">
          <el-icon><Lock /></el-icon>
          <span>登录并继续</span>
        </button>
      </div>

      <div v-else-if="!messages.length" class="sj-stage sj-welcome">
        <span class="sj-mark sj-mark--lg" aria-hidden="true"><SparkMark /></span>
        <h2>{{ welcomeGreeting }}</h2>
        <p>问站内功能、校园服务和操作步骤，也可以直接聊天。</p>
        <div class="sj-prompts">
          <button
            v-for="prompt in welcomePrompts"
            :key="prompt.text"
            type="button"
            class="sj-prompt"
            :disabled="assistantQuotaExhausted"
            @click="sendPrompt(prompt.text)"
          >
            <span class="sj-prompt-icon"><el-icon><component :is="prompt.icon" /></el-icon></span>
            <span class="sj-prompt-copy">
              <strong>{{ prompt.text }}</strong>
              <small>{{ prompt.hint }}</small>
            </span>
          </button>
        </div>
        <small class="sj-privacy">
          拾间AI不会读取你的课表、成绩等个人数据，涉及本人数据时会引导你到对应页面查看。
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">隐私说明</a>
        </small>
      </div>

      <div
        v-else
        ref="conversationRef"
        class="sj-thread"
        aria-live="polite"
        @scroll.passive="handleConversationScroll"
      >
        <div class="sj-thread-inner">
          <article
            v-for="message in messages"
            :key="message.id"
            class="sj-msg"
            :class="`sj-msg--${message.role}`"
          >
            <template v-if="message.role === 'user'">
              <p class="sj-user-bubble">{{ message.content }}</p>
            </template>
            <template v-else>
              <span class="sj-mark sj-mark--avatar" :class="{ 'is-busy': message.streaming }" aria-hidden="true"><SparkMark /></span>
              <div class="sj-answer">
                <div v-if="!message.content && message.streaming" class="sj-thinking" aria-label="拾间AI正在回答">
                  {{ message.streamStatus || "正在思考…" }}
                </div>
                <div
                  v-if="message.content"
                  class="sj-markdown"
                  :class="{ 'is-streaming': message.streaming }"
                  v-html="renderAssistantMarkdown(message.content)"
                ></div>
                <div v-if="message.streaming && message.content && message.streamStatus?.startsWith('仍在')" class="sj-stream-note">
                  {{ message.streamStatus }}
                </div>

                <div v-if="message.images?.length" class="sj-images">
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

                <div v-if="visibleLinks(message.actions).length" class="sj-actions">
                  <button
                    v-for="action in visibleLinks(message.actions)"
                    :key="action.id"
                    type="button"
                    class="sj-action"
                    @click="open(action)"
                  >
                    <span class="sj-action-icon"><AppIcon :legacy="action.icon" name="link" /></span>
                    <span class="sj-action-copy">
                      <strong>{{ action.label }}</strong>
                      <small v-if="action.description">{{ action.description }}</small>
                    </span>
                    <el-icon class="sj-action-go"><Right /></el-icon>
                  </button>
                </div>

                <div v-if="visibleLinks(message.sources).length" class="sj-sources">
                  <span class="sj-sources-label">参考来源</span>
                  <a
                    v-for="(source, index) in visibleLinks(message.sources)"
                    :key="source.url"
                    :href="source.url"
                    :title="source.url"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  ><b>{{ index + 1 }}</b>{{ source.title }}</a>
                </div>

                <div v-if="!message.streaming && message.content" class="sj-msg-tools">
                  <button
                    type="button"
                    :aria-label="copiedMessageId === message.id ? '已复制' : '复制回答'"
                    :title="copiedMessageId === message.id ? '已复制' : '复制'"
                    @click="copyMessage(message)"
                  >
                    <el-icon><Check v-if="copiedMessageId === message.id" /><CopyDocument v-else /></el-icon>
                  </button>
                </div>

                <div v-if="message.suggestions?.length && !message.streaming && message.id === lastAssistantMessageId" class="sj-followups">
                  <button
                    v-for="suggestion in message.suggestions"
                    :key="suggestion"
                    type="button"
                    :disabled="assistantLoading || assistantQuotaExhausted"
                    @click="sendPrompt(suggestion)"
                  >
                    <el-icon><Right /></el-icon>
                    <span>{{ suggestion }}</span>
                  </button>
                </div>
              </div>
            </template>
          </article>
        </div>
      </div>

      <div v-if="auth.isLoggedIn" class="sj-dock">
        <div v-if="assistantError && !assistantLoading" class="sj-error" role="alert">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ assistantError }}</span>
          <button type="button" @click="retryAssistant">重试</button>
        </div>
        <div
          class="sj-composer"
          :class="{ 'is-disabled': assistantQuotaExhausted }"
          @pointerdown.capture="captureConversationAnchor"
          @click="focusComposer"
        >
          <textarea
            ref="composerRef"
            v-model="keywordInput"
            rows="1"
            maxlength="500"
            enterkeyhint="send"
            :placeholder="assistantQuotaExhausted ? '今日额度和点数都已用完，明天 00:00 恢复' : '给拾间AI发消息'"
            :disabled="assistantQuotaExhausted"
            aria-label="给拾间AI发消息"
            @input="resizeComposer"
            @keydown="handleComposerKeydown"
            @focus="handleComposerFocus"
            @blur="handleComposerBlur"
          ></textarea>
          <div class="sj-composer-side">
            <span v-if="keywordInput.length >= 400" class="sj-counter">{{ keywordInput.length }}/500</span>
            <button
              v-if="assistantLoading"
              type="button"
              class="sj-send is-stop"
              aria-label="停止生成"
              title="停止生成"
              @click.stop="stopAssistant"
            >
              <i></i>
            </button>
            <button
              v-else
              type="button"
              class="sj-send"
              aria-label="发送"
              title="发送（Enter）"
              :disabled="!keywordInput.trim() || assistantQuotaExhausted"
              @click.stop="submitSearch"
            >
              <el-icon><Top /></el-icon>
            </button>
          </div>
        </div>
        <p class="sj-footnote">内容由 AI 生成，请注意甄别</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ChatDotRound,
  Check,
  Close,
  Coin,
  CopyDocument,
  Delete,
  EditPen,
  Expand,
  FullScreen,
  Headset,
  Lightning,
  Lock,
  Right,
  Top,
  WarningFilled,
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
import { isForumDestination } from "@/utils/nativeForumVisibility";
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
function visibleLinks<T extends { url: string }>(links?: T[]): T[] {
  return (links || []).filter((link) => !auth.forumHidden || !isForumDestination(link.url));
}
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

const composerRef = ref<HTMLTextAreaElement | null>(null);
const copiedMessageId = ref<number | null>(null);
let copiedTimer = 0;

// 拾间AI的品牌标：一大一小两颗星芒
const SparkMark = () => h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
  h("path", { d: "M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" }),
  h("path", { d: "M18.5 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z" }),
]);

// 完整页面在宽屏上把历史对话常驻在左侧；悬浮窗和窄屏仍然用抽屉
const DOCKED_HISTORY_QUERY = "(min-width: 1024px)";
const dockedHistoryMedia = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia(DOCKED_HISTORY_QUERY)
  : null;
const wideViewport = ref(Boolean(dockedHistoryMedia?.matches));
const historyDocked = computed(() => !embedded && wideViewport.value);

const welcomePrompts = [
  { text: "宿舍电费在哪里查？", hint: "校园服务", icon: Lightning },
  { text: "怎么打开药苑之声？", hint: "站内功能", icon: Headset },
  { text: "AI 额度怎么计算？", hint: "使用说明", icon: Coin },
];
const welcomeGreeting = computed(() => {
  const name = auth.user?.nickname?.trim();
  return name ? `${name}，想了解点什么？` : "想了解点什么？";
});
// 追问建议只挂在最新一条回答下，旧回答的建议已经过时
const lastAssistantMessageId = computed(() => (
  [...messages.value].reverse().find((item) => item.role === "assistant")?.id ?? null
));
const assistantQuotaExhausted = computed(() => (
  assistantQuota.value !== null && assistantQuota.value.totalRemaining <= 0
));
const historyCaption = computed(() => {
  if (!auth.isLoggedIn) return "记录保存在当前设备，登录后可同步到账号";
  if (cloudSyncState.value === "syncing") return "正在同步历史对话…";
  if (cloudSyncState.value === "error") return "云同步暂时不可用，本机记录已保留";
  return `已同步到账号，最多保留 ${MAX_SESSIONS} 个对话`;
});
const sessionGroups = computed(() => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const day = 24 * 60 * 60 * 1000;
  const buckets: { label: string; since: number; items: ConversationSession[] }[] = [
    { label: "今天", since: today, items: [] },
    { label: "昨天", since: today - day, items: [] },
    { label: "近 7 天", since: today - 6 * day, items: [] },
    { label: "更早", since: Number.NEGATIVE_INFINITY, items: [] },
  ];
  for (const session of sessions.value) {
    buckets.find((bucket) => session.updatedAt >= bucket.since)!.items.push(session);
  }
  return buckets.filter((bucket) => bucket.items.length);
});

onMounted(() => {
  if (auth.isLoggedIn) {
    void hydrateCloudSessions();
    void loadAssistantQuota();
  }
  window.visualViewport?.addEventListener("resize", handleComposerViewportChange);
  dockedHistoryMedia?.addEventListener("change", handleDockedHistoryMediaChange);
  resizeComposer();
  // 悬浮窗打开时恢复的上一段对话要直接落在最新一条消息上
  if (messages.value.length) scrollConversation();
});

watch(keywordInput, () => {
  void nextTick(resizeComposer);
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
    streamStatus: "正在思考…",
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
          : "正在思考…";
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
    if (seq !== assistantSeq) return;
    if (controller.signal.aborted) {
      // 用户主动停止：保留已经生成的部分，空回答直接撤掉
      assistantMessage.streaming = false;
      if (!assistantMessage.content.trim()) {
        messages.value = messages.value.filter((item) => item.id !== assistantMessage.id);
      }
      persistActiveConversation();
      return;
    }
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

function stopAssistant() {
  if (!assistantLoading.value) return;
  assistantController?.abort();
}

function resizeComposer() {
  const element = composerRef.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

function focusComposer(event: MouseEvent) {
  if (event.target instanceof HTMLButtonElement) return;
  composerRef.value?.focus();
}

async function copyMessage(message: ConversationMessage) {
  try {
    await navigator.clipboard.writeText(message.content);
  } catch {
    ElMessage.warning("复制失败，请长按文字手动复制");
    return;
  }
  copiedMessageId.value = message.id;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copiedMessageId.value = null;
  }, 1600);
}

function handleDockedHistoryMediaChange(event: MediaQueryListEvent) {
  wideViewport.value = event.matches;
  if (event.matches) historyOpen.value = false;
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
  const content = [...session.messages].reverse().find((item) => item.content.trim())?.content || "";
  // 列表里只显示一行纯文字，去掉 Markdown 标记和换行
  const plain = content
    .slice(0, 240)
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain || "空对话";
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
      const lastMessage = element.querySelector<HTMLElement>(".sj-msg:last-of-type");
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
  dockedHistoryMedia?.removeEventListener("change", handleDockedHistoryMediaChange);
  window.clearTimeout(copiedTimer);
  window.clearTimeout(cloudSyncTimer);
  if (pendingCloudSession) void flushCloudSync();
});
</script>

<style scoped>
/* 按钮统一在这里清掉浏览器默认样式；:where 保持零特异性，后面的具体类可以直接覆盖。 */
.sj :where(button) {
  margin: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.sj :where(button:disabled) {
  cursor: default;
}
.sj :where(button:focus-visible) {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

/* ---------- 外框 ---------- */
.sj {
  --sj-column: 768px;
  --sj-radius: 20px;
  --sj-user-bubble: var(--cpu-primary-soft);
  --sj-hover: color-mix(in srgb, var(--cpu-text) 5%, transparent);
  --sj-warn-ink: #a15c07;
  position: relative;
  display: flex;
  width: 100%;
  max-width: 1180px;
  height: 100%;
  min-height: 0;
  margin: 0 auto;
  overflow: hidden;
  color: var(--cpu-text);
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--sj-radius);
}
:global(html[data-theme="dark"]) .sj {
  --sj-warn-ink: var(--cpu-warn);
  box-shadow: none;
}

.sj-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* ---------- 顶栏 ---------- */
.sj-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  height: 56px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.sj-head-title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding-left: 2px;
}
.sj-head-title h1 {
  margin: 0;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.sj-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sj-quota {
  margin-right: 4px;
  padding: 4px 10px;
  border-radius: var(--cpu-radius-pill);
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface-subtle);
  font-size: var(--cpu-fs-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sj-quota.is-empty {
  color: var(--sj-warn-ink);
  background: var(--cpu-accent-soft);
}
.sj-icon-btn {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-l);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.sj-icon-btn:not(:disabled):hover {
  color: var(--cpu-text);
  background: var(--sj-hover);
}
.sj-icon-btn:disabled {
  opacity: 0.35;
}

/* ---------- 品牌标 ---------- */
.sj-mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: #fff;
  background: var(--cpu-primary-light);
}
.sj-mark :deep(svg) {
  display: block;
  fill: currentColor;
}
.sj-mark--sm {
  width: 26px;
  height: 26px;
  border-radius: var(--cpu-radius-m);
}
.sj-mark--sm :deep(svg) {
  width: 15px;
  height: 15px;
}
.sj-mark--lg {
  width: 52px;
  height: 52px;
  border-radius: var(--cpu-radius-l);
}
.sj-mark--lg :deep(svg) {
  width: 28px;
  height: 28px;
}
.sj-mark--avatar {
  width: 28px;
  height: 28px;
  margin-top: 1px;
  border-radius: var(--cpu-radius-m);
}
.sj-mark--avatar :deep(svg) {
  width: 16px;
  height: 16px;
}
.sj-mark--avatar.is-busy :deep(svg) {
  animation: sj-twinkle 1.4s ease-in-out infinite;
}

/* ---------- 空状态 / 登录引导 ---------- */
.sj-stage {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  overflow-y: auto;
  padding: 40px 24px 24px;
  text-align: center;
}
.sj-stage::before,
.sj-stage::after {
  content: "";
  flex: 1 1 0;
}
.sj-stage h2 {
  margin: 18px 0 6px;
  font-size: var(--cpu-fs-xl);
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.sj-stage > p {
  max-width: 420px;
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-m);
  line-height: 1.65;
}
.sj-gate-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 42px;
  margin-top: 22px;
  padding: 0 22px;
  border-radius: var(--cpu-radius-pill);
  color: var(--cpu-button-on-primary);
  background: var(--cpu-button-primary);
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  transition: filter 0.15s ease;
}
.sj-gate-btn:hover {
  filter: brightness(1.06);
}

.sj-prompts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  width: min(100%, 680px);
  margin-top: 30px;
}
.sj-prompt {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface);
  text-align: left;
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}
.sj-prompt:not(:disabled):hover {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-primary-soft);
  transform: translateY(-1px);
}
.sj-prompt:disabled {
  opacity: 0.5;
}
.sj-prompt-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  font-size: var(--cpu-fs-l);
}
.sj-prompt-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.sj-prompt-copy strong {
  color: var(--cpu-text);
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  line-height: 1.45;
}
.sj-prompt-copy small {
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.sj-privacy {
  max-width: 440px;
  margin-top: 26px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.65;
}
.sj-privacy a {
  color: var(--cpu-primary);
  text-decoration: none;
  white-space: nowrap;
}
.sj-privacy a:hover {
  text-decoration: underline;
}

/* ---------- 对话 ---------- */
.sj-thread {
  /* scrollConversation 用 offsetTop 定位最后一条消息，必须以滚动容器为 offsetParent */
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--cpu-text) 16%, transparent) transparent;
}
.sj-thread-inner {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: var(--sj-column);
  margin: 0 auto;
  padding: 28px 24px 20px;
}
.sj-msg--user {
  display: flex;
  justify-content: flex-end;
}
.sj-user-bubble {
  max-width: min(82%, 580px);
  margin: 0;
  padding: 10px 16px;
  border-radius: 20px 20px 6px 20px;
  color: var(--cpu-text);
  background: var(--sj-user-bubble);
  font-size: var(--cpu-fs-m);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sj-msg--assistant {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.sj-answer {
  min-width: 0;
  padding-top: 3px;
}

.sj-thinking {
  display: inline-block;
  color: transparent;
  background: var(--cpu-text-muted);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  font-size: var(--cpu-fs-m);
  line-height: 24px;
  animation: sj-shimmer 1.8s linear infinite;
}
.sj-stream-note {
  margin-top: 8px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}

/* Markdown 正文 */
.sj-markdown {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: var(--cpu-fs-m);
  line-height: 1.75;
}
.sj-markdown :deep(> :first-child) { margin-top: 0; }
.sj-markdown :deep(> :last-child) { margin-bottom: 0; }
.sj-markdown :deep(p) {
  margin: 0.7em 0;
}
.sj-markdown :deep(h1),
.sj-markdown :deep(h2),
.sj-markdown :deep(h3),
.sj-markdown :deep(h4) {
  margin: 1.2em 0 0.5em;
  font-weight: 500;
  line-height: 1.4;
}
.sj-markdown :deep(h1) { font-size: 1.3em; }
.sj-markdown :deep(h2) { font-size: 1.18em; }
.sj-markdown :deep(h3) { font-size: 1.06em; }
.sj-markdown :deep(h4) { font-size: 1em; }
.sj-markdown :deep(strong) {
  font-weight: 500;
}
.sj-markdown :deep(ul),
.sj-markdown :deep(ol) {
  margin: 0.7em 0;
  padding-left: 1.4em;
}
.sj-markdown :deep(li) {
  padding-left: 0.2em;
}
.sj-markdown :deep(li + li) {
  margin-top: 0.3em;
}
.sj-markdown :deep(li::marker) {
  color: var(--cpu-text-muted);
}
.sj-markdown :deep(blockquote) {
  margin: 0.9em 0;
  padding: 0.55em 0.95em;
  border-left: 3px solid var(--cpu-primary);
  border-radius: 0 10px 10px 0;
  color: var(--cpu-text-secondary);
  background: var(--cpu-primary-soft);
}
.sj-markdown :deep(blockquote p) {
  margin: 0.3em 0;
}
.sj-markdown :deep(a) {
  color: var(--cpu-primary);
  text-decoration: underline;
  text-decoration-color: var(--cpu-primary-soft);
  text-underline-offset: 3px;
}
.sj-markdown :deep(a:hover) {
  text-decoration-color: currentColor;
}
.sj-markdown :deep(hr) {
  margin: 1.4em 0;
  border: 0;
  border-top: 1px solid var(--cpu-border-soft);
}
.sj-markdown :deep(code) {
  padding: 0.14em 0.4em;
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-surface-subtle);
  font-family: var(--cpu-font-mono);
  font-size: 0.86em;
}
.sj-markdown :deep(pre) {
  max-width: 100%;
  margin: 0.9em 0;
  overflow-x: auto;
  padding: 13px 15px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
  line-height: 1.6;
}
.sj-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 0.85em;
  white-space: pre;
}
.sj-markdown :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  margin: 0.9em 0;
  overflow-x: auto;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--cpu-fs-m);
}
.sj-markdown :deep(th),
.sj-markdown :deep(td) {
  padding: 8px 14px;
  border-bottom: 1px solid var(--cpu-border-soft);
  text-align: left;
  vertical-align: top;
}
.sj-markdown :deep(th) {
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface-soft);
  font-size: var(--cpu-fs-s);
  font-weight: 500;
}
.sj-markdown :deep(tr:last-child td) {
  border-bottom: 0;
}
.sj-markdown :deep(img) {
  max-width: 100%;
  border-radius: var(--cpu-radius-m);
}
.sj-markdown :deep(.katex-display) {
  max-width: 100%;
  margin: 0.9em 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.25em 0;
  text-align: left;
}
.sj-markdown :deep(.katex-display > .katex) {
  text-align: left;
}
.sj-markdown :deep(.katex) {
  color: inherit;
  font-size: 1.02em;
}
.sj-markdown.is-streaming :deep(> p:last-child)::after,
.sj-markdown.is-streaming :deep(> h1:last-child)::after,
.sj-markdown.is-streaming :deep(> h2:last-child)::after,
.sj-markdown.is-streaming :deep(> h3:last-child)::after,
.sj-markdown.is-streaming :deep(> h4:last-child)::after,
.sj-markdown.is-streaming :deep(> blockquote:last-child > p:last-child)::after,
.sj-markdown.is-streaming :deep(> ul:last-child > li:last-child)::after,
.sj-markdown.is-streaming :deep(> ol:last-child > li:last-child)::after {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 5px;
  border-radius: 50%;
  vertical-align: 0.05em;
  background: var(--cpu-primary);
  animation: sj-pulse 1s ease-in-out infinite;
}

/* 生成的图片 */
.sj-images {
  display: grid;
  width: min(100%, 560px);
  margin-top: 14px;
}
.sj-images button {
  display: block;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-subtle);
  cursor: zoom-in;
}
.sj-images img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 640px;
  object-fit: contain;
}

/* 站内入口卡片 */
.sj-actions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.sj-action {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  padding: 10px 12px 10px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface);
  text-align: left;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.sj-action:hover {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-primary-soft);
}
.sj-action-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  font-size: var(--cpu-fs-l);
}
.sj-action-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.sj-action-copy strong {
  overflow: hidden;
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sj-action-copy small {
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sj-action-go {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-m);
  transition: transform 0.15s ease, color 0.15s ease;
}
.sj-action:hover .sj-action-go {
  color: var(--cpu-primary);
  transform: translateX(2px);
}

/* 参考来源 */
.sj-sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
}
.sj-sources-label {
  margin-right: 2px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.sj-sources a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(100%, 280px);
  padding: 3px 10px 3px 3px;
  overflow: hidden;
  border-radius: var(--cpu-radius-pill);
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface-subtle);
  font-size: var(--cpu-fs-xs);
  line-height: 18px;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.sj-sources a:hover {
  color: var(--cpu-text);
  background: var(--cpu-primary-soft);
}
.sj-sources b {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--cpu-primary);
  background: var(--cpu-card);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
}

/* 消息工具条与追问 */
.sj-msg-tools {
  display: flex;
  gap: 2px;
  margin: 10px 0 0 -6px;
}
.sj-msg-tools button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-m);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.sj-msg-tools button:hover {
  color: var(--cpu-text);
  background: var(--sj-hover);
}
.sj-followups {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-top: 10px;
}
.sj-followups button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 7px 13px 7px 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.45;
  text-align: left;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.sj-followups button .el-icon {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
}
.sj-followups button:not(:disabled):hover {
  border-color: var(--cpu-border);
  color: var(--cpu-text);
  background: var(--sj-hover);
}
.sj-followups button:not(:disabled):hover .el-icon {
  color: var(--cpu-primary);
}
.sj-followups button:disabled {
  opacity: 0.5;
}

/* ---------- 输入区 ---------- */
.sj-dock {
  flex: 0 0 auto;
  width: 100%;
  max-width: calc(var(--sj-column) + 48px);
  margin: 0 auto;
  padding: 6px 24px 12px;
}
.sj-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 8px 8px 12px;
  border-radius: var(--cpu-radius-l);
  color: var(--sj-warn-ink);
  background: var(--cpu-accent-soft);
  font-size: var(--cpu-fs-s);
  line-height: 1.5;
}
.sj-error > span {
  flex: 1;
  min-width: 0;
}
.sj-error > .el-icon {
  flex: 0 0 auto;
  font-size: var(--cpu-fs-m);
}
.sj-error button {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-primary);
  font-weight: 500;
}
.sj-error button:hover {
  background: var(--sj-hover);
}
.sj-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 7px 7px 7px 18px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface);
  box-shadow: var(--cpu-shadow-float);
  cursor: text;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.sj-composer:focus-within {
  border-color: var(--cpu-border-soft);
  box-shadow: 0 0 0 4px var(--cpu-primary-soft), var(--cpu-shadow-float);
}
.sj-composer.is-disabled {
  cursor: not-allowed;
  background: var(--cpu-surface-soft);
}
:global(html[data-theme="dark"]) .sj-composer {
  box-shadow: none;
}
.sj-composer textarea {
  flex: 1;
  min-width: 0;
  height: 36px;
  max-height: 176px;
  padding: 7px 0;
  overflow-y: auto;
  border: 0;
  outline: 0;
  color: var(--cpu-text);
  background: transparent;
  font: inherit;
  font-size: var(--cpu-fs-m);
  line-height: 22px;
  resize: none;
  -webkit-appearance: none;
  appearance: none;
}
.sj-composer textarea::placeholder {
  color: var(--cpu-text-muted);
}
.sj-composer textarea:disabled {
  cursor: not-allowed;
}
.sj-composer-side {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}
.sj-counter {
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  font-variant-numeric: tabular-nums;
}
.sj-send {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 50%;
  color: var(--cpu-button-on-primary);
  background: var(--cpu-button-primary);
  font-size: var(--cpu-fs-l);
  transition: background-color 0.15s ease, transform 0.12s ease, opacity 0.15s ease;
}
.sj-send:not(:disabled):hover {
  filter: brightness(1.06);
}
.sj-send:not(:disabled):active {
  transform: scale(0.94);
}
.sj-send:disabled {
  color: var(--cpu-text-muted);
  background: var(--cpu-surface-subtle);
}
.sj-send.is-stop {
  color: var(--cpu-card);
  background: var(--cpu-text);
}
.sj-send.is-stop i {
  width: 11px;
  height: 11px;
  border-radius: var(--cpu-radius-s);
  background: currentColor;
}
.sj-footnote {
  margin: 8px 0 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.4;
  text-align: center;
}

/* ---------- 历史对话 ---------- */
.sj-history {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 6px 10px 12px;
  background: var(--cpu-surface-soft);
}
.sj--docked .sj-history {
  width: 268px;
  flex: 0 0 268px;
  border-right: 1px solid var(--cpu-border-soft);
}
.sj-history--overlay {
  position: absolute;
  z-index: 6;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(300px, 86%);
  background: var(--cpu-card);
  box-shadow: 16px 0 48px rgba(15, 23, 42, 0.16);
  animation: sj-slide-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sj-scrim {
  position: absolute;
  z-index: 5;
  inset: 0;
  background: rgba(15, 23, 42, 0.26);
}
:global(html[data-theme="dark"]) .sj-scrim {
  background: rgba(0, 0, 0, 0.45);
}
.sj-history-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 0 0 8px;
}
.sj-history-head strong {
  font-size: var(--cpu-fs-m);
  font-weight: 500;
}
.sj-history-new {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin: 4px 0 8px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  color: var(--cpu-text);
  background: var(--cpu-card);
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.sj-history-new .el-icon {
  font-size: var(--cpu-fs-m);
}
.sj-history-new:hover {
  border-color: var(--cpu-border-soft);
  color: var(--cpu-primary);
}
.sj-history-list {
  flex: 1;
  min-height: 0;
  margin: 0 -4px;
  padding: 0 4px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.sj-history-group h3 {
  margin: 14px 8px 4px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.sj-history-group:first-child h3 {
  margin-top: 6px;
}
.sj-history-item {
  display: flex;
  align-items: center;
  border-radius: var(--cpu-radius-m);
  transition: background-color 0.12s ease;
}
.sj-history-item:hover {
  background: var(--sj-hover);
}
.sj-history-item.is-active {
  background: var(--cpu-primary-soft);
}
.sj-history-open {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 7px 4px 7px 10px;
  text-align: left;
}
.sj-history-title,
.sj-history-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sj-history-title {
  color: var(--cpu-text);
  font-size: var(--cpu-fs-s);
  line-height: 1.45;
}
.sj-history-item.is-active .sj-history-title {
  font-weight: 500;
}
.sj-history-preview {
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.45;
}
.sj-history-delete {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  margin-right: 4px;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-m);
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease, background-color 0.12s ease;
}
.sj-history-item:hover .sj-history-delete,
.sj-history-item.is-active .sj-history-delete,
.sj-history-delete:focus-visible {
  opacity: 1;
}
.sj-history-delete:hover {
  color: var(--cpu-danger);
  background: var(--cpu-danger-soft);
}
@media (hover: none) {
  .sj-history-delete {
    opacity: 1;
  }
}
.sj-history-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
}
.sj-history-empty .el-icon {
  font-size: 26px;
}
.sj-history-caption {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 7px;
  margin: 10px 6px 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.5;
}
.sj-history-caption i {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  transform: translateY(-1px);
  background: var(--cpu-text-muted);
}
.sj-history-caption i.is-ready { background: var(--cpu-success); }
.sj-history-caption i.is-syncing { background: var(--cpu-warn); animation: sj-pulse 1s ease-in-out infinite; }
.sj-history-caption i.is-error { background: var(--cpu-danger); }

/* ---------- 悬浮窗（嵌入模式） ---------- */
.sj--embedded {
  max-width: none;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.sj--embedded .sj-head {
  height: 54px;
  padding: 0 10px 0 12px;
}
.sj--embedded .sj-stage {
  padding: 28px 18px 16px;
}
.sj--embedded .sj-stage h2 {
  margin-top: 14px;
  font-size: var(--cpu-fs-xl);
}
.sj--embedded .sj-stage > p {
  font-size: var(--cpu-fs-s);
}
.sj--embedded .sj-mark--lg {
  width: 44px;
  height: 44px;
  border-radius: var(--cpu-radius-l);
}
.sj--embedded .sj-mark--lg :deep(svg) {
  width: 24px;
  height: 24px;
}
.sj--embedded .sj-prompts {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-top: 22px;
}
.sj--embedded .sj-prompt {
  align-items: center;
  padding: 11px 12px;
}
.sj--embedded .sj-privacy {
  margin-top: 18px;
}
.sj--embedded .sj-thread-inner {
  gap: 24px;
  padding: 20px 16px 16px;
}
.sj--embedded .sj-msg--assistant {
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 11px;
}
.sj--embedded .sj-mark--avatar {
  width: 24px;
  height: 24px;
  border-radius: var(--cpu-radius-m);
}
.sj--embedded .sj-mark--avatar :deep(svg) {
  width: 14px;
  height: 14px;
}
.sj--embedded .sj-markdown,
.sj--embedded .sj-user-bubble {
  font-size: var(--cpu-fs-m);
}
.sj--embedded .sj-actions {
  grid-template-columns: minmax(0, 1fr);
}
.sj--embedded .sj-dock {
  padding: 4px 12px 10px;
}
.sj--embedded .sj-quota {
  display: none;
}

/* ---------- 动效 ---------- */
.sj-fade-enter-active,
.sj-fade-leave-active {
  transition: opacity 0.2s ease;
}
.sj-fade-enter-from,
.sj-fade-leave-to {
  opacity: 0;
}
@keyframes sj-shimmer {
  from { background-position: 110% 0; }
  to { background-position: -110% 0; }
}
@keyframes sj-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}
@keyframes sj-twinkle {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; }
  50% { transform: scale(0.82) rotate(18deg); opacity: 0.75; }
}
@keyframes sj-slide-in {
  from { transform: translateX(-16px); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .sj *,
  .sj *::before,
  .sj *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ---------- 窄屏 ---------- */
@media (max-width: 860px) {
  .sj-prompts {
    grid-template-columns: minmax(0, 1fr);
    width: min(100%, 440px);
    gap: 8px;
  }
  .sj-prompt {
    align-items: center;
    padding: 11px 12px;
  }
}

@media (max-width: 640px) {
  .sj:not(.sj--embedded) {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }
  .sj:not(.sj--embedded) .sj-main {
    overflow: hidden;
  }
  .sj-head {
    height: 46px;
    padding: 0 0 0 2px;
    border-bottom: 0;
  }
  .sj-head-title h1 {
    font-size: var(--cpu-fs-l);
  }
  .sj-quota {
    padding: 3px 8px;
    font-size: var(--cpu-fs-xs);
  }
  .sj-stage {
    padding: 24px 6px 12px;
  }
  .sj-stage h2 {
    font-size: var(--cpu-fs-xl);
  }
  .sj-stage > p {
    max-width: 300px;
    font-size: var(--cpu-fs-s);
  }
  .sj-mark--lg {
    width: 46px;
    height: 46px;
    border-radius: var(--cpu-radius-l);
  }
  .sj-mark--lg :deep(svg) {
    width: 25px;
    height: 25px;
  }
  .sj-prompts {
    margin-top: 22px;
  }
  .sj-privacy {
    margin-top: 18px;
  }
  .sj-thread {
    scrollbar-width: none;
  }
  .sj-thread::-webkit-scrollbar {
    display: none;
  }
  .sj-thread-inner {
    gap: 22px;
    padding: 12px 2px 14px;
  }
  .sj-msg--assistant {
    display: block;
  }
  .sj-msg--assistant > .sj-mark--avatar {
    display: none;
  }
  .sj-answer {
    padding-top: 0;
  }
  .sj-user-bubble {
    max-width: 86%;
  }
  .sj-actions {
    grid-template-columns: minmax(0, 1fr);
  }
  .sj-dock {
    padding: 4px 0 2px;
  }
  .sj-composer {
    padding: 5px 5px 5px 15px;
    border-radius: var(--cpu-radius-l);
    box-shadow: none;
  }
  .sj-composer textarea {
    /* 16px 以下 iOS 会在聚焦时自动放大页面 */
    font-size: var(--cpu-fs-l);
    max-height: 132px;
  }
  .sj-footnote {
    height: 14px;
    margin-top: 5px;
    overflow: hidden;
    font-size: var(--cpu-fs-xs);
    line-height: 14px;
    white-space: nowrap;
  }
  .sj.is-composer-focused .sj-footnote {
    display: none;
  }
  .sj-history--overlay {
    width: min(320px, 88%);
  }
}
</style>
