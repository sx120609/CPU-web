import type { RequestHandler } from "express";
import { hasAndroidPdsShare, resolveAndroidDownload, type PdsDownload } from "../services/pdsShare";
import {
  androidPatchFrom,
  androidReleaseFor,
  betaAndroidRelease,
  parseAndroidChannel,
  publishedAndroidRelease,
  type AndroidChannel,
  type AndroidRelease,
} from "../services/androidRelease";
import { getAndroidUpdateRequirement } from "../services/androidUpdateRequirement";

export const LEGACY_ANDROID_DOWNLOAD_PATH = /^\/downloads\/CPU-Web-(?:Android-)?V\d+\.apk$/i;

type DownloadDependencies = {
  hasShare: () => boolean;
  resolveDownload: (fileName: string) => Promise<PdsDownload>;
  releaseFor?: (channel: AndroidChannel) => { release: AndroidRelease; channel: AndroidChannel };
};

const defaultDependencies: DownloadDependencies = {
  hasShare: hasAndroidPdsShare,
  resolveDownload: (fileName) => resolveAndroidDownload(fileName),
  releaseFor: (channel) => androidReleaseFor(channel),
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

/** `?channel=beta` downloads the 药大拾间 NEXT build while one is newer than the release. */
export function createAndroidDownloadHandler(dependencies: DownloadDependencies = defaultDependencies): RequestHandler {
  const releaseFor = dependencies.releaseFor ?? defaultDependencies.releaseFor!;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { release } = releaseFor(parseAndroidChannel(req.query?.channel));
    await redirectToEnterpriseFile(res, dependencies, release.fileName, release.size);
  };
}

export const androidDownloadHandler = createAndroidDownloadHandler();

/** An incremental update from `?from=<versionCode>` to the channel's release, also from the enterprise drive. */
export function createAndroidPatchHandler(dependencies: DownloadDependencies = defaultDependencies): RequestHandler {
  const releaseFor = dependencies.releaseFor ?? defaultDependencies.releaseFor!;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { release } = releaseFor(parseAndroidChannel(req.query?.channel));
    const from = Number(req.query?.from);
    const patch = Number.isSafeInteger(from) ? androidPatchFrom(release, from) : null;
    if (!patch) {
      res.status(404).json({ code: 404, data: null, message: "没有适用于该版本的增量包" });
      return;
    }
    await redirectToEnterpriseFile(res, dependencies, patch.fileName, patch.size);
  };
}

export const androidPatchHandler = createAndroidPatchHandler();

export function createAndroidReleaseHandler(
  readRequirement = getAndroidUpdateRequirement,
  releaseFor: (channel: AndroidChannel) => { release: AndroidRelease; channel: AndroidChannel } = (channel) => androidReleaseFor(channel),
  beta: AndroidRelease = betaAndroidRelease,
  stable: AndroidRelease = publishedAndroidRelease,
): RequestHandler {
  return async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const updateRequirement = await readRequirement();
      const served = releaseFor(parseAndroidChannel(req.query?.channel));
      const from = Number(req.query?.from);
      const patch = Number.isSafeInteger(from) && from > 0 ? androidPatchFrom(served.release, from) : null;
      const query = served.channel === "beta" ? "?channel=beta" : "";
      const { patches: _patches, ...release } = served.release;
      res.json({ code: 0, data: {
        ...release,
        notes: served.release.notes ?? [],
        channel: served.channel,
        downloadUrl: `/api/site/downloads/android-app${query}`,
        patch: patch ? {
          ...patch,
          url: `/api/site/downloads/android-patch?channel=${served.channel}&from=${patch.fromVersionCode}`,
        } : null,
        // An invitation for stable devices while a NEXT build is out.
        beta: beta.versionCode > stable.versionCode
          ? { versionCode: beta.versionCode, versionName: beta.versionName, notes: beta.notes ?? [] }
          : null,
        updateRequirement, serverTime: new Date().toISOString(),
      }, message: "" });
    } catch (error) { next(error); }
  };
}

export const androidReleaseHandler = createAndroidReleaseHandler();
