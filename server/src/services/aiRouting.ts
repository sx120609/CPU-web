import { prisma } from "../prisma";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequest } from "./aiJsonApi";
import { fetchAiModelCatalog } from "./aiModelCatalog";
import {
  AI_SCENE_MODEL_FIELDS,
  AI_SERVICE_SCENES,
  getStoredSiteConfig,
  setAiReviewConfig,
  setCampusAssistantModel,
  setLearningAssistantTiers,
  type AiServiceConfig,
  type AiServiceFallbackMap,
  type AiServiceScene,
  type LearningAssistantTierKey,
  type SiteConfig,
} from "./siteSettings";

/** 线路上的一环：哪个服务、在它上面用哪个模型。回退环的模型留空表示沿用主模型名。 */
export type AiRouteEntry = { serviceId: string; model: string };
export type AiLearningTierModels = Record<LearningAssistantTierKey, string>;

export type AiRoutingScene = {
  scene: AiServiceScene;
  label: string;
  /** 这个场景的功能开关是否打开；关着的场景不会发请求，线路只是备着。 */
  featureEnabled: boolean;
  /** 第一环是主线路，其后按顺序回退。 */
  chain: AiRouteEntry[];
  /** 仅网课解题：主线路上三个档位各自的模型。 */
  tierModels?: AiLearningTierModels;
  /** 主服务上的备选模型（逗号分隔），在“功能与审核”里维护，这里只读，供换主服务时对照。 */
  fallbackModels: string;
};

export type AiRoutingState = {
  services: AiServiceConfig[];
  scenes: AiRoutingScene[];
};

export type AiRoutingUpdate = {
  services: AiServiceConfig[];
  scenes: Partial<Record<AiServiceScene, { chain: AiRouteEntry[]; tierModels?: AiLearningTierModels }>>;
};

const SCENE_LABELS: Record<AiServiceScene, string> = {
  assistant: "拾间 AI",
  "learning-assistant": "网课解题",
  "smart-post": "智慧发帖",
  "text-review": "文字审核",
  "song-review": "歌曲审核",
  "qq-group-ad": "QQ群广告过滤",
  "image-review": "图片审核",
  "video-review": "视频审核",
};

const SCENE_SERVICE_ID_FIELDS = {
  assistant: "assistantServiceId",
  "learning-assistant": "learningAssistantServiceId",
  "smart-post": "smartPostServiceId",
  "text-review": "aiReviewServiceId",
  "song-review": "songReviewServiceId",
  "qq-group-ad": "qqGroupAdReviewServiceId",
  "image-review": "imageReviewServiceId",
  "video-review": "videoReviewServiceId",
} as const satisfies Record<AiServiceScene, keyof SiteConfig>;

const LEARNING_TIERS: LearningAssistantTierKey[] = ["low", "high", "max"];
const DEFAULT_AI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TRAFFIC_WINDOW_MINUTES = 30;
const CATALOG_PROBE_TIMEOUT_MS = 8_000;
const ROUTE_TEST_TIMEOUT_MS = 30_000;

function sceneFeatureEnabled(config: SiteConfig, scene: AiServiceScene) {
  if (scene === "smart-post") return config.smartPostEnabled;
  if (scene === "song-review") return config.songReviewEnabled;
  if (scene === "qq-group-ad") return config.qqGroupAdReviewEnabled;
  if (scene === "image-review") return config.imageReviewEnabled;
  if (scene === "video-review") return config.videoReviewEnabled;
  // 拾间 AI、网课解题和文字审核共用“启用审核”这个总开关。
  return config.aiReviewEnabled;
}

/** 把分散在各字段里的主服务、主模型和回退列表拼成每个场景一条线路。 */
export function buildAiRoutingState(config: SiteConfig): AiRoutingState {
  const scenes = AI_SERVICE_SCENES.map((scene): AiRoutingScene => {
    const primaryId = String(config[SCENE_SERVICE_ID_FIELDS[scene]] || "");
    const fallbacks = (config.aiServiceFallbacks[scene] || []).map((route) => ({
      serviceId: route.serviceId,
      model: route.model || "",
    }));
    if (scene === "learning-assistant") {
      const tierModels = Object.fromEntries(
        LEARNING_TIERS.map((tier) => [tier, config.learningAssistantTiers[tier].model]),
      ) as AiLearningTierModels;
      return {
        scene,
        label: SCENE_LABELS[scene],
        featureEnabled: sceneFeatureEnabled(config, scene),
        chain: [{ serviceId: primaryId, model: tierModels.low }, ...fallbacks],
        tierModels,
        fallbackModels: "",
      };
    }
    const fields = AI_SCENE_MODEL_FIELDS[scene];
    return {
      scene,
      label: SCENE_LABELS[scene],
      featureEnabled: sceneFeatureEnabled(config, scene),
      chain: [{ serviceId: primaryId, model: String(config[fields.model] || "") }, ...fallbacks],
      fallbackModels: fields.fallbackModels ? String(config[fields.fallbackModels] || "") : "",
    };
  });
  return { services: config.aiServices.map((service) => ({ ...service })), scenes };
}

