<template>
  <div class="installs-pane">
    <header class="installs-head">
      <div>
        <div class="eyebrow">Windows 桌面端</div>
        <h2>桌面端安装</h2>
        <p>Windows 安装器在安装失败，或经过重试 / 管理员权限重试才成功时匿名上报阶段、错误码与检测到的安全软件。不记录账号、IP 或设备标识，报错信息中的用户目录已替换；明细保留 180 天。</p>
      </div>
      <div class="head-actions">
        <el-radio-group v-model="range" size="small" @change="load">
          <el-radio-button value="1d">24 小时</el-radio-button>
          <el-radio-button value="7d">近 7 天</el-radio-button>
          <el-radio-button value="30d">近 30 天</el-radio-button>
          <el-radio-button value="90d">近 90 天</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" show-icon :closable="false" :title="error" />

    <div v-loading="loading" class="installs-content">
      <template v-if="stats">
        <div class="metric-grid">
          <div class="metric"><span>{{ rangeLabel }}报告</span><strong>{{ stats.reports }}</strong><small>累计 {{ stats.totals.allTime }} 条</small></div>
          <div class="metric danger-tint"><span>安装失败</span><strong>{{ stats.byOutcome.failed }}</strong><small>{{ ratio(stats.byOutcome.failed, stats.reports) }}</small></div>
          <div class="metric"><span>重试后成功</span><strong>{{ stats.byOutcome.retried }}</strong><small>文件被占用等临时错误</small></div>
          <div class="metric"><span>提权后成功</span><strong>{{ stats.byOutcome.elevated }}</strong><small>以管理员身份重试</small></div>
        </div>

        <div class="dist-grid">
          <section class="card">
            <h3>每日报告</h3>
            <p class="hint">近 {{ stats.trend.dates.length }} 天，按北京时间统计；“已恢复”为重试或提权后成功。</p>
            <div class="chart-box"><DailyActiveChart :option="trendChartOption" /></div>
          </section>
          <section class="card">
            <h3>错误码</h3>
            <p class="hint">红色为最终失败的部分，其余为重试或提权后恢复。</p>
            <GroupBars :rows="stats.byErrorCode" :total="stats.reports" />
          </section>
        </div>

        <div class="feature-grid">
          <section class="card">
            <h3>出错阶段</h3>
            <GroupBars :rows="stats.byStage" :total="stats.reports" :label="stageLabel" />
          </section>
          <section class="card">
            <h3>安全软件</h3>
            <p class="hint">同一报告检测到多款软件时分别计数。</p>
            <GroupBars :rows="stats.byAntivirus" :total="stats.reports" />
          </section>
          <section class="card">
            <h3>客户端版本</h3>
            <GroupBars :rows="stats.byAppVersion" :total="stats.reports" />
            <h3 class="sub-title">系统</h3>
            <GroupBars :rows="stats.byWindows" :total="stats.reports" />
          </section>
        </div>

        <section class="card">
          <h3>最近报告</h3>
          <p class="hint">展开行查看完整报错信息。</p>
          <div class="table-scroll">
            <el-table :data="stats.recent" size="small" row-key="id" empty-text="暂无报告">
              <el-table-column type="expand" width="36">
                <template #default="{ row }">
                  <div class="detail">
                    <div class="detail-message">{{ row.message || "（无报错信息）" }}</div>
                    <div class="muted">
                      {{ row.windows }} · {{ row.osRelease }} · {{ row.arch }} · 用时 {{ duration(row.durationMs) }}
                      <template v-if="row.previousVersion"> · 升级自 {{ row.previousVersion }}</template>
                      <template v-if="row.fileName"> · 文件 {{ row.fileName }}</template>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="120"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column>
              <el-table-column label="版本" width="90"><template #default="{ row }">{{ row.appVersion }}</template></el-table-column>
              <el-table-column label="方式" width="80"><template #default="{ row }">{{ MODE_LABELS[row.mode] ?? row.mode }}</template></el-table-column>
              <el-table-column label="结果" width="100">
                <template #default="{ row }"><el-tag size="small" :type="OUTCOMES[row.outcome as DesktopInstallOutcome]?.type">{{ OUTCOMES[row.outcome as DesktopInstallOutcome]?.label ?? row.outcome }}</el-tag></template>
              </el-table-column>
              <el-table-column label="阶段" width="120"><template #default="{ row }">{{ stageLabel(row.stage) }}</template></el-table-column>
              <el-table-column label="错误码" width="90"><template #default="{ row }"><code v-if="row.errorCode">{{ row.errorCode }}</code><span v-else class="muted">-</span></template></el-table-column>
              <el-table-column label="文件" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.fileName || "-" }}</template></el-table-column>
              <el-table-column label="安全软件" min-width="130" show-overflow-tooltip>
                <template #default="{ row }">{{ row.antivirus.length ? row.antivirus.join("、") : "-" }}</template>
              </el-table-column>
              <el-table-column label="权限" width="70"><template #default="{ row }">{{ row.elevated ? "管理员" : "普通" }}</template></el-table-column>
              <el-table-column label="重试" width="60" align="right"><template #default="{ row }">{{ row.retries }}</template></el-table-column>
            </el-table>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, onMounted, ref, type PropType } from "vue";
