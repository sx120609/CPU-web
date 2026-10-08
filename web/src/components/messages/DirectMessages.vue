<template>
  <div class="dm" :class="{ 'has-active': !!activeCounterpart }">
    <aside class="dm-side">
      <div class="dm-side-head">
        <div class="dm-side-title">
          <h3>私聊</h3>
          <span v-if="totalUnread" class="dm-count">{{ Math.min(totalUnread, 99) }}</span>
        </div>
        <button type="button" class="dm-text-btn dm-notice-link" @click="openNoticeCenter">其他通知</button>
      </div>
      <label v-if="conversations.length > 5 || searchQuery" class="dm-search">
        <el-icon><Search /></el-icon>
        <input v-model="searchQuery" type="search" placeholder="搜索会话" aria-label="搜索会话" />
      </label>

      <div v-if="listLoading && !conversations.length" class="dm-side-state">
        <span class="dm-spinner" aria-hidden="true"></span>
        <span>正在加载会话…</span>
      </div>
      <div v-else-if="listError && !conversations.length" class="dm-side-state">
        <span>{{ listError }}</span>
        <button type="button" class="dm-text-btn" @click="loadConversationList">重试</button>
      </div>
      <div v-else-if="!conversations.length" class="dm-side-state">
        <span class="dm-empty-icon"><el-icon><ChatLineRound /></el-icon></span>
        <b>还没有私聊</b>
        <span>在帖子或用户主页点击“私信”即可发起</span>
      </div>
      <div v-else class="dm-list">
        <button
          v-for="conversation in filteredConversations"
          :key="conversation.id"
          type="button"
          class="dm-row"
          :class="{ 'is-active': activeConversation?.id === conversation.id, 'is-unread': conversation.unreadCount > 0 }"
          :aria-current="activeConversation?.id === conversation.id ? 'true' : undefined"
          :aria-label="`打开与 ${conversationDisplayName(conversation)} 的私聊${conversation.unreadCount ? `，${conversation.unreadCount} 条未读` : ''}`"
          @click="openConversation(conversation.id)"
        >
          <UserAvatar
            :size="44"
            :src="conversation.counterpart.avatar"
            :name="conversation.counterpart.nickname"
            :seed="conversation.counterpart.id || conversation.counterpart.nickname"
            :profile-frame="conversation.counterpart.profileFrame"
            alt="私聊对象头像"
          />
          <span class="dm-row-copy">
            <span class="dm-row-line">
              <b :title="conversation.counterpartRemark ? `原昵称：${conversation.counterpart.nickname}` : undefined">
                <span v-if="conversation.counterpartRemark" class="dm-remark">{{ conversation.counterpartRemark }}</span>
                <DisplayNickname v-else :name="conversation.counterpart.nickname" />
              </b>
              <time>{{ shortTime(conversation.lastMessageAt) }}</time>
            </span>
            <span class="dm-row-line">
              <span class="dm-row-preview">{{ conversationPreview(conversation.lastMessage) }}</span>
              <span v-if="conversation.unreadCount" class="dm-count">{{ Math.min(conversation.unreadCount, 99) }}</span>
            </span>
          </span>
        </button>
        <p v-if="searchQuery && !filteredConversations.length" class="dm-list-empty">没有匹配“{{ searchQuery }}”的会话</p>
      </div>
    </aside>

    <section class="dm-chat">
      <div v-if="targetLoading" class="dm-chat-state">
        <span class="dm-spinner" aria-hidden="true"></span>
        <span>正在打开私聊…</span>
      </div>
      <div v-else-if="targetError && !activeCounterpart" class="dm-chat-state">
        <span class="dm-empty-icon"><el-icon><Warning /></el-icon></span>
        <b>{{ targetError }}</b>
        <button type="button" class="dm-pill-btn" @click="applyRouteTarget">重试</button>
      </div>
      <div v-else-if="!activeCounterpart" class="dm-chat-state">
        <span class="dm-empty-icon dm-empty-icon--lg"><el-icon><ChatLineRound /></el-icon></span>
        <b>选择一个会话开始聊天</b>
        <span>也可以从帖子或用户主页发起新的私聊</span>
      </div>
      <template v-else>
        <header class="dm-chat-head">
          <button type="button" class="dm-icon-btn dm-back" aria-label="返回会话列表" title="返回会话列表" @click="backToList">
            <el-icon><ArrowLeft /></el-icon>
          </button>
          <button
            type="button"
            class="dm-peer"
            :disabled="activeCounterpart.anonymous || activeCounterpart.id <= 0"
            :title="activeCounterpart.anonymous ? undefined : '查看资料'"
            @click="openProfile"
          >
            <UserAvatar
              :size="38"
              :src="activeCounterpart.avatar"
              :name="activeCounterpart.nickname"
              :seed="activeCounterpart.id || activeCounterpart.nickname"
              :profile-frame="activeCounterpart.profileFrame"
              alt="私聊对象头像"
            />
            <span class="dm-peer-copy">
              <b :title="activeRemark ? `原昵称：${activeCounterpart.nickname}` : undefined">
                <span v-if="activeRemark" class="dm-remark">{{ activeRemark }}</span>
                <DisplayNickname v-else :name="activeCounterpart.nickname" />
              </b>
              <small>{{ activeChatSubtitle }}</small>
            </span>
          </button>
          <div class="dm-head-actions">
            <button
              v-if="!activeCounterpart.anonymous && activeCounterpart.id > 0"
              type="button"
              class="dm-icon-btn"
              :aria-label="activeRemark ? '修改备注' : '设置备注'"
              :title="activeRemark ? '修改备注' : '设置备注'"
              @click="editCounterpartRemark"
            >
              <el-icon><EditPen /></el-icon>
            </button>
            <el-dropdown trigger="click" placement="bottom-end" @command="handleMoreCommand">
              <button type="button" class="dm-icon-btn" aria-label="更多操作" title="更多操作">
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="!activeCounterpart.anonymous && activeCounterpart.id > 0" command="profile" :icon="User">查看资料</el-dropdown-item>
                  <el-dropdown-item command="report" :icon="Warning">举报</el-dropdown-item>
                  <el-dropdown-item command="block" :icon="CircleClose" class="dm-danger-item">屏蔽</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </header>

        <div ref="messageScroller" class="dm-scroller" aria-live="polite" aria-label="私聊消息记录">
          <div class="dm-thread">
            <div v-if="nextCursor" class="dm-load-more">
              <button type="button" class="dm-pill-btn" :disabled="olderLoading" @click="loadOlderMessages">
                <span v-if="olderLoading" class="dm-spinner dm-spinner--sm" aria-hidden="true"></span>
                加载更早消息
              </button>
            </div>
            <div v-if="messageLoading && !messages.length" class="dm-thread-state">
              <span class="dm-spinner" aria-hidden="true"></span>
              <span>正在加载消息…</span>
            </div>
            <div v-else-if="messageError && !messages.length" class="dm-thread-state">
              <span>{{ messageError }}</span>
              <button type="button" class="dm-text-btn" @click="loadMessages(true)">重试</button>
            </div>
            <div v-else-if="!messages.length" class="dm-intro">
              <UserAvatar
                :size="64"
                :src="activeCounterpart.avatar"
                :name="activeCounterpart.nickname"
                :seed="activeCounterpart.id || activeCounterpart.nickname"
                :profile-frame="activeCounterpart.profileFrame"
                alt="私聊对象头像"
              />
              <b>发消息给 <DisplayNickname :name="activeCounterpart.nickname" /></b>
              <span>对方首次回复前最多发送两条，回复后即可继续交流。</span>
            </div>

            <template v-for="block in messageBlocks" :key="block.key">
              <div v-if="block.type === 'day'" class="dm-day"><span>{{ block.label }}</span></div>
              <div
                v-else
                class="dm-msg"
                :class="{
                  'is-mine': block.mine,
                  'is-first': block.first,
                  'is-last': block.last,
                  'is-rejected': isRejected(block.message),
                }"
              >
                <div class="dm-bubble-row">
                  <p class="dm-bubble">{{ block.message.content }}</p>
                  <button
                    v-if="!block.mine"
                    type="button"
                    class="dm-msg-report"
                    aria-label="举报这条消息"
                    title="举报这条消息"
                    @click="openMessageReport(block.message)"
                  >
                    <el-icon><Warning /></el-icon>
                  </button>
                </div>
                <div v-if="block.last || block.status" class="dm-meta">
                  <time v-if="block.last">{{ clockTime(block.message.createdAt) }}</time>
                  <span v-if="block.status" class="dm-status" :class="`is-${block.status.tone}`">{{ block.status.text }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <footer class="dm-dock">
          <div v-if="sendBlocked" class="dm-notice" role="status">
            <el-icon><InfoFilled /></el-icon>
            <span>已发送两条消息，请等待对方回复后再继续</span>
          </div>
          <div class="dm-composer" :class="{ 'is-disabled': sendBlocked }" @click="focusComposer">
            <textarea
              ref="composerRef"
              v-model="draft"
              rows="1"
              maxlength="2000"
              enterkeyhint="send"
              :disabled="sendBlocked || sending"
              :placeholder="sendBlocked ? '等待对方回复' : '输入消息，Enter 发送'"
              aria-label="输入私聊消息"
              @input="resizeComposer"
              @keydown="onComposerKeydown"
            ></textarea>
            <span v-if="draft.length >= 1800" class="dm-counter">{{ draft.length }}/2000</span>
            <button
              type="button"
              class="dm-send"
              aria-label="发送"
              title="发送（Enter）"
              :disabled="!canSubmit"
              @click.stop="sendMessage"
            >
              <span v-if="sending" class="dm-spinner dm-spinner--sm dm-spinner--light" aria-hidden="true"></span>
              <el-icon v-else><Top /></el-icon>
            </button>
          </div>
          <p class="dm-hint">{{ composerHint }} · 发送后后台审核，通过后对方才会收到</p>
        </footer>
      </template>
    </section>

    <el-dialog v-model="reportOverviewOpen" title="举报与投诉" width="min(460px, calc(100vw - 32px))" append-to-body destroy-on-close>
      <p class="dm-report-lead">请选择需要举报的消息，举报将提交给管理员处理。</p>
      <div v-if="reportableMessages.length" class="dm-report-options">
        <button
          v-for="message in reportableMessages"
          :key="message.id"
          type="button"
          class="dm-report-option"
          @click="openMessageReport(message)"
        >
          <time>{{ messageTime(message.createdAt) }}</time>
          <span>{{ message.content }}</span>
        </button>
      </div>
      <p v-else class="dm-report-lead">当前没有可举报的对方消息。</p>
      <el-button v-if="activeCounterpart && !activeCounterpart.anonymous && activeCounterpart.id > 0" @click="openCounterpartReport">举报用户资料</el-button>
      <p class="dm-report-foot">其他投诉或无法选择消息时，可联系 <a href="mailto:sl@qiuxieit.cn">sl@qiuxieit.cn</a>，说明会话时间及问题；请勿提供密码或验证码。</p>
      <template #footer><el-button @click="reportOverviewOpen = false">关闭</el-button></template>
    </el-dialog>
    <ContentReportDialog
      v-if="reportTarget"
      v-model="reportDialogOpen"
      :target-type="reportTarget.type"
      :target-id="reportTarget.id"
      :target-label="reportTarget.label"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  ArrowLeft,
  ChatLineRound,
  CircleClose,
  EditPen,
  InfoFilled,
  MoreFilled,
  Search,
  Top,
  User,
  Warning,
} from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import { blockUser } from "@/utils/userBlock";
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
import { promptDirectMessageRemark } from "@/utils/directMessageRemark";

