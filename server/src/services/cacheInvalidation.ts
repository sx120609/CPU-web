import { bumpCacheVersion, type CacheDomain } from "./cache";

async function bumpMany(domains: CacheDomain[]) {
  await bumpCacheVersion(...Array.from(new Set(domains)));
}

export async function invalidateSiteSettingCaches() {
  await bumpMany(["site", "boards", "home", "search", "courses"]);
}

export async function invalidateBoardCaches() {
  await bumpMany(["boards", "home", "forum-list", "search"]);
}

export async function invalidateServiceCaches() {
  await bumpMany(["services", "home", "search"]);
}

export async function invalidateForumCaches(options?: {
  includeBoards?: boolean;
  includeCourses?: boolean;
}) {
  // 课评统计只算公开可见的帖子；隐藏、删除、审核通过等任何帖子变化都会影响它，所以课程缓存总是跟着刷新。
  const domains: CacheDomain[] = ["forum-list", "home", "search", "courses"];
  if (options?.includeBoards !== false) domains.push("boards");
  await bumpMany(domains);
}

export async function invalidateForumAdCaches() {
  await bumpMany(["forum-ads"]);
}

export async function invalidateCourseCaches() {
  await bumpMany(["courses", "search"]);
}

export async function invalidateJwxtWidgetCaches() {
  await bumpMany(["jwxt-widget"]);
}