import type { EChartsOption } from "echarts";
import {
  adminApi,
  type DesktopInstallGroupCount,
  type DesktopInstallOutcome,
  type DesktopInstallReports,
  type IosClientStatsRange,
} from "@/api/admin";

const DailyActiveChart = defineAsyncComponent(() => import("./DailyActiveChart.vue"));

function ratio(part: number, total: number) {
  return total ? `${Math.round((part / total) * 1000) / 10}%` : "0%";
}

// One row per group: the bar is the group's share of all reports, split into
// the failed part (red) and the recovered part.
const GroupBars = defineComponent({
  props: {
    rows: { type: Array as PropType<DesktopInstallGroupCount[]>, required: true },
    total: { type: Number, required: true },
    label: { type: Function as PropType<(key: string) => string>, default: (key: string) => key },
  },
  setup(props) {
    return () => {
      if (!props.rows.length) return h("div", { class: "empty" }, "暂无数据");
      return props.rows.map((row) => h("div", { class: "bar-row", key: row.key }, [
        h("div", { class: "bar-label" }, [h("span", { title: row.key }, props.label(row.key))]),
        h("div", { class: "bar-track split" }, [
          h("div", { class: "bar-fill failed", style: { width: ratio(row.failed, props.total) } }),
          h("div", { class: "bar-fill", style: { width: ratio(row.count - row.failed, props.total) } }),
        ]),
        h("span", { class: "bar-count" }, row.failed ? `${row.count} · 失败 ${row.failed}` : String(row.count)),
      ]));
    };
  },
});

const range = ref<IosClientStatsRange>("30d");
const stats = ref<DesktopInstallReports | null>(null);
const loading = ref(false);
const error = ref("");

const RANGE_LABELS: Record<IosClientStatsRange, string> = { "1d": "24 小时", "7d": "近 7 天", "30d": "近 30 天", "90d": "近 90 天", all: "全部" };
const rangeLabel = computed(() => RANGE_LABELS[range.value]);

const STAGE_LABELS: Record<string, string> = {
  lock: "获取安装锁",
  "close-running": "关闭运行中的程序",
  stage: "解压暂存",
  swap: "替换文件",
  rollback: "回滚",
  shortcuts: "创建快捷方式",
  registry: "写入注册表",
  elevate: "请求管理员权限",
  unknown: "未知",
};
const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

const MODE_LABELS: Record<string, string> = { install: "全新安装", upgrade: "覆盖升级", "auto-update": "自动更新" };

const OUTCOMES: Record<DesktopInstallOutcome, { label: string; type: "danger" | "warning" | "success" }> = {
  failed: { label: "失败", type: "danger" },
  retried: { label: "重试后成功", type: "warning" },
  elevated: { label: "提权后成功", type: "success" },
};

