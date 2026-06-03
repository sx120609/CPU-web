import { Router } from "express";
import { Readable } from "node:stream";
import { completeOneDriveChinaAuthorization } from "../services/oneDriveChina";
import { fetchCloudDriveRemoteFile, resolveCloudDriveStreamTarget } from "../services/cloudDrive";
import { setOneDriveChinaLastError } from "../services/storageConfig";

export const storageRouter = Router();

storageRouter.get("/onedrive-cn/callback", async (req, res) => {
  const oauthError = String(req.query.error || "").trim();
  const oauthErrorDescription = String(req.query.error_description || "").trim();
  if (oauthError) {
    const message = oauthErrorDescription || oauthError || "用户取消了世纪互联 OneDrive 授权";
    await setOneDriveChinaLastError(message).catch(() => null);
    res.redirect(302, `/admin?tab=media-storage&storageAuth=error&storageAuthMessage=${encodeURIComponent(message)}`);
    return;
  }

  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  if (!code || !state) {
    const message = "世纪互联 OneDrive 授权回调缺少 code 或 state";
    await setOneDriveChinaLastError(message).catch(() => null);
    res.redirect(302, `/admin?tab=media-storage&storageAuth=error&storageAuthMessage=${encodeURIComponent(message)}`);
    return;
  }

  try {
    await completeOneDriveChinaAuthorization({
      code,
      state,
      requestOrigin: requestOrigin(req),
    });
    res.redirect(302, "/admin?tab=media-storage&storageAuth=success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "世纪互联 OneDrive 授权失败";
    await setOneDriveChinaLastError(message).catch(() => null);
    res.redirect(302, `/admin?tab=media-storage&storageAuth=error&storageAuthMessage=${encodeURIComponent(message)}`);
  }
});

storageRouter.get("/cloud-drive/file", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) {
    res.status(400).send("缺少访问令牌");
    return;
  }

  try {
    const target = await resolveCloudDriveStreamTarget(token);
    if (!target) {
      res.status(404).send("文件不存在");
      return;
    }

    res.setHeader("Content-Disposition", `${target.disposition}; filename*=UTF-8''${encodeURIComponent(target.fileName)}`);
    if (target.backend === "local") {
      res.sendFile(target.absolutePath);
      return;
    }

    const upstream = await fetchCloudDriveRemoteFile(target.relativePath, req.headers.range, req.headers["if-none-match"]);
    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
      "cache-control",
    ];
    for (const header of passthroughHeaders) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.status(upstream.status);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取云盘文件失败";
    res.status(400).send(message);
  }
});

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}
