import { config } from "../config";
import * as local from "./schoolCrawlerCore";
import * as remote from "./schoolCrawlerRemote";

const useRemote = !!config.jwxtProxyUrl;

export const crawlSchoolFeedSource = useRemote ? remote.crawlSchoolFeedSource : local.crawlSchoolFeedSource;
