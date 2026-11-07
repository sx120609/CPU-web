<template>
  <div class="th-chat">
    <header class="th-chat-head">
      <button type="button" class="th-chat-back" aria-label="返回" @click="goBack">
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <div v-if="session" class="th-chat-title">
        <strong>
          <template v-if="session.role === 'visitor' && session.host">
            <span class="th-dot" :class="{ 'is-on': session.host.online }" aria-hidden="true" />{{ session.host.name }}
          </template>
          <template v-else-if="session.role === 'visitor'">等待小艾绒认领</template>
          <template v-else>{{ session.alias }}</template>
          <em v-if="session.role !== 'visitor' && session.tag && session.tag !== 'normal'" class="th-chip" :class="tagTone(session.tag)">{{ tagLabel(session.tag) }}</em>
        </strong>
        <span>{{ subtitle }}</span>
      </div>
      <div v-else class="th-chat-title"><strong>艾绒树洞</strong></div>
      <el-dropdown v-if="session && menuItems.length" trigger="click" @command="onCommand">
        <el-button text aria-label="更多操作"><el-icon><MoreFilled /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="item in menuItems" :key="item.command" :command="item.command" :disabled="item.disabled" :divided="item.divided">
              {{ item.label }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <!-- 高危转介后常驻：手机上默认收成一行，电话始终可见 -->
    <div v-if="session?.help" class="th-help" role="note">
      <button type="button" class="th-help-summary" :aria-expanded="helpExpanded" @click="helpExpanded = !helpExpanded">
        <span><strong>{{ session.help.centerName }}</strong><template v-if="session.help.centerHotline"> · {{ session.help.centerHotline }}</template></span>
        <em>{{ helpExpanded ? "收起" : "展开" }}</em>
      </button>
      <template v-if="helpExpanded">
        <p class="th-help-guide">{{ session.help.crisisGuide }}</p>
        <ul>
          <li v-if="session.help.centerLocation">地点：{{ session.help.centerLocation }}</li>
          <li v-if="session.help.centerHours">开放时间：{{ session.help.centerHours }}</li>
        </ul>
        <p v-if="session.help.emergencyNote" class="th-help-emergency">{{ session.help.emergencyNote }}</p>
      </template>
    </div>
    <div v-if="session && session.role !== 'visitor' && session.contact" class="th-help th-contact" role="note">
      <p>来访者自愿留下的联系方式：<strong>{{ session.contact }}</strong></p>
    </div>
    <div v-if="session && session.role !== 'visitor' && session.topics.length" class="th-topics-bar">
      <span v-for="topic in session.topics" :key="topic" class="th-chip">#{{ topic }}</span>
    </div>
    <div v-if="session?.role === 'admin'" class="th-help th-contact" role="note">
      <p>你正以核心管理员身份查阅这段对话，查阅已记入操作日志。<router-link v-if="session.crisis" :to="`/treehole/admin?tab=cases&case=${session.crisis.id}`">查看高危工单</router-link></p>
    </div>

    <div ref="body" class="th-chat-body" aria-live="polite" @scroll.passive="scroller.onScroll">
      <div v-if="loading" class="th-empty">加载中…</div>
      <div v-else-if="error" class="th-empty"><p>{{ error }}</p><el-button @click="load">重试</el-button></div>
      <template v-else>
        <el-button v-if="hasMore" class="th-chat-more" text size="small" :loading="loadingOlder" @click="loadOlder">查看更早的消息</el-button>
        <div v-if="session && session.role === 'visitor' && !hasMore" class="th-system">
          {{ session.mode === "live" ? "实时聊天" : "留言倾诉" }} · 你在这条留言里的虚拟 ID 是 {{ session.alias }}
        </div>
        <template v-for="{ message, day, showAuthor, showTime } in lines" :key="message.id">
          <div v-if="day" class="th-day">{{ day }}</div>
          <div v-if="message.kind === 'notice' || message.sender === 'system'" class="th-system">{{ message.content }}</div>
          <div v-else class="th-msg" :class="{ 'is-mine': message.mine, 'is-grouped': !showAuthor }">
            <span v-if="!message.mine && showAuthor" class="th-msg-author" :class="{ 'is-host': message.sender === 'host' }">{{ authorName(message.sender) }}</span>
            <div v-if="message.kind === 'room-invite' && message.room" class="th-invite">
              <div class="th-invite-title">
                <el-icon aria-hidden="true"><ChatLineRound /></el-icon>{{ message.room.name }}
                <em class="th-chip is-brand">{{ message.room.categoryLabel }}</em>
              </div>
              <p>{{ message.room.intro || "小艾绒推荐你来这个主题宣泄室看看。" }}</p>
              <template v-if="session?.role === 'visitor'">
                <span v-if="message.room.status !== 'active'" class="th-muted">这个宣泄室已关闭</span>
                <el-button v-else-if="message.room.joined" size="small" type="primary" @click="router.push(`/treehole/room/${message.room.id}`)">进入宣泄室</el-button>
                <el-button v-else size="small" type="primary" @click="router.push({ path: '/treehole/rooms', query: { room: message.room.id } })">去看看</el-button>
              </template>
              <span v-else class="th-muted">已推荐给来访者</span>
            </div>
            <div v-else-if="message.kind === 'image' && message.image" class="th-bubble th-bubble-image">
              <TreeholeImage :image="message.image" :mine="message.mine" />
              <div v-if="message.content" class="th-bubble-caption">{{ message.content }}</div>
            </div>
            <div v-else class="th-bubble">{{ message.content }}</div>
            <span v-if="showTime" class="th-msg-time">{{ clockText(message.createdAt) }}</span>
          </div>
        </template>
      </template>
    </div>
    <button v-if="scroller.unseen.value" type="button" class="th-jump" @click="scroller.toBottom(true)">
      <el-icon aria-hidden="true"><ArrowDown /></el-icon>{{ scroller.unseen.value }} 条新消息
    </button>

    <footer v-if="session" class="th-chat-foot">
      <div v-if="session.status !== 'active'" class="th-chat-closed">这次倾诉已经结束{{ session.endedAt ? `（${timeText(session.endedAt)}）` : "" }}。</div>
      <div v-else-if="session.role === 'admin'" class="th-chat-closed">核心管理员只能查阅，不能在会话里发言。</div>
      <template v-else>
        <div v-if="session.role === 'visitor' && !session.host" class="th-composer-hint">留言已放进待认领，小艾绒值班时会认领并回复你。想补充什么可以接着写。</div>
        <div v-else-if="session.role === 'visitor' && session.host && !session.host.available" class="th-chat-closed">这位小艾绒暂时无法接待。你可以结束这条留言，再写一条新的。</div>
        <div v-else-if="session.role === 'visitor' && session.host && !session.host.online" class="th-composer-hint">小艾绒暂时不在岗，{{ nextShiftText(session.host.nextShiftAt) }}，值班时会看到你的消息。</div>
        <Composer :send="send" :draft-key="`session-${session.id}`" :placeholder="session.role === 'host' ? '温和地回应…' : '说说你的感受…'" @focus="onComposerFocus" />
      </template>
    </footer>

    <CrisisDialog v-model="crisisOpen" @submit="submitCrisis" />

    <el-dialog v-model="topicsOpen" title="留言标签" width="min(92vw, 420px)" append-to-body>
      <p class="th-sub">最多 3 个，方便统计和找到合适的小艾绒。</p>
      <div class="th-topic-picker">
        <button
          v-for="topic in TREEHOLE_TOPICS"
          :key="topic"
          type="button"
          class="th-topic"
          :class="{ 'is-on': topicDraft.includes(topic) }"
          @click="toggleTopic(topic)"
        >
          {{ topic }}
        </button>
      </div>
      <template #footer>
        <el-button @click="topicsOpen = false">取消</el-button>
        <el-button type="primary" @click="saveTopics">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="inviteOpen" title="推荐宣泄室" width="min(92vw, 420px)" append-to-body>
      <p class="th-sub">来访者会收到一张卡片，读过保密与伦理须知后就能进入。</p>
      <div v-if="!inviteRooms.length" class="th-empty"><p>还没有开放的宣泄室。</p></div>
      <div v-else class="th-rows th-invite-list">
        <button v-for="room in inviteRooms" :key="room.id" type="button" class="th-row" @click="sendInvite(room.id)">
          <div class="th-row-copy">
            <div class="th-row-title">{{ room.name }} <em class="th-chip is-brand">{{ room.categoryLabel }}</em></div>
          </div>
        </button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, ArrowLeft, ChatLineRound, MoreFilled } from "@element-plus/icons-vue";
