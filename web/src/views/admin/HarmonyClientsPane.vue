<template>
  <div class="clients-pane">
    <header class="clients-head">
      <div>
        <div class="eyebrow">原生客户端</div>
        <h2>鸿蒙客户端统计</h2>
        <p>原生鸿蒙 App 在启动和回到前台时上报设备、版本与功能状态。按安装去重，安装标识是 App 自己生成的随机编号，不含 OAID、UDID 等设备标识；日活保留 180 天。3.0.7 之前的版本不带上报功能，不计入此页。崩溃与性能数据尚未采集。</p>
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

    <div v-loading="loading" class="clients-content">
      <template v-if="stats">
        <div class="metric-grid">
          <div class="metric"><span>累计安装</span><strong>{{ stats.totals.allTime }}</strong></div>
          <div class="metric"><span>24 小时活跃</span><strong>{{ stats.totals.active1d }}</strong></div>
          <div class="metric"><span>7 天活跃</span><strong>{{ stats.totals.active7d }}</strong></div>
          <div class="metric"><span>30 天活跃</span><strong>{{ stats.totals.active30d }}</strong></div>
          <div class="metric">
            <span>{{ rangeLabel }}登录用户</span><strong>{{ stats.signedInUsers }}</strong>
            <small>{{ stats.installs }} 台设备</small>
          </div>
        </div>

        <div class="dist-grid">
          <section class="card">
            <h3>每日活跃设备</h3>
            <p class="hint">近 {{ stats.trend.dates.length }} 天，每台设备每天计一次；虚线为当日新增安装。</p>
            <div class="chart-box"><DailyActiveChart :option="activeChartOption" /></div>
          </section>
          <section class="card">
            <h3>版本升级进度</h3>
            <p class="hint">每日活跃设备按客户端版本堆叠。</p>
            <div class="chart-box"><DailyActiveChart :option="versionChartOption" /></div>
          </section>
        </div>

        <div class="dist-grid">
          <section class="card">
            <h3>设备类型</h3>
            <div v-if="!stats.byDeviceType.length" class="empty">暂无数据</div>
            <div v-for="row in stats.byDeviceType" :key="row.type" class="bar-row">
              <div class="bar-label"><span>{{ row.name }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
            <h3 class="sub-title">系统版本</h3>
            <div v-if="!stats.bySystemVersion.length" class="empty">暂无数据</div>
            <div v-for="row in stats.bySystemVersion" :key="row.version" class="bar-row">
              <div class="bar-label"><span>HarmonyOS {{ row.version }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
          </section>
          <section class="card">
            <h3>客户端版本</h3>
            <div v-if="!stats.byAppVersion.length" class="empty">暂无数据</div>
            <div v-for="row in stats.byAppVersion" :key="row.version" class="bar-row">
              <div class="bar-label"><span>{{ row.version }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
            <h3 class="sub-title">API 版本</h3>
            <p class="hint">系统的 API 版本决定可用的原生能力。</p>
            <div v-if="!stats.byApiVersion.length" class="empty">暂无数据</div>
            <div v-for="row in stats.byApiVersion" :key="row.version" class="bar-row">
              <div class="bar-label"><span>API {{ row.version }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
          </section>
        </div>

        <section class="card">
          <h3>设备型号</h3>
          <p class="hint">厂商的型号代码，按设备数排序，最多列出 30 个。</p>
          <div v-if="!stats.byDeviceModel.length" class="empty">暂无数据</div>
          <div class="model-grid">
            <div v-for="row in stats.byDeviceModel" :key="row.deviceModel" class="bar-row">
              <div class="bar-label">
                <span>{{ row.deviceModel }}</span>
                <small v-if="row.brand">{{ row.brand }}</small>
              </div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
          </div>
          <p v-if="stats.otherDeviceModels.models" class="hint tail">另有 {{ stats.otherDeviceModels.models }} 个型号共 {{ stats.otherDeviceModels.count }} 台未列出。</p>
        </section>

        <div class="feature-grid">
          <section class="card">
            <h3>课表风格</h3>
            <div v-for="row in features.scheduleStyle" :key="row.style" class="bar-row">
              <div class="bar-label"><span>{{ row.style === "unknown" ? "未上报" : row.name }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
            <FlagBar label="使用自定义课表背景" :value="features.customBackground" />
          </section>
          <section class="card">
            <h3>课程配色</h3>
            <div v-for="row in features.schedulePalette" :key="row.palette" class="bar-row">
              <div class="bar-label"><span>{{ paletteLabel(row.palette) }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
            <FlagBar label="改过课表显示设置" :value="features.customDisplay" />
          </section>
          <section class="card">
            <h3>外观模式</h3>
            <div v-for="row in features.appearanceMode" :key="row.mode" class="bar-row">
              <div class="bar-label"><span>{{ appearanceLabel(row.mode) }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
          </section>
        </div>

        <section class="card">
          <h3>最近活跃设备</h3>
          <div class="table-scroll">
            <el-table :data="stats.recent" size="small" empty-text="暂无数据">
              <el-table-column label="设备" min-width="170">
                <template #default="{ row }">{{ row.brandName }}<span class="muted"> {{ row.deviceModel }}</span></template>
              </el-table-column>
              <el-table-column label="类型" width="80"><template #default="{ row }">{{ row.typeName }}</template></el-table-column>
              <el-table-column label="系统" width="150"><template #default="{ row }">{{ row.systemVersion }}</template></el-table-column>
              <el-table-column label="客户端" width="120"><template #default="{ row }">{{ row.appVersion }} ({{ row.appBuild }})</template></el-table-column>
              <el-table-column label="用户" min-width="140">
                <template #default="{ row }">
                  <span v-if="row.user">{{ row.user.nickname || row.user.username }}<span class="muted"> #{{ row.user.id }}</span></span>
                  <span v-else class="muted">未登录</span>
                </template>
              </el-table-column>
              <el-table-column label="首次" width="150"><template #default="{ row }">{{ formatDateTime(row.firstSeenAt) }}</template></el-table-column>
              <el-table-column label="最近" width="150"><template #default="{ row }">{{ formatDateTime(row.lastSeenAt) }}</template></el-table-column>
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
import { adminApi, type HarmonyClientStats, type IosClientFlagCounts, type IosClientStatsRange } from "@/api/admin";

const DailyActiveChart = defineAsyncComponent(() => import("./DailyActiveChart.vue"));

const FlagBar = defineComponent({
  props: { label: { type: String, required: true }, value: { type: Object as PropType<IosClientFlagCounts>, required: true } },
  setup(props) {
    return () => {
      const known = props.value.yes + props.value.no;
      const share = known ? `${Math.round((props.value.yes / known) * 1000) / 10}%` : "-";
      return h("div", { class: "flag-row" }, [
        h("div", { class: "flag-head" }, [h("span", props.label), h("strong", share)]),
        h("div", { class: "bar-track" }, [h("div", { class: "bar-fill", style: { width: known ? share : "0%" } })]),
        h("small", `是 ${props.value.yes} · 否 ${props.value.no} · 未知 ${props.value.unknown}`),
      ]);
    };
  },
});

const range = ref<IosClientStatsRange>("30d");
const stats = ref<HarmonyClientStats | null>(null);
const loading = ref(false);
const error = ref("");

const RANGE_LABELS: Record<IosClientStatsRange, string> = { "1d": "24 小时", "7d": "近 7 天", "30d": "近 30 天", "90d": "近 90 天", all: "累计" };
const rangeLabel = computed(() => RANGE_LABELS[range.value]);
const features = computed(() => stats.value!.features);

const APPEARANCE_LABELS: Record<string, string> = { system: "跟随系统", light: "浅色", dark: "深色", unknown: "未上报" };
const appearanceLabel = (mode: string) => APPEARANCE_LABELS[mode] ?? mode;

// 课表配色的键和网页、安卓一致。
const PALETTE_LABELS: Record<string, string> = {
  "color-glass": "多彩", green: "青绿", blue: "蓝色", teal: "湖蓝", indigo: "靛粉", violet: "紫色", orange: "橙色", rose: "玫红", slate: "石墨",
  unknown: "未上报",
};
const paletteLabel = (palette: string) => PALETTE_LABELS[palette] ?? palette;

const SERIES_COLORS = ["#148f7b", "#3b82f6", "#f59e0b", "#a855f7", "#94a3b8"];

function ratio(part: number, total: number) {
  return total ? `${Math.round((part / total) * 1000) / 10}%` : "0%";
}

function percent(count: number) {
  return ratio(count, stats.value?.installs ?? 0);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function baseChart(dates: string[]): EChartsOption {
  const lastIndex = Math.max(0, dates.length - 1);
  const step = dates.length > 45 ? 14 : 7;
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
      boundaryGap: false,
      data: dates.map((date) => date.slice(5).replace("-", "/")),
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
  };
}

const activeChartOption = computed<EChartsOption>(() => {
  const trend = stats.value?.trend;
  if (!trend) return {};
  return {
    ...baseChart(trend.dates),
    series: [
      { name: "活跃设备", type: "line", data: trend.active, showSymbol: false, smooth: true, lineStyle: { width: 2, color: SERIES_COLORS[0] }, itemStyle: { color: SERIES_COLORS[0] }, areaStyle: { color: "rgba(20, 143, 123, 0.12)" } },
      { name: "新增安装", type: "line", data: trend.newInstalls, showSymbol: false, smooth: true, lineStyle: { width: 1.5, type: "dashed", color: SERIES_COLORS[1] }, itemStyle: { color: SERIES_COLORS[1] } },
    ],
  };
});

const versionChartOption = computed<EChartsOption>(() => {
  const trend = stats.value?.trend;
  if (!trend) return {};
  return {
    ...baseChart(trend.dates),
    series: trend.versions.map((row, index) => ({
      name: row.version,
      type: "line",
      stack: "versions",
      data: row.counts,
      showSymbol: false,
      lineStyle: { width: 1, color: SERIES_COLORS[index % SERIES_COLORS.length] },
      itemStyle: { color: SERIES_COLORS[index % SERIES_COLORS.length] },
      areaStyle: { opacity: 0.35 },
    })),
  };
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    stats.value = await adminApi.harmonyClientStats(range.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "鸿蒙客户端统计加载失败";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.clients-pane { display: flex; flex-direction: column; gap: 18px; }
.clients-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 8px 2px 0; flex-wrap: wrap; }
.clients-head h2, .card h3 { margin: 0; color: var(--cpu-text); }
.clients-head h2 { font-size: 24px; }
.clients-head p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; max-width: 760px; }
.eyebrow { margin-bottom: 5px; color: var(--cpu-primary); font-size: 11px; font-weight: 700; letter-spacing: .16em; }
.head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.clients-content { min-height: 240px; display: flex; flex-direction: column; gap: 18px; }
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.metric { padding: 12px; border-radius: 10px; background: linear-gradient(145deg, var(--cpu-surface-subtle), rgba(20,143,123,.055)); min-width: 0; }
.metric span { display: block; color: var(--cpu-text-secondary); font-size: 12px; }
.metric strong { display: block; margin-top: 5px; font-size: 22px; color: var(--cpu-text); }
.metric small { display: block; margin-top: 4px; color: var(--cpu-text-secondary); font-size: 11px; }
.dist-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.card { padding: 17px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); min-width: 0; }
.card h3 { font-size: 15px; margin-bottom: 12px; }
.card .hint { margin: -6px 0 12px; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.55; }
.card .hint.tail { margin: 8px 0 0; }
.sub-title { margin-top: 20px; }
.model-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 28px; }
.model-grid .bar-row { grid-template-columns: minmax(0, 110px) minmax(0, 1fr) auto; }
.chart-box { height: 220px; }
.bar-row { display: grid; grid-template-columns: minmax(0, 130px) minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; }
.bar-label { min-width: 0; }
.bar-label span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cpu-text); }
.bar-label small, .muted { color: var(--cpu-text-secondary); font-size: 11px; }
.bar-track, :deep(.bar-track) { height: 8px; border-radius: 4px; background: var(--cpu-surface-subtle); overflow: hidden; }
.bar-fill, :deep(.bar-fill) { height: 100%; border-radius: 4px; background: var(--cpu-primary); }
.bar-count { color: var(--cpu-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
:deep(.flag-row) { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
:deep(.flag-head) { display: flex; justify-content: space-between; font-size: 13px; color: var(--cpu-text); }
:deep(.flag-head strong) { font-size: 16px; }
:deep(.flag-row small) { color: var(--cpu-text-secondary); font-size: 11px; }
.empty { color: var(--cpu-text-secondary); font-size: 13px; padding: 8px 0; }
.table-scroll { overflow-x: auto; }
@media (max-width: 1100px) { .feature-grid, .model-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 860px) { .dist-grid, .feature-grid, .model-grid { grid-template-columns: 1fr; } }
</style>
