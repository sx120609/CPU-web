export type AiModelCatalog = {
  endpoint: string;
  models: string[];
};

export function buildAiModelEndpointCandidates(apiUrl: string, provider?: string) {
  const parsed = new URL(String(apiUrl || "").trim());
  const path = parsed.pathname.replace(/\/+$/, "");
  const basePath = path.replace(/\/(?:chat\/completions|responses|completions|models?|model|api\/(?:chat|generate|tags))$/i, "");
  if (String(provider || "").trim().toLowerCase() === "ollama") {
    const serverBasePath = basePath.replace(/\/(?:v1|api)$/i, "");
    const openAiModelsPath = `${serverBasePath}/v1/models`.replace(/\/{2,}/g, "/");
    const nativeTagsPath = `${serverBasePath}/api/tags`.replace(/\/{2,}/g, "/");
    const nativeApiConfigured = /\/api(?:\/(?:chat|generate|tags))?$/i.test(path);
    return [nativeApiConfigured ? nativeTagsPath : openAiModelsPath, nativeApiConfigured ? openAiModelsPath : nativeTagsPath]
      .map((nextPath) => {
        const next = new URL(parsed.toString());
        next.pathname = nextPath;
        next.search = "";
        next.hash = "";
        return next.toString();
      })
      .filter((endpoint, index, list) => list.indexOf(endpoint) === index);
  }
  const candidates = ["model", "models"].map((suffix) => {
    const next = new URL(parsed.toString());
    next.pathname = `${basePath}/${suffix}`.replace(/\/{2,}/g, "/");
    next.search = "";
    next.hash = "";
    return next.toString();
  });
  return Array.from(new Set(candidates));
}

export function extractAiModelIds(payload: unknown) {
  const roots: unknown[] = [payload];
  if (isRecord(payload)) {
    roots.push(payload.data, payload.models, payload.result);
    if (isRecord(payload.data)) roots.push(payload.data.models, payload.data.items);
  }

  const ids: string[] = [];
  for (const root of roots) {
    if (!Array.isArray(root)) continue;
    for (const item of root) {
      if (typeof item === "string") {
        ids.push(item);
        continue;
      }
      if (!isRecord(item)) continue;
      const candidate = item.id ?? item.model ?? item.name ?? item.value;
      if (typeof candidate === "string") ids.push(candidate);
    }
  }
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

export async function fetchAiModelCatalog(input: {
  apiUrl: string;
  provider?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<AiModelCatalog> {
  const candidates = buildAiModelEndpointCandidates(input.apiUrl, input.provider);
  const errors: string[] = [];

  for (const endpoint of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      const apiKey = String(input.apiKey || "").trim();
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetch(endpoint, { method: "GET", headers, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`${new URL(endpoint).pathname} 返回 ${response.status}`);
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        errors.push(`${new URL(endpoint).pathname} 未返回 JSON`);
        continue;
      }
      const models = extractAiModelIds(payload);
      if (!models.length) {
        errors.push(`${new URL(endpoint).pathname} 未返回可识别的模型`);
        continue;
      }
      return { endpoint, models };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "请求超时"
        : error instanceof Error
          ? error.message
          : "请求失败";
      errors.push(`${new URL(endpoint).pathname} ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(errors.join("；") || "上游模型接口不可用");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
