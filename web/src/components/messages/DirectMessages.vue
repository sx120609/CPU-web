<template>
  <div class="direct-messages" :class="{ 'has-active': !!activeCounterpart }">
    <aside class="conversation-sidebar">
      <div class="sidebar-head">
        <div>
          <b>站内私聊</b>
          <span>消息记录会保存在站内</span>
        </div>
        <el-badge :value="totalUnread" :hidden="!totalUnread" :max="99" />
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
          @click="openConversation(conversation.id)"
        >
          <UserAvatar
            :size="42"
            :src="conversation.counterpart.avatar"
            :name="conversation.counterpart.nickname"
            :seed="conversation.counterpart.id"
            :profile-frame="conversation.counterpart.profileFrame"
            alt="私聊对象头像"
          />
          <span class="conversation-copy">
            <span class="conversation-line">
              <b>{{ conversation.counterpart.nickname }}</b>
              <small>{{ shortTime(conversation.lastMessageAt) }}</small>
            </span>
            <span class="conversation-preview">
              {{ conversation.lastMessage?.senderId === auth.user?.id ? "我：" : "" }}{{ conversation.lastMessage?.content || "开始私聊" }}
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
        <el-empty description="从用户主页发起私聊，或在左侧选择一个会话" />
      </div>
      <template v-else>
        <header class="chat-head">
          <button type="button" class="mobile-back" aria-label="返回会话列表" @click="backToList">‹</button>
          <UserAvatar
            :size="40"
            :src="activeCounterpart.avatar"
            :name="activeCounterpart.nickname"
            :seed="activeCounterpart.id"
            :profile-frame="activeCounterpart.profileFrame"
            alt="私聊对象头像"
          />
          <div class="chat-title">
            <b>{{ activeCounterpart.nickname }}</b>
            <span v-if="activeConversation?.sendState.limitedUntilReply">
              对方回复前还可发送 {{ activeConversation.sendState.remainingBeforeReply }} 条
            </span>
            <span v-else-if="!activeConversation">新私聊 · 对方回复前最多发送两条</span>
            <span v-else>站内私聊</span>
          </div>
          <el-button text type="primary" @click="openProfile">查看资料</el-button>
        </header>

        <div ref="messageScroller" class="message-scroller">
          <div v-if="nextCursor" class="load-more">
            <el-button text type="primary" :loading="olderLoading" @click="loadOlderMessages">加载更早消息</el-button>
          </div>
          <div v-if="messageLoading && !messages.length" class="message-loading">正在加载消息...</div>
          <div v-else-if="messageError && !messages.length" class="message-loading sidebar-error">
            <span>{{ messageError }}</span>
            <el-button text type="primary" @click="loadMessages(true)">重试</el-button>
          </div>
          <div v-else-if="!messages.length" class="new-chat-tip">
            <b>开始和 {{ activeCounterpart.nickname }} 私聊</b>
            <span>为减少打扰，对方首次回复前你最多可以发送两条消息。</span>
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
                <template v-if="message.senderId === auth.user?.id"> · {{ message.readAt ? "已读" : "未读" }}</template>
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
          <el-input
            v-model="draft"
            type="textarea"
            :rows="3"
            resize="none"
            maxlength="2000"
            show-word-limit
            :disabled="sendBlocked || sending"
            :placeholder="sendBlocked ? '等待对方回复' : '输入消息，Enter 发送，Shift + Enter 换行'"
            @keydown="onComposerKeydown"
          />
          <div class="composer-actions">
            <span>{{ composerHint }}</span>
            <el-button type="primary" :loading="sending" :disabled="!canSubmit" @click="sendMessage">发送</el-button>
          </div>
        </footer>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import UserAvatar from "@/components/common/UserAvatar.vue";
import {
  directMessageApi,
  type DirectConversation,
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
let disposed = false;
let refreshTimer = 0;
let routeSeq = 0;
let messageSeq = 0;

const activeCounterpart = computed(() => activeConversation.value?.counterpart || pendingTarget.value);
const sendBlocked = computed(() => Boolean(activeConversation.value && !activeConversation.value.sendState.canSend));
const canSubmit = computed(() => Boolean(draft.value.trim()) && !sendBlocked.value && !sending.value);
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
});