const emit = defineEmits<{ (event: "notices-read", conversationId: number): void }>();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const conversations = ref<DirectConversation[]>([]);
const totalUnread = ref(0);
const activeConversation = ref<DirectConversation | null>(null);
const pendingTarget = ref<DirectMessageUser | null>(null);
const pendingTargetRemark = ref<string | null>(null);
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
const reportOverviewOpen = ref(false);
const reportTarget = ref<{ type: "direct_message" | "user"; id: number; label: string } | null>(null);
const reportableMessages = computed(() => messages.value.filter(message => message.senderId !== auth.user?.id));
const composerRef = ref<HTMLTextAreaElement | null>(null);
const searchQuery = ref("");
const filteredConversations = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase();
  if (!keyword) return conversations.value;
  return conversations.value.filter((conversation) => [
    conversation.counterpartRemark,
    conversation.counterpart.nickname,
    conversation.lastMessage?.content,
  ].some((text) => text?.toLowerCase().includes(keyword)));
});

// 同一个人 5 分钟内连续发出的消息合成一组：只在组尾显示时间，气泡圆角连成一串
const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;
type MessageStatus = { text: string; tone: "muted" | "read" | "warn" | "danger" };
type MessageBlock =
  | { type: "day"; key: string; label: string }
  | {
    type: "message";
    key: string;
    message: DirectMessageItem;
    mine: boolean;
    first: boolean;
    last: boolean;
    status: MessageStatus | null;
  };
