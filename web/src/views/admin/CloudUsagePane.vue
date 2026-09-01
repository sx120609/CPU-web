<template>
  <div class="usage-pane">
    <header class="usage-head">
      <div>
        <div class="eyebrow">成本与配额</div>
        <h2>云资源用量</h2>
        <p>集中查看腾讯云 CDN、阿里云 ESA 的流量与请求数，以及可查询到的资源包余额。</p>
      </div>
      <div class="head-actions">
        <el-radio-group v-model="range" size="small" @change="loadUsage(false)">
          <el-radio-button value="today">今天</el-radio-button>
          <el-radio-button value="7d">近 7 天</el-radio-button>
          <el-radio-button value="30d">近 30 天</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="loadUsage(true)">
          <el-icon><Refresh /></el-icon>
          强制刷新
        </el-button>
      </div>
    </header>

    <el-alert
      v-if="error"
      type="error"
      show-icon
      :closable="false"
      :title="error"
    >
      <template #default><el-button size="small" @click="loadUsage(true)">重试</el-button></template>
    </el-alert>

    <div v-loading="loading" class="usage-content">
      <div v-if="summary" class="freshness">
        <span>{{ rangeLabel }} · {{ formatDateTime(summary.startTime) }} 至 {{ formatDateTime(summary.endTime) }}</span>
        <span>{{ summary.cached ? "缓存数据" : "实时拉取" }} · 生成于 {{ formatDateTime(summary.generatedAt) }} · 自动缓存 {{ Math.round(summary.cacheTtlSeconds / 60) }} 分钟</span>
      </div>

      <div v-if="summary" class="provider-grid">
        <section v-for="provider in providerList" :key="provider.provider" class="provider-card">
          <div class="provider-title">
            <div>
              <span class="provider-name">{{ providerName(provider.provider) }}</span>
              <span class="provider-target">{{ provider.target || "未识别域名" }}</span>
            </div>
            <el-tag :type="provider.available ? 'success' : provider.configured ? 'warning' : 'info'" effect="light" round>
              {{ provider.available ? "已接入" : provider.configured ? "部分不可用" : "未配置" }}
            </el-tag>
          </div>

          <div class="metric-grid">
            <div class="metric">
              <span>{{ provider.provider === "aliyun" ? "ESA 响应流量" : "CDN 流量" }}</span>
              <strong>{{ formatBytes(provider.trafficBytes) }}</strong>
            </div>
            <div v-if="provider.provider === 'aliyun'" class="metric">
              <span>ESA 计费总流量</span>
              <strong>{{ formatBytes(provider.trafficBytes + provider.requestTrafficBytes) }}</strong>
              <small>请求流量 + 响应流量</small>
            </div>
            <div class="metric">
              <span>请求数</span>
              <strong>{{ formatCount(provider.requests) }}</strong>
            </div>
            <div v-if="provider.provider === 'tencent'" class="metric">
              <span>流量命中率</span>
              <strong>{{ formatPercent(provider.trafficHitRate) }}</strong>
            </div>
            <div v-if="provider.provider === 'tencent'" class="metric">
              <span>请求命中率</span>
              <strong>{{ formatPercent(provider.requestHitRate) }}</strong>
            </div>
            <div v-if="provider.provider === 'aliyun'" class="metric">
              <span>请求报文流量</span>
              <strong>{{ formatBytes(provider.requestTrafficBytes) }}</strong>
            </div>
            <div v-if="provider.provider === 'aliyun' && provider.storage" class="metric">
              <span>OSS 实际存储量</span>
              <strong>{{ formatBytes(provider.storage.storageBytes) }}</strong>
              <small>{{ formatCount(provider.storage.objectCount) }} 个对象 · {{ provider.storage.bucket }}</small>
            </div>
            <div v-if="provider.provider === 'aliyun' && provider.storage" class="metric">
              <span>OSS 本月读请求</span>
              <strong>{{ formatNullableCount(provider.storage.monthlyGetRequests) }}</strong>
            </div>
            <div v-if="provider.provider === 'aliyun' && provider.storage" class="metric">
              <span>OSS 本月写请求</span>
              <strong>{{ formatNullableCount(provider.storage.monthlyPutRequests) }}</strong>
            </div>
            <div v-if="provider.provider === 'aliyun' && provider.storage" class="metric">
              <span>OSS 本月公网流出</span>
              <strong>{{ formatNullableBytes(provider.storage.monthlyInternetEgressBytes) }}</strong>
            </div>
            <div v-if="provider.provider === 'aliyun'" class="metric">
              <span>采样率</span>
              <strong>{{ formatPercent(provider.samplingRate) }}</strong>
            </div>
          </div>

          <p v-if="provider.provider === 'aliyun' && provider.storage" class="storage-freshness">
            OSS 容量统计：{{ formatDateTime(provider.storage.measuredAt) }}；月度请求/流出统计：{{ formatDateTime(provider.storage.meteringMeasuredAt) }}。云厂商统计可能延迟一小时以上。
          </p>

          <el-alert
            v-for="warning in provider.warnings"
            :key="warning"
            class="provider-warning"
            type="warning"
            :closable="false"
            show-icon
            :title="warning"
          />
        </section>
      </div>

      <section v-if="summary" class="chart-section">
        <div class="section-head">
          <div><h3>用量趋势</h3><p>两家云平台使用各自的官方统计口径；切换时间范围会自动调整采样粒度。</p></div>
        </div>
        <div v-if="hasChartData" class="chart-grid">
          <div class="chart-card"><h4>流量</h4><CloudUsageChart :option="trafficChartOption" /></div>
          <div class="chart-card"><h4>请求数</h4><CloudUsageChart :option="requestChartOption" /></div>
        </div>
        <el-empty v-else description="当前范围没有可绘制的趋势数据" :image-size="76" />
      </section>

      <section v-if="summary" class="package-section">
        <div class="section-head">
          <div><h3>资源包余额</h3><p>费用中心返回资源包余额；OSS 实际存储量已在上方单独显示，避免把延迟结算的资源包扣减量当成实时存储量。</p></div>
          <el-tag effect="plain">{{ packageRows.length }} 个资源包</el-tag>
        </div>
        <el-table v-if="packageRows.length" :data="packageRows" stripe class="package-table">
          <el-table-column label="平台" width="90"><template #default="{ row }"><el-tag size="small" :type="row.provider === '腾讯云' ? 'primary' : 'warning'">{{ row.provider }}</el-tag></template></el-table-column>
          <el-table-column prop="name" label="资源包" min-width="180" show-overflow-tooltip />
          <el-table-column label="类型" width="90"><template #default="{ row }">{{ packageKind(row.kind) }}</template></el-table-column>
          <el-table-column label="已用 / 总量" min-width="220">
            <template #default="{ row }">
              <div class="package-amount"><span>{{ formatPackageAmount(row.used, row.unit) }} / {{ formatPackageAmount(row.total, row.unit) }}</span><el-progress v-if="packagePercent(row) !== null" :percentage="packagePercent(row)!" :stroke-width="6" :show-text="false" /></div>
            </template>
          </el-table-column>
          <el-table-column label="剩余" min-width="130"><template #default="{ row }"><strong>{{ formatPackageAmount(row.remaining, row.unit) }}</strong></template></el-table-column>
          <el-table-column label="到期时间" min-width="150"><template #default="{ row }">{{ formatDate(row.expiresAt) }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }">{{ statusLabel(row.status) }}</template></el-table-column>
        </el-table>
        <el-empty v-else description="暂无可查询的资源包" :image-size="76" />
      </section>

      <section v-if="summary && aliyunPlans.length" class="plan-section">
        <div class="section-head"><div><h3>阿里云 ESA 套餐</h3><p>套餐 API 提供包含量和有效期，但不等同于实时剩余额度。</p></div></div>
        <div class="plan-grid">
          <article v-for="plan in aliyunPlans" :key="plan.id" class="plan-card">
            <div class="plan-title"><strong>{{ plan.name }}</strong><el-tag size="small" effect="plain">{{ statusLabel(plan.status) }}</el-tag></div>
            <dl>
              <div><dt>包含流量</dt><dd>{{ plan.includedTrafficGb === null ? "—" : `${formatNumber(plan.includedTrafficGb)} GB` }}</dd></div>
              <div><dt>本月已用流量</dt><dd>{{ formatPlanTraffic(plan.usedTrafficGb) }}</dd></div>
              <div><dt>本月剩余流量</dt><dd>{{ formatPlanTraffic(plan.remainingTrafficGb) }}</dd></div>
              <div><dt>静态请求</dt><dd>{{ plan.includedRequests === null ? "—" : formatCount(plan.includedRequests) }}</dd></div>
              <div><dt>计费模式</dt><dd>{{ plan.billingMode || "—" }}</dd></div>
              <div><dt>有效期至</dt><dd>{{ formatDate(plan.expiresAt) }}</dd></div>
            </dl>
            <div v-if="planTrafficPercent(plan) !== null" class="plan-traffic-progress">
              <div><span>自然月套餐消耗</span><strong>{{ formatNumber(planTrafficPercent(plan)!, 2) }}%</strong></div>
              <el-progress :percentage="planTrafficPercent(plan)!" :stroke-width="8" :show-text="false" />
              <p>{{ formatDate(plan.trafficUsageStartAt) }} 起，按 ESA 请求流量与响应流量之和计算。</p>
            </div>
            <p v-if="plan.sites.length" class="plan-sites">站点：{{ plan.sites.join("、") }}</p>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import type { EChartsOption } from "echarts";