watch(
  () => [route.query.tab, route.query.user, route.query.conversation],
  () => {
    if (route.query.tab === "private") void applyRouteTarget();
  },
);

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

  if (conversationId) {
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (!conversation) {
      activeConversation.value = null;
      pendingTarget.value = null;
      messages.value = [];
      targetError.value = "会话不存在或已不可访问";
      return;
    }
    pendingTarget.value = null;
    activeConversation.value = conversation;
    await loadMessages(true);
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
        await loadMessages(true);
      } else {
        activeConversation.value = null;
        pendingTarget.value = result.counterpart;
        messages.value = [];
        nextCursor.value = null;
      }
    } catch (error) {
      if (disposed || seq !== routeSeq) return;
      activeConversation.value = null;
      pendingTarget.value = null;
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
    query: { ...route.query, tab: "private", conversation: String(conversationId), user: undefined },
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
    const result = activeConversation.value
      ? await directMessageApi.send(activeConversation.value.id, content, { suppressErrorMessage: true })
      : await directMessageApi.sendToUser(counterpart.id, content, { suppressErrorMessage: true });
    draft.value = "";
    pendingTarget.value = null;
    activeConversation.value = result.conversation;
    mergeMessages([result.message]);
    upsertConversation({ ...result.conversation, lastMessage: result.message });
    await router.replace({
      query: { ...route.query, tab: "private", conversation: String(result.conversation.id), user: undefined },
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
  messages.value = [];
  router.replace({ query: { ...route.query, tab: "private", conversation: undefined, user: undefined } }).catch(() => null);
}

function openProfile() {
  if (activeCounterpart.value) router.push(`/u/${activeCounterpart.value.id}`);
}

function positiveQueryId(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function shortTime(value: string) {
  const sameDay = new Date(value).toDateString() === new Date().toDateString();
  return fmtDate(value, sameDay ? "HH:mm" : "MM-DD");
}

function messageTime(value: string) {
  return fmtDate(value, "MM-DD HH:mm");
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
  min-height: 620px;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
}
.conversation-sidebar { min-width: 0; border-right: 1px solid var(--cpu-border-soft); background: var(--cpu-surface-soft); }
.sidebar-head { min-height: 68px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--cpu-border-soft); }
.sidebar-head > div { display: flex; flex-direction: column; gap: 3px; }
.sidebar-head b { color: var(--cpu-text); }
.sidebar-head span { color: var(--cpu-text-secondary); font-size: 12px; }
.conversation-list { display: flex; flex-direction: column; max-height: 550px; overflow-y: auto; }
.conversation-row { position: relative; width: 100%; min-width: 0; padding: 13px 14px; display: flex; gap: 10px; align-items: center; border: 0; border-bottom: 1px solid var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.conversation-row:hover, .conversation-row.active { background: var(--cpu-card); }
.conversation-row.active { box-shadow: inset 3px 0 var(--cpu-primary); }
.conversation-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
.conversation-line { min-width: 0; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.conversation-line b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.conversation-line small { flex-shrink: 0; color: var(--cpu-text-muted); font-size: 10px; }
.conversation-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cpu-text-secondary); font-size: 12px; }
.unread-dot { min-width: 20px; height: 20px; padding: 0 5px; display: grid; place-items: center; border-radius: 999px; background: #ef4444; color: white; font-size: 10px; }
.sidebar-state, .message-loading { min-height: 150px; padding: 24px; display: grid; place-items: center; color: var(--cpu-text-secondary); font-size: 13px; text-align: center; }
.sidebar-error { display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.chat-pane { min-width: 0; min-height: 620px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.chat-state { grid-row: 1 / -1; min-height: 520px; display: grid; place-items: center; color: var(--cpu-text-secondary); }
.chat-head { min-height: 68px; padding: 10px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cpu-border-soft); }
.chat-title { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.chat-title b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-title span { color: var(--cpu-text-secondary); font-size: 12px; }
.mobile-back { display: none; border: 0; background: transparent; color: var(--cpu-primary); font-size: 28px; cursor: pointer; }
.message-scroller { min-height: 0; max-height: 410px; padding: 18px; overflow-y: auto; background: linear-gradient(180deg, var(--cpu-surface-soft), var(--cpu-card)); }
.message-row { display: flex; margin: 8px 0; justify-content: flex-start; }
.message-row.mine { justify-content: flex-end; }
.message-bubble { max-width: min(76%, 620px); padding: 10px 12px 8px; border-radius: 6px 16px 16px 16px; background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); box-shadow: 0 2px 7px rgba(15, 23, 42, .05); }
.mine .message-bubble { border-radius: 16px 6px 16px 16px; background: color-mix(in srgb, var(--cpu-primary) 14%, var(--cpu-card)); border-color: color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft)); }
.message-bubble p { margin: 0; color: var(--cpu-text); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-bubble span { display: block; margin-top: 5px; color: var(--cpu-text-muted); font-size: 10px; text-align: right; }
.new-chat-tip { min-height: 260px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; color: var(--cpu-text-secondary); text-align: center; }
.new-chat-tip b { color: var(--cpu-text); }
.load-more { display: flex; justify-content: center; }
.composer { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 9px; border-top: 1px solid var(--cpu-border-soft); background: var(--cpu-card); }
.composer-actions { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
.composer-actions span { color: var(--cpu-text-secondary); font-size: 11px; }

@media (max-width: 720px) {
  .direct-messages { display: block; min-height: 560px; }
  .conversation-sidebar { border-right: 0; }
  .chat-pane { display: none; min-height: 560px; }
  .direct-messages.has-active .conversation-sidebar { display: none; }
  .direct-messages.has-active .chat-pane { display: grid; }
  .conversation-list { max-height: 490px; }
  .mobile-back { display: block; padding: 0 4px 0 0; }
  .message-scroller { max-height: 360px; padding: 13px; }
  .message-bubble { max-width: 88%; }
  .chat-head { padding: 10px 12px; }
  .chat-head :deep(.el-button) { padding-left: 6px; padding-right: 6px; }
  .composer { padding: 10px 11px 12px; }
}
</style>
