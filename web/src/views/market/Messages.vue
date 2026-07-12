<template>
  <div class="market-chat-page cpu-page">
    <header class="chat-head">
      <div><el-button text @click="$router.push({ name: 'market-mine' })">← 返回我的交易</el-button><h1>交易消息</h1><p>围绕商品和订单沟通，重要交易状态仍以平台订单为准。</p></div>
    </header>
    <section class="chat-shell" v-loading="loading">
      <aside :class="{ hidden: selectedId && mobileConversation }">
        <div class="aside-title">会话 <el-badge :value="conversations.length" /></div>
        <button v-for="conversation in conversations" :key="conversation.id" class="conversation" :class="{ active: conversation.id === selectedId }" @click="selectConversation(conversation.id)">
          <el-avatar :size="42" :src="conversation.counterpart?.avatar || ''">{{ userInitial(conversation.counterpart) }}</el-avatar>
          <span><strong>{{ userName(conversation.counterpart) }}</strong><small>{{ conversation.item?.title }}</small><em>{{ conversation.lastMessage?.content || '开始沟通交易细节' }}</em></span>
          <time>{{ shortTime(conversation.lastMessageAt) }}</time>
        </button>
        <el-empty v-if="!loading && !conversations.length" description="暂无交易会话" />
      </aside>
      <main v-if="activeConversation" class="messages">
        <div class="message-head">
          <el-button class="mobile-back" text @click="mobileConversation = false">←</el-button>
          <img v-if="activeConversation.item?.cover" :src="activeConversation.item.cover" alt="" />
          <div><strong>{{ activeConversation.item?.title }}</strong><small>与 {{ userName(activeConversation.counterpart) }} 沟通</small></div>
          <el-button text type="primary" @click="$router.push({ name: 'market-item', params: { id: activeConversation.itemId } })">查看商品</el-button>
        </div>
        <div ref="messageList" class="message-list">
          <div v-for="message in messages" :key="message.id" class="bubble-row" :class="{ mine: message.senderId === auth.user?.id }">
            <el-avatar :size="32" :src="message.sender?.avatar || ''">{{ userInitial(message.sender) }}</el-avatar>
            <div><p>{{ message.content }}</p><time>{{ fullTime(message.createdAt) }}</time></div>
          </div>
          <el-empty v-if="!messages.length" description="发送第一条消息，确认价格、地点和时间" />
        </div>
        <form class="composer" @submit.prevent="send">
          <el-input v-model="draft" maxlength="1000" show-word-limit type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="输入消息；请勿在平台外提前转账" @keydown.ctrl.enter.prevent="send" />
          <el-button type="primary" native-type="submit" :loading="sending" :disabled="!draft.trim()">发送</el-button>
        </form>
      </main>
      <main v-else class="empty-chat"><el-empty description="选择一个会话开始沟通" /></main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { marketApi, type MarketConversation, type MarketMessage, type MarketUser } from "@/api/market";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const conversations = ref<MarketConversation[]>([]);
const messages = ref<MarketMessage[]>([]);
const selectedId = ref(0);
const loading = ref(false);
const sending = ref(false);
const draft = ref("");
const messageList = ref<HTMLElement | null>(null);
const mobileConversation = ref(false);
let pollTimer = 0;
const activeConversation = computed(() => conversations.value.find((conversation) => conversation.id === selectedId.value) || null);

