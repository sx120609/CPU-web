import type { NextFunction, Request, Response } from "express";
import { isDev } from "../config";

export const WEB_STATIC_COS_ORIGIN = "https://cputime-1462084442.cos.ap-shanghai.myqcloud.com";
export const WEB_STATIC_CDN_ORIGIN = "https://img.cputime.cn";
export const WEB_STATIC_OSS_ORIGIN = "https://cputime-static-20260901.oss-cn-shanghai.aliyuncs.com";
export const WEB_STATIC_ESA_ORIGIN = "https://static.cputime.cn";
const WEB_STATIC_ORIGINS = `${WEB_STATIC_ESA_ORIGIN} ${WEB_STATIC_OSS_ORIGIN} ${WEB_STATIC_CDN_ORIGIN} ${WEB_STATIC_COS_ORIGIN}`;

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src 'self' ${WEB_STATIC_ORIGINS}`,
  `style-src 'self' 'unsafe-inline' ${WEB_STATIC_ORIGINS}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data: ${WEB_STATIC_ORIGINS}`,
  "connect-src 'self' https: wss:",
  "media-src 'self' blob: https:",
  `worker-src 'self' blob: ${WEB_STATIC_ORIGINS}`,
  "frame-src 'self' https:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types default dompurify vue",
  "report-uri /api/security/csp-report",
  ...(!isDev ? ["upgrade-insecure-requests"] : []),
];

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Content-Security-Policy", CSP_DIRECTIVES.join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  );
  if (!isDev) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

function safeReportUrl(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 500);
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 500);
  }
}

export function receiveCspReport(req: Request, res: Response) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const report = body["csp-report"] && typeof body["csp-report"] === "object"
    ? body["csp-report"]
    : body;
  console.warn("[security:csp]", {
    directive: String(report["violated-directive"] || report.effectiveDirective || "").slice(0, 120),
    document: safeReportUrl(report["document-uri"] || report.documentURL),
    blocked: safeReportUrl(report["blocked-uri"] || report.blockedURL),
  });
  res.status(204).end();
}