export function getAiRoutingState() {
  return buildAiRoutingState(getStoredSiteConfig());
}

/** 校验一次线路保存，并换算成站点配置的字段；有问题时抛出给管理员看的说明。 */
export function buildAiRoutingPatch(current: SiteConfig, update: AiRoutingUpdate) {
  if (!update.services.length) throw new Error("至少保留一个 AI 服务");
  const serviceIds = new Set<string>();
  for (const service of update.services) {
    if (serviceIds.has(service.id)) throw new Error(`服务标识重复：${service.id}`);
    serviceIds.add(service.id);
  }
  const patch: Partial<SiteConfig> = { aiServices: update.services };
  const fallbacks = {} as AiServiceFallbackMap;
  let assistantModel: string | null = null;
  let learningTiers: SiteConfig["learningAssistantTiers"] | null = null;

  for (const scene of AI_SERVICE_SCENES) {
    const label = SCENE_LABELS[scene];
    const input = update.scenes[scene];
    if (!input?.chain.length) throw new Error(`${label}没有配置线路`);
    const seen = new Set<string>();
    for (const entry of input.chain) {
      if (!serviceIds.has(entry.serviceId)) throw new Error(`${label}的线路引用了不存在的服务`);
      if (seen.has(entry.serviceId)) throw new Error(`${label}的线路里同一个服务出现了两次`);
      seen.add(entry.serviceId);
    }
    const [primary, ...rest] = input.chain;
    patch[SCENE_SERVICE_ID_FIELDS[scene]] = primary.serviceId;
    fallbacks[scene] = rest.map((entry) => ({ serviceId: entry.serviceId, model: entry.model.trim() }));

    if (scene === "learning-assistant") {
      const tiers = structuredClone(current.learningAssistantTiers);
      for (const tier of LEARNING_TIERS) {
        const model = String(input.tierModels?.[tier] || primary.model || "").trim();
        if (!model) throw new Error(`${label}的主线路缺少模型`);
        tiers[tier].model = model;
      }
      learningTiers = tiers;
      continue;
    }
    const model = primary.model.trim();
    if (!model) throw new Error(`${label}的主线路缺少模型`);
    if (scene === "assistant") assistantModel = model;
    else patch[AI_SCENE_MODEL_FIELDS[scene].model] = model;
  }
  patch.aiServiceFallbacks = fallbacks;
  return { patch, assistantModel, learningTiers };
}

export async function saveAiRouting(update: AiRoutingUpdate) {
  const current = getStoredSiteConfig();
  const { patch, assistantModel, learningTiers } = buildAiRoutingPatch(current, update);
  await setAiReviewConfig(patch);
  if (assistantModel && assistantModel !== current.assistantModel) await setCampusAssistantModel(assistantModel);
  if (learningTiers && LEARNING_TIERS.some((tier) => learningTiers[tier].model !== current.learningAssistantTiers[tier].model)) {
    await setLearningAssistantTiers(learningTiers);
  }
  return getAiRoutingState();
}

export type AiServiceTraffic = {
  serviceId: string;
  success: number;
  error: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string;
  lastErrorModel: string;
  /** 另有服务填的是同一个地址，日志里分不出是谁的请求。 */
  shared: boolean;
};

