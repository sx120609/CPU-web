<template>
  <div class="assistant-page">
    <section class="assistant-shell cpu-card">
      <div class="assistant-head">
        <span class="assistant-mark">拾</span>
        <div>
          <h1>拾间AI</h1>
          <p>问功能、找入口，也可以直接聊天</p>
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

      <div v-else class="conversation" aria-live="polite">
        <article
          v-for="(message, index) in messages"
          :key="`${message.role}-${index}-${message.content.slice(0, 12)}`"
          class="message"
          :class="`message--${message.role}`"
        >
          <div class="message-label">{{ message.role === "user" ? "你" : "拾间AI" }}</div>
          <div class="message-bubble">
            <p>{{ message.content }}</p>
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

        <article v-if="assistantLoading" class="message message--assistant">
          <div class="message-label">拾间AI</div>
          <div class="message-bubble assistant-thinking">
            <i></i><i></i><i></i>
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
          clearable
          maxlength="500"
          placeholder="问我：怎么查电费、药苑之声怎么用……"
          size="large"
          @keyup.enter="submitSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button
          type="primary"
          size="large"
          :loading="assistantLoading"
          :disabled="!keywordInput.trim() || assistantLoading"
          @click="submitSearch"
        >
          发送
        </el-button>
      </div>
    </section>

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
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Right, Search } from "@element-plus/icons-vue";
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
  actions?: CampusAssistantAction[];
  suggestions?: string[];
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const q = ref((route.query.q as string) ?? "");
const keywordInput = ref(q.value);
const result = ref<SearchResult | null>(null);
const searchLoading = ref(false);
const searchError = ref("");
const assistantLoading = ref(false);
const assistantError = ref("");
const messages = ref<ConversationMessage[]>([]);
let searchSeq = 0;
let assistantSeq = 0;

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
  if (!keyword) {
    result.value = null;
    searchError.value = "";
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
  messages.value.push({ role: "user", content: keyword });
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
  assistantLoading.value = true;
  assistantError.value = "";
  try {
    const next = await searchApi.askAssistant(keyword, history, { suppressErrorMessage: true });
    if (seq !== assistantSeq) return;
    messages.value.push({
      role: "assistant",
      content: next.answer,
      actions: next.actions,
      suggestions: next.suggestions,
    });
  } catch (error) {
    if (seq === assistantSeq) assistantError.value = normalizeRequestError(error, "拾间AI暂时不可用");
  } finally {
    if (seq === assistantSeq) assistantLoading.value = false;
  }
}

async function retryAssistant() {
  const keyword = q.value.trim();
  if (!keyword || assistantLoading.value) return;
  const history = messages.value
    .filter((item, index) => !(index === messages.value.length - 1 && item.role === "user"))
    .slice(-8)
    .map(({ role, content }) => ({ role, content }));
  await askAssistant(keyword, history);
}

function normalizeRequestError(error: unknown, fallback: string) {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500) return response.data?.message || fallback;
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
</script>

<style scoped>
.assistant-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 920px;
  margin: 0 auto;
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
  flex-direction: column;
  gap: 16px;
  min-height: 360px;
  padding: 20px;
}
.assistant-head {
  display: flex;
  align-items: center;
  gap: 12px;
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
  max-height: min(56vh, 560px);
  overflow-y: auto;
  padding: 2px 4px 8px;
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
@keyframes thinking {
  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
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
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--cpu-border-soft);
}
.assistant-form .el-input {
  flex: 1;
  min-width: 0;
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

@media (max-width: 640px) {
  .assistant-page {
    gap: 0;
    margin: -2px -4px 0;
  }
  .assistant-shell {
    min-height: calc(100dvh - 176px);
    padding: 8px 6px 10px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .assistant-head {
    gap: 9px;
    padding: 0 2px 6px;
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
    max-height: none;
    gap: 20px;
    padding: 12px 2px 18px;
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
    padding: 10px 2px 2px;
    border-top-color: var(--cpu-border-soft);
  }
  .assistant-form :deep(.el-input__wrapper) {
    border-radius: 14px;
    box-shadow: 0 0 0 1px var(--cpu-border-soft) inset;
  }
  .assistant-form .el-button {
    min-width: 58px;
    border-radius: 14px;
    padding-inline: 15px;
  }
  .related-results {
    display: none;
  }
}
</style>
