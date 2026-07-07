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
  const domains: CacheDomain[] = ["forum-list", "home", "search"];
  if (options?.includeBoards !== false) domains.push("boards");
  if (options?.includeCourses) domains.push("courses");
  await bumpMany(domains);
}

export async function invalidateCourseCaches() {
  await bumpMany(["courses", "search"]);
}

export async function invalidateJwxtWidgetCaches() {
  await bumpMany(["jwxt-widget"]);
}
