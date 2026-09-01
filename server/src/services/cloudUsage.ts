import { cdn } from "tencentcloud-sdk-nodejs-cdn";
import EsaClient, {
  DescribeSiteTimeSeriesDataRequest,
  DescribeSiteTimeSeriesDataRequestFields,
  ListSitesRequest,
  ListUserRatePlanInstancesRequest,
} from "@alicloud/esa20240910";
import BssClient, { QueryResourcePackageInstancesRequest } from "@alicloud/bssopenapi20171214";
import CmsClient, { DescribeMetricListRequest } from "@alicloud/cms20190101";
import { getMediaStorageRuntimeConfig, loadStorageConfig } from "./storageConfig";
import { getAliyunOssBucketStats } from "./aliyunOss";

export type CloudUsageRange = "today" | "7d" | "30d";

export type CloudUsagePoint = {
  timestamp: string;
  trafficBytes: number;
  requests: number;
};

export type CloudResourcePackage = {
  id: string;
  name: string;
  kind: "traffic" | "requests" | "storage" | "other";
  status: string;
  total: number | null;
  used: number | null;
  remaining: number | null;
  unit: string;
  effectiveAt: string;
  expiresAt: string;
};

export type CloudRatePlan = {
  id: string;
  name: string;
  status: string;
  billingMode: string;
  coverage: string;
  expiresAt: string;
  sites: string[];
  includedTrafficGb: number | null;
  usedTrafficGb: number | null;
  remainingTrafficGb: number | null;
  trafficUsageStartAt: string;
  trafficUsageEndAt: string;
  includedRequests: number | null;
};

export type CloudStorageUsage = {
  bucket: string;
  storageBytes: number;
  objectCount: number;
  standardStorageBytes: number;
  standardObjectCount: number;
  monthlyGetRequests: number | null;
  monthlyPutRequests: number | null;
  monthlyInternetEgressBytes: number | null;
  meteringMeasuredAt: string;
  measuredAt: string;
};

export type CloudProviderUsage = {
  provider: "tencent" | "aliyun";
  configured: boolean;
  available: boolean;
  target: string;
  trafficBytes: number;
  requestTrafficBytes: number;
  requests: number;
  trafficHitRate: number | null;
  requestHitRate: number | null;
  samplingRate: number | null;
  points: CloudUsagePoint[];
  packages: CloudResourcePackage[];
  plans: CloudRatePlan[];
  storage: CloudStorageUsage | null;
  warnings: string[];
};

export type CloudUsageSummary = {
  range: CloudUsageRange;
  startTime: string;
  endTime: string;
  generatedAt: string;
  expiresAt: string;
  cacheTtlSeconds: number;
  cached: boolean;
  providers: {
    tencent: CloudProviderUsage;
    aliyun: CloudProviderUsage;
  };
};