import { ElMessage } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import {
  adminApi,
  type CloudProviderUsage,
  type CloudRatePlan,
  type CloudResourcePackage,
  type CloudUsageRange,
  type CloudUsageSummary,
} from "@/api/admin";

const CloudUsageChart = defineAsyncComponent(() => import("./CloudUsageChart.vue"));
const range = ref<CloudUsageRange>("today");
const summary = ref<CloudUsageSummary | null>(null);
const loading = ref(false);
const error = ref("");

const providerList = computed(() => summary.value ? [summary.value.providers.tencent, summary.value.providers.aliyun] : []);
const packageRows = computed<Array<CloudResourcePackage & { provider: string }>>(() => summary.value ? [
  ...summary.value.providers.tencent.packages.map((item) => ({ ...item, provider: "腾讯云" })),
  ...summary.value.providers.aliyun.packages.map((item) => ({ ...item, provider: "阿里云" })),
] : []);
const aliyunPlans = computed<CloudRatePlan[]>(() => summary.value?.providers.aliyun.plans || []);
const hasChartData = computed(() => providerList.value.some((provider) => provider.points.length));
const rangeLabel = computed(() => ({ today: "今天", "7d": "近 7 天", "30d": "近 30 天" }[range.value]));
const trafficChartOption = computed<EChartsOption>(() => buildChartOption("traffic"));
const requestChartOption = computed<EChartsOption>(() => buildChartOption("requests"));

