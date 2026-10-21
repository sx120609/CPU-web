import type { RequestHandler } from "express";

const paths = new Set([
  "/api/auth/sso-begin", "/api/auth/sso-login", "/api/live-activities/broadcast-config",
  "/api/jwxt/identity", "/api/jwxt/status", "/api/jwxt/schedule", "/api/jwxt/grades",
  "/api/jwxt/progress", "/api/jwxt/calendar", "/api/jwxt/schedule-widget-tokens/refresh",
]);

/** Fixed route labels and numeric aggregates only: never log URLs, payloads,
 * identities, upstream messages, tickets, cookies or credentials. */
export function createServiceDiagnostics(log: (line: string) => void = console.warn, now = Date.now) {
  const buckets = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  const flush = () => {
    if (!buckets.size) return;
    log("[service-diagnostics] " + JSON.stringify([...buckets].map(([key, value]) => ({
      key, count: value.count, meanMs: Math.round(value.totalMs / value.count), maxMs: value.maxMs,
    }))));
    buckets.clear();
  };
  const timer = setInterval(flush, 30000);
  timer.unref();
  const middleware: RequestHandler = (req, res, next) => {
    const route = req.path;
    if (!paths.has(route)) return next();
    const started = now();
    res.once("finish", () => {
      const duration = Math.max(0, Math.round(now() - started));
      const code = Number(res.locals.serviceErrorCode) || 0;
      const label = `${route}:${res.statusCode}:${code}`;
      const key = buckets.has(label) || buckets.size < 128 ? label : "overflow";
      const value = buckets.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
      value.count++; value.totalMs += duration; value.maxMs = Math.max(value.maxMs, duration);
      buckets.set(key, value);
    });
    next();
  };
  return { middleware, flush, stop() { clearInterval(timer); flush(); } };
}
