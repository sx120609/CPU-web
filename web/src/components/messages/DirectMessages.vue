<template>
  <div class="direct-messages" :class="{ 'has-active': !!activeCounterpart }">
    <aside class="conversation-sidebar">
      <div class="sidebar-head">
        <div class="sidebar-copy">
          <b>私信</b>
          <span>{{ totalUnread ? `${totalUnread} 条未读消息` : "消息记录仅会显示给会话双方" }}</span>
        </div>
        <div class="sidebar-actions">
          <el-badge :value="totalUnread" :hidden="!totalUnread" :max="99" />
          <el-button class="notice-link" text type="primary" @click="openNoticeCenter">其他通知</el-button>
        </div>
      </div>

      <div v-if="listLoading && !conversations.length" class="sidebar-state">正在加载会话...</div>
      <div v-else-if="listError && !conversations.length" class="sidebar-state sidebar-error">
        <span>{{ listError }}</span>
        <el-button text type="primary" @click="loadConversationList">重试</el-button>
      </div>
      <el-empty v-else-if="!conversations.length" description="还没有私聊" :image-size="72" />
      <div v-else class="conversation-list">
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          type="button"
          class="conversation-row"
          :class="{ active: activeConversation?.id === conversation.id }"
          :aria-current="activeConversation?.id === conversation.id ? 'true' : undefined"
          :aria-label="`打开与 ${conversation.counterpart.nickname} 的私聊${conversation.unreadCount ? `，${conversation.unreadCount} 条未读` : ''}`"
          @click="openConversation(conversation.id)"
        >
          <UserAvatar
            :size="42"
            :src="conversation.counterpart.avatar"
            :name="conversation.counterpart.nickname"
            :seed="conversation.counterpart.id || conversation.counterpart.nickname"
            :profile-frame="conversation.counterpart.profileFrame"
            alt="私聊对象头像"
          />
          <span class="conversation-copy">
            <span class="conversation-line">
              <b><DisplayNickname :name="conversation.counterpart.nickname" /></b>
              <small>{{ shortTime(conversation.lastMessageAt) }}</small>
            </span>
            <span class="conversation-preview">
              {{ conversationPreview(conversation.lastMessage) }}
            </span>
          </span>
          <span v-if="conversation.unreadCount" class="unread-dot">{{ Math.min(conversation.unreadCount, 99) }}</span>
        </button>
      </div>
    </aside>

    <section class="chat-pane">
      <div v-if="targetLoading" class="chat-state">正在打开私聊...</div>
      <div v-else-if="targetError && !activeCounterpart" class="chat-state">
        <el-empty :description="targetError">
          <el-button type="primary" @click="applyRouteTarget">重试</el-button>
        </el-empty>
      </div>
      <div v-else-if="!activeCounterpart" class="chat-state chat-placeholder">
        <el-empty description="从帖子或用户主页发起私聊，或在左侧选择一个会话" />
      </div>
      <template v-else>
        <header class="chat-head">
          <button type="button" class="mobile-back" aria-label="返回会话列表" title="返回会话列表" @click="backToList">
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <UserAvatar
            :size="40"
            :src="activeCounterpart.avatar"
            :name="activeCounterpart.nickname"
            :seed="activeCounterpart.id || activeCounterpart.nickname"
            :profile-frame="activeCounterpart.profileFrame"
            alt="私聊对象头像"
          />
          <div class="chat-title">
            <b><DisplayNickname :name="activeCounterpart.nickname" /></b>
            <span v-if="activeConversation?.sendState.limitedUntilReply">
              对方回复前还可发送 {{ activeConversation.sendState.remainingBeforeReply }} 条
            </span>
            <span v-else-if="!activeConversation">新私聊 · 对方回复前最多发送两条</span>
            <span v-else>站内私聊</span>
          </div>
          <el-button v-if="!activeCounterpart.anonymous" class="profile-link" text type="primary" @click="openProfile">查看资料</el-button>
        </header>

        <div ref="messageScroller" class="message-scroller" aria-live="polite" aria-label="私聊消息记录">
          <div v-if="nextCursor" class="load-more">
            <el-button text type="primary" :loading="olderLoading" @click="loadOlderMessages">加载更早消息</el-button>
          </div>
          <div v-if="messageLoading && !messages.length" class="message-loading">正在加载消息...</div>
          <div v-else-if="messageError && !messages.length" class="message-loading sidebar-error">
            <span>{{ messageError }}</span>
            <el-button text type="primary" @click="loadMessages(true)">重试</el-button>
          </div>
          <div v-else-if="!messages.length" class="new-chat-tip">
            <UserAvatar
              :size="56"
              :src="activeCounterpart.avatar"
              :name="activeCounterpart.nickname"
              :seed="activeCounterpart.id || activeCounterpart.nickname"
              :profile-frame="activeCounterpart.profileFrame"
              alt="私聊对象头像"
            />
            <b>发消息给 <DisplayNickname :name="activeCounterpart.nickname" /></b>
            <span>对方首次回复前最多发送两条，回复后即可继续交流。</span>
          </div>
          <div
            v-for="message in messages"
            :key="message.id"
            class="message-row"
            :class="{ mine: message.senderId === auth.user?.id }"
          >
            <div class="message-bubble">
              <p>{{ message.content }}</p>
              <span>
                {{ messageTime(message.createdAt) }}
                <template v-if="message.senderId === auth.user?.id"> · {{ messageDeliveryText(message) }}</template>
                <button
                  v-else
                  type="button"
                  class="message-report-button"
                  @click="openMessageReport(message)"
                >举报</button>
              </span>
            </div>
          </div>
        </div>

        <footer class="composer">
          <el-alert
            v-if="sendBlocked"
            type="info"
            :closable="false"
            show-icon
            title="已发送两条消息，请等待对方回复后再继续"
          />
          <div class="composer-row">
            <el-input
              v-model="draft"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              resize="none"
              maxlength="2000"
              :disabled="sendBlocked || sending"
              :placeholder="sendBlocked ? '等待对方回复' : '输入消息'"
              @keydown="onComposerKeydown"
            />
            <el-button type="primary" :loading="sending" :disabled="!canSubmit" @click="sendMessage">发送</el-button>
          </div>
          <span class="composer-hint">{{ composerHint }} · 发送后后台审核，通过后对方才会收到</span>
        </footer>
      </template>
    </section>
    <ContentReportDialog
      v-if="reportMessage"
      v-model="reportDialogOpen"
      target-type="direct_message"
      :target-id="reportMessage.id"
      :target-label="`与 ${activeCounterpart?.nickname || '对方'} 的私聊消息`"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import UserAvatar from "@/components/common/UserAvatar.vue";