const messageBlocks = computed<MessageBlock[]>(() => {
  const blocks: MessageBlock[] = [];
  const items = messages.value;
  items.forEach((message, index) => {
    const previous = items[index - 1];
    const next = items[index + 1];
    const day = dayKey(message.createdAt);
    if (!previous || dayKey(previous.createdAt) !== day) {
      blocks.push({ type: "day", key: `day-${day}-${message.id}`, label: dayLabel(message.createdAt) });
    }
    const mine = message.senderId === auth.user?.id;
    const first = !previous || !sameGroup(previous, message);
    const last = !next || !sameGroup(message, next);
    blocks.push({
      type: "message",
      key: `message-${message.id}`,
      message,
      mine,
      first,
      last,
      status: mine ? messageStatus(message, last) : null,
    });
  });
  return blocks;
});
let disposed = false;
let refreshTimer = 0;
let routeSeq = 0;
let messageSeq = 0;

const activeCounterpart = computed(() => activeConversation.value?.counterpart || pendingTarget.value);
async function blockCounterpart() {
  const conversationId = activeConversation.value?.id;
  const targetId = conversationId || activeCounterpart.value?.id;
  if (!targetId) return;
  if (await blockUser(conversationId ? "conversation" : "user", targetId)) {
    activeConversation.value = null;
    pendingTarget.value = null;
    messages.value = [];
    await router.replace("/profile/privacy");
  }
}
const activeRemark = computed(() => activeConversation.value?.counterpartRemark || pendingTargetRemark.value || null);
const activeDisplayName = computed(() => activeRemark.value || activeCounterpart.value?.nickname || "对方");
const activeChatSubtitle = computed(() => {
  const conversation = activeConversation.value;
  const status = conversation?.sendState.limitedUntilReply
    ? `对方回复前还可发送 ${conversation.sendState.remainingBeforeReply} 条`
    : conversation
      ? "站内私聊"
      : "新私聊 · 对方回复前最多发送两条";
  return activeRemark.value && activeCounterpart.value?.nickname
    ? `原昵称：${activeCounterpart.value.nickname} · ${status}`
    : status;
});
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
  if (disposed) return;
  // 页面在后台时不轮询，回到前台立即刷新一次。
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) void refreshVisibleConversation();
  }, 7000);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  disposed = true;
  routeSeq += 1;
  messageSeq += 1;
  if (refreshTimer) window.clearInterval(refreshTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  flushComposerDraft();
});

