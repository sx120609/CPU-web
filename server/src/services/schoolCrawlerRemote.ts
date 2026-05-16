import { config } from "../config";
import { Errors, HttpError } from "../utils/response";
import type { CrawlSchoolFeedResult, SchoolFeedSourceInput } from "./schoolCrawlerCore";

type ApiEnvelope<T> = {
  code: number;
  data: T;
  message: string;
};

async function call<T>(path: string, body: unknown): Promise<T> {
  if (!config.jwxtProxyUrl) throw Errors.server("未配置教务代理地址");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.proxyTimeoutMs);
  const url = new URL(path, config.jwxtProxyUrl).toString();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Auth": config.jwxtProxyAuth,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await parseEnvelope<T>(res);
    if (!res.ok || json.code !== 0) {
      throw new HttpError(res.status || 500, json.code || 5000, json.message || `代理请求失败 (${res.status})`);
    }
    return json.data;
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    if (e?.name === "AbortError") throw Errors.server("教务代理请求超时");
    throw Errors.server("教务代理不可达: " + (e?.message ?? String(e)));
  } finally {
    clearTimeout(timer);
  }
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new HttpError(res.status || 502, 5000, "教务代理返回非 JSON 响应");
  }
}

export function crawlSchoolFeedSource(
  source: SchoolFeedSourceInput,
  opts: { skipExternalIds?: string[]; dryRun?: boolean } = {},
): Promise<CrawlSchoolFeedResult> {
  return call("/v1/school-feed/crawl", { source, ...opts });
}