import DisplayNickname from "@/components/common/DisplayNickname.vue";
import ContentReportDialog from "@/components/forum/ContentReportDialog.vue";
import {
  directMessageApi,
  type DirectConversation,
  type ForumDirectMessageKind,
  type DirectMessageItem,
  type DirectMessageUser,
} from "@/api/directMessage";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

const emit = defineEmits<{ (event: "notices-read", conversationId: number): void }>();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const conversations = ref<DirectConversation[]>([]);
const totalUnread = ref(0);
const activeConversation = ref<DirectConversation | null>(null);
const pendingTarget = ref<DirectMessageUser | null>(null);
const pendingForumTarget = ref<{ kind: ForumDirectMessageKind; postId: number } | null>(null);
const messages = ref<DirectMessageItem[]>([]);
const nextCursor = ref<number | null>(null);
const draft = ref("");
const listLoading = ref(false);
const targetLoading = ref(false);
const messageLoading = ref(false);
const olderLoading = ref(false);
const sending = ref(false);
const listError = ref("");
const targetError = ref("");
const messageError = ref("");
const messageScroller = ref<HTMLElement | null>(null);
const reportDialogOpen = ref(false);
const reportMessage = ref<DirectMessageItem | null>(null);
let disposed = false;
let refreshTimer = 0;
let routeSeq = 0;
let messageSeq = 0;

