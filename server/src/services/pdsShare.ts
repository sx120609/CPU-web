import { config } from "../config";

/**
 * 阿里云盘企业版（PDS）分享链接解析。
 *
 * 为什么需要这一层：PDS 的 `get_download_url` 返回的地址**最长只有 32 小时**
 * （`expire_sec` 默认 900 秒，上限 115200 秒），拿不到永久直链。所以不能把地址
 * 直接写进页面或配置里，只能在每次请求时现换一个，再 302 过去 —— 对外看到的
 * 是我们自己域名下那条稳定链接，用户不必输提取码，也不会跳到网盘页。
 *
 * 链路（已对真实分享验证）：
 *   1. POST /v2/share_link/get_share_token  { share_id, share_pwd } -> share_token（约 2 小时）
 *   2. POST /v2/file/list  { share_id, parent_file_id: "root" }  + 头 x-share-token
 *   3. POST /v2/file/get_download_url  { share_id, file_id, expire_sec } + 头 x-share-token
 *
 * 注意 `get_share_link_download_url` 走不通：它要的是用户 access token，
 * 拿 share_token 调会返回 401 AccessTokenInvalid。
 */

export type PdsFile = {
  fileId: string;
  name: string;
  size: number;
  updatedAt: string;
};

export type PdsDownload = {
  url: string;
  name: string;
  size: number;
  /** 这个地址本身的失效时刻 */
  expiresAt: number;
  /**
   * 文件内容哈希（PDS 一般给 SHA1）。安装包没有代码签名，这是唯一能验真的东西：
   * 哈希经我们自己的 HTTPS 接口下发，字节从阿里云的地址取，两条路都被篡改才可能骗过。
   * 自动更新必须校验它再执行。
   */
  contentHash: string;
  contentHashName: string;
};

type ShareRef = { apiBase: string; shareId: string };

/**
 * 从分享链接里解出 domainId 与 shareId。
 * 形如 https://bj37249.apps.aliyunfile.com/disk/s/w2axNbRRn5n?domainId=bj37249
 *
 * API 主机是 <domainId>.api.aliyunfile.com —— 注意是 aliyunfile 不是 aliyunpds，
 * 后者会返回 NotFound.Domain。这个值在分享页内嵌的 PDS_CONFIG.endpoints 里可以查到。
 */
export const parseShareUrl = (value: string): ShareRef | null => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname.endsWith(".aliyunfile.com")) return null;

  const shareId = url.pathname.match(/\/s\/([A-Za-z0-9_-]+)/)?.[1];
  if (!shareId) return null;

  // domainId 优先取查询参数，其次取主机名第一段
  const domainId = (url.searchParams.get("domainId") || url.hostname.split(".")[0] || "").trim();
  if (!/^[A-Za-z0-9-]+$/.test(domainId)) return null;

  return { apiBase: `https://${domainId}.api.aliyunfile.com`, shareId };
};

const callPds = async <T>(apiBase: string, path: string, body: unknown, shareToken?: string): Promise<T> => {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(shareToken ? { "x-share-token": shareToken } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // 非 JSON 响应按下面的错误分支处理
  }
  if (!response.ok) {
    const detail = payload as { code?: string; message?: string } | null;
    throw new Error(`PDS ${path} 失败（HTTP ${response.status}${detail?.code ? ` ${detail.code}` : ""}）`);
  }
  return payload as T;
};

// share_token 官方给 7200 秒，这里按 90% 过期，避免踩在边界上用一个刚失效的 token
type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

