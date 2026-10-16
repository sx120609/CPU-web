<template>
  <section v-if="view?.status === 'answered'" id="ai-answer" ref="rootEl" class="cpu-card topic-ai-answer" aria-label="拾间AI 参考回答">
    <header class="topic-ai-answer-head">
      <span class="topic-ai-answer-mark" aria-hidden="true"><SparkMark /></span>
      <div class="topic-ai-answer-title">
        <strong>拾间AI 参考回答</strong>
        <small>依据学校文件、公告和往期帖子整理，可能有误，以学校最新通知为准</small>
      </div>
      <div v-if="view.canDismiss || view.canRegenerate" class="topic-ai-answer-tools">
        <el-button v-if="view.canRegenerate" text size="small" :loading="busy === 'regenerate'" :disabled="Boolean(busy)" @click="regenerate">重新生成</el-button>
        <el-button v-if="view.canDismiss" text size="small" :loading="busy === 'dismiss'" :disabled="Boolean(busy)" @click="dismiss">关闭</el-button>
      </div>
    </header>

    <MarkdownView :content="view.answer || ''" class="topic-ai-answer-body" compact-quotes />

    <ol v-if="view.sources?.length" class="topic-ai-answer-sources" aria-label="出处">
      <li v-for="source in view.sources" :key="source.n">
        <span class="topic-ai-answer-n">{{ source.n }}</span>
        <span class="topic-ai-answer-source">
          <router-link v-if="source.url?.startsWith('/')" :to="source.url">{{ source.title }}</router-link>
          <a v-else-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer nofollow">{{ source.title }}</a>
          <span v-else>{{ source.title }}</span>
          <small>{{ sourceMeta(source) }}</small>
        </span>
      </li>
    </ol>

    <p v-if="view.review" class="topic-ai-answer-staff">自评 {{ view.review.confidence }} 分<template v-if="view.review.model"> · {{ view.review.model }}</template></p>
  </section>

  <section v-else-if="view?.status === 'pending'" class="cpu-card topic-ai-answer topic-ai-answer--pending" aria-live="polite">
    <span class="topic-ai-answer-mark is-busy" aria-hidden="true"><SparkMark /></span>
    <span>拾间AI 正在查找相关的学校资料和往期帖子…</span>
  </section>

  <section v-else-if="view?.review" class="cpu-card topic-ai-answer topic-ai-answer--staff">
    <span class="topic-ai-answer-mark" aria-hidden="true"><SparkMark /></span>
    <span class="topic-ai-answer-staff-line">
      拾间AI 没有回答（仅管理员可见）：{{ staffStatus(view.review.status) }}<template v-if="view.review.reason">，{{ view.review.reason }}</template>
    </span>
    <el-button v-if="view.canRegenerate" text size="small" :loading="busy === 'regenerate'" :disabled="Boolean(busy)" @click="regenerate">重新生成</el-button>
  </section>
</template>

<script setup lang="ts">
import { h, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import { topicApi, type TopicAiAnswer, type TopicAiAnswerSource } from "@/api/topic";

const props = defineProps<{ topicId: number }>();

const route = useRoute();
const view = ref<TopicAiAnswer | null>(null);
const busy = ref<"" | "dismiss" | "regenerate">("");
const rootEl = ref<HTMLElement | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollCount = 0;
let loadSeq = 0;
// 后台检索加模型一般十几秒；一分半还没好就不再轮询，刷新页面时再看。
const POLL_INTERVAL_MS = 4_000;
const POLL_LIMIT = 22;

const SparkMark = () => h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
  h("path", { d: "M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" }),
  h("path", { d: "M18.5 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z" }),
]);

const KIND_LABELS: Record<TopicAiAnswerSource["kind"], string> = {
  "school-doc": "学校文件",
  announce: "学校公告",
  forum: "论坛帖子",
  coursereview: "课程点评",
  site: "站内功能",
};

function sourceMeta(source: TopicAiAnswerSource) {
  return [KIND_LABELS[source.kind] || "资料", source.kind === "forum" || source.kind === "site" ? "" : source.where, source.date || ""]
    .filter(Boolean)
    .join(" · ");
}