const activeCounterpart = computed(() => activeConversation.value?.counterpart || pendingTarget.value);
const sendBlocked = computed(() => Boolean(activeConversation.value && !activeConversation.value.sendState.canSend));
const canSubmit = computed(() => Boolean(draft.value.trim()) && !sendBlocked.value && !sending.value);
const composerDraftKey = computed(() => {
  const userId = auth.user?.id;
  if (!userId) return "";
  if (activeConversation.value?.id && activeCounterpart.value?.anonymous) {
    return `cpu-direct-message-draft-v2:user-${userId}:conversation-${activeConversation.value.id}`;
  }
  if (pendingForumTarget.value) {
    return `cpu-direct-message-draft-v2:user-${userId}:forum-${pendingForumTarget.value.kind}-${pendingForumTarget.value.postId}`;
  }
  const counterpartId = activeCounterpart.value?.id;
  return counterpartId ? `cpu-direct-message-draft-v2:user-${userId}:counterpart-${counterpartId}` : "";
});
let draftSaveTimer = 0;
let pendingDraftKey = "";
let pendingDraftContent = "";
const composerHint = computed(() => {
  if (!activeConversation.value) return "对方回复前最多发送两条";
  const remaining = activeConversation.value.sendState.remainingBeforeReply;
  if (activeConversation.value.sendState.limitedUntilReply && remaining !== null) {
    return remaining > 0 ? `对方回复前还可发送 ${remaining} 条` : "等待对方回复";
  }
  return "消息仅会显示给会话双方";
});

onMounted(async () => {
  disposed = false;
  await loadConversationList();
  await applyRouteTarget();
  refreshTimer = window.setInterval(() => void refreshVisibleConversation(), 7000);
});

onBeforeUnmount(() => {
  disposed = true;
  routeSeq += 1;
  messageSeq += 1;
  if (refreshTimer) window.clearInterval(refreshTimer);
  flushComposerDraft();
});

watch(
  () => [route.query.tab, route.query.user, route.query.conversation, route.query.forumKind, route.query.forumId],
  () => {
    if (route.query.tab === "private") void applyRouteTarget();
  },
);

watch(composerDraftKey, (key, previousKey) => {
  flushComposerDraft();
  if (previousKey) persistComposerDraft(previousKey, draft.value);
  draft.value = readComposerDraft(key);
}, { immediate: true });

watch(draft, (content) => {
  const key = composerDraftKey.value;
  if (!key) return;
  window.clearTimeout(draftSaveTimer);
  pendingDraftKey = key;
  pendingDraftContent = content;
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = 0;
    persistComposerDraft(pendingDraftKey, pendingDraftContent);
    pendingDraftKey = "";
    pendingDraftContent = "";
  }, 300);
});

async function loadConversationList() {
  if (disposed || listLoading.value) return;
  listLoading.value = true;
  listError.value = "";
  try {
    const result = await directMessageApi.conversations({ cacheTtlMs: 0, suppressErrorMessage: true });
    if (disposed) return;
    conversations.value = result.conversations;
    totalUnread.value = result.totalUnread;
    if (activeConversation.value) {
      const updated = result.conversations.find((item) => item.id === activeConversation.value?.id);
      if (updated) activeConversation.value = updated;
    }
  } catch (error) {
    if (!disposed) listError.value = errorMessage(error, "会话列表加载失败");
  } finally {
    if (!disposed) listLoading.value = false;
  }
}