onMounted(() => loadUsage(false));

async function loadUsage(force: boolean) {
  loading.value = true;
  error.value = "";
  try {
    summary.value = await adminApi.cloudUsage(range.value, force, { suppressErrorMessage: true });
    if (force) ElMessage.success("云平台用量已重新拉取");
  } catch (cause) {
    error.value = requestMessage(cause) || "云资源用量读取失败";
  } finally {
    loading.value = false;
  }
}

function buildChartOption(kind: "traffic" | "requests"): EChartsOption {
  const colors = { tencent: "#2563eb", aliyun: "#f97316" };
  return {
    animation: false,
    color: [colors.tencent, colors.aliyun],
    grid: { left: 14, right: 18, top: 42, bottom: 20, containLabel: true },
    legend: { top: 4, textStyle: { color: "#64748b", fontSize: 12 } },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(15, 23, 42, 0.94)",
      borderWidth: 0,
      textStyle: { color: "#f8fafc" },
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        const title = rows[0]?.axisValue ? formatDateTime(String(rows[0].axisValue)) : "";
        return [title, ...rows.map((item: any) => `${item.marker}${item.seriesName}：${kind === "traffic" ? formatBytes(Number(item.value?.[1] ?? item.value)) : formatCount(Number(item.value?.[1] ?? item.value))}`)].join("<br/>");
      },
    },
    xAxis: { type: "time", axisLabel: { color: "#94a3b8", hideOverlap: true }, axisLine: { lineStyle: { color: "#dbe4f0" } }, axisTick: { show: false } },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { color: "#94a3b8", formatter: (value: number) => kind === "traffic" ? formatBytes(value) : compactCount(value) },
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.18)", type: "dashed" } },
    },
    series: providerList.value.filter((provider) => provider.points.length).map((provider) => ({
      name: providerName(provider.provider),
      type: "line",
      smooth: true,
      showSymbol: false,
      symbol: "circle",
      lineStyle: { width: 2.5 },
      areaStyle: { opacity: 0.06 },
      data: provider.points.map((point) => [point.timestamp, kind === "traffic" ? point.trafficBytes : point.requests]),
    })),
  };
}