type UsageWindow = {
  start: Date;
  end: Date;
  tencentInterval: "5min" | "hour" | "day";
  aliyunInterval: "300" | "3600" | "86400";
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<CloudUsageRange, { expiresAt: number; value: CloudUsageSummary }>();
const inflight = new Map<CloudUsageRange, Promise<CloudUsageSummary>>();

export function resolveCloudUsageWindow(range: CloudUsageRange, now = new Date()): UsageWindow {
  const end = new Date(now);
  if (range === "today") {
    const local = new Date(end.getTime() + 8 * 60 * 60 * 1000);
    local.setUTCHours(0, 0, 0, 0);
    return {
      start: new Date(local.getTime() - 8 * 60 * 60 * 1000),
      end,
      tencentInterval: "5min",
      aliyunInterval: "300",
    };
  }
  const days = range === "7d" ? 7 : 30;
  return {
    start: new Date(end.getTime() - days * 24 * 60 * 60 * 1000),
    end,
    tencentInterval: range === "7d" ? "hour" : "day",
    aliyunInterval: range === "7d" ? "3600" : "86400",
  };
}

export function resolveAliyunBillingMonthWindow(now = new Date()) {
  const end = new Date(now);
  const local = new Date(end.getTime() + 8 * 60 * 60 * 1000);
  local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return {
    start: new Date(local.getTime() - 8 * 60 * 60 * 1000),
    end,
  };
}

export function calculateAliyunPlanTraffic(includedTrafficGb: unknown, usedTrafficBytes: unknown) {
  const included = nullableNumber(includedTrafficGb);
  const usedBytes = nullableNumber(usedTrafficBytes);
  const used = usedBytes === null ? null : Math.max(0, usedBytes) / 1_000_000_000;
  return {
    includedTrafficGb: included,
    usedTrafficGb: used,
    remainingTrafficGb: included === null || used === null ? null : Math.max(0, included - used),
  };
}

export function summarizeAliyunCmsDatapoints(raw: unknown) {
  let datapoints: unknown[] = [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) datapoints = parsed;
  } catch {
    return { total: 0, measuredAt: "" };
  }
  let total = 0;
  let latestTimestamp = 0;
  for (const datapoint of datapoints) {
    if (!datapoint || typeof datapoint !== "object") continue;
    const row = datapoint as Record<string, unknown>;
    const value = [row.Value, row.value, row.Sum, row.sum, row.Average, row.average]
      .map(nullableNumber)
      .find((candidate) => candidate !== null);
    if (value !== undefined) total += value;
    const timestamp = finiteNumber(row.timestamp ?? row.Timestamp);
    if (timestamp > latestTimestamp) latestTimestamp = timestamp;
  }
  return {
    total,
    measuredAt: latestTimestamp > 0 ? new Date(latestTimestamp).toISOString() : "",
  };
}

export function mergeUsageSeries(
  traffic: Array<{ timestamp: string; value: unknown }>,
  requests: Array<{ timestamp: string; value: unknown }>,
): CloudUsagePoint[] {
  const merged = new Map<string, CloudUsagePoint>();
  for (const point of traffic) {
    const timestamp = normalizeTimestamp(point.timestamp);
    if (!timestamp) continue;
    merged.set(timestamp, { timestamp, trafficBytes: finiteNumber(point.value), requests: 0 });
  }
  for (const point of requests) {
    const timestamp = normalizeTimestamp(point.timestamp);
    if (!timestamp) continue;
    const current = merged.get(timestamp) || { timestamp, trafficBytes: 0, requests: 0 };
    current.requests = finiteNumber(point.value);
    merged.set(timestamp, current);
  }
  return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function normalizeCloudResourcePackage(input: {
  id?: unknown;
  name?: unknown;
  kind?: CloudResourcePackage["kind"];
  status?: unknown;
  total?: unknown;
  used?: unknown;
  remaining?: unknown;
  unit?: unknown;
  effectiveAt?: unknown;
  expiresAt?: unknown;
}): CloudResourcePackage {
  const total = nullableNumber(input.total);
  const remaining = nullableNumber(input.remaining);
  const explicitUsed = nullableNumber(input.used);
  return {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "资源包").trim() || "资源包",
    kind: input.kind || "other",
    status: String(input.status ?? "unknown").trim() || "unknown",
    total,
    used: explicitUsed ?? (total !== null && remaining !== null ? Math.max(0, total - remaining) : null),
    remaining,
    unit: String(input.unit ?? "").trim(),
    effectiveAt: normalizeTimestamp(input.effectiveAt),
    expiresAt: normalizeTimestamp(input.expiresAt),
  };
}

export async function getCloudUsageSummary(range: CloudUsageRange, forceRefresh = false): Promise<CloudUsageSummary> {
  const now = Date.now();
  const cached = cache.get(range);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return { ...cached.value, cached: true };
  }
  const pending = inflight.get(range);
  if (pending) return pending;

  const task = collectCloudUsage(range)
    .then((value) => {
      cache.set(range, { expiresAt: Date.parse(value.expiresAt), value });
      return value;
    })
    .finally(() => inflight.delete(range));
  inflight.set(range, task);
  return task;
}