async function applyRouteTarget() {
  if (disposed || route.query.tab !== "private") return;
  const seq = ++routeSeq;
  targetError.value = "";
  const conversationId = positiveQueryId(route.query.conversation);
  const userId = positiveQueryId(route.query.user);
  const forumKind = forumKindQuery(route.query.forumKind);
  const forumId = positiveQueryId(route.query.forumId);

  if (conversationId) {
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (!conversation) {
      activeConversation.value = null;
      pendingTarget.value = null;
      pendingForumTarget.value = null;
      messages.value = [];
      targetError.value = "会话不存在或已不可访问";
      return;
    }
    pendingTarget.value = null;
    pendingForumTarget.value = null;
    activeConversation.value = conversation;
    await loadMessages(true);
    return;
  }

  if (forumKind && forumId) {
    targetLoading.value = true;
    try {
      const result = await directMessageApi.withForumPost(forumKind, forumId, {
        cacheTtlMs: 0,
        suppressErrorMessage: true,
      });
      if (disposed || seq !== routeSeq) return;
      if (result.conversation) {
        upsertConversation(result.conversation);
        activeConversation.value = result.conversation;
        pendingTarget.value = null;
        pendingForumTarget.value = null;
        await loadMessages(true);
      } else {
        activeConversation.value = null;
        pendingTarget.value = result.counterpart;
        pendingForumTarget.value = { kind: forumKind, postId: forumId };
        messages.value = [];
        nextCursor.value = null;
      }
    } catch (error) {
      if (disposed || seq !== routeSeq) return;
      activeConversation.value = null;
      pendingTarget.value = null;
      pendingForumTarget.value = null;
      messages.value = [];
      targetError.value = errorMessage(error, "私聊对象加载失败");
    } finally {
      if (!disposed && seq === routeSeq) targetLoading.value = false;
    }
    return;
  }

  if (userId) {
    targetLoading.value = true;
    try {
      const result = await directMessageApi.withUser(userId, { cacheTtlMs: 0, suppressErrorMessage: true });
      if (disposed || seq !== routeSeq) return;
      if (result.conversation) {
        upsertConversation(result.conversation);
        activeConversation.value = result.conversation;
        pendingTarget.value = null;
        pendingForumTarget.value = null;
        await loadMessages(true);
      } else {
        activeConversation.value = null;
        pendingTarget.value = result.counterpart;
        pendingForumTarget.value = null;
        messages.value = [];
        nextCursor.value = null;
      }
    } catch (error) {
      if (disposed || seq !== routeSeq) return;
      activeConversation.value = null;
      pendingTarget.value = null;
      pendingForumTarget.value = null;
      messages.value = [];
      targetError.value = errorMessage(error, "私聊对象加载失败");
    } finally {
      if (!disposed && seq === routeSeq) targetLoading.value = false;
    }
    return;
  }

  if (!activeConversation.value && !pendingTarget.value) messages.value = [];
}

function openConversation(conversationId: number) {
  router.replace({
    query: {
      ...route.query,
      tab: "private",
      conversation: String(conversationId),
      user: undefined,
      forumKind: undefined,
      forumId: undefined,
    },
  }).catch(() => null);
}

async function loadMessages(replace: boolean) {
  const conversationId = activeConversation.value?.id;
  if (!conversationId || disposed) return;
  const seq = ++messageSeq;
  if (replace) messageLoading.value = true;
  messageError.value = "";
  try {
    const result = await directMessageApi.messages(conversationId, { limit: 50 }, {
      cacheTtlMs: 0,
      suppressErrorMessage: true,
    });
    if (disposed || seq !== messageSeq || activeConversation.value?.id !== conversationId) return;
    const previousUnread = conversations.value.find((item) => item.id === conversationId)?.unreadCount || 0;
    activeConversation.value = result.conversation;
    upsertConversation(result.conversation);
    if (replace) {
      messages.value = result.messages;
      nextCursor.value = result.nextCursor;
    } else {
      mergeMessages(result.messages);
    }
    totalUnread.value = Math.max(0, totalUnread.value - previousUnread);
    const row = conversations.value.find((item) => item.id === conversationId);
    if (row) row.unreadCount = 0;
    emit("notices-read", conversationId);
    if (replace) await scrollToBottom();
  } catch (error) {
    if (!disposed && seq === messageSeq) messageError.value = errorMessage(error, "消息加载失败");
  } finally {
    if (!disposed && seq === messageSeq) messageLoading.value = false;
  }
}

async function loadOlderMessages() {
  const conversationId = activeConversation.value?.id;
  const before = nextCursor.value;
  if (!conversationId || !before || olderLoading.value) return;
  olderLoading.value = true;
  try {
    const result = await directMessageApi.messages(conversationId, { before, limit: 50 }, {
      cacheTtlMs: 0,
      suppressErrorMessage: true,
    });
    const existing = new Set(messages.value.map((item) => item.id));
    messages.value = [...result.messages.filter((item) => !existing.has(item.id)), ...messages.value];
    nextCursor.value = result.nextCursor;
    activeConversation.value = result.conversation;
  } catch (error) {
    ElMessage.error(errorMessage(error, "更早消息加载失败"));
  } finally {
    olderLoading.value = false;
  }
}

