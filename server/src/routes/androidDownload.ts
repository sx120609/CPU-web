import type { RequestHandler } from "express";
import { hasAndroidPdsShare, resolveAndroidDownload, type PdsDownload } from "../services/pdsShare";
import {
  androidPatchFrom,
  publishedAndroidNextRelease,
  publishedAndroidRelease,
  type AndroidRelease,
} from "../services/androidRelease";
import { getAndroidUpdateRequirement } from "../services/androidUpdateRequirement";
import { androidNextAccess, canSeeAndroidNext, isValidAndroidNextInvite, type AndroidNextAccess } from "../services/androidNextAccess";

export const LEGACY_ANDROID_DOWNLOAD_PATH = /^\/downloads\/CPU-Web-(?:Android-)?V\d+\.apk$/i;

type DownloadDependencies = {
  hasShare: () => boolean;
  resolveDownload: (fileName: string) => Promise<PdsDownload>;
};

const defaultDependencies: DownloadDependencies = {
  hasShare: hasAndroidPdsShare,
  resolveDownload: (fileName) => resolveAndroidDownload(fileName),
};

/** Redirect to one verified file of the enterprise drive; this server never carries the bytes. */
async function redirectToEnterpriseFile(
  res: Parameters<RequestHandler>[1],
  dependencies: DownloadDependencies,
  fileName: string,
  size: number,
) {
  if (!dependencies.hasShare()) {
    res.status(503).json({ code: 503, data: null, message: "安卓客户端企业盘下载暂未配置" });
    return;
  }
  try {
    const file = await dependencies.resolveDownload(fileName);
    if (file.name !== fileName || file.size !== size) throw new Error("企业盘文件与已验证发布清单不一致");
    res.redirect(302, file.url);
  } catch (error) {
    console.error("PDS Android 分享解析失败", error);
    res.status(503).json({ code: 503, data: null, message: "企业盘下载暂时不可用，请稍后重试" });
  }
}

const notPublished = (res: Parameters<RequestHandler>[1]) =>
  res.status(404).json({ code: 404, data: null, message: "药大拾间 NEXT 尚未发布或邀请链接无效" });

/** Invite-only NEXT stays invisible to anyone without the app or an invitation. */
const allowed = (req: Parameters<RequestHandler>[0], access: AndroidNextAccess) =>
  canSeeAndroidNext(access, { userAgent: req.get?.("user-agent") ?? "", invite: req.query?.invite });

export function createAndroidDownloadHandler(
  dependencies: DownloadDependencies = defaultDependencies,
  release: AndroidRelease = publishedAndroidRelease,
): RequestHandler {
  return async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await redirectToEnterpriseFile(res, dependencies, release.fileName, release.size);
  };
}

export const androidDownloadHandler = createAndroidDownloadHandler();

export function createAndroidReleaseHandler(
  readRequirement = getAndroidUpdateRequirement,
  next: AndroidRelease | null = publishedAndroidNextRelease,
  access: AndroidNextAccess = androidNextAccess,
): RequestHandler {
  return async (_req, res, next_) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const updateRequirement = await readRequirement();
      res.json({ code: 0, data: {
        ...publishedAndroidRelease, downloadUrl: "/api/site/downloads/android-app",
        // The separate 药大拾间 NEXT app, for the download page's card; invite-only builds are not advertised.
        next: next && access.mode === "public"
          ? { versionCode: next.versionCode, versionName: next.versionName, notes: next.notes ?? [] }
          : null,
        updateRequirement, serverTime: new Date().toISOString(),
      }, message: "" });
    } catch (error) { next_(error); }
  };
}

export const androidReleaseHandler = createAndroidReleaseHandler();

// region 药大拾间 NEXT

/** The NEXT release, with the incremental patch for `?from=<installed versionCode>` when one exists. */
export function createAndroidNextReleaseHandler(
  next: AndroidRelease | null = publishedAndroidNextRelease,
  access: AndroidNextAccess = androidNextAccess,
): RequestHandler {
  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!next || !allowed(req, access)) return notPublished(res);
    // The invitation page downloads with its own code; the app downloads as itself.
    const invite = isValidAndroidNextInvite(access, req.query?.invite) ? `?invite=${encodeURIComponent(req.query.invite.trim())}` : "";
    const from = Number(req.query?.from);
    const patch = Number.isSafeInteger(from) && from > 0 ? androidPatchFrom(next, from) : null;
    const { patches: _patches, ...release } = next;
    res.json({ code: 0, data: {
      ...release,
      notes: next.notes ?? [],
      downloadUrl: `/api/site/downloads/android-next-app${invite}`,
      patch: patch ? { ...patch, url: `/api/site/downloads/android-next-patch?from=${patch.fromVersionCode}` } : null,
      serverTime: new Date().toISOString(),
    }, message: "" });
  };
}

export function createAndroidNextDownloadHandler(
  dependencies: DownloadDependencies = defaultDependencies,
  next: AndroidRelease | null = publishedAndroidNextRelease,
  access: AndroidNextAccess = androidNextAccess,
): RequestHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!next || !allowed(req, access)) return notPublished(res);
    await redirectToEnterpriseFile(res, dependencies, next.fileName, next.size);
  };
}

/** An incremental NEXT update from `?from=<versionCode>`, also from the enterprise drive. */
export function createAndroidNextPatchHandler(
  dependencies: DownloadDependencies = defaultDependencies,
  next: AndroidRelease | null = publishedAndroidNextRelease,
  access: AndroidNextAccess = androidNextAccess,
): RequestHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!next || !allowed(req, access)) return notPublished(res);
    const from = Number(req.query?.from);
    const patch = Number.isSafeInteger(from) ? androidPatchFrom(next, from) : null;
    if (!patch) {
      res.status(404).json({ code: 404, data: null, message: "没有适用于该版本的增量包" });
      return;
    }
    await redirectToEnterpriseFile(res, dependencies, patch.fileName, patch.size);
  };
}

export const androidNextReleaseHandler = createAndroidNextReleaseHandler();
export const androidNextDownloadHandler = createAndroidNextDownloadHandler();
export const androidNextPatchHandler = createAndroidNextPatchHandler();

// endregion