function originOf(url: string) {
  try {
    return new URL(String(url || "").trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 按调用日志统计每个服务最近的真实请求结果。日志只记了请求地址，所以按地址的主机归到服务上。
 * 用户自己取消的请求不算失败。
 */
export async function loadAiServiceTraffic(services: AiServiceConfig[]): Promise<{
  windowMinutes: number;
  services: AiServiceTraffic[];
}> {
  const since = new Date(Date.now() - TRAFFIC_WINDOW_MINUTES * 60_000);
  const notCancelled = { OR: [{ errorMessage: null }, { NOT: { errorMessage: { startsWith: "REQUEST_ABORTED" } } }] };
  const [groups, recentErrors] = await Promise.all([
    prisma.aiReviewLog.groupBy({
      by: ["endpoint", "status"],
      where: { startedAt: { gte: since }, status: { in: ["success", "error"] }, ...notCancelled },
      _count: { _all: true },
      _max: { startedAt: true },
    }),
    prisma.aiReviewLog.findMany({
      where: { startedAt: { gte: since }, status: "error", ...notCancelled },
      orderBy: { startedAt: "desc" },
      take: 80,
      select: { endpoint: true, errorMessage: true, model: true },
    }),
  ]);

  const byOrigin = new Map<string, Omit<AiServiceTraffic, "serviceId" | "shared">>();
  const entryFor = (origin: string) => {
    let entry = byOrigin.get(origin);
    if (!entry) {
      entry = { success: 0, error: 0, lastSuccessAt: null, lastErrorAt: null, lastError: "", lastErrorModel: "" };
      byOrigin.set(origin, entry);
    }
    return entry;
  };
  const later = (left: string | null, right: Date | null) => {
    const next = right ? right.toISOString() : null;
    return !left || (next && next > left) ? next : left;
  };
  for (const group of groups) {
    const origin = originOf(group.endpoint || "");
    if (!origin) continue;
    const entry = entryFor(origin);
    if (group.status === "success") {
      entry.success += group._count._all;
      entry.lastSuccessAt = later(entry.lastSuccessAt, group._max.startedAt);
    } else {
      entry.error += group._count._all;
      entry.lastErrorAt = later(entry.lastErrorAt, group._max.startedAt);
    }
  }
  for (const row of recentErrors) {
    const entry = byOrigin.get(originOf(row.endpoint || ""));
    if (!entry || entry.lastError) continue;
    entry.lastError = String(row.errorMessage || "").slice(0, 200);
    entry.lastErrorModel = row.model;
  }

  const origins = services.map((service) => originOf(service.apiUrl));
  return {
    windowMinutes: TRAFFIC_WINDOW_MINUTES,
    services: services.map((service, index) => ({
      serviceId: service.id,
      ...(byOrigin.get(origins[index]) || {
        success: 0, error: 0, lastSuccessAt: null, lastErrorAt: null, lastError: "", lastErrorModel: "",
      }),
      shared: Boolean(origins[index]) && origins.filter((origin) => origin === origins[index]).length > 1,
    })),
  };
}

export type AiServiceProbeInput = { id: string; provider: string; apiUrl: string; apiKey: string };
export type AiServiceProbe = {
  serviceId: string;
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
  endpoint: string;
  models: string[];
  error: string;
};

/** 读一次模型目录：能读到说明地址通、密钥被接受，同时拿到这个服务上可选的模型。 */
export async function probeAiService(service: AiServiceProbeInput): Promise<AiServiceProbe> {
  const startedAt = Date.now();
  const done = (extra: Pick<AiServiceProbe, "ok" | "endpoint" | "models" | "error">): AiServiceProbe => ({
    serviceId: service.id,
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    ...extra,
  });
  if (!service.apiUrl.trim()) return done({ ok: false, endpoint: "", models: [], error: "没有填写 API 地址" });
  try {
    const catalog = await fetchAiModelCatalog({
      provider: service.provider,
      apiUrl: service.apiUrl,
      apiKey: service.apiKey,
      timeoutMs: CATALOG_PROBE_TIMEOUT_MS,
    });
    return done({ ok: true, endpoint: catalog.endpoint, models: catalog.models, error: "" });
  } catch (error) {
    return done({ ok: false, endpoint: "", models: [], error: errorText(error) });
  }
}

export type AiRouteTestInput = { key: string; provider: string; apiUrl: string; apiKey: string; model: string };
export type AiRouteTest = {
  key: string;
  ok: boolean;
  /** 上游返回的 HTTP 状态；没有连上时为 0。 */
  status: number;
  latencyMs: number;
  checkedAt: string;
  /** 成功时是模型的回复，失败时是上游的报错。 */
  message: string;
};

/** 用线路上的服务和模型真发一条最小的请求，走的是各场景实际使用的同一条请求路径。 */
export async function testAiRoute(route: AiRouteTestInput): Promise<AiRouteTest> {
  const startedAt = Date.now();
  const done = (extra: Pick<AiRouteTest, "ok" | "status" | "message">): AiRouteTest => ({
    key: route.key,
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    ...extra,
  });
  if (!route.apiUrl.trim()) return done({ ok: false, status: 0, message: "没有填写 API 地址" });
  if (!route.model.trim()) return done({ ok: false, status: 0, message: "没有指定模型" });
  try {
    const result = await sendAiJsonRequest({
      endpoint: normalizeAiJsonApiUrl(route.apiUrl, DEFAULT_AI_ENDPOINT),
      apiKey: route.apiKey,
      provider: route.provider,
      model: route.model.trim(),
      messages: [{ role: "user", content: "这是一次连通性检查。请只输出 JSON：{\"ok\":true}" }],
      // 和各场景一样带上 temperature，模型不接受这类参数时测试也能发现。
      temperature: 0.1,
      maxTokens: 64,
      maxTransientRetries: 0,
      timeoutMs: ROUTE_TEST_TIMEOUT_MS,
    });
    const status = result.response.status;
    if (!result.response.ok) {
      const body = result.errorText || await result.response.text().catch(() => "");
      return done({ ok: false, status, message: summarizeUpstreamError(body) || `HTTP ${status}` });
    }
    const payload = await result.response.json().catch(() => null);
    const reply = payload ? extractAiJsonTextResponse(payload, result.mode) : "";
    return done({ ok: true, status, message: String(reply || "").trim().slice(0, 120) });
  } catch (error) {
    return done({ ok: false, status: 0, message: errorText(error) });
  }
}

function summarizeUpstreamError(body: string) {
  const text = String(body || "").trim();
  try {
    const json = JSON.parse(text);
    const message = json?.error?.message ?? json?.error ?? json?.message ?? json?.msg;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 300);
  } catch {
    // 不是 JSON 就原样截取
  }
  return text.replace(/\s+/g, " ").slice(0, 300);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.name === "AbortError" ? "请求超时" : error.message.slice(0, 300);
  return "请求失败";
}