export function resetCloudUsageCache() {
  cache.clear();
  inflight.clear();
}

async function collectCloudUsage(range: CloudUsageRange): Promise<CloudUsageSummary> {
  await loadStorageConfig();
  const runtime = await getMediaStorageRuntimeConfig();
  const window = resolveCloudUsageWindow(range);
  const generatedAt = new Date().toISOString();
  const [tencent, aliyun] = await Promise.all([
    collectTencentUsage(runtime, window),
    collectAliyunUsage(runtime, window),
  ]);
  return {
    range,
    startTime: window.start.toISOString(),
    endTime: window.end.toISOString(),
    generatedAt,
    expiresAt: new Date(Date.parse(generatedAt) + CACHE_TTL_MS).toISOString(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
    cached: false,
    providers: { tencent, aliyun },
  };
}

async function collectTencentUsage(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfig>>, window: UsageWindow): Promise<CloudProviderUsage> {
  const secretId = runtime.tencentCosSecretId.trim() || runtime.legacyTencentCosSecretId.trim();
  const secretKey = runtime.tencentCosSecretKey.trim() || runtime.legacyTencentCosSecretKey.trim();
  const target = hostnameFromUrl(runtime.tencentCosPublicBaseUrl || runtime.legacyTencentCosPublicBaseUrl);
  const result = emptyProvider("tencent", Boolean(secretId && secretKey), target);
  if (!result.configured) {
    result.warnings.push("腾讯云 API 密钥尚未配置");
    return result;
  }

  const client = new cdn.v20180606.Client({
    credential: { secretId, secretKey },
    region: "",
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      httpProfile: { endpoint: "cdn.tencentcloudapi.com", reqMethod: "POST", reqTimeout: 30 },
    },
  });
  const common = {
    StartTime: formatTencentTime(window.start),
    EndTime: formatTencentTime(window.end),
    Domains: target ? [target] : undefined,
    Interval: window.tencentInterval,
    Detail: false,
    Area: "mainland",
  };
  const [flux, requests, trafficHitRate, requestHitRate, trafficPackages, httpsPackages] = await Promise.allSettled([
    client.DescribeCdnData({ ...common, Metric: "flux" }),
    client.DescribeCdnData({ ...common, Metric: "request" }),
    client.DescribeCdnData({ ...common, Metric: "fluxHitRate" }),
    client.DescribeCdnData({ ...common, Metric: "requestHitRate" }),
    client.DescribeTrafficPackages({ Offset: 0, Limit: 1000, SortBy: "status" }),
    client.DescribeHttpsPackages({ Offset: 0, Limit: 1000 }),
  ]);

  if (flux.status === "fulfilled") {
    result.trafficBytes = tencentMetricSummary(flux.value, "flux");
    result.points = mergeUsageSeries(tencentMetricPoints(flux.value, "flux"), []);
    result.available = true;
  } else result.warnings.push(providerError("腾讯 CDN 流量", flux.reason));
  if (requests.status === "fulfilled") {
    result.requests = tencentMetricSummary(requests.value, "request");
    result.points = mergeUsageSeries(
      result.points.map((point) => ({ timestamp: point.timestamp, value: point.trafficBytes })),
      tencentMetricPoints(requests.value, "request"),
    );
    result.available = true;
  } else result.warnings.push(providerError("腾讯 CDN 请求数", requests.reason));
  if (trafficHitRate.status === "fulfilled") {
    result.trafficHitRate = tencentMetricSummary(trafficHitRate.value, "fluxHitRate");
    result.available = true;
  } else result.warnings.push(providerError("腾讯 CDN 流量命中率", trafficHitRate.reason));
  if (requestHitRate.status === "fulfilled") {
    result.requestHitRate = tencentMetricSummary(requestHitRate.value, "requestHitRate");
    result.available = true;
  } else result.warnings.push(providerError("腾讯 CDN 请求命中率", requestHitRate.reason));
  if (trafficPackages.status === "fulfilled") {
    for (const item of trafficPackages.value.TrafficPackages || []) {
      result.packages.push(normalizeCloudResourcePackage({
        id: item.Id,
        name: item.Type || "CDN 流量包",
        kind: "traffic",
        status: item.Status,
        total: item.Bytes,
        used: item.BytesUsed,
        remaining: Math.max(0, finiteNumber(item.Bytes) - finiteNumber(item.BytesUsed)),
        unit: "B",
        effectiveAt: item.EnableTime,
        expiresAt: item.ExpireTime,
      }));
    }
    result.available = true;
  } else result.warnings.push(providerError("腾讯 CDN 流量包", trafficPackages.reason));
  if (httpsPackages.status === "fulfilled") {
    for (const item of httpsPackages.value.HttpsPackages || []) {
      result.packages.push(normalizeCloudResourcePackage({
        id: item.Id,
        name: item.Type || "HTTPS 请求包",
        kind: "requests",
        status: item.Status,
        total: item.Size,
        used: item.SizeUsed,
        remaining: Math.max(0, finiteNumber(item.Size) - finiteNumber(item.SizeUsed)),
        unit: "次",
        effectiveAt: item.EnableTime,
        expiresAt: item.ExpireTime,
      }));
    }
    result.available = true;
  } else result.warnings.push(providerError("腾讯 HTTPS 请求包", httpsPackages.reason));
  result.packages.sort(sortPackages);
  return result;
}

