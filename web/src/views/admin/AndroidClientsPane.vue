<template>
  <div class="clients-pane">
    <header class="clients-head">
      <div>
        <div class="eyebrow">原生客户端</div>
        <h2>安卓客户端统计</h2>
        <p>原生安卓 App 在启动、回到前台和登录时上报设备、版本与功能状态；崩溃是 App 捕获的未处理异常，ANR 与进程退出原因来自系统记录（Android 11 及以上），启动和退出统计按天汇总、通常在次日送达。按安装去重，不含 Android ID、IMEI 或广告标识；日活、性能与崩溃明细保留 180 天。不带上报功能的旧版本不计入此页。</p>
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
            <h3>设备品牌</h3>
            <div v-if="!stats.byBrand.length" class="empty">暂无数据</div>
            <div v-for="row in stats.byBrand" :key="row.brand" class="bar-row">
              <div class="bar-label"><span>{{ row.name }}</span></div>
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
            <h3 class="sub-title">系统版本</h3>
            <div v-if="!stats.bySystemVersion.length" class="empty">暂无数据</div>
            <div v-for="row in stats.bySystemVersion" :key="row.version" class="bar-row">
              <div class="bar-label"><span>Android {{ row.version }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
            <h3 class="sub-title">WebView 内核</h3>
            <p class="hint">网页部分由系统 WebView 渲染，内核主版本决定可用的网页特性。</p>
            <div v-if="!stats.byWebView.length" class="empty">暂无数据</div>
            <div v-for="row in stats.byWebView" :key="row.version" class="bar-row">
              <div class="bar-label"><span>{{ row.version === "unknown" ? "未上报" : `Chromium ${row.version}` }}</span></div>
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
            <h3>桌面小组件</h3>
            <div class="feature-big">
              <strong>{{ ratio(features.widgets.installsWithWidget, features.widgets.reported) }}</strong>
              <span>已添加小组件（{{ features.widgets.installsWithWidget }} / {{ features.widgets.reported }} 台）</span>
            </div>
            <div v-if="!features.widgets.byKind.length" class="empty">暂无设备添加小组件</div>
            <div v-for="row in features.widgets.byKind" :key="row.kind" class="bar-row">
              <div class="bar-label"><span>{{ row.name }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: ratio(row.installs, features.widgets.reported) }" /></div>
              <span class="bar-count">{{ row.installs }} 台 · {{ row.count }} 个</span>
            </div>
          </section>
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
            <h3>外观模式</h3>
            <div v-for="row in features.appearanceMode" :key="row.mode" class="bar-row">
              <div class="bar-label"><span>{{ appearanceLabel(row.mode) }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: percent(row.count) }" /></div>
              <span class="bar-count">{{ row.count }} · {{ percent(row.count) }}</span>
            </div>
            <h3 class="sub-title">应用内更新</h3>
            <FlagBar label="已允许安装应用" :value="features.installPermission" />
            <p class="hint">未允许的设备在应用内更新时会先跳到系统授权页。</p>
          </section>
        </div>

        <section class="card">
          <h3>稳定性与性能（按版本）</h3>
          <p class="hint">冷启动耗时从进程创建算到首帧绘制，只统计由用户打开界面触发的启动。崩溃、ANR 和前台被杀取自系统的进程退出记录，仅 Android 11 及以上提供，崩溃率是每百次冷启动的崩溃退出数。</p>
          <div class="table-scroll">
            <el-table :data="stats.stability.byVersion" size="small" empty-text="暂无启动或退出数据">
              <el-table-column prop="version" label="版本" min-width="110" />
              <el-table-column label="冷启动次数" width="100" align="right"><template #default="{ row }">{{ row.launches }}</template></el-table-column>
              <el-table-column label="冷启动耗时" width="100" align="right"><template #default="{ row }">{{ ms(row.launchMsAvg) }}</template></el-table-column>
              <el-table-column label="崩溃退出" width="120" align="right">
                <template #default="{ row }">
                  <span :class="{ danger: row.crashExits }">{{ row.crashExits }}</span><span v-if="row.crashRate != null" class="muted"> ({{ row.crashRate }}%)</span>
                </template>
              </el-table-column>
              <el-table-column label="原生崩溃" width="90" align="right"><template #default="{ row }">{{ row.nativeCrashExits }}</template></el-table-column>
              <el-table-column label="ANR" width="70" align="right"><template #default="{ row }">{{ row.anrExits }}</template></el-table-column>
              <el-table-column label="前台被杀" width="90" align="right"><template #default="{ row }">{{ row.foregroundKills }}</template></el-table-column>
              <el-table-column label="网页进程崩溃 / 被回收" width="170" align="right">
                <template #default="{ row }">{{ row.rendererCrashes }}<span class="muted"> / {{ row.rendererKills }}</span></template>
              </el-table-column>
              <el-table-column label="崩溃报告" width="120" align="right">
                <template #default="{ row }">
                  <span :class="{ danger: row.crashReports }">{{ row.crashReports }}</span><span class="muted"> / {{ row.crashInstalls }} 台</span>
                </template>
              </el-table-column>
              <el-table-column label="ANR 报告" width="90" align="right"><template #default="{ row }">{{ row.anrReports }}</template></el-table-column>
            </el-table>
          </div>
        </section>

        <section class="card">
          <h3>崩溃与 ANR 分组</h3>
          <p class="hint">按异常类型和 App 自身的调用帧分组，行号变化不影响归组。安装包未混淆，调用栈可直接对照源码。</p>
          <div class="table-scroll">
            <el-table :data="stats.stability.groups" size="small" empty-text="暂无崩溃或 ANR 报告">
              <el-table-column label="类型" width="70">
                <template #default="{ row }"><el-tag size="small" :type="row.kind === 'crash' ? 'danger' : 'warning'">{{ row.kind === "crash" ? "崩溃" : "ANR" }}</el-tag></template>
              </el-table-column>
              <el-table-column label="摘要" min-width="260">
                <template #default="{ row }">
                  <div class="summary">{{ row.summary }}</div>
                  <div class="frames">{{ frameLine(row.topFrames) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="次数" width="70" align="right"><template #default="{ row }">{{ row.count }}</template></el-table-column>
              <el-table-column label="设备" width="70" align="right"><template #default="{ row }">{{ row.installs }}</template></el-table-column>
              <el-table-column label="版本" width="160"><template #default="{ row }">{{ row.versions.join("、") }}</template></el-table-column>
              <el-table-column label="最近" width="120"><template #default="{ row }">{{ row.lastSeenAt ? formatDateTime(row.lastSeenAt) : "-" }}</template></el-table-column>
              <el-table-column label="" width="80">
                <template #default="{ row }"><el-button v-if="row.sampleId" link type="primary" @click="openDiagnostic(row.sampleId)">调用栈</el-button></template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <section class="card">
          <h3>最近活跃设备</h3>
          <div class="table-scroll">
            <el-table :data="stats.recent" size="small" empty-text="暂无数据">
              <el-table-column label="设备" min-width="170">
                <template #default="{ row }">{{ row.brandName }}<span class="muted"> {{ row.deviceModel }}</span></template>
              </el-table-column>
              <el-table-column label="系统" width="100"><template #default="{ row }">Android {{ row.systemVersion }}</template></el-table-column>
              <el-table-column label="客户端" width="120"><template #default="{ row }">{{ row.appVersion }} ({{ row.appBuild }})</template></el-table-column>
              <el-table-column label="WebView" width="130"><template #default="{ row }">{{ row.webViewVersion || "-" }}</template></el-table-column>
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

    <el-dialog v-model="diagnosticOpen" title="诊断详情" width="min(860px, 94vw)" append-to-body>
      <div v-loading="diagnosticLoading" class="diagnostic">
        <template v-if="diagnostic">
          <p><strong>{{ diagnostic.summary }}</strong></p>
          <p class="muted">
            {{ diagnostic.brandName }} {{ diagnostic.deviceModel }} · Android {{ diagnostic.systemVersion }} · {{ diagnostic.appVersion }} ({{ diagnostic.appBuild }}) · {{ formatDateTime(diagnostic.occurredAt) }}
          </p>
          <h4>{{ diagnostic.kind === "anr" ? "主线程调用栈" : "调用栈" }}</h4>
          <pre class="stack">{{ diagnostic.stackTrace }}</pre>
          <div class="dialog-actions"><el-button size="small" @click="copyStack">复制调用栈</el-button></div>
        </template>
        <el-alert v-else-if="diagnosticError" type="error" :closable="false" :title="diagnosticError" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, onMounted, ref, type PropType } from "vue";
import type { EChartsOption } from "echarts";
import { ElMessage } from "element-plus";
import {
  adminApi,
  type AndroidClientDiagnosticDetail,
  type AndroidClientStats,
  type IosClientFlagCounts,
  type IosClientStatsRange,
} from "@/api/admin";

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
const stats = ref<AndroidClientStats | null>(null);
const loading = ref(false);
const error = ref("");
const diagnosticOpen = ref(false);
const diagnosticLoading = ref(false);
const diagnostic = ref<AndroidClientDiagnosticDetail | null>(null);
const diagnosticError = ref("");

const RANGE_LABELS: Record<IosClientStatsRange, string> = { "1d": "24 小时", "7d": "近 7 天", "30d": "近 30 天", "90d": "近 90 天", all: "累计" };
const rangeLabel = computed(() => RANGE_LABELS[range.value]);
const features = computed(() => stats.value!.features);

const APPEARANCE_LABELS: Record<string, string> = { system: "跟随系统", light: "浅色", dark: "深色", unknown: "未上报" };
const appearanceLabel = (mode: string) => APPEARANCE_LABELS[mode] ?? mode;

const SERIES_COLORS = ["#148f7b", "#3b82f6", "#f59e0b", "#a855f7", "#94a3b8"];

function ratio(part: number, total: number) {
  return total ? `${Math.round((part / total) * 1000) / 10}%` : "0%";
}

function percent(count: number) {
  return ratio(count, stats.value?.installs ?? 0);
}

function ms(value: number | null) {
  if (value == null) return "-";
  return value >= 1000 ? `${Math.round(value / 100) / 10} s` : `${value} ms`;
}

/** `package.Class.method(File.kt:12)` without the package, which every app frame shares. */
function frameLine(frames: string[]) {
  return frames.slice(0, 3).map((frame) => frame.replace(/^cn\.lizmt\.cpuweb\.schedule\./, "")).join("  ←  ");
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
    stats.value = await adminApi.androidClientStats(range.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "安卓客户端统计加载失败";
  } finally {
    loading.value = false;
  }
}

async function openDiagnostic(id: string) {
  diagnosticOpen.value = true;
  diagnosticLoading.value = true;
  diagnostic.value = null;
  diagnosticError.value = "";
  try {
    diagnostic.value = await adminApi.androidClientDiagnostic(id);
  } catch (e) {
    diagnosticError.value = e instanceof Error ? e.message : "诊断详情加载失败";
  } finally {
    diagnosticLoading.value = false;
  }
}

async function copyStack() {
  if (!diagnostic.value) return;
  try {
    await navigator.clipboard.writeText(diagnostic.value.stackTrace);
    ElMessage.success("已复制调用栈");
  } catch {
    ElMessage.error("复制失败，请检查浏览器权限");
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
.card :deep(.flag-row) + .hint { margin-top: -4px; margin-bottom: 0; }
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
.feature-big { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.feature-big strong { font-size: 26px; color: var(--cpu-text); }
.feature-big span { color: var(--cpu-text-secondary); font-size: 12px; }
:deep(.flag-row) { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
:deep(.flag-head) { display: flex; justify-content: space-between; font-size: 13px; color: var(--cpu-text); }
:deep(.flag-head strong) { font-size: 16px; }
:deep(.flag-row small) { color: var(--cpu-text-secondary); font-size: 11px; }
.sub-title + :deep(.flag-row) { padding-top: 0; }
.summary { color: var(--cpu-text); white-space: pre-line; overflow-wrap: anywhere; }
.frames { margin-top: 3px; color: var(--cpu-text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }
.danger { color: var(--el-color-danger); font-weight: 600; }
.empty { color: var(--cpu-text-secondary); font-size: 13px; padding: 8px 0; }
.table-scroll { overflow-x: auto; }
.diagnostic { min-height: 120px; }
.diagnostic p { margin: 0 0 6px; overflow-wrap: anywhere; white-space: pre-line; }
.diagnostic h4 { margin: 14px 0 6px; font-size: 13px; }
.stack { margin: 0; padding: 10px 12px; max-height: 420px; overflow: auto; border-radius: 8px; background: var(--cpu-surface-subtle); color: var(--cpu-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
.dialog-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
@media (max-width: 1100px) { .feature-grid, .model-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 860px) { .dist-grid, .feature-grid, .model-grid { grid-template-columns: 1fr; } }
</style>
