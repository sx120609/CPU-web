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
  /**
   * 不带 Content-Disposition: attachment 的临时文件地址。除图片预览外，PDS
   * 禁止 APK 调用 get_download_url 时也可直接使用；文件字节仍由阿里云返回。
   */
  viewUrl?: string;
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

export type PdsEntry = {
  file_id: string;
  name: string;
  type: string;
  size?: number;
  updated_at?: string;
  url?: string;
};

/** 从标准桌面安装包文件名中提取版本号，供更新接口自动下发。 */
export function parseDesktopVersionFromFileName(fileName: string): string {
  return /-([0-9]+(?:\.[0-9]+){1,3})-(?:win|mac(?:os)?)(?:-|_)/i.exec(fileName)?.[1] ?? "";
}

/** 综测填表工具的发布包只认固定命名，避免把分享目录里的其他 ZIP 当成更新。 */
export function parseAssessmentToolVersionFromFileName(fileName: string): string {
  return /^(?:药大拾间-)?综测填表工具-v([0-9]+(?:\.[0-9]+)*)\.zip$/i.exec(fileName)?.[1] ?? "";
}

const compareDesktopVersions = (left: string, right: string): number => {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const compareInstallerCandidates = (left: PdsFile, right: PdsFile): number => {
  const leftVersion = parseDesktopVersionFromFileName(left.name);
  const rightVersion = parseDesktopVersionFromFileName(right.name);
  if (leftVersion && rightVersion) {
    const versionDiff = compareDesktopVersions(rightVersion, leftVersion);
    if (versionDiff !== 0) return versionDiff;
  } else if (leftVersion !== rightVersion) {
    return leftVersion ? -1 : 1;
  }

  const updatedDiff = (right.updatedAt || "").localeCompare(left.updatedAt || "");
  return updatedDiff || left.name.localeCompare(right.name);
};

type ListResponse = {
  items?: PdsEntry[];
  next_marker?: string;
};

const MAX_SHARE_FOLDERS = 100;
const MAX_SHARE_ENTRIES = 1000;

/**
 * 分享根目录可以直接放文件，也可以只分享一个长期不变的文件夹。
 * 队列遍历带数量上限与去重，避免异常目录结构把一次下载请求拖成无界扫描。
 */
export const walkShareTree = async (
  listChildren: (parentFileId: string) => Promise<PdsEntry[]>,
): Promise<PdsFile[]> => {
  const queue = ["root"];
  const visited = new Set<string>();
  const files: PdsFile[] = [];
  let seenEntries = 0;

  while (queue.length > 0) {
    const parentFileId = queue.shift()!;
    if (visited.has(parentFileId)) continue;
    visited.add(parentFileId);
    if (visited.size > MAX_SHARE_FOLDERS) throw new Error("PDS 分享文件夹数量过多");

    const entries = await listChildren(parentFileId);
    seenEntries += entries.length;
    if (seenEntries > MAX_SHARE_ENTRIES) throw new Error("PDS 分享内容过多");

    for (const item of entries) {
      if (item.type === "folder") {
        if (item.file_id && !visited.has(item.file_id)) queue.push(item.file_id);
        continue;
      }
      if (item.type !== "file") continue;
      files.push({
        fileId: item.file_id,
        name: item.name,
        size: Number(item.size) || 0,
        updatedAt: item.updated_at ?? "",
        viewUrl: item.url ?? "",
      });
    }
  }
  return files;
};

export const listShareFiles = async (ref: ShareRef, password: string): Promise<PdsFile[]> => {
  const token = await getShareToken(ref, password);
  return walkShareTree(async (parentFileId) => {
    const entries: PdsEntry[] = [];
    let marker = "";
    do {
      const result = await callPds<ListResponse>(
        ref.apiBase,
        "/v2/file/list",
        {
          share_id: ref.shareId,
          parent_file_id: parentFileId,
          limit: 100,
          ...(marker ? { marker } : {}),
        },
        token,
      );
      entries.push(...(result.items ?? []));
      marker = String(result.next_marker ?? "").trim();
    } while (marker);
    return entries;
  });
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

/** 从分享里挑出 Windows 安装包：只认 .exe，同名多个时取最后更新的那个 */
export const pickInstaller = (files: PdsFile[]): PdsFile | null => {
  const candidates = files.filter((file) => /\.exe$/i.test(file.name));
  if (candidates.length === 0) return null;
  return candidates.sort(compareInstallerCandidates)[0];
};

/** macOS 只发布 Apple Silicon 版；优先 DMG，不把通用 ZIP 误当成给小白的主下载。 */
export const pickMacInstaller = (files: PdsFile[]): PdsFile | null => {
  const candidates = files.filter((file) =>
    /(?:mac|macos)[-_]?arm64.*\.dmg$/i.test(file.name)
    || /\.dmg$/i.test(file.name)
  );
  if (candidates.length === 0) return null;
  return candidates.sort(compareInstallerCandidates)[0];
};

type AndroidApkCandidate = {
  rank: number;
  version: number;
};

const parseAndroidApkCandidate = (fileName: string): AndroidApkCandidate | null => {
  const patterns = [
    { rank: 0, pattern: /^CPU-Web-Android-V(\d+)\.apk$/i },
    { rank: 1, pattern: /^CPU-Web-V(\d+)\.apk$/i },
  ];
  for (const { rank, pattern } of patterns) {
    const match = pattern.exec(fileName);
    if (match) {
      return {
        rank,
        version: Number(match[1]) || 0,
      };
    }
  }
  return null;
};

const compareAndroidInstallerCandidates = (left: PdsFile, right: PdsFile): number => {
  const leftCandidate = parseAndroidApkCandidate(left.name);
  const rightCandidate = parseAndroidApkCandidate(right.name);
  if (leftCandidate && rightCandidate) {
    if (leftCandidate.rank !== rightCandidate.rank) {
      return leftCandidate.rank - rightCandidate.rank;
    }
    const versionDiff = rightCandidate.version - leftCandidate.version;
    if (versionDiff !== 0) return versionDiff;
  } else if (leftCandidate !== rightCandidate) {
    return leftCandidate ? -1 : 1;
  }

  const updatedDiff = (right.updatedAt || "").localeCompare(left.updatedAt || "");
  return updatedDiff || left.name.localeCompare(right.name);
};

/** 从分享里挑出 Android 安装包：优先 `CPU-Web-Android-V*.apk`，再回退旧包。 */
export const pickAndroidInstaller = (files: PdsFile[]): PdsFile | null => {
  const candidates = files.filter((file) => /\.apk$/i.test(file.name));
  if (candidates.length === 0) return null;
  return candidates.sort(compareAndroidInstallerCandidates)[0];
};

export const pickAssessmentToolPackage = (files: PdsFile[]): PdsFile | null => {
  const candidates = files.filter((file) => Boolean(parseAssessmentToolVersionFromFileName(file.name)));
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => {
    const versionDiff = compareDesktopVersions(
      parseAssessmentToolVersionFromFileName(right.name),
      parseAssessmentToolVersionFromFileName(left.name),
    );
    if (versionDiff !== 0) return versionDiff;
    const updatedDiff = (right.updatedAt || "").localeCompare(left.updatedAt || "");
    return updatedDiff || left.name.localeCompare(right.name);
  })[0];
};

/**
 * 校园地图分享可能同时包含压缩预览与原图；按体积选择最大的常见图片文件，
 * 避免把缩略图误当作“下载原图”。
 */
export const pickCampusMapOriginal = (files: PdsFile[]): PdsFile | null => {
  const candidates = files.filter((file) => /\.(?:png|jpe?g|webp|tiff?)$/i.test(file.name));
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) =>
    right.size - left.size
    || (right.updatedAt || "").localeCompare(left.updatedAt || "")
    || left.name.localeCompare(right.name)
  )[0];
};

