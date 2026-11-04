<template>
  <div class="pk-page library-page">
    <header class="pk-head">
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true"><el-icon><Reading /></el-icon></span>
        <div class="pk-title-copy">
          <h1>图书馆借阅</h1>
          <p>用学校统一认证登录时的账号进入图书馆，只读，不会替你续借或改动任何记录。</p>
        </div>
      </div>
      <el-button class="library-refresh" :loading="loading" @click="load">刷新</el-button>
    </header>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="library-alert" />

    <template v-if="overview">
      <section class="library-summary" aria-label="借阅额度">
        <div class="library-stat">
          <span class="library-stat-value">{{ overview.loans.length }}</span>
          <span class="library-stat-label">在借</span>
        </div>
        <div v-if="overview.quota" class="library-stat">
          <span class="library-stat-value">{{ overview.quota.borrowed }} / {{ overview.quota.limit }}</span>
          <span class="library-stat-label">已借 / 可借上限</span>
        </div>
        <div class="library-stat" :class="{ 'is-warn': dueSoonCount > 0 }">
          <span class="library-stat-value">{{ dueSoonCount }}</span>
          <span class="library-stat-label">7 天内到期</span>
        </div>
        <div v-if="overview.fines.length" class="library-stat is-warn">
          <span class="library-stat-value">{{ fineTotal }}</span>
          <span class="library-stat-label">待处理罚款（元）</span>
        </div>
      </section>

      <section class="library-section" aria-labelledby="library-loans-title">
        <h2 id="library-loans-title">当前借阅</h2>
        <p v-if="!overview.loans.length" class="library-empty">现在没有在借的书。</p>
        <ul v-else class="library-list">
          <li v-for="(loan, index) in overview.loans" :key="`${loan.title}-${index}`" class="library-item">
            <div class="library-item-main">
              <b>{{ loan.title }}</b>
              <span class="library-meta">{{ [loan.author, loan.callNo, loan.location].filter(Boolean).join(" · ") }}</span>
            </div>
            <div class="library-item-side">
              <span :class="['library-due', dueTone(loan.dueDate)]">{{ loan.dueDate ? `${loan.dueDate} 到期` : "无到期日" }}</span>
              <span class="library-meta">
                已续借 {{ loan.renewTimes }} 次<template v-if="loan.renewLeft !== undefined"> · 还可续 {{ loan.renewLeft }} 次</template>
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="overview.fines.length" class="library-section" aria-labelledby="library-fines-title">
        <h2 id="library-fines-title">罚款</h2>
        <ul class="library-list">
          <li v-for="(fine, index) in overview.fines" :key="`fine-${index}`" class="library-item">
            <div class="library-item-main">
              <b>{{ fine.title }}</b>
              <span v-if="fine.reason" class="library-meta">{{ fine.reason }}</span>
            </div>
            <span class="library-due is-overdue">{{ fine.amount !== undefined ? `${fine.amount} 元` : "—" }}</span>
          </li>
        </ul>
      </section>
    </template>

    <section class="library-section" aria-labelledby="library-history-title">
      <h2 id="library-history-title">借阅历史<span v-if="historyTotal" class="library-count">{{ historyTotal }} 本</span></h2>
      <p v-if="historyLoaded && !history.length" class="library-empty">还没有借阅记录。</p>
      <ul v-else class="library-list">
        <li v-for="(item, index) in history" :key="`hist-${index}`" class="library-item">
          <div class="library-item-main">
            <b>{{ item.title }}</b>
            <span class="library-meta">{{ [item.author, item.callNo].filter(Boolean).join(" · ") }}</span>
          </div>
          <span class="library-meta">{{ [item.loanDate, item.returnDate].filter(Boolean).join(" 借 → ") }}{{ item.returnDate ? " 还" : "" }}</span>
        </li>
      </ul>
      <el-button v-if="history.length < historyTotal" text :loading="historyLoading" @click="loadHistory(historyPage + 1)">加载更多</el-button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Reading } from "@element-plus/icons-vue";
import { libraryApi, type LibraryHistoryPage, type LibraryOverview } from "@/api/library";
import "@/styles/page-kit.css";

const overview = ref<LibraryOverview | null>(null);
const loading = ref(false);
const error = ref("");
const history = ref<LibraryHistoryPage["list"]>([]);
const historyTotal = ref(0);
const historyPage = ref(0);
const historyLoaded = ref(false);
const historyLoading = ref(false);

function errorText(e: unknown, fallback: string) {
  const serverMessage = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof serverMessage === "string" && serverMessage) return serverMessage;
  return (e instanceof Error && e.message) || fallback;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function daysUntil(date?: string) {
  if (!date) return Infinity;
  return Math.round((Date.parse(`${date}T00:00:00+08:00`) - Date.parse(`${today()}T00:00:00+08:00`)) / 86_400_000);
}

function dueTone(date?: string) {
  const days = daysUntil(date);
  if (days < 0) return "is-overdue";
  if (days <= 7) return "is-soon";
  return "";
}

const dueSoonCount = computed(() => (overview.value?.loans ?? []).filter((loan) => daysUntil(loan.dueDate) <= 7).length);
const fineTotal = computed(() => (overview.value?.fines ?? []).reduce((sum, fine) => sum + (fine.amount ?? 0), 0).toFixed(2));

async function loadHistory(page: number) {
  historyLoading.value = true;
  try {
    const result = await libraryApi.history(page);
    history.value = page === 1 ? result.list : [...history.value, ...result.list];
    historyTotal.value = result.total;
    historyPage.value = result.page;
    historyLoaded.value = true;
  } catch (e) {
    if (!error.value) error.value = errorText(e, "借阅历史加载失败");
  } finally {
    historyLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    overview.value = await libraryApi.overview();
  } catch (e) {
    error.value = errorText(e, "图书馆暂时连不上，请稍后重试");
  } finally {
    loading.value = false;
  }
  await loadHistory(1);
}

onMounted(load);
</script>

<style scoped>
.library-page { display: flex; flex-direction: column; gap: 16px; }
.library-alert { margin: 0; }
.library-refresh { flex: none; align-self: center; width: auto; }
.library-summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.library-stat { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); background: var(--cpu-card); }
.library-stat-value { font-size: var(--cpu-fs-l); font-weight: 600; font-variant-numeric: tabular-nums; }
.library-stat-label { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.library-stat.is-warn .library-stat-value { color: var(--cpu-accent); }
.library-section { display: flex; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.library-section h2 { margin: 0; font-size: var(--cpu-fs-m); font-weight: 600; }
.library-count { margin-left: 8px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); font-weight: 400; }
.library-empty { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.library-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.library-item { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; }
.library-item + .library-item { border-top: 1px solid var(--cpu-border-soft); }
.library-item-main, .library-item-side { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.library-item-side { align-items: flex-end; text-align: right; flex: none; }
.library-item-main b { font-size: var(--cpu-fs-s); font-weight: 600; }
.library-meta { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.library-due { font-size: var(--cpu-fs-s); font-variant-numeric: tabular-nums; }
.library-due.is-soon { color: var(--cpu-warn); }
.library-due.is-overdue { color: var(--el-color-danger); }
@media (max-width: 640px) {
  .library-item { flex-direction: column; gap: 4px; }
  .library-item-side { align-items: flex-start; text-align: left; }
}
</style>