async function collectAliyunUsage(runtime: Awaited<ReturnType<typeof getMediaStorageRuntimeConfig>>, window: UsageWindow): Promise<CloudProviderUsage> {
  const accessKeyId = runtime.aliyunOssAccessKeyId.trim() || runtime.legacyAliyunOssAccessKeyId.trim();
  const accessKeySecret = runtime.aliyunOssAccessKeySecret.trim() || runtime.legacyAliyunOssAccessKeySecret.trim();
  const targetHost = hostnameFromUrl(runtime.aliyunOssPublicBaseUrl || runtime.legacyAliyunOssPublicBaseUrl);
  const result = emptyProvider("aliyun", Boolean(accessKeyId && accessKeySecret), targetHost);
  if (!result.configured) {
    result.warnings.push("阿里云 AccessKey 尚未配置");
    return result;
  }

  const clientConfig = {
    accessKeyId,
    accessKeySecret,
    type: "access_key",
    regionId: "cn-hangzhou",
    endpoint: "esa.cn-hangzhou.aliyuncs.com",
  } as any;
  const esaClient = new EsaClient(clientConfig);
  const bssClient = new BssClient({ ...clientConfig, endpoint: "business.aliyuncs.com" } as any);
  const ossBucket = runtime.aliyunOssBucket.trim() || runtime.legacyAliyunOssBucket.trim();
  const ossRegion = (runtime.aliyunOssRegion.trim() || runtime.legacyAliyunOssRegion.trim() || "oss-cn-hangzhou").replace(/^oss-/u, "");
  const cmsClient = new CmsClient({
    ...clientConfig,
    regionId: ossRegion,
    endpoint: `metrics.${ossRegion}.aliyuncs.com`,
  } as any);
  const billingWindow = resolveAliyunBillingMonthWindow(window.end);
  const [sites, plans, packages, storage, ossGetRequests, ossPutRequests, ossInternetEgress] = await Promise.allSettled([
    esaClient.listSites(new ListSitesRequest({ pageNumber: 1, pageSize: 500 })),
    esaClient.listUserRatePlanInstances(new ListUserRatePlanInstancesRequest({ pageNumber: 1, pageSize: 500, sortBy: "ExpireTime", sortOrder: "asc" })),
    bssClient.queryResourcePackageInstances(new QueryResourcePackageInstancesRequest({ pageNum: 1, pageSize: 300, includePartner: true })),
    getAliyunOssBucketStats(),
    queryAliyunOssMonthlyMetric(cmsClient, ossBucket, ossRegion, "MeteringGetRequest", billingWindow),
    queryAliyunOssMonthlyMetric(cmsClient, ossBucket, ossRegion, "MeteringPutRequest", billingWindow),
    queryAliyunOssMonthlyMetric(cmsClient, ossBucket, ossRegion, "MeteringInternetTX", billingWindow),
  ]);

  const siteList = sites.status === "fulfilled" ? sites.value.body?.sites || [] : [];
  const matchedSite = siteList.find((site) => {
    const siteName = String(site.siteName || "").trim().toLowerCase();
    return siteName && (targetHost === siteName || targetHost.endsWith(`.${siteName}`));
  }) || siteList.find((site) => site.status === "active");
  result.target = String(matchedSite?.siteName || targetHost || "");
  if (sites.status === "rejected") result.warnings.push(providerError("阿里 ESA 站点", sites.reason));

  const metrics = await Promise.allSettled([
    esaClient.describeSiteTimeSeriesData(new DescribeSiteTimeSeriesDataRequest({
      siteId: matchedSite?.siteId ? String(matchedSite.siteId) : undefined,
      startTime: window.start.toISOString(),
      endTime: window.end.toISOString(),
      interval: window.aliyunInterval,
      fields: ["Traffic", "RequestTraffic", "Requests"].map((fieldName) => new DescribeSiteTimeSeriesDataRequestFields({ fieldName, dimension: ["ALL"] })),
    })),
  ]);
  if (metrics[0].status === "fulfilled") {
    const body = metrics[0].value.body;
    result.trafficBytes = aliyunMetricSummary(body?.summarizedData, "Traffic");
    result.requestTrafficBytes = aliyunMetricSummary(body?.summarizedData, "RequestTraffic");
    result.requests = aliyunMetricSummary(body?.summarizedData, "Requests");
    result.samplingRate = nullableNumber(body?.samplingRate);
    result.points = mergeUsageSeries(
      aliyunMetricPoints(body?.data, "Traffic"),
      aliyunMetricPoints(body?.data, "Requests"),
    );
    result.available = true;
  } else result.warnings.push(providerError("阿里 ESA 流量分析", metrics[0].reason));

  if (plans.status === "fulfilled") {
    const planInfos = plans.value.body?.instanceInfo || [];
    const siteIds = [...new Set(planInfos.flatMap((plan) => (plan.sites || []).map((site) => finiteNumber(site.siteId)).filter((siteId) => siteId > 0)))];
    const monthlyUsage = await Promise.allSettled(siteIds.map(async (siteId) => {
      const response = await esaClient.describeSiteTimeSeriesData(new DescribeSiteTimeSeriesDataRequest({
        siteId,
        startTime: billingWindow.start.toISOString(),
        endTime: billingWindow.end.toISOString(),
        interval: "86400",
        fields: ["Traffic", "RequestTraffic"].map((fieldName) => new DescribeSiteTimeSeriesDataRequestFields({ fieldName, dimension: ["ALL"] })),
      }));
      const summarized = response.body?.summarizedData;
      return {
        siteId,
        trafficBytes: aliyunMetricSummary(summarized, "Traffic") + aliyunMetricSummary(summarized, "RequestTraffic"),
      };
    }));
    const monthlyUsageBySite = new Map<number, number>();
    for (const usage of monthlyUsage) {
      if (usage.status === "fulfilled") monthlyUsageBySite.set(usage.value.siteId, usage.value.trafficBytes);
    }
    const rejectedUsage = monthlyUsage.find((usage) => usage.status === "rejected");
    if (rejectedUsage?.status === "rejected") result.warnings.push(providerError("阿里 ESA 本月套餐流量", rejectedUsage.reason));
    result.plans = planInfos.map((plan) => {
      const planSiteIds = (plan.sites || []).map((site) => finiteNumber(site.siteId)).filter((siteId) => siteId > 0);
      const hasUsage = planSiteIds.length > 0 && planSiteIds.every((siteId) => monthlyUsageBySite.has(siteId));
      const usedTrafficBytes = hasUsage
        ? planSiteIds.reduce((total, siteId) => total + (monthlyUsageBySite.get(siteId) || 0), 0)
        : null;
      const traffic = calculateAliyunPlanTraffic(plan.planTraffic, usedTrafficBytes);
      return {
        id: String(plan.instanceId || ""),
        name: String(plan.planName || plan.subscribeType || "ESA 套餐"),
        status: String(plan.status || "unknown"),
        billingMode: String(plan.billingMode || ""),
        coverage: String(plan.coverages || ""),
        expiresAt: normalizeTimestamp(plan.expireTime),
        sites: (plan.sites || []).map((site) => String(site.siteName || "")).filter(Boolean),
        ...traffic,
        trafficUsageStartAt: billingWindow.start.toISOString(),
        trafficUsageEndAt: billingWindow.end.toISOString(),
        includedRequests: nullableNumber(plan.staticRequest) === null ? null : finiteNumber(plan.staticRequest) * 10_000,
      };
    });
    result.available = true;
  } else result.warnings.push(providerError("阿里 ESA 套餐", plans.reason));

  if (storage.status === "fulfilled") {
    const meteringResults = [ossGetRequests, ossPutRequests, ossInternetEgress]
      .filter((metric): metric is PromiseFulfilledResult<{ total: number; measuredAt: string }> => metric.status === "fulfilled")
      .map((metric) => metric.value.measuredAt)
      .filter(Boolean)
      .sort();
    result.storage = {
      ...storage.value,
      monthlyGetRequests: ossGetRequests.status === "fulfilled" ? ossGetRequests.value.total : null,
      monthlyPutRequests: ossPutRequests.status === "fulfilled" ? ossPutRequests.value.total : null,
      monthlyInternetEgressBytes: ossInternetEgress.status === "fulfilled" ? ossInternetEgress.value.total : null,
      meteringMeasuredAt: meteringResults.at(-1) || "",
    };
    result.available = true;
  } else result.warnings.push(providerError("阿里 OSS 存储用量", storage.reason));
  if (ossGetRequests.status === "rejected") result.warnings.push(providerError("阿里 OSS 本月读请求", ossGetRequests.reason));
  if (ossPutRequests.status === "rejected") result.warnings.push(providerError("阿里 OSS 本月写请求", ossPutRequests.reason));
  if (ossInternetEgress.status === "rejected") result.warnings.push(providerError("阿里 OSS 本月公网流出", ossInternetEgress.reason));

  if (packages.status === "fulfilled") {
    const list = packages.value.body?.data?.instances?.instance || [];
    result.packages = list.map((item) => {
      const products = item.applicableProducts?.product || [];
      const text = `${item.packageType || ""} ${item.remark || ""} ${products.join(" ")}`.toLowerCase();
      const kind: CloudResourcePackage["kind"] = text.includes("traffic") || text.includes("流量")
        ? "traffic"
        : text.includes("storage") || text.includes("存储") || text.includes("oss")
          ? "storage"
          : text.includes("request") || text.includes("请求")
            ? "requests"
            : "other";
      return normalizeCloudResourcePackage({
        id: item.instanceId,
        name: item.remark || item.packageType || "阿里云资源包",
        kind,
        status: item.status,
        total: item.totalAmount,
        remaining: item.remainingAmount,
        unit: item.remainingAmountUnit || item.totalAmountUnit,
        effectiveAt: item.effectiveTime,
        expiresAt: item.expiryTime,
      });
    }).sort(sortPackages);
    result.available = true;
  } else result.warnings.push(providerError("阿里云资源包", packages.reason));
  return result;
}

