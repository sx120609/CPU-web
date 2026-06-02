import { Router } from "express";
import { completeOneDriveChinaAuthorization } from "../services/oneDriveChina";
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

function requestOrigin(req: any) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}
