<template>
  <section class="th-group">
    <div class="th-group-head">
      <h2 class="th-h2">数据统计</h2>
      <el-radio-group v-model="days" size="small" @change="load">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
        <el-radio-button :value="90">近 90 天</el-radio-button>
        <el-radio-button :value="365">近一年</el-radio-button>
      </el-radio-group>
    </div>
    <div v-if="!stats" class="th-empty"><p>加载中…</p></div>
    <template v-else>
      <div class="th-stat-grid">
        <div class="th-stat"><div class="th-stat-label">接待量</div><div class="th-stat-value">{{ stats.sessions.total }}</div></div>
        <div class="th-stat"><div class="th-stat-label">留言 / 实时</div><div class="th-stat-value">{{ stats.sessions.async }} / {{ stats.sessions.live }}</div></div>
        <div class="th-stat"><div class="th-stat-label">实时会话占比</div><div class="th-stat-value">{{ livePercent }}</div></div>
        <div class="th-stat"><div class="th-stat-label">重点关注</div><div class="th-stat-value">{{ stats.sessions.focus }}</div></div>
        <div class="th-stat"><div class="th-stat-label">高危个案</div><div class="th-stat-value">{{ stats.cases.total }}</div></div>
        <div class="th-stat"><div class="th-stat-label">未结案工单（当前）</div><div class="th-stat-value">{{ stats.cases.openNow }}</div></div>
        <div class="th-stat"><div class="th-stat-label">进行中会话（当前）</div><div class="th-stat-value">{{ stats.sessions.activeNow }}</div></div>
        <div class="th-stat"><div class="th-stat-label">入群申请 通过 / 拒绝</div><div class="th-stat-value">{{ stats.applications.approved ?? 0 }} / {{ stats.applications.rejected ?? 0 }}</div></div>
      </div>

      <h3 class="th-h3">每日新会话</h3>
      <div class="th-bars" role="img" :aria-label="`近 ${stats.days} 天每日新会话数`">
        <div v-for="day in stats.daily" :key="day.date" class="th-bar" :title="`${day.date}：${day.sessions}`">
          <span :style="{ height: `${barHeight(day.sessions)}%` }" />
        </div>
      </div>
      <p class="th-meta"><span>{{ stats.daily[0]?.date }}</span><span>{{ stats.daily.at(-1)?.date }}</span><span>最多 {{ maxDaily }} 次/天</span></p>
    </template>
  </section>

  <section v-if="stats" class="th-group th-group--flush">
    <div class="th-group-head"><h2 class="th-h2">洞主接待量</h2></div>
    <div class="th-table-wrap">
      <table class="th-table">
        <thead><tr><th>洞主</th><th>状态</th><th>接待次数</th></tr></thead>
        <tbody>
          <tr v-for="host in stats.hosts" :key="host.code ?? host.name">
            <td>{{ host.name }}</td>
            <td>{{ !host.enabled ? "已停用" : host.online ? "在岗" : "离岗" }}</td>
            <td>{{ host.sessions }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="stats && stats.rooms.length" class="th-group th-group--flush">
    <div class="th-group-head"><h2 class="th-h2">宣泄室活跃度</h2></div>
    <div class="th-table-wrap">
      <table class="th-table">
        <thead><tr><th>宣泄室</th><th>类型</th><th>状态</th><th>在群同学</th><th>期间消息</th></tr></thead>
        <tbody>
          <tr v-for="room in stats.rooms" :key="room.id">
            <td>{{ room.name }}</td>
            <td>{{ room.categoryLabel }}</td>
            <td>{{ room.status === "active" ? "开放" : "已关闭" }}</td>
            <td>{{ room.members }}</td>
            <td>{{ room.messages }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { treeholeApi, type TreeholeStats } from "@/api/treehole";

const days = ref(30);
const stats = ref<TreeholeStats | null>(null);

const maxDaily = computed(() => Math.max(1, ...(stats.value?.daily.map((day) => day.sessions) ?? [0])));
const livePercent = computed(() => {
  const value = stats.value?.sessions;
  if (!value?.total) return "—";
  return `${Math.round((value.live / value.total) * 100)}%`;
});

function barHeight(value: number) {
  return value ? Math.max(4, (value / maxDaily.value) * 100) : 0;
}

async function load() {
  stats.value = await treeholeApi.stats(days.value);
}

onMounted(load);
</script>

<style scoped>
.th-h3 { margin: 18px 0 8px; font-size: var(--cpu-fs-m); font-weight: 600; }
.th-bars {
  display: flex;
  height: 96px;
  align-items: flex-end;
  gap: 2px;
  padding: 4px 0;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.th-bar { display: flex; height: 100%; min-width: 2px; flex: 1; align-items: flex-end; }
.th-bar span { display: block; width: 100%; border-radius: 2px 2px 0 0; background: var(--cpu-primary); }
</style>