async function queryAliyunOssMonthlyMetric(
  client: CmsClient,
  bucket: string,
  regionId: string,
  metricName: "MeteringGetRequest" | "MeteringPutRequest" | "MeteringInternetTX",
  window: Pick<UsageWindow, "start" | "end">,
) {
  if (!bucket) throw new Error("OSS 存储桶尚未配置");
  const response = await client.describeMetricList(new DescribeMetricListRequest({
    namespace: "acs_oss_dashboard",
    metricName,
    period: "3600",
    startTime: String(window.start.getTime()),
    endTime: String(window.end.getTime()),
    dimensions: JSON.stringify([{ BucketName: bucket }]),
    length: "1000",
    regionId,
  }));
  if (response.body?.success === false) throw new Error(response.body.message || "云监控查询失败");
  return summarizeAliyunCmsDatapoints(response.body?.datapoints);
}

function emptyProvider(provider: CloudProviderUsage["provider"], configured: boolean, target: string): CloudProviderUsage {
  return {
    provider,
    configured,
    available: false,
    target,
    trafficBytes: 0,
    requestTrafficBytes: 0,
    requests: 0,
    trafficHitRate: null,
    requestHitRate: null,
    samplingRate: null,
    points: [],
    packages: [],
    plans: [],
    storage: null,
    warnings: [],
  };
}