async function sendMessage() {
  const content = draft.value.trim();
  const counterpart = activeCounterpart.value;
  if (!content || !counterpart || sending.value || sendBlocked.value) return;
  sending.value = true;
  try {
    const forumTarget = pendingForumTarget.value;
    const result = activeConversation.value
      ? await directMessageApi.send(activeConversation.value.id, content, { suppressErrorMessage: true })
      : forumTarget
        ? await directMessageApi.sendToForumPost(forumTarget.kind, forumTarget.postId, content, { suppressErrorMessage: true })
        : await directMessageApi.sendToUser(counterpart.id, content, { suppressErrorMessage: true });
    clearComposerDraft(composerDraftKey.value);
    draft.value = "";
    pendingTarget.value = null;
    pendingForumTarget.value = null;
    activeConversation.value = result.conversation;
    mergeMessages([result.message]);
    upsertConversation({ ...result.conversation, lastMessage: result.message });
    if (result.message.aiReviewStatus === "checking") ElMessage.info("消息已提交后台审核，通过后会自动发送给对方");
    await router.replace({
      query: {
        ...route.query,
        tab: "private",
        conversation: String(result.conversation.id),
        user: undefined,
        forumKind: undefined,
        forumId: undefined,
      },
    }).catch(() => null);
    await scrollToBottom();
    void loadConversationList();
  } catch (error) {
    const message = errorMessage(error, "消息发送失败");
    ElMessage.error(message);
    if (/等待对方回复|最多发送两条/.test(message) && activeConversation.value) {
      activeConversation.value.sendState = {
        limitedUntilReply: true,
        canSend: false,
        remainingBeforeReply: 0,
      };
    }
  } finally {
    sending.value = false;
  }
}

function openMessageReport(message: DirectMessageItem) {
  if (message.senderId === auth.user?.id) return;
  reportMessage.value = message;
  reportDialogOpen.value = true;
}

function readComposerDraft(key: string) {
  if (!key) return "";
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return typeof parsed?.content === "string" ? parsed.content : "";
  } catch {
    return "";
  }
}

function persistComposerDraft(key: string, content: string) {
  if (!key) return;
  try {
    if (content.trim()) {
      localStorage.setItem(key, JSON.stringify({ content, savedAt: Date.now() }));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    return;
  }
}

function flushComposerDraft() {
  if (!pendingDraftKey) return;
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = 0;
  persistComposerDraft(pendingDraftKey, pendingDraftContent);
  pendingDraftKey = "";
  pendingDraftContent = "";
}

function clearComposerDraft(key: string) {
  if (!key) return;
  if (pendingDraftKey === key) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = 0;
    pendingDraftKey = "";
    pendingDraftContent = "";
  }
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

function onComposerKeydown(event: Event | KeyboardEvent) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void sendMessage();
}

async function refreshVisibleConversation() {
  if (disposed || route.query.tab !== "private") return;
  await loadConversationList();
  if (activeConversation.value) await loadMessages(false);
}

function mergeMessages(next: DirectMessageItem[]) {
  const map = new Map(messages.value.map((item) => [item.id, item]));
  next.forEach((item) => map.set(item.id, item));
  messages.value = [...map.values()].sort((a, b) => a.id - b.id);
}