import {
  treeholeApi,
  TREEHOLE_TOPICS,
  type TreeholeCrisisInput,
  type TreeholeMessage,
  type TreeholeSession,
  type TreeholeTag,
} from "@/api/treehole";
import Composer from "./Composer.vue";
import CrisisDialog from "./CrisisDialog.vue";
import TreeholeImage from "./TreeholeImage.vue";
import { chatLines, claimStatusLabel, clockText, errorText, nextShiftText, tagLabel, tagTone, timeText, useChatScroll, usePolling } from "./shared";
import "./treehole.css";

const route = useRoute();
const router = useRouter();
const sessionId = computed(() => Number(route.params.id));

const session = ref<TreeholeSession | null>(null);
const messages = ref<TreeholeMessage[]>([]);
const hasMore = ref(false);
const loading = ref(true);
const loadingOlder = ref(false);
const error = ref("");
const body = ref<HTMLElement | null>(null);
const crisisOpen = ref(false);
const inviteOpen = ref(false);
const helpExpanded = ref(typeof window !== "undefined" && window.innerWidth >= 640);
const inviteRooms = ref<Array<{ id: number; name: string; categoryLabel: string }>>([]);
const topicsOpen = ref(false);
const topicDraft = ref<string[]>([]);

const subtitle = computed(() => {
  const value = session.value;
  if (!value) return "";
  const mode = value.mode === "live" ? "实时聊天" : "留言倾诉";
  const state = claimStatusLabel(value.claimStatus, value.status !== "active");
  if (value.role === "visitor") return value.host ? `${mode} · ${state} · ${value.host.online ? "在岗" : "离岗"}` : `${mode} · ${state}`;
  if (value.role === "host") return `${mode} · ${state}`;
  return `${value.host ? `${value.host.name} 接待` : "待认领"} · ${mode}`;
});