// 解析结果整体缓存一小段时间：下载页与下载跳转是连着点的，没必要为同一次
// 用户操作把三个 PDS 接口各打一遍。缓存必须短于地址本身的有效期。
type DownloadTarget = "windows" | "mac" | "android" | "assessment-form" | "campus-map" | "campus-map-view";
const downloadCache = new Map<string, { value: PdsDownload; expiresAt: number }>();
const inFlight = new Map<string, Promise<PdsDownload>>();

// 安装包上传后应尽快被旧客户端发现。这里只做短暂的并发削峰；
// 临时下载地址本身仍有一小时有效期，无需为了它把“最新版文件”缓存十分钟。
const CACHE_MS = 30 * 1000;
const getShareSettings = (target: DownloadTarget) => {
  if (target === "android") {
    return {
      shareUrl: config.androidAppPdsShareUrl,
      password: config.androidAppPdsSharePassword,
      pickInstaller: pickAndroidInstaller,
    };
  }
  if (target === "assessment-form") {
    return {
      shareUrl: config.assessmentToolPdsShareUrl,
      password: config.assessmentToolPdsSharePassword,
      pickInstaller: pickAssessmentToolPackage,
    };
  }
  if (target === "campus-map" || target === "campus-map-view") {
    return {
      shareUrl: config.campusMapPdsShareUrl,
      password: config.campusMapPdsSharePassword,
      pickInstaller: pickCampusMapOriginal,
    };
  }

  return {
    shareUrl: config.desktopPdsShareUrl,
    password: config.desktopPdsSharePassword,
    pickInstaller: target === "mac" ? pickMacInstaller : pickInstaller,
  };
};

