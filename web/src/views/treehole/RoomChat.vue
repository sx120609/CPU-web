<template>
  <div class="th-chat">
    <header class="th-chat-head">
      <button type="button" class="th-chat-back" aria-label="返回" @click="goBack">
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <div class="th-chat-title">
        <strong>{{ detail?.room.name || "宣泄室" }}<em v-if="detail" class="th-chip is-brand">{{ detail.room.categoryLabel }}</em></strong>
        <span v-if="detail">{{ detail.visitorCount }} 位同学 · {{ detail.hostCount }} 位小艾绒<template v-if="detail.me"> · 我是 {{ detail.me.alias }}</template></span>
      </div>
      <el-dropdown v-if="detail" trigger="click" @command="onCommand">
        <el-badge :value="pendingCount" :hidden="!detail.canModerate || !pendingCount" class="th-room-badge">
          <el-button text :aria-label="pendingCount && detail.canModerate ? `更多操作，${pendingCount} 条入群申请待审核` : '更多操作'"><el-icon><MoreFilled /></el-icon></el-button>
        </el-badge>
        <template #dropdown>
          <el-dropdown-menu>
            <template v-if="detail.canModerate">
              <el-dropdown-item command="applications">入群申请{{ pendingCount ? `（${pendingCount}）` : "" }}</el-dropdown-item>
              <el-dropdown-item command="members">成员管理</el-dropdown-item>
              <el-dropdown-item v-if="detail.room.status === 'active'" command="close">关闭宣泄室</el-dropdown-item>
            </template>
            <el-dropdown-item v-if="detail.me" command="leave" :divided="detail.canModerate">退出宣泄室</el-dropdown-item>
            <el-dropdown-item v-if="!detail.me && !detail.canModerate" command="noop" disabled>只读查看</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <div v-if="detail" class="th-help th-room-rules" role="note">
      <button type="button" class="th-help-summary" :aria-expanded="rulesExpanded" @click="rulesExpanded = !rulesExpanded">
        <span class="th-rules-line">只显示虚拟 ID · 不打听身份、不交换联系方式</span>
        <em>{{ rulesExpanded ? "收起" : "群规" }}</em>
      </button>
      <template v-if="rulesExpanded">
        <p>这里只显示虚拟 ID。请互相温柔以待，不要打听身份、交换联系方式或互加好友。</p>
        <p v-if="detail.room.intro">{{ detail.room.intro }}</p>
      </template>
    </div>

    <div ref="body" class="th-chat-body" aria-live="polite" @scroll.passive="scroller.onScroll">
      <div v-if="loading" class="th-empty">加载中…</div>
      <div v-else-if="error" class="th-empty"><p>{{ error }}</p><el-button @click="router.push('/treehole')">回到树洞</el-button></div>
      <template v-else>
        <el-button v-if="hasMore" class="th-chat-more" text size="small" :loading="loadingOlder" @click="loadOlder">查看更早的消息</el-button>
        <div v-if="!messages.length" class="th-system">还没有人说话，可以先打个招呼。</div>
        <template v-for="{ message, day, showAuthor, showTime } in lines" :key="message.id">
          <div v-if="day" class="th-day">{{ day }}</div>
          <div v-if="message.kind === 'notice'" class="th-system">{{ message.content }}</div>
          <div v-else class="th-msg" :class="{ 'is-mine': message.mine, 'is-grouped': !showAuthor, 'is-selected': selectedId === message.id }">
            <span v-if="!message.mine && showAuthor" class="th-msg-author" :class="{ 'is-host': message.isHost }">{{ message.alias }}{{ message.isHost ? "（管理员）" : "" }}</span>
            <div v-if="message.recalled && !message.content && !message.image" class="th-bubble is-recalled">消息已被管理员撤回</div>
            <div v-else-if="message.image" class="th-bubble th-bubble-image" :class="{ 'is-recalled': message.recalled }" @click="select(message)">
              <TreeholeImage :image="message.image" :mine="message.mine" />
              <div v-if="message.content" class="th-bubble-caption">{{ message.content }}</div>
            </div>
            <div v-else class="th-bubble" :class="{ 'is-recalled': message.recalled }" @click="select(message)">{{ message.content }}</div>
            <div v-if="showTime || selectedId === message.id || (message.recalled && message.content)" class="th-msg-tools">
              <span class="th-msg-time">{{ clockText(message.createdAt) }}<template v-if="message.recalled && message.content"> · 已撤回</template></span>
              <el-button v-if="selectedId === message.id" text size="small" type="danger" class="th-recall" @click="recall(message.id)">撤回这条</el-button>
            </div>
          </div>
        </template>
      </template>
    </div>
    <button v-if="scroller.unseen.value" type="button" class="th-jump" @click="scroller.toBottom(true)">
      <el-icon aria-hidden="true"><ArrowDown /></el-icon>{{ scroller.unseen.value }} 条新消息
    </button>

    <footer v-if="detail" class="th-chat-foot">
      <div v-if="detail.room.status !== 'active'" class="th-chat-closed">宣泄室已关闭{{ detail.room.closeReason ? `：${detail.room.closeReason}` : "" }}</div>
      <div v-else-if="!detail.me" class="th-chat-closed">你正在以核心管理员身份查阅，查阅已记入操作日志。</div>
      <Composer v-else :send="send" :draft-key="`room-${detail.room.id}`" :max-length="1000" placeholder="在这里说出来，大家都在" @focus="onComposerFocus" />
    </footer>

    <el-drawer v-model="applicationsOpen" title="入群申请" size="min(100vw, 420px)" append-to-body>
      <el-radio-group v-model="applicationFilter" size="small" @change="loadApplications">
        <el-radio-button value="pending">待审核</el-radio-button>
        <el-radio-button value="all">全部记录</el-radio-button>
      </el-radio-group>
      <div v-if="!applications.length" class="th-empty"><p>{{ applicationFilter === "pending" ? "没有待审核的申请" : "还没有申请记录" }}</p></div>
      <div v-else class="th-rows th-drawer-rows">
        <div v-for="application in applications" :key="application.id" class="th-row th-application">
          <div class="th-row-copy">
            <div class="th-row-title">
              {{ application.visitorAlias }}
              <em class="th-chip" :class="statusTone(application.status)">{{ applicationStatus(application.status) }}</em>
            </div>
            <p class="th-meta"><span>{{ application.recommendedBy }} 推荐</span><span>{{ timeText(application.createdAt) }}</span></p>
            <p v-if="application.note" class="th-text th-application-note">“{{ application.note }}”</p>
            <p v-if="application.reviewer" class="th-meta">
              <span>{{ application.reviewer }} 审核</span>
              <span v-if="application.rejectReason">{{ application.rejectReason }}</span>
            </p>
          </div>
          <div v-if="application.status === 'pending'" class="th-actions">
            <el-button size="small" type="primary" @click="review(application.id, true)">通过</el-button>
            <el-button size="small" @click="review(application.id, false)">拒绝</el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <el-drawer v-model="membersOpen" title="成员" size="min(100vw, 420px)" append-to-body>
      <div class="th-rows th-drawer-rows">
        <div v-for="member in members" :key="member.id" class="th-row">
          <div class="th-row-copy">
            <div class="th-row-title">
              {{ member.alias }}
              <em v-if="member.role === 'host'" class="th-chip is-brand">管理员</em>
              <em v-if="member.mine" class="th-chip">我</em>
            </div>
            <p class="th-meta"><span v-if="member.recommendedBy">{{ member.recommendedBy }} 推荐</span><span>{{ timeText(member.joinedAt) }} 进群</span></p>
          </div>
          <el-button v-if="!member.mine && (member.role === 'visitor' || canRemoveHosts)" size="small" text type="danger" @click="removeMember(member.id, member.alias)">移出</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, ArrowLeft, MoreFilled } from "@element-plus/icons-vue";
