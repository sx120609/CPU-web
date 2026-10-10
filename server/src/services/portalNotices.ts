/**
 * 融合门户（i.cpu.edu.cn）“门户资讯聚合”列表的解析与部门归类。
 *
 * 这里不碰网络和 Prisma：列表由持有教务会话的节点取回，入库在 portalNoticeCrawler。
 */

export const PORTAL_NOTICE_PARSER = "portal-notice-v1";
export const PORTAL_NOTICE_SOURCE_SLUG = "portal-notice";
export const PORTAL_NOTICE_HOMEPAGE = "https://i.cpu.edu.cn/?siteId=100000333&columnId=100017929&type=notice#/columnList";
// _p 是 base64(as=2&t=5&d=133&p=1&f=44&m=N&)，来自门户首页布局，和应用列表接口共用。
export const PORTAL_NOTICE_LIST_URL =
  "https://i.cpu.edu.cn/mnews/mobile/getPortalArticleList16.rst"
  + "?siteId=100000333&columnId=100017929&type=notice&_p=YXM9MiZ0PTUmZD0xMzMmcD0xJmY9NDQmbT1OJg__";
export const PORTAL_NOTICE_MAX_PAGE_SIZE = 500;

export interface PortalNotice {
  id: number;
  title: string;
  /** 发布部门，如“教务处”。 */
  department: string;
  /** 部门网站里的栏目，如“通知公告”。 */
  column: string;
  url: string;
  publishedAt: string;
  summary: string;
}

export interface PortalNoticePage {
  total: number;
  notices: PortalNotice[];
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function publicHttpUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** 接口不带 callback 时直接返回 JSON；带了就是 JSONP，两种都接受。 */
export function parsePortalNoticeResponse(text: string): PortalNoticePage {
  const body = text.replace(/^﻿/, "").trim();
  if (!body || body.startsWith("<")) throw new Error("门户未返回资讯数据（登录态可能已失效）");
  const jsonText = /^[\w$.]+\s*\(/.test(body) ? body.replace(/^[\w$.]+\s*\(/, "").replace(/\)\s*;?$/, "") : body;
  let json: any;
  try {
    json = JSON.parse(jsonText);
  } catch {
    throw new Error("门户资讯数据不是有效的 JSON");
  }
  if (String(json?.result) !== "1") throw new Error(`门户资讯接口未成功：${cleanText(json?.reason, 120) || "未返回成功状态"}`);
  const articles: unknown[] = Array.isArray(json?.data?.articles) ? json.data.articles : [];
  const notices: PortalNotice[] = [];
  for (const raw of articles as any[]) {
    const id = Number(raw?.id);
    const title = cleanText(raw?.title, 300);
    const department = cleanText(raw?.from, 40);
    const url = publicHttpUrl(raw?.articleUrl) || publicHttpUrl(raw?.linkUrl);
    const timestamp = Number(raw?.publishTimestamp);
    if (!Number.isSafeInteger(id) || id <= 0 || !title || !department || !url) continue;
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    notices.push({
      id,
      title,
      department,
      column: cleanText(raw?.phColName, 60),
      url,
      publishedAt: new Date(timestamp).toISOString(),
      summary: cleanText(raw?.summary || raw?.content, 400),
    });
  }
  return { total: Number(json?.data?.count) || notices.length, notices };
}

/**
 * 去重用的外部 ID。学校站群的文章地址里带 c{栏目}a{文章}，和各部门网站直接抓取时用的
 * 是同一个值，所以两条路抓到同一篇文章只会入库一次。
 */
export function portalNoticeExternalId(notice: Pick<PortalNotice, "id" | "url">) {
  return (notice.url.match(/c(\d+)a(\d+)/i) ?? [])[0] ?? `portal-${notice.id}`;
}

// 面向教职工的部门：默认不进“全部”，用户可以自己加回来。
const STAFF_ORIENTED_DEPARTMENTS = [
  "科学技术研究院", "人事处", "国有资产管理处", "审计处", "离退休工作处",
  "党委组织部", "党委宣传部", "党委统战部", "纪委", "工会", "财务处", "校长办公室", "党委办公室",
];

export function isDefaultAnnouncementDepartment(department: string) {
  return !STAFF_ORIENTED_DEPARTMENTS.some((name) => department.includes(name));
}

export interface AnnouncementSourceChoice {
  slug: string;
  announceDefault: boolean;
}

export interface AnnouncementOverrides {
  include: string[];
  exclude: string[];
}

/** 实际显示的板块 = 默认集合 + 用户加入的 − 用户去掉的；已不存在的 slug 自动忽略。 */
export function resolveAnnouncementSelection(sources: AnnouncementSourceChoice[], overrides: AnnouncementOverrides | null) {
  const include = new Set(overrides?.include ?? []);
  const exclude = new Set(overrides?.exclude ?? []);
  return sources
    .filter((source) => (source.announceDefault ? !exclude.has(source.slug) : include.has(source.slug)))
    .map((source) => source.slug);
}

/** 把用户勾选的结果折算成相对默认集合的增减。 */
export function announcementOverridesFor(sources: AnnouncementSourceChoice[], selected: string[]): AnnouncementOverrides {
  const chosen = new Set(selected);
  return {
    include: sources.filter((source) => !source.announceDefault && chosen.has(source.slug)).map((source) => source.slug),
    exclude: sources.filter((source) => source.announceDefault && !chosen.has(source.slug)).map((source) => source.slug),
  };
}

/** 后台绑定的门户登录态。存了账号密码时，令牌由服务端自己登录得到（owned），失效后可以自动重登。 */
export type PortalSession = {
  token: string;
  username?: string;
  password?: string;
  owned?: boolean;
  reloginAt?: number;
};

/** 学校明确拒绝了账号密码。不能再拿同一个密码重试，否则会把账号试到锁定。 */
export class PortalLoginRejectedError extends Error {}

// 重登后门户仍不认时不要每轮都去登录一次。
export const PORTAL_RELOGIN_MIN_INTERVAL_MS = 30 * 60 * 1000;

export function isPortalSessionExpiredError(error: unknown) {
  if ((error as { status?: unknown } | null)?.status === 401) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /登录态|会话已失效|尚未完成统一认证|未登录/.test(message);
}

/** 用绑定的登录态执行一次门户请求；登录态失效且存了账号密码时重新登录再试一次。 */
export async function withPortalRelogin<T>(
  session: PortalSession,
  deps: {
    run: (token: string) => Promise<T>;
    login: (username: string, password: string) => Promise<string>;
    save: (next: PortalSession, previous: PortalSession) => Promise<void>;
    now?: () => number;
  },
): Promise<T> {
  try {
    return await deps.run(session.token);
  } catch (error) {
    if (!session.username || !session.password || !isPortalSessionExpiredError(error)) throw error;
    const now = (deps.now ?? Date.now)();
    if (session.reloginAt && now - session.reloginAt < PORTAL_RELOGIN_MIN_INTERVAL_MS) throw error;

    let token: string;
    try {
      token = await deps.login(session.username, session.password);
    } catch (loginError) {
      const reason = loginError instanceof Error ? loginError.message : String(loginError);
      if (loginError instanceof PortalLoginRejectedError) {
        await deps.save({ token: session.token, owned: session.owned }, session);
        throw new Error(`自动重新登录被统一认证拒绝，已停用保存的密码，请重新绑定：${reason}`);
      }
      throw new Error(`融合门户登录态已失效，自动重新登录没有成功：${reason}`);
    }
    const next: PortalSession = { ...session, token, owned: true, reloginAt: now };
    await deps.save(next, session);
    return deps.run(token);
  }
}
