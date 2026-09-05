import type { RequestHandler } from "express";
import { hasAndroidPdsShare, resolveAndroidDownload } from "../services/pdsShare";

export const LEGACY_ANDROID_DOWNLOAD_PATH = /^\/downloads\/CPU-Web-(?:Android-)?V\d+\.apk$/i;

export function createAndroidDownloadHandler(dependencies = {
  hasShare: hasAndroidPdsShare,
  resolveDownload: resolveAndroidDownload,
}): RequestHandler {
  return async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!dependencies.hasShare()) {
      res.status(503).json({ code: 503, data: null, message: "安卓客户端企业盘下载暂未配置" });
      return;
    }
    try {
      const file = await dependencies.resolveDownload();
      res.redirect(302, file.url);
    } catch (error) {
      console.error("PDS Android 分享解析失败", error);
      res.status(503).json({ code: 503, data: null, message: "企业盘下载暂时不可用，请稍后重试" });
    }
  };
}

export const androidDownloadHandler = createAndroidDownloadHandler();