import {
  treeholeApi,
  type TreeholeRoomApplication,
  type TreeholeRoomDetail,
  type TreeholeRoomMember,
  type TreeholeRoomMessage,
} from "@/api/treehole";
import Composer from "./Composer.vue";
import TreeholeImage from "./TreeholeImage.vue";
import { chatLines, clockText, errorText, timeText, useChatScroll, usePolling } from "./shared";
import "./treehole.css";

const route = useRoute();
const router = useRouter();
const roomId = computed(() => Number(route.params.id));

const detail = ref<TreeholeRoomDetail | null>(null);
const messages = ref<TreeholeRoomMessage[]>([]);
const hasMore = ref(false);
const loading = ref(true);
const loadingOlder = ref(false);
const error = ref("");
const body = ref<HTMLElement | null>(null);
const applicationsOpen = ref(false);
const applicationFilter = ref<"pending" | "all">("pending");
const applications = ref<TreeholeRoomApplication[]>([]);
const pendingCount = ref(0);
const membersOpen = ref(false);
const members = ref<TreeholeRoomMember[]>([]);
const rulesExpanded = ref(typeof window !== "undefined" && window.innerWidth >= 640);
// 群管理员点一下消息才出现“撤回”，不在每条消息下面都摆一个按钮。
const selectedId = ref<number | null>(null);

