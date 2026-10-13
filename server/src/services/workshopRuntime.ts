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
export function workshopRuntimeOrigin(req: Request) {
  const configured = process.env.WORKSHOP_RUNTIME_ORIGIN?.trim();
  return origin(configured || `${req.protocol}://${req.get("host")}`);
}
function frameOrigins(req: Request) {
  const allowed = config.corsAllowedOrigins.map((item) => origin(item));
  const main = process.env.WORKSHOP_MAIN_ORIGIN?.trim();
  if (main) allowed.push(origin(main));
  const requested = req.get("origin");
  if (config.nodeEnv !== "production") {
    allowed.push(origin(`${req.protocol}://${req.get("host")}`));
    if (requested && requested !== "null") allowed.push(origin(requested));
  }
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
    result.data.frameOrigins.some((item) => {
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
  const ticket = signWorkshopTicket({
    kind: options.kind,
    workId: version.workId,
    versionId: version.id,
    workRevision: version.work.runtimeRevision,
    versionRevision: version.runtimeRevision,
    ...(options.kind === "preview" ? { viewerId: viewer!.userId } : {}),
    expires,
    frameOrigins: frameOrigins(req),
  });
  const manifest = version.manifest as unknown as WorkshopManifest;
  const entry = manifest.entry.split("/").map(encodeURIComponent).join("/");
  return {
    url: `${workshopRuntimeOrigin(req)}/api/workshop-runtime/${ticket}/${entry}`,
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
  ticket: Pick<Ticket, "frameOrigins">,
  encoded: string,
) {
  const own = `${workshopRuntimeOrigin(req)}/api/workshop-runtime/${encoded}/`;
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

export type { WorkshopRuntimeTicket };
