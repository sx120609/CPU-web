import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Request, Response } from "express";
import { config } from "../config";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import type { WorkshopManifest } from "./workshopPackage";
import {
  canManageWorkshop,
  isWorkshopPublished,
  isWorkshopTicketCurrent,
  type WorkshopRuntimeTicket,
  type WorkshopViewer,
} from "./workshopPolicy";

const ticketSchema = z
  .object({
    kind: z.enum(["public", "preview"]),
    workId: z.string().uuid(),
    versionId: z.string().uuid(),
    workRevision: z.number().int().nonnegative(),
    versionRevision: z.number().int().nonnegative(),
    viewerId: z.number().int().positive().optional(),
    expires: z.number().int().positive(),
    frameOrigins: z.array(z.string().max(300)).min(1).max(20),
    // Where the work is served from. Absent on tickets issued before this field existed.
    origin: z.string().max(300).optional(),
  })
  .strict();
type Ticket = z.infer<typeof ticketSchema>;

function origin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Errors.badRequest("工坊运行域名配置无效");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw Errors.badRequest("工坊运行域名必须是 http(s) origin");
  }
  return url.origin;
}
/**
 * Without a dedicated runtime origin the work is served by the main site, so
 * its public address is the page that asked for the ticket. The request's own
 * protocol and Host are the last resort: behind a reverse proxy that does not
 * forward them they read `http://127.0.0.1:<port>`, an address the main page's
 * `frame-src` blocks.
 */
export function workshopRuntimeOrigin(req: Request) {
  const configured = process.env.WORKSHOP_RUNTIME_ORIGIN?.trim();
  if (configured) return origin(configured);
  const requested = req.get("origin");
  if (requested && requested !== "null") {
    const page = origin(requested);
    if (frameOrigins(req).includes(page)) return page;
  }
  const main = process.env.WORKSHOP_MAIN_ORIGIN?.trim();
  if (main) return origin(main);
  if (config.nodeEnv === "production" && config.corsAllowedOrigins.length)
    return origin(config.corsAllowedOrigins[0]);
  return origin(`${req.protocol}://${req.get("host")}`);
}
function configuredFrameOrigins(req: Request) {
  const allowed = config.corsAllowedOrigins.map((item) => origin(item));
  const main = process.env.WORKSHOP_MAIN_ORIGIN?.trim();
  if (main) allowed.push(origin(main));
  if (config.nodeEnv !== "production") allowed.push(origin(`${req.protocol}://${req.get("host")}`));
  return allowed;
}
function frameOrigins(req: Request) {
  const allowed = configuredFrameOrigins(req);
  const requested = req.get("origin");
  if (config.nodeEnv !== "production" && requested && requested !== "null")
    allowed.push(origin(requested));
  if (!allowed.length) throw Errors.server("请配置工坊主站域名 WORKSHOP_MAIN_ORIGIN");
  if (requested && requested !== "null" && !allowed.includes(origin(requested)))
    throw Errors.forbidden("工坊请求来自未授权的主站");
  return [...new Set(allowed)].slice(0, 20);
}
function signature(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(`cpu-workshop-runtime-v1:${encoded}`).digest();
}
export function signWorkshopTicket(ticket: Ticket, secret = config.jwtSecret) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
export function verifyWorkshopTicket(
  value: string,
  secret = config.jwtSecret,
  now = Date.now(),
): Ticket {
  if (value.length > 5000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
    throw Errors.forbidden("运行链接无效或已过期");
  const [payload, mac] = value.split(".");
  const expected = signature(payload, secret);
  const actual = Buffer.from(mac, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw Errors.forbidden("运行链接无效或已过期");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw Errors.forbidden("运行链接无效或已过期");
  }
  const result = ticketSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.expires <= now ||
    [...result.data.frameOrigins, ...(result.data.origin ? [result.data.origin] : [])].some((item) => {
      try {
        return origin(item) !== item;
      } catch {
        return true;
      }
    })
  )
    throw Errors.forbidden("运行链接无效或已过期");
  return result.data;
}

