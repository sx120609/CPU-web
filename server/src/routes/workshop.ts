import path from "node:path";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, HttpError, ok } from "../utils/response";
import {
  extractWorkshopPackage,
  removeWorkshopPackage,
  safeWorkshopPath,
  workshopStorageRoot,
  WORKSHOP_MAX_ZIP_BYTES,
} from "../services/workshopPackage";
import {
  createWorkshopDraft,
  deleteWorkshopSave,
  favoriteWorkshopWork,
  getWorkshopWork,
  listWorkshopQueue,
  listWorkshopReports,
  listWorkshopAudits,
  resolveWorkshopReport,
  listWorkshopWorks,
  readWorkshopSave,
  listWorkshopSaves,
  reportWorkshopWork,
  reviewWorkshopVersion,
  setWorkshopWorkState,
  submitWorkshopVersion,
  writeWorkshopSave,
} from "../services/workshop";
import { assertWorkshopAdmin } from "../services/workshopPolicy";
import {
  issueWorkshopRuntime,
  loadWorkshopRuntime,
  workshopRuntimeHeaders,
} from "../services/workshopRuntime";

import {
  listWorkshopPlacements,
  setWorkshopPlacement,
  listWorkshopPublicCatalog,
} from "../services/workshopPlacements";

export const workshopRouter = Router();
export const workshopRuntimeRouter = Router();
workshopRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const idSchema = z.string().uuid("作品标识无效");
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  q: z.string().trim().max(100).optional(),
  type: z.enum(["game", "tool", "extension"]).optional(),
  favorites: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
});
const adminWorkPageSchema = pageSchema.extend({
  state: z.enum(["published", "unpublished", "disabled"]).optional(),
});
const adminReportPageSchema = pageSchema.extend({
  reportStatus: z.enum(["open", "resolved"]).optional(),
});
const auditPageSchema = pageSchema.pick({ page: true, pageSize: true });
const adminRequired: RequestHandler = (req, _res, next) => {
  try {
    assertWorkshopAdmin(req.user);
    next();
  } catch (error) {
    next(error);
  }
};
function route(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

workshopRouter.get(
  "/public/site",
  route((_req, res) => {
    ok(res, { name: "药大拾间", locale: "zh-CN" });
  }),
);
workshopRouter.get(
  "/public/catalog",
  route(async (req, res) => {
    ok(
      res,
      await listWorkshopPublicCatalog(
        pageSchema
          .omit({ favorites: true })
          .extend({ pageSize: z.coerce.number().int().min(1).max(12).default(12) })
          .parse(req.query),
      ),
    );
  }),
);
workshopRouter.get(
  "/placements",
  route(async (_req, res) => {
    ok(res, await listWorkshopPlacements());
  }),
);
workshopRouter.get(
  "/admin/placements",
  authRequired,
  adminRequired,
  route(async (req, res) => {
    ok(res, await listWorkshopPlacements(req.user!));
  }),
);
workshopRouter.put(
  "/admin/placements/:slot",
  authRequired,
  adminRequired,
  validate(z.object({ versionId: idSchema.nullable() }).strict()),
  route(async (req, res) => {
    ok(
      res,
      await setWorkshopPlacement(
        z.enum(["splash", "dialog"]).parse(req.params.slot),
        req.body.versionId,
        req.user!,
      ),
    );
  }),
);

// Admission happens before multer's in-memory allocation. Persistent account quotas live in the DB.
const buckets = new Map<string, { started: number; count: number }>();
function limit(action: string, count: number, windowMs: number): RequestHandler {
  return (req, _res, next) => {
    const now = Date.now();
    const key = `${action}:${req.user!.userId}`;
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.started >= windowMs) {
      bucket = { started: now, count: 0 };
      buckets.set(key, bucket);
    }
    if (buckets.size > 10000) {
      for (const [key, candidate] of buckets)
        if (now - candidate.started > 60 * 60 * 1000) buckets.delete(key);
      if (buckets.size > 20000) {
        next(new HttpError(429, 4029, "工坊暂时繁忙，请稍后重试"));
        return;
      }
    }
    bucket.count++;
    if (bucket.count > count) {
      next(new HttpError(429, 4029, "操作过于频繁，请稍后重试"));
      return;
    }
    next();
  };
}
let uploadsInFlight = 0;
const uploadAdmission: RequestHandler = (req, res, next) => {
  if (uploadsInFlight >= 4) {
    next(new HttpError(429, 4029, "作品包处理队列已满，请稍后重试"));
    return;
  }
  uploadsInFlight++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      uploadsInFlight--;
    }
  };
  res.locals.workshopUploadRelease = release;
  res.once("finish", release);
  res.once("close", () => {
    if (!req.complete) release();
  });
  next();
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WORKSHOP_MAX_ZIP_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 100 },
}).single("file");
const packageUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      next(
        Errors.badRequest(
          error.code === "LIMIT_FILE_SIZE"
            ? "ZIP 文件最多 20 MiB"
            : "请仅上传一个 file 字段的 ZIP 作品包",
        ),
      );
      return;
    }
    next();
  });
};