function providerName(provider: CloudProviderUsage["provider"]) {
  return provider === "tencent" ? "腾讯云 CDN" : "阿里云 ESA";
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${formatNumber(bytes / (1024 ** index), index > 1 ? 2 : 1)} ${units[index]}`;
}

function formatCount(value: number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(amount) : "—";
}

function formatNullableCount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : formatCount(value);
}

function formatNullableBytes(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : formatBytes(value);
}

function compactCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${formatNumber(value)}%`;
}

function formatPackageAmount(value: number | null, unit: string) {
  if (value === null) return "—";
  if (unit.trim().toUpperCase() === "B") return formatBytes(value);
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function formatPlanTraffic(value: number | null) {
  if (value === null) return "—";
  return `${formatNumber(value, value > 0 && value < 0.01 ? 4 : 2)} GB`;
}

function planTrafficPercent(plan: CloudRatePlan) {
  if (plan.includedTrafficGb === null || plan.usedTrafficGb === null || plan.includedTrafficGb <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((plan.usedTrafficGb / plan.includedTrafficGb) * 10_000) / 100));
}

function packagePercent(row: CloudResourcePackage) {
  if (row.total === null || row.used === null || row.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((row.used / row.total) * 1000) / 10));
}

function packageKind(kind: CloudResourcePackage["kind"]) {
  return { traffic: "流量", requests: "请求", storage: "存储", other: "其他" }[kind];
}

function statusLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return ({ enabled: "可用", available: "可用", active: "生效中", normal: "正常", expired: "已到期", closed: "已关闭" } as Record<string, string>)[normalized] || value || "未知";
}

function formatDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}