function staffStatus(status: string) {
  if (status === "skipped") return "已跳过";
  if (status === "failed") return "处理失败";
  if (status === "dismissed") return "已被关闭";
  return status;
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  stopPolling();
  if (pollCount >= POLL_LIMIT) return;
  pollCount += 1;
  pollTimer = setTimeout(() => void load(), POLL_INTERVAL_MS);
}

async function load() {
  const seq = ++loadSeq;
  const id = props.topicId;
  try {
    const next = await topicApi.aiAnswer(id);
    if (seq !== loadSeq || id !== props.topicId) return;
    const wasAnswered = view.value?.status === "answered";
    view.value = next;
    if (next.status === "pending") schedulePoll();
    else stopPolling();
    if (!wasAnswered && next.status === "answered" && route.hash === "#ai-answer") {
      await nextTick();
      rootEl.value?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  } catch {
    if (seq === loadSeq) view.value = null;
  }
}

async function dismiss() {
  try {
    await ElMessageBox.confirm("关闭后这条参考回答不再显示给任何人。", "关闭拾间AI 回答", {
      confirmButtonText: "关闭",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  busy.value = "dismiss";
  try {
    view.value = await topicApi.dismissAiAnswer(props.topicId);
    ElMessage.success("已关闭");
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "关闭失败，请稍后再试");
  } finally {
    busy.value = "";
  }
}

async function regenerate() {
  busy.value = "regenerate";
  try {
    view.value = await topicApi.regenerateAiAnswer(props.topicId);
    pollCount = 0;
    schedulePoll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "重新生成失败，请稍后再试");
  } finally {
    busy.value = "";
  }
}

watch(() => props.topicId, () => {
  stopPolling();
  pollCount = 0;
  view.value = null;
  if (props.topicId > 0) void load();
}, { immediate: true });

onBeforeUnmount(stopPolling);
</script>

<style scoped lang="scss">
@use "../../styles/compact" as *;

.topic-ai-answer {
  padding: 16px 20px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  scroll-margin-top: 72px;
}

.topic-ai-answer-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.topic-ai-answer-mark {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);

  :deep(svg) {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  &.is-busy :deep(svg) {
    animation: topic-ai-answer-pulse 1.4s ease-in-out infinite;
  }
}

.topic-ai-answer-title {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;

  strong {
    font-size: var(--cpu-fs-m);
    font-weight: 600;
  }

  small {
    color: var(--cpu-text-muted);
    font-size: var(--cpu-fs-xs);
    line-height: 1.5;
  }
}

.topic-ai-answer-tools {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  margin-top: -2px;

  :deep(.el-button) {
    margin: 0;
    color: var(--cpu-text-muted);
    font-size: var(--cpu-fs-xs);
  }
}

.topic-ai-answer-body {
  margin-top: 10px;
  font-size: var(--cpu-fs-m);
  line-height: 1.75;
}

.topic-ai-answer-sources {
  display: grid;
  gap: 6px;
  margin: 12px 0 0;
  padding: 10px 0 0;
  border-top: 1px solid var(--cpu-border-soft);
  list-style: none;

  li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
  }
}

.topic-ai-answer-n {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-top: 1px;
  place-items: center;
  border-radius: 50%;
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  font-size: var(--cpu-fs-xs);
  font-weight: 600;
}

.topic-ai-answer-source {
  display: grid;
  min-width: 0;
  gap: 1px;
  font-size: var(--cpu-fs-s);
  line-height: 1.5;

  a,
  span {
    overflow: hidden;
    color: var(--cpu-text-secondary);
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a:hover {
    color: var(--cpu-primary);
  }

  small {
    color: var(--cpu-text-muted);
    font-size: var(--cpu-fs-xs);
  }
}

.topic-ai-answer-staff {
  margin: 8px 0 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}

.topic-ai-answer--pending,
.topic-ai-answer--staff {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.topic-ai-answer-staff-line {
  min-width: 0;
  flex: 1;
  line-height: 1.5;
}

@keyframes topic-ai-answer-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.85);
  }
}

@include compact-layout {
  .topic-ai-answer {
    margin-top: 8px;
    padding: 14px 16px;
    border: 0;
    border-radius: 0;
  }

  .topic-ai-answer--pending,
  .topic-ai-answer--staff {
    padding: 10px 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .topic-ai-answer-mark.is-busy :deep(svg) {
    animation: none;
  }
}
</style>