function upsertConversation(conversation: DirectConversation) {
  const index = conversations.value.findIndex((item) => item.id === conversation.id);
  if (index >= 0) {
    conversations.value[index] = { ...conversations.value[index], ...conversation };
  } else {
    conversations.value.unshift(conversation);
  }
  conversations.value.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

async function scrollToBottom() {
  await nextTick();
  const el = messageScroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function backToList() {
  activeConversation.value = null;
  pendingTarget.value = null;
  pendingForumTarget.value = null;
  messages.value = [];
  router.replace({
    query: {
      ...route.query,
      tab: "private",
      conversation: undefined,
      user: undefined,
      forumKind: undefined,
      forumId: undefined,
    },
  }).catch(() => null);
}

function openProfile() {
  if (activeCounterpart.value && !activeCounterpart.value.anonymous && activeCounterpart.value.id > 0) {
    router.push(`/u/${activeCounterpart.value.id}`);
  }
}

function openNoticeCenter() {
  router.replace({
    query: {
      ...route.query,
      tab: "all",
      conversation: undefined,
      user: undefined,
      forumKind: undefined,
      forumId: undefined,
    },
  }).catch(() => null);
}

function positiveQueryId(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function forumKindQuery(value: unknown): ForumDirectMessageKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "topic" || raw === "reply" ? raw : null;
}

function shortTime(value: string) {
  const sameDay = new Date(value).toDateString() === new Date().toDateString();
  return fmtDate(value, sameDay ? "HH:mm" : "MM-DD");
}

function messageTime(value: string) {
  return fmtDate(value, "MM-DD HH:mm");
}

function messageDeliveryText(message: DirectMessageItem) {
  if (message.aiReviewStatus === "checking") return "审核中";
  if (["blocked_ai", "blocked_force", "rejected_manual"].includes(message.aiReviewStatus)) return "未通过审核";
  if (message.aiReviewStatus === "review_failed") return "审核未完成";
  return message.readAt ? "已读" : "未读";
}

function conversationPreview(message?: DirectMessageItem | null) {
  if (!message) return "开始私聊";
  const mine = message.senderId === auth.user?.id ? "我：" : "";
  if (message.aiReviewStatus === "checking") return `${mine}[审核中] ${message.content}`;
  if (["blocked_ai", "blocked_force", "rejected_manual"].includes(message.aiReviewStatus)) return `${mine}[未通过审核] ${message.content}`;
  if (message.aiReviewStatus === "review_failed") return `${mine}[审核未完成] ${message.content}`;
  return `${mine}${message.content}`;
}

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
    || (error as { message?: string })?.message
    || fallback;
}
</script>

<style scoped>
.direct-messages {
  display: grid;
  grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
  height: clamp(620px, 68vh, 760px);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
}
.conversation-sidebar { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); border-right: 1px solid var(--cpu-border-soft); background: var(--cpu-surface-soft); }
.sidebar-head { min-height: 68px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--cpu-border-soft); }
.sidebar-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sidebar-head b { color: var(--cpu-text); }
.sidebar-head span { color: var(--cpu-text-secondary); font-size: 12px; }
.sidebar-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
.notice-link { display: none; margin-left: 0 !important; }
.conversation-list { min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.conversation-row { position: relative; width: 100%; min-width: 0; min-height: 68px; padding: 13px 14px; display: flex; gap: 10px; align-items: center; border: 0; border-bottom: 1px solid var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; transition: background-color .16s ease, box-shadow .16s ease; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.conversation-row:hover, .conversation-row.active { background: var(--cpu-card); }
.conversation-row:focus-visible { outline: 2px solid color-mix(in srgb, var(--cpu-primary) 60%, transparent); outline-offset: -3px; }
.conversation-row.active { box-shadow: inset 3px 0 var(--cpu-primary); }
.conversation-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
.conversation-line { min-width: 0; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.conversation-line b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.conversation-line small { flex-shrink: 0; color: var(--cpu-text-muted); font-size: 10px; }
.conversation-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cpu-text-secondary); font-size: 12px; }
.unread-dot { min-width: 20px; height: 20px; padding: 0 5px; display: grid; place-items: center; border-radius: 999px; background: #ef4444; color: white; font-size: 10px; }
.sidebar-state, .message-loading { min-height: 150px; padding: 24px; display: grid; place-items: center; color: var(--cpu-text-secondary); font-size: 13px; text-align: center; }
.sidebar-error { display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.chat-pane { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.chat-state { grid-row: 1 / -1; min-height: 520px; display: grid; place-items: center; color: var(--cpu-text-secondary); }
.chat-head { width: 100%; min-width: 0; min-height: 68px; padding: 10px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cpu-border-soft); box-sizing: border-box; overflow: hidden; }
.chat-title { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.chat-title b { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-title b :deep(.display-nickname) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-title span { color: var(--cpu-text-secondary); font-size: 12px; }
.mobile-back { display: none; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; padding: 0; border: 0; border-radius: 12px; background: var(--cpu-surface-soft); color: var(--cpu-primary); font-size: 20px; cursor: pointer; touch-action: manipulation; }
.mobile-back:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.message-scroller { width: 100%; min-width: 0; min-height: 0; padding: 18px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; background: linear-gradient(180deg, var(--cpu-surface-soft), var(--cpu-card)); box-sizing: border-box; }
.message-row { display: flex; margin: 8px 0; justify-content: flex-start; }
.message-row.mine { justify-content: flex-end; }
.message-bubble { max-width: min(76%, 620px); padding: 10px 12px 8px; border-radius: 6px 16px 16px 16px; background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); box-shadow: 0 3px 12px rgba(15, 23, 42, .06); }
.mine .message-bubble { border-radius: 16px 6px 16px 16px; background: color-mix(in srgb, var(--cpu-primary) 14%, var(--cpu-card)); border-color: color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft)); }
.message-bubble p { margin: 0; color: var(--cpu-text); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-bubble span { display: block; margin-top: 5px; color: var(--cpu-text-muted); font-size: 10px; text-align: right; }
.new-chat-tip { width: 100%; min-width: 0; min-height: 260px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; color: var(--cpu-text-secondary); text-align: center; box-sizing: border-box; }
.new-chat-tip b { width: 100%; max-width: 440px; color: var(--cpu-text); overflow-wrap: anywhere; }
.new-chat-tip > span { max-width: 440px; line-height: 1.6; }
.load-more { display: flex; justify-content: center; }
.composer { position: relative; z-index: 1; width: 100%; min-width: 0; padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 7px; border-top: 1px solid var(--cpu-border-soft); background: color-mix(in srgb, var(--cpu-card) 94%, transparent); box-shadow: 0 -8px 24px rgba(15, 23, 42, .04); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-sizing: border-box; overflow: hidden; }
.composer-row { width: 100%; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; }
.composer-row :deep(.el-textarea) { min-width: 0; }
.composer :deep(.el-textarea__inner) { min-height: 42px !important; padding: 10px 12px; line-height: 1.5; border-radius: 12px; }
.composer-row :deep(.el-button) { min-width: 76px; min-height: 42px; margin-left: 0; }
.composer-hint { min-width: 0; color: var(--cpu-text-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.message-report-button { margin-left: 6px; padding: 0; border: 0; background: transparent; color: var(--el-color-danger); font: inherit; cursor: pointer; }
.message-report-button:hover { text-decoration: underline; }

@media (max-width: 720px) {
  .direct-messages { display: block; width: 100%; max-width: 100%; height: 100%; min-height: 0; border: 0; border-radius: 0; box-sizing: border-box; }
  .conversation-sidebar { height: 100%; border-right: 0; }
  .chat-pane { display: none; height: 100%; min-height: 0; }
  .direct-messages.has-active .conversation-sidebar { display: none; }
  .direct-messages.has-active .chat-pane { display: grid; }
  .mobile-back { display: grid; }
  .sidebar-head { min-height: 64px; padding: 10px 14px; }
  .notice-link { display: inline-flex; }
  .message-scroller { padding: 14px 12px 18px; }
  .message-row { margin: 7px 0; }
  .message-bubble { max-width: 88%; padding: 9px 11px 7px; }
  .chat-head { min-height: 60px; padding: 8px 10px; gap: 8px; }
  .chat-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-link { flex: 0 0 auto; min-width: 44px; margin-left: 0 !important; padding-left: 5px !important; padding-right: 5px !important; font-size: 12px; }
  .composer { padding: 10px 10px max(10px, env(safe-area-inset-bottom)); gap: 8px; }
  .composer-row { gap: 8px; }
  .composer-row :deep(.el-button) { min-width: 64px; min-height: 42px; padding-inline: 14px; }
  .new-chat-tip { min-height: 100%; padding: 24px 22px; }
}

@media (max-width: 380px) {
  .chat-head :deep(.user-avatar) { width: 34px !important; height: 34px !important; }
  .profile-link { display: none; }
  .message-bubble { max-width: 92%; }
  .composer-hint { font-size: 10px; }
}
</style>