function handleVisibilityChange() {
  if (!document.hidden) void refreshVisibleConversation();
}

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

// 草稿恢复、发送后清空、切换会话都会改动内容，输入框高度要跟着变
watch([draft, composerRef], () => {
  void nextTick(resizeComposer);
});

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
      pendingTargetRemark.value = null;
      pendingForumTarget.value = null;
      messages.value = [];
      targetError.value = "会话不存在或已不可访问";
      return;
    }
    pendingTarget.value = null;
    pendingTargetRemark.value = null;
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
        pendingTargetRemark.value = null;
        pendingForumTarget.value = null;
        await loadMessages(true);
      } else {
        activeConversation.value = null;
        pendingTarget.value = result.counterpart;
        pendingTargetRemark.value = result.counterpartRemark;
        pendingForumTarget.value = { kind: forumKind, postId: forumId };
        messages.value = [];
        nextCursor.value = null;
      }
    } catch (error) {
      if (disposed || seq !== routeSeq) return;
      activeConversation.value = null;
      pendingTarget.value = null;
      pendingTargetRemark.value = null;
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
        pendingTargetRemark.value = null;
        pendingForumTarget.value = null;
        await loadMessages(true);
      } else {
        activeConversation.value = null;
        pendingTarget.value = result.counterpart;
        pendingTargetRemark.value = result.counterpartRemark;
        pendingForumTarget.value = null;
        messages.value = [];
        nextCursor.value = null;
      }
    } catch (error) {
      if (disposed || seq !== routeSeq) return;
      activeConversation.value = null;
      pendingTarget.value = null;
      pendingTargetRemark.value = null;
      pendingForumTarget.value = null;
      messages.value = [];
      targetError.value = errorMessage(error, "私聊对象加载失败");
    } finally {
      if (!disposed && seq === routeSeq) targetLoading.value = false;
    }
    return;
  }

  clearActiveTarget();
}