function userName(user?: MarketUser) { return user?.nickname || (user?.id ? `用户 #${user.id}` : "用户"); }
function userInitial(user?: MarketUser) { return userName(user).slice(0, 1).toUpperCase(); }
function shortTime(value?: string | null) { if (!value) return ""; return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function fullTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
async function scrollBottom() { await nextTick(); if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight; }

async function loadConversations() {
  const list = await marketApi.conversations({ suppressErrorMessage: true });
  conversations.value = list;
  const queryId = Number(route.query.conversation || 0);
  const queryItemId = Number(route.query.item || 0);
  if (!selectedId.value) {
    const conversationId = queryId && list.some((item) => item.id === queryId)
      ? queryId
      : queryItemId
        ? list.find((item) => item.itemId === queryItemId)?.id
        : 0;
    selectedId.value = conversationId || list[0]?.id || 0;
  }
}
async function loadMessages(silent = false) {
  if (!selectedId.value) return;
  try {
    const list = await marketApi.messages(selectedId.value, { suppressErrorMessage: true });
    const changed = list.length !== messages.value.length || list.at(-1)?.id !== messages.value.at(-1)?.id;
    messages.value = list;
    if (changed) await scrollBottom();
  } catch (error) {
    if (!silent) ElMessage.error(error instanceof Error ? error.message : "消息加载失败");
  }
}
async function selectConversation(id: number) {
  selectedId.value = id;
  mobileConversation.value = true;
  messages.value = [];
  await router.replace({ query: { ...route.query, conversation: String(id) } });
  await loadMessages();
}
async function send() {
  const content = draft.value.trim();
  if (!content || !selectedId.value || sending.value) return;
  sending.value = true;
  try {
    const message = await marketApi.sendMessage(selectedId.value, content);
    messages.value.push(message);
    draft.value = "";
    await Promise.all([scrollBottom(), loadConversations()]);
  } finally { sending.value = false; }
}

onMounted(async () => {
  loading.value = true;
  try { await loadConversations(); await loadMessages(); } catch (error) { ElMessage.error(error instanceof Error ? error.message : "会话加载失败"); } finally { loading.value = false; }
  pollTimer = window.setInterval(() => { void loadMessages(true); void loadConversations(); }, 3000);
});
onBeforeUnmount(() => window.clearInterval(pollTimer));
</script>

<style scoped>
.market-chat-page{max-width:1240px;margin:0 auto;padding:28px 20px 48px}.chat-head h1{margin:4px 0;font-size:28px}.chat-head p{margin:0 0 20px;color:#718096}.chat-shell{display:grid;grid-template-columns:340px 1fr;height:min(720px,calc(100vh - 220px));min-height:520px;background:#fff;border:1px solid #e5eaf1;border-radius:18px;overflow:hidden}.chat-shell aside{border-right:1px solid #e5eaf1;overflow:auto}.aside-title{display:flex;justify-content:space-between;padding:20px;font-weight:700;border-bottom:1px solid #eef1f5}.conversation{position:relative;width:100%;display:grid;grid-template-columns:44px 1fr auto;gap:10px;padding:15px 14px;border:0;border-bottom:1px solid #f0f2f6;background:#fff;text-align:left;cursor:pointer}.conversation:hover,.conversation.active{background:#edf8f5}.conversation span{min-width:0;display:flex;flex-direction:column;gap:3px}.conversation strong,.conversation small,.conversation em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.conversation small{color:#138a76}.conversation em{font-style:normal;color:#8a94a6;font-size:12px}.conversation time{font-size:11px;color:#a1aaba}.messages{display:grid;grid-template-rows:auto 1fr auto;min-width:0}.message-head{height:72px;display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid #e8edf3}.message-head img{width:46px;height:46px;object-fit:cover;border-radius:10px}.message-head div{flex:1;min-width:0;display:flex;flex-direction:column}.message-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.message-head small{color:#8491a5}.message-list{padding:20px;overflow-y:auto;background:#f7f9fc}.bubble-row{display:flex;gap:10px;align-items:flex-start;margin-bottom:16px}.bubble-row>div{max-width:68%}.bubble-row p{margin:0;padding:10px 13px;background:#fff;border:1px solid #e6ebf2;border-radius:4px 14px 14px 14px;white-space:pre-wrap;word-break:break-word}.bubble-row time{display:block;margin-top:4px;font-size:11px;color:#98a2b3}.bubble-row.mine{flex-direction:row-reverse}.bubble-row.mine>div{text-align:right}.bubble-row.mine p{color:#fff;background:#168c78;border-color:#168c78;border-radius:14px 4px 14px 14px;text-align:left}.composer{display:flex;align-items:flex-end;gap:12px;padding:14px;border-top:1px solid #e5eaf1}.composer .el-textarea{flex:1}.empty-chat{display:grid;place-items:center}.mobile-back{display:none}@media(max-width:760px){.market-chat-page{padding:10px}.chat-shell{grid-template-columns:1fr;height:calc(100vh - 150px);min-height:480px}.chat-shell aside{border:0}.chat-shell aside.hidden{display:none}.messages{grid-column:1}.empty-chat{display:none}.mobile-back{display:inline-flex}.message-head{padding:8px}.message-head img{display:none}.message-head .el-button:last-child{padding:6px}.bubble-row>div{max-width:82%}.composer{padding:10px}.composer .el-button{height:54px}}
.chat-head p,.conversation em,.conversation time,.message-head small,.bubble-row time{color:var(--cpu-text-secondary)}.chat-shell,.conversation{color:var(--cpu-text);background:var(--cpu-card);border-color:var(--cpu-border-soft)}.chat-shell aside,.aside-title,.conversation,.message-head,.composer{border-color:var(--cpu-border-soft)}.conversation:hover,.conversation.active{background:var(--cpu-primary-soft)}.message-list{background:var(--cpu-surface-soft)}.bubble-row p{color:var(--cpu-text);background:var(--cpu-card);border-color:var(--cpu-border-soft)}
</style>