function tencentMetricSummary(response: { Data?: Array<{ CdnData?: Array<{ Metric?: string; SummarizedData?: { Value?: number } }> }> }, metric: string) {
  return finiteNumber(response.Data?.[0]?.CdnData?.find((item) => item.Metric === metric)?.SummarizedData?.Value);
}

function tencentMetricPoints(response: { Data?: Array<{ CdnData?: Array<{ Metric?: string; DetailData?: Array<{ Time?: string; Value?: number }> }> }> }, metric: string) {
  return (response.Data?.[0]?.CdnData?.find((item) => item.Metric === metric)?.DetailData || []).map((point) => ({
    timestamp: String(point.Time || ""),
    value: point.Value,
  }));
}

function aliyunMetricSummary(items: Array<{ fieldName?: string; value?: unknown }> | undefined, fieldName: string) {
  return finiteNumber(items?.find((item) => item.fieldName === fieldName)?.value);
}

function aliyunMetricPoints(items: Array<{ fieldName?: string; detailData?: Array<{ timeStamp?: string; value?: unknown }> }> | undefined, fieldName: string) {
  return (items?.find((item) => item.fieldName === fieldName)?.detailData || []).map((point) => ({
    timestamp: String(point.timeStamp || ""),
    value: point.value,
  }));
}

function hostnameFromUrl(value: string) {
  try { return new URL(String(value || "").trim()).hostname.toLowerCase(); } catch { return ""; }
}

function formatTencentTime(value: Date) {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = Date.parse(text.includes("T") ? text : text.replace(" ", "T") + "+08:00");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function providerError(label: string, error: unknown) {
  const message = String((error as any)?.message || (error as any)?.code || error || "请求失败")
    .replace(/\s+/gu, " ")
    .slice(0, 300);
  return `${label}：${message}`;
}

function sortPackages(a: CloudResourcePackage, b: CloudResourcePackage) {
  const activeA = ["enabled", "available"].includes(a.status.toLowerCase()) ? 0 : 1;
  const activeB = ["enabled", "available"].includes(b.status.toLowerCase()) ? 0 : 1;
  if (activeA !== activeB) return activeA - activeB;
  return (Date.parse(a.expiresAt) || Number.MAX_SAFE_INTEGER) - (Date.parse(b.expiresAt) || Number.MAX_SAFE_INTEGER);
}