const getShareToken = async (ref: ShareRef, password: string): Promise<string> => {
  const key = `${ref.apiBase}|${ref.shareId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const result = await callPds<{ share_token?: string; expires_in?: number }>(
    ref.apiBase,
    "/v2/share_link/get_share_token",
    { share_id: ref.shareId, share_pwd: password },
  );
  if (!result.share_token) throw new Error("PDS 未返回 share_token（分享可能已失效或需要提取码）");

  const lifetime = Number.isFinite(result.expires_in) ? Number(result.expires_in) : 7200;
  tokenCache.set(key, {
    token: result.share_token,
    expiresAt: Date.now() + lifetime * 900, // 秒 -> 毫秒后再打九折
  });
  return result.share_token;
};

type ListResponse = {
  items?: { file_id: string; name: string; type: string; size?: number; updated_at?: string }[];
};

export const listShareFiles = async (ref: ShareRef, password: string): Promise<PdsFile[]> => {
  const token = await getShareToken(ref, password);
  const result = await callPds<ListResponse>(
    ref.apiBase,
    "/v2/file/list",
    { share_id: ref.shareId, parent_file_id: "root", limit: 100 },
    token,
  );
  return (result.items ?? [])
    .filter((item) => item.type === "file")
    .map((item) => ({
      fileId: item.file_id,
      name: item.name,
      size: Number(item.size) || 0,
      updatedAt: item.updated_at ?? "",
    }));
};

const getDownloadUrl = async (ref: ShareRef, password: string, file: PdsFile): Promise<PdsDownload> => {
  const token = await getShareToken(ref, password);
  const result = await callPds<{
    url?: string;
    expiration?: string;
    size?: number;
    content_hash?: string;
    content_hash_name?: string;
  }>(
    ref.apiBase,
    "/v2/file/get_download_url",
    // 上限是 115200（32 小时）。这里只要够一次下载即可 —— 地址活得越久，
    // 被转贴到别处、绕开我们这一层的窗口就越大。
    { share_id: ref.shareId, file_id: file.fileId, expire_sec: 3600 },
    token,
  );
  if (!result.url) throw new Error("PDS 未返回下载地址");
  const expiration = result.expiration ? Date.parse(result.expiration) : NaN;
  return {
    url: result.url,
    name: file.name,
    size: Number(result.size) || file.size,
    expiresAt: Number.isFinite(expiration) ? expiration : Date.now() + 3600_000,
    contentHash: (result.content_hash ?? "").toLowerCase(),
    contentHashName: (result.content_hash_name ?? "").toLowerCase(),
  };
};

/** 从分享里挑出桌面端安装包：只认 .exe，同名多个时取最后更新的那个 */
export const pickInstaller = (files: PdsFile[]): PdsFile | null => {
  const candidates = files.filter((file) => /\.exe$/i.test(file.name));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];
};

// 解析结果整体缓存一小段时间：下载页与下载跳转是连着点的，没必要为同一次
// 用户操作把三个 PDS 接口各打一遍。缓存必须短于地址本身的有效期。
let downloadCache: { value: PdsDownload; expiresAt: number } | null = null;
let inFlight: Promise<PdsDownload> | null = null;

const CACHE_MS = 10 * 60 * 1000;

/**
 * 取桌面端安装包的当前下载地址。失败时抛错，调用方决定怎么降级。
 * 并发请求共用同一次解析（inFlight），避免下载高峰把 PDS 打满。
 */
export const resolveDesktopDownload = async (): Promise<PdsDownload> => {
  if (downloadCache && downloadCache.expiresAt > Date.now()) return downloadCache.value;
  if (inFlight) return inFlight;

  const ref = parseShareUrl(config.desktopPdsShareUrl);
  if (!ref) throw new Error("未配置有效的 PDS 分享链接");

  inFlight = (async () => {
    const files = await listShareFiles(ref, config.desktopPdsSharePassword);
    const installer = pickInstaller(files);
    if (!installer) throw new Error("PDS 分享里没有找到 .exe 安装包");
    const download = await getDownloadUrl(ref, config.desktopPdsSharePassword, installer);
    downloadCache = {
      value: download,
      // 地址快过期时不再复用缓存
      expiresAt: Math.min(Date.now() + CACHE_MS, download.expiresAt - 60_000),
    };
    return download;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

/** 配置了 PDS 分享就返回 true，站点据此决定是走直链还是老的网盘提取码 */
export const hasPdsShare = (): boolean => parseShareUrl(config.desktopPdsShareUrl) !== null;
