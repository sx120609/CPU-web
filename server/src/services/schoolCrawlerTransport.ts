import { config } from "../config";
import * as local from "./schoolCrawlerCore";
import * as remote from "./schoolCrawlerRemote";
import * as agentRemote from "./schoolCrawlerAgentRemote";

export function crawlSchoolFeedSource(
  source: Parameters<typeof local.crawlSchoolFeedSource>[0],
  opts?: Parameters<typeof local.crawlSchoolFeedSource>[1],
) {
  // 公告抓取有校内网络边界，只走管理员明确指定的单个 Agent，不参与教务池负载均衡。
  if (agentRemote.hasConfiguredCrawlAgent()) return agentRemote.crawlSchoolFeedSource(source, opts);
  if (config.jwxtProxyUrl) return remote.crawlSchoolFeedSource(source, opts);
  return local.crawlSchoolFeedSource(source, opts);
}