/**
 * 取对应下载目标的当前地址。失败时抛错，调用方决定怎么降级。
 * 并发请求共用同一次解析（inFlight），避免下载高峰把 PDS 打满。
 */
const resolveTargetDownload = async (target: DownloadTarget, fileName?: string): Promise<PdsDownload> => {
  const cacheKey = `${target}:${fileName || "latest"}`;
  const cached = downloadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const { shareUrl, password, pickInstaller } = getShareSettings(target);
  const ref = parseShareUrl(shareUrl);
  if (!ref) throw new Error("未配置有效的 PDS 分享链接");

  const task = (async () => {
    const files = await listShareFiles(ref, password);
    const matching = fileName ? files.filter((file) => file.name === fileName) : [];
    if (fileName && matching.length !== 1) throw new Error("企业盘发布文件缺失或重名");
    const installer = fileName ? matching[0] : pickInstaller(files);
    if (!installer) {
      throw new Error(target === "android"
        ? "PDS share missing APK"
        : target === "mac"
          ? "PDS share missing DMG"
          : target === "campus-map" || target === "campus-map-view"
            ? "PDS share missing campus map image"
            : "PDS share missing EXE");
    }
    if (target === "campus-map-view" && !installer.viewUrl) {
      throw new Error("PDS share missing inline file URL");
    }
    const directViewTarget = target === "campus-map-view"
      || (target === "android" && Boolean(installer.viewUrl));
    const download = directViewTarget
      ? {
          url: installer.viewUrl!,
          name: installer.name,
        size: installer.size,
        expiresAt: Date.now() + 3600_000,
        contentHash: "",
        contentHashName: "",
      }
      : await getDownloadUrl(ref, password, installer);
    downloadCache.set(cacheKey, {
      value: download,
      expiresAt: Math.min(Date.now() + CACHE_MS, download.expiresAt - 60_000),
    });
    return download;
  })();
  inFlight.set(cacheKey, task);

  try {
    return await task;
  } finally {
    if (inFlight.get(cacheKey) === task) inFlight.delete(cacheKey);
  }
};

export const resolveDesktopDownload = (): Promise<PdsDownload> => resolveTargetDownload("windows");
export const resolveMacDesktopDownload = (): Promise<PdsDownload> => resolveTargetDownload("mac");
export const resolveAndroidDownload = (fileName?: string): Promise<PdsDownload> => resolveTargetDownload("android", fileName);
export const resolveAssessmentToolDownload = (): Promise<PdsDownload> => resolveTargetDownload("assessment-form");
export const resolveCampusMapDownload = (): Promise<PdsDownload> => resolveTargetDownload("campus-map");
export const resolveCampusMapView = (): Promise<PdsDownload> => resolveTargetDownload("campus-map-view");

export const hasPdsShare = (): boolean => parseShareUrl(config.desktopPdsShareUrl) !== null;
export const hasAndroidPdsShare = (): boolean => parseShareUrl(config.androidAppPdsShareUrl) !== null;
export const hasAssessmentToolPdsShare = (): boolean => parseShareUrl(config.assessmentToolPdsShareUrl) !== null;
export const hasCampusMapPdsShare = (): boolean => parseShareUrl(config.campusMapPdsShareUrl) !== null;