workshopRouter.get(
  "/works",
  authOptional,
  route(async (req, res) =>
    ok(res, await listWorkshopWorks(pageSchema.parse(req.query), req.user)),
  ),
);
workshopRouter.get(
  "/mine",
  authRequired,
  route(async (req, res) =>
    ok(res, await listWorkshopWorks(pageSchema.parse(req.query), req.user, "mine")),
  ),
);
workshopRouter.get(
  "/works/:id",
  authOptional,
  route(async (req, res) =>
    ok(res, await getWorkshopWork(idSchema.parse(req.params.id), req.user)),
  ),
);

workshopRouter.post(
  "/packages",
  authRequired,
  limit("upload", 6, 10 * 60 * 1000),
  uploadAdmission,
  packageUpload,
  route(async (req, res) => {
    if (!req.file) throw Errors.badRequest("请选择 ZIP 作品包");
    try {
      const fields = z.object({ expectedWorkId: idSchema.optional() }).strict().parse(req.body);
      const extracted = await extractWorkshopPackage(req.file.buffer);
      try {
        ok(res, await createWorkshopDraft({ ...extracted, ...fields }, req.user!));
      } catch (error) {
        await removeWorkshopPackage(extracted.packageKey);
        throw error;
      }
    } finally {
      res.locals.workshopUploadRelease?.();
    }
  }),
);
workshopRouter.post(
  "/versions/:id/submit",
  authRequired,
  limit("submit", 15, 10 * 60 * 1000),
  route(async (req, res) =>
    ok(res, await submitWorkshopVersion(idSchema.parse(req.params.id), req.user!)),
  ),
);
workshopRouter.post(
  "/versions/:id/preview",
  authRequired,
  limit("preview", 60, 10 * 60 * 1000),
  route(async (req, res) =>
    ok(
      res,
      await issueWorkshopRuntime(
        req,
        { versionId: idSchema.parse(req.params.id), kind: "preview" },
        req.user,
      ),
    ),
  ),
);
workshopRouter.post(
  "/works/:id/play",
  authOptional,
  route(async (req, res) =>
    ok(
      res,
      await issueWorkshopRuntime(
        req,
        { workId: idSchema.parse(req.params.id), kind: "public" },
        req.user,
      ),
    ),
  ),
);
workshopRouter.put(
  "/works/:id/favorite",
  authRequired,
  limit("favorite", 120, 10 * 60 * 1000),
  route(async (req, res) =>
    ok(res, await favoriteWorkshopWork(idSchema.parse(req.params.id), req.user!, true)),
  ),
);
workshopRouter.delete(
  "/works/:id/favorite",
  authRequired,
  limit("favorite", 120, 10 * 60 * 1000),
  route(async (req, res) =>
    ok(res, await favoriteWorkshopWork(idSchema.parse(req.params.id), req.user!, false)),
  ),
);
workshopRouter.post(
  "/works/:id/reports",
  authRequired,
  limit("report", 10, 60 * 60 * 1000),
  validate(z.object({ reason: z.string().trim().min(5).max(1000) }).strict()),
  route(async (req, res) =>
    ok(res, await reportWorkshopWork(idSchema.parse(req.params.id), req.body.reason, req.user!)),
  ),
);