type MenuItem = { command: string; label: string; disabled?: boolean; divided?: boolean };
const menuItems = computed<MenuItem[]>(() => {
  const value = session.value;
  if (!value) return [];
  if (value.role === "visitor") {
    return [
      { command: "topics", label: "修改标签" },
      { command: "contact", label: value.contact ? "修改留下的联系方式" : "自愿留下联系方式" },
      ...(value.status === "active" ? [{ command: "end", label: "结束这条留言", divided: true }] : []),
    ];
  }
  if (value.role === "host") {
    const locked = value.tag === "crisis";
    return [
      { command: "tag:normal", label: `标记：${tagLabel("normal")}`, disabled: locked || value.tag === "normal" },
      { command: "tag:focus", label: `标记：${tagLabel("focus")}`, disabled: locked || value.tag === "focus" },
      { command: "tag:crisis", label: locked ? "已提交高危转介" : "标记：高危转介…", disabled: locked },
      { command: "topics", label: "修改留言标签", divided: true },
      ...(value.status === "active" ? [{ command: "invite", label: "推荐宣泄室…" }] : []),
      ...(value.status === "active" && value.claimStatus === "claimed" ? [{ command: "release", label: "放回待认领" }] : []),
    ];
  }
  return [];
});

const lastId = computed(() => messages.value.reduce((max, message) => Math.max(max, message.id), 0));

function authorName(sender: string) {
  if (sender === "host") return session.value?.host?.name ?? "小艾绒";
  if (sender === "visitor") return session.value?.alias ?? "来访者";
  return "";
}

const scroller = useChatScroll(body);
const scrollToBottom = () => scroller.toBottom();
const lines = computed(() => chatLines(messages.value, (message) => (message.kind === "notice" ? "system" : message.sender)));

/** 合并消息，返回其中新增的条数（已有的只更新内容，例如邀请卡片的申请状态）。 */
function mergeMessages(incoming: TreeholeMessage[]) {
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

// 键盘弹起时先等可视区域缩小，再贴底，避免最后几条被输入框挡住。
function onComposerFocus() {
  if (scroller.nearBottom()) window.setTimeout(() => void scroller.toBottom(), 300);
}

let stopResizeTracking: () => void = () => undefined;
onBeforeUnmount(() => stopResizeTracking());

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const detail = await treeholeApi.session(sessionId.value);
    session.value = detail.session;
    messages.value = detail.messages;
    hasMore.value = detail.hasMore;
    inviteRooms.value = detail.inviteRooms ?? [];
    loading.value = false;
    await scrollToBottom();
    stopResizeTracking();
    stopResizeTracking = scroller.keepBottomOnResize();
  } catch (cause) {
    error.value = errorText(cause, "会话不存在或你没有权限查看");
    loading.value = false;
  }
}

async function poll() {
  if (!session.value || loading.value) return;
  const settle = scroller.beforeIncoming();
  const result = await treeholeApi.sessionMessages(sessionId.value, { after: lastId.value });
  session.value = result.session;
  await settle(mergeMessages(result.messages));
}

usePolling(poll, () => {
  const value = session.value;
  if (!value || value.status !== "active") return 30_000;
  if (value.role === "admin") return 10_000;
  return value.mode === "live" ? 2_500 : 6_000;
});

