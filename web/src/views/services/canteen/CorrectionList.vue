<template>
  <div class="cc-list">
    <p v-if="loading && !entries.length" class="cc-empty" role="status">正在加载纠错…</p>
    <p v-else-if="error" class="cc-empty" role="status">{{ error }} <button type="button" class="cc-link" @click="load">重试</button></p>
    <p v-else-if="!entries.length" class="cc-empty">{{ emptyText }}</p>
    <article v-for="item in entries" :key="item.id" class="cc-item" :class="`is-${item.status}`">
      <header>
        <span class="cc-kind">{{ item.kind }}</span>
        <strong v-if="showShop && item.shopName" class="cc-shop">{{ item.shopName }}</strong>
        <span class="cc-status">{{ statusLabel(item) }}</span>
      </header>
      <p v-if="item.proposedTags?.length" class="cc-tags">卖 {{ item.proposedTags.join("、") }}</p>
      <p v-if="item.content" class="cc-content">{{ item.content }}</p>
      <p v-if="item.aiNote && item.status !== 'voting'" class="cc-note">
        <b>{{ item.status === "applied" || item.status === "reverted" ? "已修改" : "处理结果" }}</b>{{ item.aiNote }}
      </p>
      <footer>
        <span class="cc-meta">{{ item.author }} · {{ formatTime(item.createdAt) }}</span>
        <template v-if="item.status === 'voting'">
          <div class="cc-progress" :title="`${item.agreeCount} 人认为正确，超过 ${threshold} 人就会生效`">
            <i :style="{ width: `${Math.min(100, item.agreeCount / (threshold + 1) * 100)}%` }"></i>
          </div>
          <span class="cc-count">{{ item.agreeCount }}/{{ threshold + 1 }}</span>
          <template v-if="!item.mine">
            <button type="button" class="cc-vote" :class="{ 'is-on': item.myVote === 'agree' }" :disabled="busy === item.id" @click="vote(item, true)">对</button>
            <button type="button" class="cc-vote is-no" :class="{ 'is-on': item.myVote === 'disagree' }" :disabled="busy === item.id" @click="vote(item, false)">不对{{ item.disagreeCount ? ` ${item.disagreeCount}` : "" }}</button>
          </template>
          <span v-else class="cc-mine">我提交的</span>
        </template>
        <span v-else-if="item.status === 'approved'" class="cc-mine">处理中…</span>
      </footer>
      <div v-if="canModerate" class="cc-admin">
        <button v-if="['voting', 'approved', 'failed'].includes(item.status)" type="button" class="cc-link" @click="moderate(item, 'dismiss')">关闭</button>
        <button v-if="item.status === 'applied'" type="button" class="cc-link is-danger" @click="moderate(item, 'revert')">撤销这次修改</button>
        <button v-if="['failed', 'rejected'].includes(item.status)" type="button" class="cc-link" @click="moderate(item, 'retry')">重新交给 AI</button>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { toolsApi, type CanteenCorrectionEntry } from "@/api/tools";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{ shopId?: string; showShop?: boolean; reloadKey?: number }>();
const emit = defineEmits<{ (e: "loaded", count: number): void; (e: "catalog-may-change"): void }>();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const entries = ref<CanteenCorrectionEntry[]>([]);
const threshold = ref(5);
const canModerate = ref(false);
const loading = ref(false);
const error = ref("");
const busy = ref("");
let requestId = 0;

const emptyText = computed(() => props.shopId ? "这家店还没有纠错。信息不对就点“纠错”。" : "最近没有待投票的纠错。");

async function load() {
  const current = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const data = await toolsApi.canteenCorrections(props.shopId);
    if (current !== requestId) return;
    entries.value = data.entries;
    threshold.value = data.threshold;
    canModerate.value = data.canModerate;
    emit("loaded", data.entries.filter((item) => item.status === "voting").length);
  } catch (err) {
    if (current === requestId) error.value = err instanceof Error ? err.message : "纠错加载失败";
  } finally {
    if (current === requestId) loading.value = false;
  }
}

watch(() => [props.shopId, props.reloadKey], load, { immediate: true });

