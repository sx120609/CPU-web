<template>
  <div class="th-page th-page--wide th-admin">
    <router-link class="th-back" to="/treehole">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>艾绒树洞
    </router-link>
    <header class="th-head">
      <div class="th-head-copy">
        <h1>树洞后台</h1>
        <p v-if="overview?.isAdmin">核心管理员。所有查阅、溯源和修改都会记入操作日志。</p>
        <p v-else-if="overview">站点管理员只能任免树洞人员和录入排班，看不到任何会话内容。</p>
      </div>
    </header>

    <div v-if="loading" class="th-group" role="status"><el-skeleton :rows="4" animated /></div>
    <div v-else-if="error" class="th-group th-empty" role="alert"><p>{{ error }}</p></div>

    <template v-else-if="overview">
      <nav class="th-tabs" aria-label="后台分区">
        <button v-for="item in tabs" :key="item.key" type="button" class="th-tab" :class="{ 'is-active': tab === item.key }" @click="setTab(item.key)">
          {{ item.label }}<span v-if="item.badge" class="th-badge">{{ item.badge }}</span>
        </button>
      </nav>
      <CasesPanel v-if="tab === 'cases'" :initial-case="initialCase" @changed="refreshOverview" />
      <SessionsPanel v-else-if="tab === 'sessions'" />
      <RoomsPanel v-else-if="tab === 'rooms'" />
      <StaffPanel v-else-if="tab === 'staff'" :core-admin="overview.isAdmin" />
      <StatsPanel v-else-if="tab === 'stats'" />
      <AuditPanel v-else-if="tab === 'audit'" />
      <ConfigPanel v-else-if="tab === 'config'" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi } from "@/api/treehole";
import AuditPanel from "./admin/AuditPanel.vue";
import CasesPanel from "./admin/CasesPanel.vue";
import ConfigPanel from "./admin/ConfigPanel.vue";
import RoomsPanel from "./admin/RoomsPanel.vue";
import SessionsPanel from "./admin/SessionsPanel.vue";
import StaffPanel from "./admin/StaffPanel.vue";
import StatsPanel from "./admin/StatsPanel.vue";
import { errorText } from "./shared";
import "./treehole.css";

type TabKey = "cases" | "sessions" | "rooms" | "staff" | "stats" | "audit" | "config";

const route = useRoute();
const router = useRouter();
const overview = ref<Awaited<ReturnType<typeof treeholeApi.adminOverview>> | null>(null);
const loading = ref(true);
const error = ref("");
const tab = ref<TabKey>("cases");
const initialCase = Number(route.query.case) || null;

const tabs = computed(() => {
  if (!overview.value?.isAdmin) return [{ key: "staff" as const, label: "人员与排班", badge: 0 }];
  const counts = overview.value.counts;
  return [
    { key: "cases" as const, label: "高危工单", badge: (counts?.openCases ?? 0) + (counts?.pendingReveals ?? 0) },
    { key: "sessions" as const, label: "会话日志", badge: 0 },
    { key: "rooms" as const, label: "宣泄室", badge: 0 },
    { key: "staff" as const, label: "人员与排班", badge: 0 },
    { key: "stats" as const, label: "数据统计", badge: 0 },
    { key: "audit" as const, label: "操作日志", badge: 0 },
    { key: "config" as const, label: "设置", badge: 0 },
  ];
});

function setTab(key: TabKey) {
  tab.value = key;
  router.replace({ query: { tab: key } });
}

async function refreshOverview() {
  overview.value = await treeholeApi.adminOverview();
}

onMounted(async () => {
  try {
    await refreshOverview();
    const requested = String(route.query.tab || "");
    const allowed = tabs.value.map((item) => item.key) as string[];
    tab.value = (allowed.includes(requested) ? requested : allowed[0]) as TabKey;
  } catch (cause) {
    error.value = errorText(cause, "只有树洞核心管理员或站点管理员可以进入后台");
  } finally {
    loading.value = false;
  }
});
</script>