const lastId = computed(() => messages.value.reduce((max, message) => Math.max(max, message.id), 0));
// 群管理员（洞主）之间不能互相移出，核心管理员可以。
const canRemoveHosts = computed(() => Boolean(detail.value?.isCoreAdmin));

const scroller = useChatScroll(body);
const scrollToBottom = () => scroller.toBottom();
const lines = computed(() => chatLines(messages.value, (message) => (message.kind === "notice" ? "notice" : String(message.memberId))));

/** 合并消息，返回其中新增的条数。 */
function mergeMessages(incoming: TreeholeRoomMessage[]) {
  if (!incoming.length) return 0;
  const byId = new Map(messages.value.map((message) => [message.id, message]));
  let added = 0;
  for (const message of incoming) {
    if (!byId.has(message.id)) added += 1;
    byId.set(message.id, message);
  }
  messages.value = [...byId.values()].sort((a, b) => a.id - b.id);
  return added;
}

function select(message: TreeholeRoomMessage) {
  if (!detail.value?.canModerate || message.mine || message.recalled) return;
  selectedId.value = selectedId.value === message.id ? null : message.id;
}

// 键盘弹起时先等可视区域缩小，再贴底。
function onComposerFocus() {
  if (scroller.nearBottom()) window.setTimeout(() => void scroller.toBottom(), 300);
}

let stopResizeTracking: () => void = () => undefined;
onBeforeUnmount(() => stopResizeTracking());

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await treeholeApi.room(roomId.value);
    detail.value = result;
    messages.value = result.messages;
    hasMore.value = result.hasMore;
    loading.value = false;
    await scrollToBottom();
    stopResizeTracking();
    stopResizeTracking = scroller.keepBottomOnResize();
    if (result.canModerate) await refreshPending();
    if (route.query.panel === "applications" && result.canModerate) await openApplications();
  } catch (cause) {
    error.value = errorText(cause, "宣泄室不存在或你不在群里");
    loading.value = false;
  }
}

async function refreshPending() {
  const list = await treeholeApi.roomApplications(roomId.value, "pending").catch(() => []);
  pendingCount.value = list.length;
  if (applicationFilter.value === "pending" && applicationsOpen.value) applications.value = list;
}

let pollCount = 0;
async function poll() {
  if (!detail.value || loading.value) return;
  const settle = scroller.beforeIncoming();
  const result = await treeholeApi.roomMessages(roomId.value, { after: lastId.value });
  detail.value.room = result.room;
  if (!result.memberActive && detail.value.me) {
    detail.value.me = null;
    ElMessage.warning("你已不在这个宣泄室里");
  }
  if (result.recalledIds.length) {
    const recalled = new Set(result.recalledIds);
    messages.value = messages.value.map((message) => (recalled.has(message.id) ? { ...message, recalled: true, content: "", image: null } : message));
  }
  await settle(mergeMessages(result.messages));
  pollCount += 1;
  if (detail.value.canModerate && pollCount % 5 === 0) await refreshPending();
}

usePolling(poll, () => (detail.value?.room.status === "active" ? 3_000 : 30_000));

async function loadOlder() {
  const first = messages.value[0];
  if (!first) return;
  loadingOlder.value = true;
  const el = body.value;
  const previousHeight = el?.scrollHeight ?? 0;
  try {
    const result = await treeholeApi.roomMessages(roomId.value, { before: first.id });
    hasMore.value = result.hasMore;
    mergeMessages(result.messages);
    await nextTick();
    if (el) el.scrollTop = el.scrollHeight - previousHeight;
  } finally {
    loadingOlder.value = false;
  }
}

async function send(payload: { content: string; imageId: number | null }) {
  const message = await treeholeApi.sendRoom(roomId.value, payload);
  mergeMessages([message]);
  await scrollToBottom();
}

function goBack() {
  if (window.history.state?.back) router.back();
  else router.push(detail.value?.me?.role === "host" ? "/treehole/host?tab=rooms" : detail.value?.me ? "/treehole" : "/treehole/admin?tab=rooms");
}