function statusLabel(item: CanteenCorrectionEntry) {
  return {
    voting: "投票中",
    approved: "已过票",
    applied: "已生效",
    rejected: "未采纳",
    failed: "处理失败",
    dismissed: "已关闭",
    reverted: "已撤销",
  }[item.status];
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function vote(item: CanteenCorrectionEntry, agree: boolean) {
  if (!auth.isLoggedIn) {
    void router.push({ path: "/login", query: { redirect: route.fullPath } });
    return;
  }
  busy.value = item.id;
  try {
    const result = await toolsApi.voteCanteenCorrection(item.id, agree);
    Object.assign(item, { agreeCount: result.agreeCount, disagreeCount: result.disagreeCount, status: result.status, myVote: agree ? "agree" : "disagree" });
    if (result.status === "approved") {
      ElMessage.success(item.kind === "新增门店" && item.proposedTags?.length ? "票数够了，马上加进门店列表" : "票数够了，AI 正在核对并修改门店信息");
      emit("catalog-may-change");
    } else if (result.status === "rejected") {
      ElMessage.info("认为不对的人够多了，这条纠错不采纳");
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "投票失败");
  } finally {
    busy.value = "";
  }
}

async function moderate(item: CanteenCorrectionEntry, action: "dismiss" | "revert" | "retry") {
  const text = { dismiss: "关闭这条纠错？", revert: "撤销这次修改？门店会恢复成修改前的样子。", retry: "重新交给 AI 处理？" }[action];
  try {
    await ElMessageBox.confirm(text, "处理纠错", { confirmButtonText: "确定", cancelButtonText: "取消", type: action === "revert" ? "warning" : undefined });
  } catch {
    return;
  }
  try {
    const result = await toolsApi.moderateCanteenCorrection(item.id, action);
    item.status = result.status;
    if (action !== "dismiss") emit("catalog-may-change");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "操作失败");
  }
}

defineExpose({ load });
</script>

<style scoped>
.cc-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.cc-empty { margin: 0; padding: 12px 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.cc-item { min-width: 0; padding: 10px 12px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); background: var(--cpu-card); }
.cc-item.is-dismissed, .cc-item.is-rejected, .cc-item.is-reverted { opacity: .7; }
.cc-item header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cc-kind { padding: 1px 6px; border-radius: var(--cpu-radius-s); background: var(--cpu-hue-amber-bg); color: var(--cpu-hue-amber-ink); font-size: var(--cpu-fs-xs); font-weight: 600; }
.cc-shop { font-size: var(--cpu-fs-s); }
.cc-status { margin-left: auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.is-applied .cc-status { color: var(--cpu-primary); font-weight: 600; }
.cc-tags { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.cc-content { margin: 6px 0 0; font-size: var(--cpu-fs-s); line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; }
.cc-note { margin: 6px 0 0; padding: 6px 8px; border-radius: var(--cpu-radius-s); background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.cc-note b { margin-right: 6px; color: var(--cpu-text); }
.cc-item footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 8px; }
.cc-meta { flex: 1; min-width: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cc-progress { width: 56px; height: 4px; border-radius: 999px; background: var(--cpu-surface-subtle); overflow: hidden; }
.cc-progress i { display: block; height: 100%; background: var(--cpu-primary); }
.cc-count { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); font-variant-numeric: tabular-nums; }
.cc-vote { flex-shrink: 0; min-width: 44px; height: 28px; padding: 0 10px; white-space: nowrap; border: 1px solid var(--cpu-border); border-radius: 999px; background: transparent; color: var(--cpu-text-secondary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); }
/* 触屏上点过的按钮会一直停在 hover，所以悬停样式只给鼠标，选中样式写死前景色。 */
@media (hover: hover) {
  .cc-vote:hover:not(:disabled):not(.is-on) { border-color: var(--cpu-primary); color: var(--cpu-primary); }
}
.cc-vote.is-on, .cc-vote.is-on:hover { border-color: var(--cpu-primary); background: var(--cpu-primary); color: var(--cpu-on-primary); font-weight: 600; }
.cc-vote.is-no.is-on, .cc-vote.is-no.is-on:hover { border-color: var(--cpu-text-muted); background: var(--cpu-text-muted); color: var(--cpu-card); }
.cc-vote:disabled { opacity: .6; cursor: wait; }
.cc-mine { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.cc-admin { display: flex; gap: 12px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--cpu-border-soft); }
.cc-link { padding: 0; border: 0; background: none; color: var(--cpu-primary); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); }
.cc-link.is-danger { color: var(--cpu-danger); }

/* 窄屏：作者和时间单独一行，投票条和按钮放下一行。 */
@media (max-width: 560px) {
  .cc-meta { flex-basis: 100%; }
  .cc-progress { flex: 1; width: auto; }
  .cc-item header { gap: 4px 6px; }
}
</style>