workshopRouter.get(
  "/storage",
  authRequired,
  route(async (req, res) =>
    ok(res, await listWorkshopSaves(auditPageSchema.parse(req.query), req.user!)),
  ),
);
workshopRouter.get(
  "/works/:id/storage",
  authRequired,
  limit("storage-read", 300, 10 * 60 * 1000),
  route(async (req, res) =>
    ok(
      res,
      await readWorkshopSave(
        idSchema.parse(req.params.id),
        idSchema.parse(req.query.versionId),
        req.user!,
      ),
    ),
  ),
);
workshopRouter.put(
  "/works/:id/storage",
  authRequired,
  limit("storage-write", 120, 10 * 60 * 1000),
  validate(
    z
      .object({
        versionId: idSchema,
        data: z.unknown().refine((value) => value !== undefined, "存档数据不能为空"),
      })
      .strict(),
  ),
  route(async (req, res) =>
    ok(
      res,
      await writeWorkshopSave(
        idSchema.parse(req.params.id),
        req.body.versionId,
        req.body.data,
        req.user!,
      ),
    ),
  ),
);
workshopRouter.delete(
  "/works/:id/storage",
  authRequired,
  limit("storage-write", 120, 10 * 60 * 1000),
  route(async (req, res) =>
    ok(
      res,
      await deleteWorkshopSave(
        idSchema.parse(req.params.id),
        idSchema.optional().parse(req.query.versionId),
        req.user!,
      ),
    ),
  ),
);

workshopRouter.get(
  "/admin/works",
  authRequired,
  adminRequired,
  route(async (req, res) =>
    ok(res, await listWorkshopWorks(adminWorkPageSchema.parse(req.query), req.user, "admin")),
  ),
);
workshopRouter.get(
  "/admin/queue",
  authRequired,
  adminRequired,
  route(async (req, res) =>
    ok(res, await listWorkshopQueue(pageSchema.parse(req.query), req.user!)),
  ),
);
workshopRouter.get(
  "/admin/reports",
  authRequired,
  adminRequired,
  route(async (req, res) =>
    ok(res, await listWorkshopReports(adminReportPageSchema.parse(req.query), req.user!)),
  ),
);
workshopRouter.get(
  "/admin/works/:id/audits",
  authRequired,
  adminRequired,
  route(async (req, res) =>
    ok(res, await listWorkshopAudits(idSchema.parse(req.params.id), auditPageSchema.parse(req.query), req.user!)),
  ),
);
workshopRouter.post(
  "/admin/reports/:id/resolve",
  authRequired,
  adminRequired,
  validate(z.object({ resolution: z.string().trim().min(1).max(1000) }).strict()),
  route(async (req, res) =>
    ok(res, await resolveWorkshopReport(idSchema.parse(req.params.id), req.body.resolution, req.user!)),
  ),
);
workshopRouter.post(
  "/admin/versions/:id/review",
  authRequired,
  adminRequired,
  validate(
    z
      .object({
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(1000).optional(),
      })
      .strict()
      .refine(
        (value) => value.decision !== "reject" || Boolean(value.reason),
        "退回作品时请填写原因",
      ),
  ),
  route(async (req, res) =>
    ok(res, await reviewWorkshopVersion(idSchema.parse(req.params.id), req.body, req.user!)),
  ),
);
workshopRouter.post(
  "/admin/works/:id/state",
  authRequired,
  adminRequired,
  validate(z.object({ action: z.enum(["unpublish", "disable", "enable"]) }).strict()),
  route(async (req, res) =>
    ok(res, await setWorkshopWorkState(idSchema.parse(req.params.id), req.body.action, req.user!)),
  ),
);

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
// Mounted before browser-session middleware. It has no auth-cookie/JWT handling and serves only ticket-scoped files.
workshopRuntimeRouter.get(
  "/:ticket/*",
  route(async (req, res, next) => {
    const encoded = req.params.ticket;
    const { ticket, version } = await loadWorkshopRuntime(encoded);
    const asset = safeWorkshopPath(req.params[0]);
    if (!Array.isArray(version.files) || !version.files.includes(asset))
      throw Errors.notFound("作品资源不存在");
    if (!/^[a-f0-9-]{36}$/.test(version.packageKey)) throw Errors.notFound("作品包不存在");
    workshopRuntimeHeaders(req, res, ticket, encoded);
    res.setHeader(
      "Content-Type",
      `${mimeTypes[path.posix.extname(asset).toLowerCase()]}${/\.(?:html?|m?js|css|json|txt|svg|map)$/i.test(asset) ? "; charset=utf-8" : ""}`,
    );
    res.sendFile(
      asset,
      {
        root: path.join(workshopStorageRoot(), version.packageKey),
        dotfiles: "deny",
        cacheControl: false,
        lastModified: false,
        acceptRanges: false,
      },
      (error) => {
        if (error) {
          if (!res.headersSent) next(Errors.notFound("作品资源不存在"));
          else res.destroy();
        }
      },
    );
  }),
);