async function loadOlder() {
  const first = messages.value[0];
  if (!first) return;
  loadingOlder.value = true;
  const el = body.value;
  const previousHeight = el?.scrollHeight ?? 0;
  try {
    const result = await treeholeApi.sessionMessages(sessionId.value, { before: first.id });
    hasMore.value = result.hasMore;
    mergeMessages(result.messages);
    await nextTick();
    if (el) el.scrollTop = el.scrollHeight - previousHeight;
  } finally {
    loadingOlder.value = false;
  }
}

async function send(payload: { content: string; imageId: number | null }) {
  const message = await treeholeApi.send(sessionId.value, payload);
  mergeMessages([message]);
  await scrollToBottom();
}

function goBack() {
  if (window.history.state?.back) router.back();
  else router.push(session.value?.role === "host" ? "/treehole/host" : session.value?.role === "admin" ? "/treehole/admin" : "/treehole");
}

async function onCommand(command: string) {
  if (command === "topics") {
    topicDraft.value = [...(session.value?.topics ?? [])];
    topicsOpen.value = true;
    return;
  }
  if (command === "release") {
    const confirmed = await ElMessageBox.confirm("放回后其他在岗的小艾绒可以认领这条留言。", "放回待认领？", {
      confirmButtonText: "放回",
      cancelButtonText: "取消",
    }).then(() => true, () => false);
    if (!confirmed) return;
    await treeholeApi.release(sessionId.value);
    ElMessage.success("已放回待认领");
    router.replace("/treehole/host");
    return;
  }
  if (command === "end") {
    const confirmed = await ElMessageBox.confirm("结束后这条留言的虚拟 ID 会作废，记录仍会保留在你的历史里。想再聊时可以重新写一条。", "结束这条留言？", {
      confirmButtonText: "结束",
      cancelButtonText: "再想想",
    }).then(() => true, () => false);
    if (!confirmed) return;
    await treeholeApi.endSession(sessionId.value);
    ElMessage.success("已结束。谢谢你愿意说出来。");
    await load();
    return;
  }
  if (command === "contact") {
    const result = await ElMessageBox.prompt("留下手机、QQ 或微信，方便小艾绒和学校心理发展中心联系你。只有接待你的洞主和核心管理员能看到。", "自愿留下联系方式", {
      confirmButtonText: "保存",
      cancelButtonText: "取消",
      inputValue: session.value?.contact ?? "",
      inputValidator: (value: string) => (value && value.trim().length >= 2 && value.trim().length <= 100) || "请填写 2 到 100 个字",
    }).catch(() => null);
    if (!result) return;
    await treeholeApi.leaveContact(sessionId.value, String(result.value).trim());
    ElMessage.success("已保存");
    await poll();
    return;
  }
  if (command === "invite") {
    inviteOpen.value = true;
    return;
  }
  if (command.startsWith("tag:")) {
    const tag = command.slice(4) as TreeholeTag;
    if (tag === "crisis") {
      crisisOpen.value = true;
      return;
    }
    await treeholeApi.setTag(sessionId.value, tag);
    if (session.value) session.value.tag = tag;
    ElMessage.success(`已标记为${tagLabel(tag)}`);
  }
}

async function submitCrisis(input: TreeholeCrisisInput, done: (ok: boolean) => void) {
  try {
    await treeholeApi.setTag(sessionId.value, "crisis", input);
    ElMessage.success("已提交高危转介，核心管理员已收到告警");
    done(true);
    await load();
  } catch {
    done(false);
  }
}

async function sendInvite(roomId: number) {
  const message = await treeholeApi.inviteRoom(sessionId.value, roomId);
  inviteOpen.value = false;
  mergeMessages([message]);
  await scrollToBottom();
}

function toggleTopic(topic: string) {
  if (topicDraft.value.includes(topic)) topicDraft.value = topicDraft.value.filter((item) => item !== topic);
  else if (topicDraft.value.length < 3) topicDraft.value = [...topicDraft.value, topic];
  else ElMessage.info("最多选 3 个标签");
}

async function saveTopics() {
  const result = await treeholeApi.setTopics(sessionId.value, topicDraft.value);
  if (session.value) session.value.topics = result.topics;
  topicsOpen.value = false;
  ElMessage.success("标签已更新");
}

watch(sessionId, load);
onMounted(load);
</script>

<style scoped>
.th-contact {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}
.th-help-guide { margin-top: 6px !important; }
.th-help-emergency { margin-top: 6px !important; font-weight: 600; }
.th-topics-bar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px 0;
}
.th-composer-hint {
  margin-bottom: 6px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.th-invite-list { margin-top: 8px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); overflow: hidden; }
</style>