async function openApplications() {
  applicationsOpen.value = true;
  await loadApplications();
}

async function loadApplications() {
  applications.value = await treeholeApi.roomApplications(roomId.value, applicationFilter.value);
  if (applicationFilter.value === "pending") pendingCount.value = applications.value.length;
}

function applicationStatus(status: string) {
  return { pending: "待审核", approved: "已通过", rejected: "已拒绝", cancelled: "已撤回" }[status] ?? status;
}

function statusTone(status: string) {
  return status === "pending" ? "is-warn" : status === "approved" ? "is-ok" : "";
}

async function review(id: number, approve: boolean) {
  let reason = "";
  if (!approve) {
    const result = await ElMessageBox.prompt("来访者会看到这条原因，请温和地说明。", "拒绝入群申请", {
      confirmButtonText: "拒绝",
      cancelButtonText: "取消",
      inputValidator: (value: string) => (value && value.trim().length >= 2) || "请简单说明原因",
    }).catch(() => null);
    if (!result) return;
    reason = String(result.value).trim();
  }
  const result = await treeholeApi.reviewApplication(id, approve, reason);
  ElMessage.success(approve ? `已通过${result.alias ? `，群内虚拟 ID 为 ${result.alias}` : ""}` : "已拒绝");
  await loadApplications();
  await poll();
}

async function onCommand(command: string) {
  if (command === "applications") return openApplications();
  if (command === "members") {
    members.value = await treeholeApi.roomMembers(roomId.value);
    membersOpen.value = true;
    return;
  }
  if (command === "close") {
    const result = await ElMessageBox.prompt("关闭后成员都无法再进入，聊天记录会留存在后台。", "关闭宣泄室", {
      confirmButtonText: "关闭",
      cancelButtonText: "取消",
      inputPlaceholder: "关闭原因",
      inputValidator: (value: string) => (value && value.trim().length >= 2) || "请写明关闭原因",
    }).catch(() => null);
    if (!result) return;
    await treeholeApi.closeRoom(roomId.value, String(result.value).trim());
    ElMessage.success("宣泄室已关闭");
    await load();
    return;
  }
  if (command === "leave") {
    const confirmed = await ElMessageBox.confirm("退出后需要洞主重新推荐、审核通过才能再进来。", "退出宣泄室？", {
      confirmButtonText: "退出",
      cancelButtonText: "取消",
    }).then(() => true, () => false);
    if (!confirmed) return;
    await treeholeApi.leaveRoom(roomId.value);
    ElMessage.success("已退出");
    router.push(detail.value?.me?.role === "host" ? "/treehole/host?tab=rooms" : "/treehole");
  }
}

async function recall(messageId: number) {
  const confirmed = await ElMessageBox.confirm("撤回后其他人看不到这条消息，核心管理员会收到违规记录。", "撤回这条消息？", {
    confirmButtonText: "撤回",
    cancelButtonText: "取消",
  }).then(() => true, () => false);
  if (!confirmed) return;
  await treeholeApi.recallRoomMessage(roomId.value, messageId);
  selectedId.value = null;
  messages.value = messages.value.map((message) => (message.id === messageId ? { ...message, recalled: true, content: "", image: null } : message));
}

async function removeMember(memberId: number, alias: string) {
  const result = await ElMessageBox.prompt(`把 ${alias} 移出宣泄室，核心管理员会收到违规记录。`, "移出成员", {
    confirmButtonText: "移出",
    cancelButtonText: "取消",
    inputPlaceholder: "移出原因",
    inputValidator: (value: string) => (value && value.trim().length >= 2) || "请写明原因",
  }).catch(() => null);
  if (!result) return;
  await treeholeApi.removeMember(roomId.value, memberId, String(result.value).trim());
  members.value = await treeholeApi.roomMembers(roomId.value);
  await poll();
}

watch(roomId, load);
onMounted(load);
</script>

<style scoped>
.th-room-rules {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.th-room-rules p { margin-top: 6px; }
.th-room-badge :deep(.el-badge__content) { top: 6px; }
.th-recall { height: auto; padding: 0; font-size: var(--cpu-fs-xs); }
.th-drawer-rows { margin-top: 12px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); overflow: hidden; }
.th-application { flex-wrap: wrap; }
.th-application-note { margin: 4px 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
</style>
