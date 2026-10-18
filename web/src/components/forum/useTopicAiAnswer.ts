import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { topicApi, type TopicAiAnswer, type TopicAiAnswerSource } from "@/api/topic";

// 后台检索加模型一般十几秒；一分半还没好就不再轮询，刷新页面时再看。
const POLL_INTERVAL_MS = 4_000;
const POLL_LIMIT = 22;

const KIND_LABELS: Record<TopicAiAnswerSource["kind"], string> = {
  "school-doc": "学校文件",
  announce: "学校公告",
  forum: "论坛帖子",
  coursereview: "课程点评",
  site: "站内功能",
};

export function topicAiSourceMeta(source: TopicAiAnswerSource) {
  return [KIND_LABELS[source.kind] || "资料", source.kind === "forum" || source.kind === "site" ? "" : source.where, source.date || ""]
    .filter(Boolean)
    .join(" · ");
}

export function topicAiStaffStatus(status: string) {
  if (status === "skipped") return "已跳过";
  if (status === "failed") return "处理失败";
  if (status === "dismissed") return "已被关闭";
  return status;
}

/** 帖子下的“拾间AI 参考回答”：读取、生成中轮询、作者或管理员关闭、管理员重新生成。topicId 为 0 时不加载。 */
export function useTopicAiAnswer(topicId: () => number, answerEl: Ref<HTMLElement | null>) {
  const route = useRoute();
  const view = ref<TopicAiAnswer | null>(null);
  const busy = ref<"" | "dismiss" | "regenerate">("");
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollCount = 0;
  let loadSeq = 0;

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
    const id = topicId();
    if (!id) return;
    try {
      const next = await topicApi.aiAnswer(id);
      if (seq !== loadSeq || id !== topicId()) return;
      const wasAnswered = view.value?.status === "answered";
      view.value = next;
      if (next.status === "pending") schedulePoll();
      else stopPolling();
      if (!wasAnswered && next.status === "answered" && route.hash === "#ai-answer") {
        await nextTick();
        answerEl.value?.scrollIntoView({ block: "start", behavior: "smooth" });
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
      view.value = await topicApi.dismissAiAnswer(topicId());
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
      view.value = await topicApi.regenerateAiAnswer(topicId());
      pollCount = 0;
      schedulePoll();
    } catch (error: any) {
      ElMessage.error(error?.response?.data?.message || "重新生成失败，请稍后再试");
    } finally {
      busy.value = "";
    }
  }

  watch(topicId, () => {
    stopPolling();
    pollCount = 0;
    view.value = null;
    if (topicId() > 0) void load();
  }, { immediate: true });

  onBeforeUnmount(stopPolling);

  return { view, busy, dismiss, regenerate };
}