export async function issueWorkshopRuntime(
  req: Request,
  options: { workId?: string; versionId?: string; kind: "public" | "preview" },
  viewer?: WorkshopViewer,
) {
  let version;
  if (options.kind === "public") {
    const work = await prisma.workshopWork.findUnique({
      where: { id: options.workId! },
      include: { publishedVersion: { include: { work: true } } },
    });
    if (!work || !isWorkshopPublished(work, work.publishedVersion))
      throw Errors.notFound("作品尚未公开或已下架");
    version = work.publishedVersion!;
  } else {
    version = await prisma.workshopVersion.findUnique({
      where: { id: options.versionId! },
      include: { work: true },
    });
    if (!version || !canManageWorkshop(version.work, viewer))
      throw Errors.notFound("作品版本不存在或无权预览");
    if (version.work.disabled) throw Errors.forbidden("作品已被停用");
  }
  const expires = Date.now() + (options.kind === "preview" ? 30 : 120) * 60 * 1000;
  const runtimeOrigin = workshopRuntimeOrigin(req);
  const ticket = signWorkshopTicket({
    kind: options.kind,
    workId: version.workId,
    versionId: version.id,
    workRevision: version.work.runtimeRevision,
    versionRevision: version.runtimeRevision,
    ...(options.kind === "preview" ? { viewerId: viewer!.userId } : {}),
    expires,
    frameOrigins: frameOrigins(req),
    origin: runtimeOrigin,
  });
  const manifest = version.manifest as unknown as WorkshopManifest;
  const entry = manifest.entry.split("/").map(encodeURIComponent).join("/");
  return {
    url: `${runtimeOrigin}/api/workshop-runtime/${ticket}/${entry}`,
    expiresAt: new Date(expires).toISOString(),
    versionId: version.id,
  };
}

export async function loadWorkshopRuntime(value: string) {
  const ticket = verifyWorkshopTicket(value);
  const version = await prisma.workshopVersion.findUnique({
    where: { id: ticket.versionId },
    include: { work: true },
  });
  if (!version) throw Errors.notFound("作品版本不存在");
  let viewer: WorkshopViewer | undefined;
  if (ticket.kind === "preview") {
    const user = await prisma.user.findUnique({
      where: { id: ticket.viewerId },
      select: { id: true, role: true, status: true },
    });
    if (user && !["banned", "deleting", "deleted"].includes(user.status))
      viewer = { userId: user.id, role: user.role };
  }
  if (!isWorkshopTicketCurrent(ticket, version.work, version, viewer))
    throw Errors.forbidden("运行链接已撤销，请重新打开作品");
  return { ticket, version };
}

export function workshopRuntimeHeaders(
  req: Request,
  res: Response,
  ticket: Pick<Ticket, "frameOrigins" | "origin">,
  encoded: string,
) {
  // The sandboxed document has an opaque origin, so 'self' matches nothing: name the work's own files.
  const own = `${ticket.origin ?? workshopRuntimeOrigin(req)}/api/workshop-runtime/${encoded}/`;
  const csp = [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline' 'wasm-unsafe-eval' ${own}`,
    `style-src 'unsafe-inline' ${own}`,
    `img-src data: ${own}`,
    `media-src data: ${own}`,
    `font-src data: ${own}`,
    `connect-src ${own}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ticket.frameOrigins.join(" ")}`,
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Access-Control-Allow-Credentials");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), gyroscope=(), magnetometer=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=(), fullscreen=()",
  );
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * A failed entry document still loads inside the work's iframe. The site-wide
 * headers forbid framing, so the browser would replace it with its own
 * "content blocked" page and hide the reason. Send a static, script-free page
 * that the main site may frame instead.
 */
export function sendWorkshopRuntimeErrorPage(
  req: Request,
  res: Response,
  status: number,
  message: string,
) {
  let ancestors: string[] = [];
  try {
    ancestors = [...new Set(configuredFrameOrigins(req))].slice(0, 20);
    // The dev client's origin is only known when the ticket is issued.
    if (config.nodeEnv !== "production") ancestors.push("http://localhost:*", "http://127.0.0.1:*");
  } catch {
    // A misconfigured origin keeps the page unframeable, as before.
  }
  res.setHeader(
    "Content-Security-Policy",
    [
      "sandbox",
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${ancestors.length ? ancestors.join(" ") : "'none'"}`,
    ].join("; "),
  );
  if (ancestors.length) res.removeHeader("X-Frame-Options");
  res.removeHeader("Access-Control-Allow-Credentials");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(status).send(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>作品无法打开</title>` +
      `<style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px/1.6 system-ui,sans-serif}main{padding:24px;text-align:center}h1{margin:0 0 8px;font-size:16px}p{margin:0;opacity:.7}</style>` +
      `<main><h1>${escapeHtml(message)}</h1><p>请关闭作品后重新打开。</p></main></html>`,
  );
}

export type { WorkshopRuntimeTicket };
