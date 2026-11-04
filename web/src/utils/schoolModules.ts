import type { SchoolInfo } from "@/api/site";

/** 网页路径归最长匹配的前缀所属的功能管；不归任何功能的路径（首页、个人页、后台）总是可用。 */
export function schoolModuleForPath(school: Pick<SchoolInfo, "pages"> | null | undefined, path: string) {
  if (!school || !path.startsWith("/")) return null;
  const clean = path.split(/[?#]/u)[0];
  let best: { prefix: string; module: string } | null = null;
  for (const entry of school.pages) {
    const matches = clean === entry.prefix || clean.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }
  return best?.module ?? null;
}

/** 学校信息还没拉到时不拦：路由守卫会先等它加载。 */
export function isSchoolPathEnabled(school: SchoolInfo | null | undefined, path: string) {
  const module = schoolModuleForPath(school, path);
  return !module || Boolean(school?.modules.includes(module));
}

export function isSchoolToolEnabled(school: SchoolInfo | null | undefined, slug: string) {
  const module = school?.tools.find((entry) => entry.slug === slug)?.module;
  return !module || Boolean(school?.modules.includes(module));
}
