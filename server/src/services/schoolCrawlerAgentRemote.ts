import { config } from "../config";
import { HttpError } from "../utils/response";
import type { CrawlSchoolFeedResult, SchoolFeedSourceInput } from "./schoolCrawlerCore";
import { getJwxtAgentRuntimeConfig } from "./jwxtAgentConfig";
import { requestJwxtAgent } from "./jwxtAgentGateway";

export function hasConfiguredCrawlAgent() {
  return Boolean(getJwxtAgentRuntimeConfig().crawlAgentId);
}

export function crawlSchoolFeedSource(
  source: SchoolFeedSourceInput,
  opts: { skipExternalIds?: string[]; dryRun?: boolean } = {},
): Promise<CrawlSchoolFeedResult> {
  const agentId = getJwxtAgentRuntimeConfig().crawlAgentId;
  if (!agentId) throw new HttpError(503, 5000, "未指定公告抓取 Agent");
  return requestJwxtAgent(
    agentId,
    "school-feed.crawl",
    { source, ...opts },
    config.proxyTimeoutMs,
  );
}
