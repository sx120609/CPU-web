import { Router, type Request } from "express";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { androidClientHeartbeatSchema, androidClientMetricsSchema, recordAndroidClientHeartbeat, recordAndroidClientMetrics } from "../services/androidClientStats";
import { desktopInstallReportSchema, recordDesktopInstallReport } from "../services/desktopInstallReports";
import { harmonyClientHeartbeatSchema, recordHarmonyClientHeartbeat } from "../services/harmonyClientStats";
import { getHarmonyAppUpdateStatus } from "../services/harmonyAppUpdate";
import { getIosAppUpdateStatus, isMarketingVersion } from "../services/iosAppUpdate";
import { iosClientHeartbeatSchema, iosClientMetricsSchema, recordIosClientHeartbeat, recordIosClientMetrics } from "../services/iosClientStats";
import { Errors, ok } from "../utils/response";

export const appClientRouter = Router();

// 按安装计数，不按 IP：校园网整栋楼共用一个出口，按 IP 会让多数设备的心跳被拒。
const byInstall = (req: Request) => {
  const installId = req.body?.installId;
  return typeof installId === "string" && /^[0-9a-f-]{36}$/i.test(installId) ? `install\0${installId.toLowerCase()}` : undefined;
};

// Anonymous launches are counted too; a session only links the install to its account.
appClientRouter.post("/ios/heartbeat", securityRateLimit("ios-client-heartbeat", 30, 60_000, byInstall), async (req, res, next) => {
  const parsed = iosClientHeartbeatSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("客户端信息格式不正确"));
  try {
    await recordIosClientHeartbeat(parsed.data, req.user?.userId ?? null);
    ok(res, { recorded: true });
  } catch (error) {
    next(error);
  }
});

// Whether the iOS app is behind the App Store. Newer builds pass their own
// version, which works signed out too; for older builds the signed-in
// account's latest install stands in, and guests simply get no prompt (a 401
// would read as an expired session).
appClientRouter.get("/ios/update", async (req, res, next) => {
  const reported = isMarketingVersion(req.query.version) ? req.query.version : null;
  if (!reported && !req.user) return ok(res, { updateAvailable: false });
  try {
    ok(res, await getIosAppUpdateStatus(req.user?.userId ?? null, reported));
  } catch (error) {
    next(error);
  }
});

// Whether a HarmonyOS app with this version code is behind AppGallery. The
// shell's version code is in its user agent, so guests are told as well.
appClientRouter.get("/harmony/update", async (req, res, next) => {
  const versionCode = Number(req.query.versionCode);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) return ok(res, { updateAvailable: false });
  try {
    ok(res, await getHarmonyAppUpdateStatus(versionCode));
  } catch (error) {
    next(error);
  }
});

// MetricKit performance reports and crash / hang diagnostics. Idempotent, so
// the client may retry a batch until it is acknowledged.
appClientRouter.post("/ios/metrics", securityRateLimit("ios-client-metrics", 20, 60_000, byInstall), async (req, res, next) => {
  const parsed = iosClientMetricsSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("诊断数据格式不正确"));
  try {
    ok(res, await recordIosClientMetrics(parsed.data));
  } catch (error) {
    next(error);
  }
});

// The native Android shell: same contract as the iOS heartbeat above.
appClientRouter.post("/android/heartbeat", securityRateLimit("android-client-heartbeat", 30, 60_000, byInstall), async (req, res, next) => {
  const parsed = androidClientHeartbeatSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("客户端信息格式不正确"));
  try {
    await recordAndroidClientHeartbeat(parsed.data, req.user?.userId ?? null);
    ok(res, { recorded: true });
  } catch (error) {
    next(error);
  }
});

// Daily launch / exit-reason summaries and crash / ANR stack traces. Idempotent,
// so the client may retry a batch until it is acknowledged.
appClientRouter.post("/android/metrics", securityRateLimit("android-client-metrics", 20, 60_000, byInstall), async (req, res, next) => {
  const parsed = androidClientMetricsSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("诊断数据格式不正确"));
  try {
    ok(res, await recordAndroidClientMetrics(parsed.data));
  } catch (error) {
    next(error);
  }
});

// The native HarmonyOS shell: same contract as the heartbeats above.
appClientRouter.post("/harmony/heartbeat", securityRateLimit("harmony-client-heartbeat", 30, 60_000, byInstall), async (req, res, next) => {
  const parsed = harmonyClientHeartbeatSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("客户端信息格式不正确"));
  try {
    await recordHarmonyClientHeartbeat(parsed.data, req.user?.userId ?? null);
    ok(res, { recorded: true });
  } catch (error) {
    next(error);
  }
});

// Windows installer outcomes: failures, and installs that only succeeded after
// retries or an elevated retry. Anonymous; the session is ignored on purpose.
appClientRouter.post("/desktop/install-report", securityRateLimit("desktop-install-report", 10, 60_000), async (req, res, next) => {
  const parsed = desktopInstallReportSchema.safeParse(req.body);
  if (!parsed.success) return next(Errors.badRequest("安装报告格式不正确"));
  try {
    await recordDesktopInstallReport(parsed.data);
    ok(res, { recorded: true });
  } catch (error) {
    next(error);
  }
});