function requestMessage(cause: unknown) {
  if (!cause || typeof cause !== "object") return "";
  const message = (cause as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  return typeof message === "string" ? message : cause instanceof Error ? cause.message : "";
}
</script>

<style scoped>
.usage-pane { display: flex; flex-direction: column; gap: 18px; }
.usage-head, .section-head, .provider-title, .plan-title, .freshness { display: flex; justify-content: space-between; gap: 16px; }
.usage-head { align-items: flex-start; padding: 8px 2px 0; }
.usage-head h2, .section-head h3, .chart-card h4 { margin: 0; color: var(--cpu-text); }
.usage-head h2 { font-size: 24px; }
.usage-head p, .section-head p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; }
.eyebrow { margin-bottom: 5px; color: var(--cpu-primary); font-size: 11px; font-weight: 700; letter-spacing: .16em; }
.head-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.usage-content { min-height: 240px; display: flex; flex-direction: column; gap: 18px; }
.freshness { padding: 10px 13px; border-radius: 9px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 12px; flex-wrap: wrap; }
.provider-grid, .chart-grid, .plan-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.provider-card, .chart-section, .package-section, .plan-section { border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
.provider-card { padding: 17px; min-width: 0; }
.provider-title { align-items: center; }
.provider-name { display: block; font-size: 17px; font-weight: 700; }
.provider-target { display: block; margin-top: 3px; color: var(--cpu-text-secondary); font-size: 12px; }
.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 15px; }
.metric { padding: 12px; border-radius: 10px; background: linear-gradient(145deg, var(--cpu-surface-subtle), rgba(20,143,123,.055)); min-width: 0; }
.metric span { display: block; color: var(--cpu-text-secondary); font-size: 12px; }
.metric strong { display: block; margin-top: 5px; font-size: 20px; color: var(--cpu-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.metric small { display: block; margin-top: 4px; color: var(--cpu-text-secondary); font-size: 11px; overflow-wrap: anywhere; }
.storage-freshness { margin: 11px 0 0; color: var(--cpu-text-secondary); font-size: 11px; line-height: 1.55; }
.provider-warning { margin-top: 10px; }
.provider-warning :deep(.el-alert__title) { overflow-wrap: anywhere; line-height: 1.55; }
.chart-section, .package-section, .plan-section { padding: 17px; }
.section-head { align-items: flex-start; margin-bottom: 14px; }
.chart-card { min-width: 0; height: 310px; padding: 13px 13px 4px; border: 1px solid var(--cpu-border-soft); border-radius: 10px; background: var(--cpu-surface-subtle); }
.chart-card h4 { font-size: 14px; }
.chart-card > :last-child { height: 270px; }
.package-table { width: 100%; }
.package-amount { display: flex; flex-direction: column; gap: 6px; }
.package-amount :deep(.el-progress) { max-width: 170px; }
.package-section strong { color: var(--cpu-primary); }
.plan-card { padding: 15px; border: 1px solid var(--cpu-border-soft); border-radius: 10px; background: var(--cpu-surface-subtle); }
.plan-title { align-items: center; }
.plan-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; margin: 14px 0 0; }
.plan-card dl div { min-width: 0; }
.plan-card dt { color: var(--cpu-text-secondary); font-size: 12px; }
.plan-card dd { margin: 3px 0 0; font-weight: 600; overflow-wrap: anywhere; }
.plan-traffic-progress { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--cpu-border-soft); }
.plan-traffic-progress > div { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 7px; color: var(--cpu-text-secondary); font-size: 12px; }
.plan-traffic-progress > div strong { color: var(--cpu-primary); }
.plan-traffic-progress p { margin: 7px 0 0; color: var(--cpu-text-secondary); font-size: 11px; line-height: 1.5; }
.plan-sites { margin: 12px 0 0; color: var(--cpu-text-secondary); font-size: 12px; overflow-wrap: anywhere; }

@media (max-width: 860px) {
  .usage-head { flex-direction: column; }
  .head-actions { width: 100%; justify-content: space-between; }
  .provider-grid, .chart-grid { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .usage-pane { gap: 14px; }
  .usage-head h2 { font-size: 21px; }
  .head-actions { align-items: stretch; flex-direction: column; }
  .head-actions :deep(.el-radio-group) { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .head-actions :deep(.el-radio-button__inner) { width: 100%; }
  .provider-card, .chart-section, .package-section, .plan-section { padding: 13px; }
  .metric strong { font-size: 17px; }
  .plan-grid { grid-template-columns: 1fr; }
  .plan-card dl { grid-template-columns: 1fr; }
}
</style>