function openConversation(conversationId: number) {
  router.push({
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
    pendingTargetRemark.value = null;
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
  reportOverviewOpen.value = false;
  reportTarget.value = { type: "direct_message", id: message.id, label: `${messageTime(message.createdAt)} · ${message.content.slice(0, 80)}` };
  reportDialogOpen.value = true;
}

function openCounterpartReport() {
  const user = activeCounterpart.value;
  if (!user || user.anonymous || user.id <= 0) return;
  reportOverviewOpen.value = false;
  reportTarget.value = { type: "user", id: user.id, label: `${activeDisplayName.value} 的用户资料` };
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

function conversationDisplayName(conversation: DirectConversation) {
  return conversation.counterpartRemark || conversation.counterpart.nickname || "对方";
}

async function scrollToBottom() {
  await nextTick();
  const el = messageScroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function backToList() {
  clearActiveTarget();
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

function clearActiveTarget() {
  messageSeq += 1;
  activeConversation.value = null;
  pendingTarget.value = null;
  pendingTargetRemark.value = null;
  pendingForumTarget.value = null;
  messages.value = [];
  nextCursor.value = null;
  messageLoading.value = false;
  messageError.value = "";
}

function openProfile() {
  if (activeCounterpart.value && !activeCounterpart.value.anonymous && activeCounterpart.value.id > 0) {
    router.push(`/u/${activeCounterpart.value.id}`);
  }
}

async function editCounterpartRemark() {
  const counterpart = activeCounterpart.value;
  if (!counterpart || counterpart.anonymous || counterpart.id <= 0) return;
  const result = await promptDirectMessageRemark({
    userId: counterpart.id,
    nickname: counterpart.nickname,
    currentRemark: activeRemark.value,
  });
  if (!result.changed) return;
  if (activeConversation.value) {
    const updated = { ...activeConversation.value, counterpartRemark: result.remark };
    activeConversation.value = updated;
    upsertConversation(updated);
  } else {
    pendingTargetRemark.value = result.remark;
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

function sameGroup(a: DirectMessageItem, b: DirectMessageItem) {
  return a.senderId === b.senderId
    && dayKey(a.createdAt) === dayKey(b.createdAt)
    && new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() < MESSAGE_GROUP_GAP_MS;
}

function dayKey(value: string) {
  return fmtDate(value, "YYYY-MM-DD");
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "今天";
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return fmtDate(value, date.getFullYear() === today.getFullYear() ? "M月D日" : "YYYY年M月D日");
}

function clockTime(value: string) {
  return fmtDate(value, "HH:mm");
}

function isRejected(message: DirectMessageItem) {
  return ["blocked_ai", "blocked_force", "rejected_manual"].includes(message.aiReviewStatus);
}

// 审核状态每条都要显示；已读 / 未读只挂在组尾，避免重复
function messageStatus(message: DirectMessageItem, last: boolean): MessageStatus | null {
  if (message.aiReviewStatus === "checking") return { text: "审核中", tone: "warn" };
  if (isRejected(message)) return { text: "未通过审核", tone: "danger" };
  if (message.aiReviewStatus === "review_failed") return { text: "审核未完成", tone: "warn" };
  if (!last) return null;
  return message.readAt ? { text: "已读", tone: "read" } : { text: "未读", tone: "muted" };
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

function handleMoreCommand(command: string) {
  if (command === "profile") openProfile();
  else if (command === "report") reportOverviewOpen.value = true;
  else if (command === "block") void blockCounterpart();
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

<style scoped lang="scss">
@use "../../styles/compact" as *;

/* 按钮统一清掉浏览器默认样式；:where 保持零特异性，后面的具体类可以直接覆盖。 */
.dm :where(button) {
  margin: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.dm :where(button:disabled) {
  cursor: default;
}
.dm :where(button:focus-visible) {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

/* ---------- 外框 ---------- */
.dm {
  --dm-hover: color-mix(in srgb, var(--cpu-text) 5%, transparent);
  --dm-theirs: var(--cpu-surface-subtle);
  --dm-mine: var(--cpu-button-primary);
  --dm-mine-ink: var(--cpu-button-on-primary);
  --dm-warn-ink: #a15c07;
  display: grid;
  grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
  /* 225px 是顶栏、页头和标签栏的高度，再留出卡片与页面底部内边距，让输入框落在首屏内 */
  height: clamp(480px, calc(100dvh - 290px), 860px);
  min-height: 0;
  overflow: hidden;
  color: var(--cpu-text);
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
}
html[data-theme="dark"] .dm {
  --dm-warn-ink: var(--cpu-warn);
}

.dm-count {
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0 5px;
  border-radius: var(--cpu-radius-pill);
  color: #fff;
  background: var(--cpu-danger);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  box-sizing: border-box;
}
.dm-text-btn {
  padding: 4px 8px;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
  font-weight: 500;
}
.dm-text-btn:hover {
  background: var(--dm-hover);
}
.dm-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-pill);
  color: var(--cpu-text-secondary);
  background: var(--cpu-card);
  font-size: var(--cpu-fs-s);
  transition: color 0.15s ease, border-color 0.15s ease;
}
.dm-pill-btn:not(:disabled):hover {
  border-color: var(--cpu-border-soft);
  color: var(--cpu-primary);
}
.dm-icon-btn {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-l);
  transition: background-color 0.15s ease, color 0.15s ease;
}
.dm-icon-btn:hover {
  color: var(--cpu-text);
  background: var(--dm-hover);
}
.dm-spinner {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border: 2px solid var(--cpu-primary-soft);
  border-top-color: var(--cpu-primary);
  border-radius: 50%;
  animation: dm-spin 0.8s linear infinite;
}
.dm-spinner--sm {
  width: 13px;
  height: 13px;
}
.dm-spinner--light {
  border-color: color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
}
.dm-empty-icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: var(--cpu-radius-l);
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  font-size: var(--cpu-fs-xl);
}
.dm-empty-icon--lg {
  width: 56px;
  height: 56px;
  border-radius: var(--cpu-radius-l);
  font-size: 26px;
}
.dm-remark {
  color: var(--cpu-text);
  font: inherit;
}

/* ---------- 会话列表 ---------- */
.dm-side {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
}
.dm-side-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 60px;
  padding: 0 12px 0 18px;
}
.dm-side-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dm-side-title h3 {
  margin: 0;
  font-size: var(--cpu-fs-l);
  font-weight: 500;
}
.dm-notice-link {
  display: none;
}
.dm-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 0 12px 8px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-muted);
  background: var(--cpu-card);
  transition: border-color 0.15s ease;
}
.dm-search:focus-within {
  border-color: var(--cpu-border-soft);
}
.dm-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--cpu-text);
  background: transparent;
  font: inherit;
  font-size: var(--cpu-fs-s);
}
.dm-search input::placeholder {
  color: var(--cpu-text-muted);
}
.dm-list {
  flex: 1;
  min-height: 0;
  padding: 0 8px 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.dm-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-width: 0;
  padding: 10px;
  border-radius: var(--cpu-radius-l);
  text-align: left;
  transition: background-color 0.12s ease;
  touch-action: manipulation;
}
.dm-row + .dm-row {
  margin-top: 2px;
}
.dm-row:hover {
  background: var(--dm-hover);
}
.dm-row.is-active {
  background: var(--cpu-primary-soft);
}
.dm-row-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.dm-row-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.dm-row-line b {
  min-width: 0;
  overflow: hidden;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-row-line time {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  font-variant-numeric: tabular-nums;
}
.dm-row-preview {
  min-width: 0;
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-row.is-unread .dm-row-preview {
  color: var(--cpu-text-secondary);
}
.dm-list-empty {
  margin: 24px 12px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
  text-align: center;
}
.dm-side-state,
.dm-chat-state,
.dm-thread-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding: 24px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
  text-align: center;
}
.dm-side-state b,
.dm-chat-state b {
  margin-top: 4px;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  font-weight: 500;
}

/* ---------- 聊天区 ---------- */
.dm-chat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.dm-chat-state {
  gap: 6px;
}
.dm-chat-state b {
  margin-top: 8px;
  font-size: var(--cpu-fs-l);
}
.dm-chat-state .dm-pill-btn {
  margin-top: 8px;
}
.dm-chat-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  height: 60px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.dm-back {
  display: none;
}
.dm-peer {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 4px 8px 4px 4px;
  border-radius: var(--cpu-radius-l);
  text-align: left;
  transition: background-color 0.12s ease;
}
.dm-peer:not(:disabled):hover {
  background: var(--dm-hover);
}
.dm-peer-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dm-peer-copy b {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-peer-copy b :deep(.display-nickname) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-peer-copy small {
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dm-head-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}
:global(.el-dropdown-menu__item.dm-danger-item) {
  color: var(--cpu-danger);
}

.dm-scroller {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.dm-thread {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 16px 20px 20px;
}
.dm-load-more {
  display: flex;
  justify-content: center;
  padding: 4px 0 12px;
}
.dm-intro {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
}
.dm-intro b {
  max-width: 420px;
  margin-top: 6px;
  font-size: var(--cpu-fs-l);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.dm-intro > span {
  max-width: 320px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}

.dm-day {
  display: flex;
  justify-content: center;
  margin: 14px 0 10px;
}
.dm-day span {
  padding: 2px 10px;
  border-radius: var(--cpu-radius-pill);
  color: var(--cpu-text-muted);
  background: var(--cpu-surface-soft);
  font-size: var(--cpu-fs-xs);
}
.dm-msg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 3px;
}
.dm-msg.is-first {
  margin-top: 12px;
}
.dm-msg.is-mine {
  align-items: flex-end;
}
.dm-bubble-row {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: min(78%, 560px);
}
.dm-bubble {
  min-width: 0;
  margin: 0;
  padding: 9px 14px;
  border-radius: 6px 18px 18px 6px;
  color: var(--cpu-text);
  background: var(--dm-theirs);
  font-size: var(--cpu-fs-m);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dm-msg.is-first .dm-bubble { border-top-left-radius: 18px; }
.dm-msg.is-last .dm-bubble { border-bottom-left-radius: 18px; }
.dm-msg.is-mine .dm-bubble {
  border-radius: 18px 6px 6px 18px;
  color: var(--dm-mine-ink);
  background: var(--dm-mine);
}
.dm-msg.is-mine.is-first .dm-bubble { border-top-right-radius: 18px; }
.dm-msg.is-mine.is-last .dm-bubble { border-bottom-right-radius: 18px; }
.dm-msg.is-rejected .dm-bubble {
  color: var(--cpu-text-secondary);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--cpu-border-soft);
}
.dm-msg-report {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-m);
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease, background-color 0.12s ease;
}
.dm-msg:hover .dm-msg-report,
.dm-msg-report:focus-visible {
  opacity: 1;
}
.dm-msg-report:hover {
  color: var(--cpu-danger);
  background: var(--cpu-danger-soft);
}
@media (hover: none) {
  /* 触屏上逐条按钮太挤，举报统一走顶部“更多 → 举报” */
  .dm-msg-report {
    display: none;
  }
}
.dm-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 4px 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  font-variant-numeric: tabular-nums;
}
.dm-status.is-warn {
  color: var(--dm-warn-ink);
}
.dm-status.is-danger {
  color: var(--cpu-danger);
}
.dm-status.is-read {
  color: var(--cpu-primary);
}

/* ---------- 输入区 ---------- */
.dm-dock {
  flex: 0 0 auto;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 6px 20px 12px;
}
.dm-notice {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  padding: 8px 12px;
  border-radius: var(--cpu-radius-l);
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface-soft);
  font-size: var(--cpu-fs-s);
}
.dm-notice .el-icon {
  flex: 0 0 auto;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-m);
}
.dm-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 6px 6px 16px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface);
  cursor: text;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dm-composer:focus-within {
  border-color: var(--cpu-border-soft);
  box-shadow: 0 0 0 4px var(--cpu-primary-soft);
}
.dm-composer.is-disabled {
  cursor: not-allowed;
  background: var(--cpu-surface-soft);
}
.dm-composer textarea {
  flex: 1;
  min-width: 0;
  height: 36px;
  max-height: 140px;
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
.dm-composer textarea::placeholder {
  color: var(--cpu-text-muted);
}
.dm-composer textarea:disabled {
  cursor: not-allowed;
}
.dm-counter {
  align-self: center;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  font-variant-numeric: tabular-nums;
}
.dm-send {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--cpu-button-on-primary);
  background: var(--cpu-button-primary);
  font-size: var(--cpu-fs-l);
  transition: transform 0.12s ease, filter 0.15s ease;
}
.dm-send:not(:disabled):hover {
  filter: brightness(1.06);
}
.dm-send:not(:disabled):active {
  transform: scale(0.94);
}
.dm-send:disabled {
  color: var(--cpu-text-muted);
  background: var(--cpu-surface-subtle);
}
.dm-hint {
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 举报弹窗 ---------- */
.dm-report-lead {
  margin: 0 0 12px;
  color: var(--cpu-text-secondary);
}
.dm-report-options {
  display: grid;
  gap: 6px;
  max-height: 280px;
  margin-bottom: 14px;
  overflow: auto;
}
.dm-report-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  color: var(--cpu-text);
  background: var(--cpu-surface);
  text-align: left;
  transition: border-color 0.15s ease;
}
.dm-report-option:hover {
  border-color: var(--cpu-border-soft);
}
.dm-report-option time {
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.dm-report-option span {
  overflow-wrap: anywhere;
  font-size: var(--cpu-fs-s);
  line-height: 1.5;
}
.dm-report-foot {
  margin: 14px 0 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}

@keyframes dm-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .dm *,
  .dm *::before,
  .dm *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ---------- 窄屏：列表与聊天二选一 ---------- */
/* Same switch as the messages page (shared compact layout), so iPad portrait never gets the desktop two-pane card. */
@include compact-layout {
  .dm {
    display: block;
    width: 100%;
    max-width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    border-radius: var(--cpu-radius-l);
    box-sizing: border-box;
  }
  .dm-side {
    height: 100%;
    border-right: 0;
    background: var(--cpu-card);
  }
  .dm-chat {
    display: none;
    height: 100%;
  }
  .dm.has-active .dm-side {
    display: none;
  }
  .dm.has-active .dm-chat {
    display: flex;
  }
  .dm-side-head {
    height: 54px;
    padding: 0 8px 0 16px;
  }
  .dm-notice-link {
    display: inline-flex;
  }
  .dm-list {
    padding: 0 6px 8px;
  }
  .dm-row {
    padding: 10px 8px;
  }
  .dm-back {
    display: grid;
    margin-right: -4px;
    color: var(--cpu-primary);
    font-size: var(--cpu-fs-xl);
  }
  .dm-chat-head {
    height: 56px;
    padding: 0 4px;
  }
  .dm-peer {
    padding-right: 4px;
  }
  .dm-thread {
    padding: 10px 12px 14px;
  }
  .dm-bubble-row {
    max-width: 84%;
  }
  .dm-dock {
    padding: 6px 8px max(8px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--cpu-border-soft);
  }
  .dm-composer {
    padding: 4px 4px 4px 14px;
    border-radius: var(--cpu-radius-l);
  }
  .dm-composer textarea {
    /* 16px 以下 iOS 会在聚焦时自动放大页面 */
    font-size: var(--cpu-fs-l);
    max-height: 112px;
  }
  .dm-hint {
    margin-top: 5px;
    font-size: var(--cpu-fs-xs);
  }
}

@media (max-width: 380px) {
  .dm-bubble-row {
    max-width: 90%;
  }
}
</style>