function duration(value: number) {
  return value >= 1000 ? `${Math.round(value / 100) / 10} s` : `${value} ms`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const trendChartOption = computed<EChartsOption>(() => {
  const trend = stats.value?.trend;
  if (!trend) return {};
  const lastIndex = Math.max(0, trend.dates.length - 1);
  const step = trend.dates.length > 45 ? 14 : 7;
  return {
    animation: false,
    grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: "#94a3b8", fontSize: 11 } },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(15, 23, 42, 0.92)",
      borderWidth: 0,
      textStyle: { color: "#f8fafc", fontSize: 12 },
    },
    xAxis: {
      type: "category",
      data: trend.dates.map((date) => date.slice(5).replace("-", "/")),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#dbe4f0" } },
      axisLabel: { color: "#94a3b8", fontSize: 10, interval: (index: number) => index === 0 || index === lastIndex || index % step === 0 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitNumber: 3,
      axisLabel: { color: "#94a3b8", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.18)" } },
    },
    series: [
      { name: "失败", type: "bar", stack: "reports", data: trend.failed, itemStyle: { color: "#ef4444" }, barMaxWidth: 14 },
      { name: "已恢复", type: "bar", stack: "reports", data: trend.recovered, itemStyle: { color: "#f59e0b" }, barMaxWidth: 14 },
    ],
  };
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    stats.value = await adminApi.desktopInstallReports(range.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "桌面端安装报告加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.installs-pane { display: flex; flex-direction: column; gap: 18px; }
.installs-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 8px 2px 0; flex-wrap: wrap; }
.installs-head h2, .card h3 { margin: 0; color: var(--cpu-text); }
.installs-head h2 { font-size: 24px; }
.installs-head p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; max-width: 760px; }
.eyebrow { margin-bottom: 5px; color: var(--cpu-primary); font-size: 11px; font-weight: 700; letter-spacing: .16em; }
.head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.installs-content { min-height: 240px; display: flex; flex-direction: column; gap: 18px; }
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.metric { padding: 12px; border-radius: 10px; background: linear-gradient(145deg, var(--cpu-surface-subtle), rgba(20,143,123,.055)); min-width: 0; }
.metric.danger-tint { background: linear-gradient(145deg, var(--cpu-surface-subtle), rgba(239,68,68,.08)); }
.metric span { display: block; color: var(--cpu-text-secondary); font-size: 12px; }
.metric strong { display: block; margin-top: 5px; font-size: 22px; color: var(--cpu-text); }
.metric small { display: block; margin-top: 4px; color: var(--cpu-text-secondary); font-size: 11px; }
.dist-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.card { padding: 17px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); min-width: 0; }
.card h3 { font-size: 15px; margin-bottom: 12px; }
.card .hint { margin: -6px 0 12px; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.55; }
.sub-title { margin-top: 20px; }
.chart-box { height: 220px; }
:deep(.bar-row) { display: grid; grid-template-columns: minmax(0, 130px) minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; }
:deep(.bar-label) { min-width: 0; }
:deep(.bar-label span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cpu-text); }
:deep(.bar-track) { height: 8px; border-radius: 4px; background: var(--cpu-surface-subtle); overflow: hidden; }
:deep(.bar-track.split) { display: flex; }
:deep(.bar-fill) { height: 100%; background: var(--cpu-primary); }
:deep(.bar-fill.failed) { background: var(--el-color-danger); }
:deep(.bar-count) { color: var(--cpu-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
:deep(.empty) { color: var(--cpu-text-secondary); font-size: 13px; padding: 8px 0; }
.muted { color: var(--cpu-text-secondary); font-size: 11px; }
.table-scroll { overflow-x: auto; }
.detail { display: flex; flex-direction: column; gap: 6px; padding: 4px 12px 4px 48px; }
.detail-message { color: var(--cpu-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 1100px) { .feature-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 860px) { .dist-grid, .feature-grid { grid-template-columns: 1fr; } }
</style>
