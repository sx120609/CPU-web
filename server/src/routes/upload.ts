import { Router } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import jwt from "jsonwebtoken";
import multer from "multer";
import { z } from "zod";
import { config } from "../config";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { registerForumImageAsset } from "../services/imageModeration";
import {
  buildUploadUrl,
  createRemoteMediaUploadSession,
  prepareMediaLocalFileForProcessing,
  resolveMediaLocalPathFromUploadUrl,
  saveMediaAsset,
} from "../services/mediaStorage";
import { registerForumVideoAsset } from "../services/videoModeration";
import { createVideoPosterAsset } from "../services/videoPoster";

export const uploadRouter = Router();

const imageSchema = z.object({
  image: z.string().min(1),
});

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_IMAGE_BYTES = 600 * 1024;
const MAX_MEDIA_BYTES = 120 * 1024 * 1024;
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_BYTES },
});

const mediaInitSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().max(200).optional().default(""),
  fileSize: z.number().int().positive().max(MAX_MEDIA_BYTES),
});

const mediaCompleteSchema = z.object({
  uploadToken: z.string().trim().min(1),
});

const VIDEO_MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
};

type MediaUploadTokenPayload = {
  kind: "forum-media-upload";
  userId: number;
  mediaKind: "image" | "video";
  relativePath: string;
  mimeType: string;
  fileSize: number;
  fileName: string;
};

uploadRouter.post("/images", authRequired, validate(imageSchema), async (req, res, next) => {
  try {
    const parsed = parseDataUrl(String(req.body.image || ""));
    if (!parsed) throw Errors.badRequest("图片数据无效");
    const ext = MIME_EXT[parsed.mime];
    if (!ext) throw Errors.badRequest("仅支持 JPG、PNG、WebP 图片");
    if (parsed.buffer.length > MAX_IMAGE_BYTES) throw Errors.badRequest("图片压缩后仍然过大");

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const relativeDir = path.join("forum", month);
    const filename = `${Date.now()}-${randomUUID()}.${ext}`;
    const saved = await saveMediaAsset({
      relativePath: path.posix.join(relativeDir.replace(/\\/g, "/"), filename),
      buffer: parsed.buffer,
      contentType: parsed.mime,
      mediaKind: "image",
    });
    await registerForumImageAsset({
      url: saved.url,
      localPath: saved.localPath,
      mimeType: parsed.mime,
      fileSize: parsed.buffer.length,
      createdById: req.user!.userId,
    }).catch(() => null);
    ok(res, { url: saved.url });
  } catch (e) {
    next(e);
  }
});

uploadRouter.post("/media/init", authRequired, validate(mediaInitSchema), async (req, res, next) => {
  try {
    const mimeType = normalizeMimeType(req.body.mimeType);
    const kind = resolveMediaKind(mimeType, req.body.fileName);
    if (!kind) throw Errors.badRequest("仅支持 JPG、PNG、WebP、GIF 图片或 MP4、WebM、MOV、M4V、MKV、OGV 视频");
    const ext = resolveUploadExtension(kind, mimeType, req.body.fileName);
    if (!ext) throw Errors.badRequest("当前文件格式暂不支持上传");

    const relativePath = buildForumMediaRelativePath(ext);
    const session = await createRemoteMediaUploadSession({
      relativePath,
      contentType: mimeType || undefined,
      mediaKind: kind,
    });
    if (!session) {
      ok(res, { mode: "proxy" as const, kind });
      return;
    }

    const uploadToken = jwt.sign({
      kind: "forum-media-upload",
      userId: req.user!.userId,
      mediaKind: kind,
      relativePath,
      mimeType,
      fileSize: req.body.fileSize,
      fileName: req.body.fileName,
    } satisfies MediaUploadTokenPayload, config.jwtSecret, { expiresIn: "3h" });

    ok(res, {
      mode: "direct" as const,
      kind,
      url: buildUploadUrl(relativePath),
      uploadUrl: session.uploadUrl,
      uploadToken,
      expiresAt: session.expiresAt,
      mimeType,
    });
  } catch (e) {
    next(e);
  }
});

uploadRouter.post("/media/complete", authRequired, validate(mediaCompleteSchema), async (req, res, next) => {
  try {
    const payload = verifyMediaUploadToken(req.body.uploadToken);
    if (payload.userId !== req.user!.userId) throw Errors.forbidden("上传会话与当前账号不匹配");
    const mimeType = normalizeMimeType(payload.mimeType);
    const url = buildUploadUrl(payload.relativePath);
    const localPath = resolveMediaLocalPathFromUploadUrl(url);
    const preparedFile = await prepareMediaLocalFileForProcessing(url);
    if (!preparedFile.localPath) {
      throw Errors.badRequest("文件还没上传完成，请稍后再试");
    }

    try {
      if (payload.mediaKind === "image") {
        await registerForumImageAsset({
          url,
          localPath,
          mimeType: mimeType || undefined,
          fileSize: payload.fileSize,
          createdById: req.user!.userId,
        }).catch(() => null);
        ok(res, {
          kind: payload.mediaKind,
          url,
          posterUrl: "",
          mimeType,
        });
        return;
      }

      await registerForumVideoAsset({
        url,
        localPath,
        mimeType: mimeType || undefined,
        fileSize: payload.fileSize,
        createdById: req.user!.userId,
      }).catch(() => null);

      let posterUrl = "";
      if (preparedFile.localPath) {
        posterUrl = await createVideoPosterAsset({
          videoLocalPath: preparedFile.localPath,
          videoRelativePath: payload.relativePath,
        }).catch(() => "");
      }

      ok(res, {
        kind: payload.mediaKind,
        url,
        posterUrl,
        mimeType,
      });
    } finally {
      if (preparedFile.temporary && preparedFile.localPath) {
        await rm(preparedFile.localPath, { force: true }).catch(() => null);
      }
    }
  } catch (e) {
    next(e);
  }
});

uploadRouter.post("/media", authRequired, (req, res, next) => {
  uploadMedia.single("file")(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") {
      return next(Errors.badRequest("上传内容过大，请换一个更小的文件"));
    }
    return next(error);
  });
}, async (req, res, next) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) throw Errors.badRequest("请先选择要上传的媒体文件");
    const mimeType = normalizeMimeType(file.mimetype);
    const kind = resolveMediaKind(mimeType, file.originalname);
    if (!kind) throw Errors.badRequest("仅支持 JPG、PNG、WebP、GIF 图片或 MP4、WebM、MOV、M4V、MKV、OGV 视频");

    const ext = resolveUploadExtension(kind, mimeType, file.originalname);
    if (!ext) throw Errors.badRequest("当前文件格式暂不支持上传");
    const relativePath = buildForumMediaRelativePath(ext);
    const saved = await saveMediaAsset({
      relativePath,
      buffer: file.buffer,
      contentType: mimeType || undefined,
      mediaKind: kind,
    });

    if (kind === "image") {
      await registerForumImageAsset({
        url: saved.url,
        localPath: saved.localPath,
        mimeType: mimeType || undefined,
        fileSize: file.size,
        createdById: req.user!.userId,
      }).catch(() => null);
      ok(res, {
        kind,
        url: saved.url,
        posterUrl: "",
        mimeType,
      });
      return;
    }

    await registerForumVideoAsset({
      url: saved.url,
      localPath: saved.localPath,
      mimeType: mimeType || undefined,
      fileSize: file.size,
      createdById: req.user!.userId,
    }).catch(() => null);
    const posterUrl = await createVideoPosterAsset({
      videoLocalPath: saved.localPath,
      videoRelativePath: saved.relativePath,
    }).catch(() => "");
    ok(res, {
      kind,
      url: saved.url,
      posterUrl,
      mimeType,
    });
  } catch (e) {
    next(e);
  }
});

function parseDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return { mime: match[1].toLowerCase(), buffer };
}

function verifyMediaUploadToken(token: string) {
  try {
    const payload = jwt.verify(String(token || ""), config.jwtSecret) as MediaUploadTokenPayload;
    if (payload.kind !== "forum-media-upload") throw Errors.badRequest("上传会话无效或已过期");
    return payload;
  } catch (error) {
    if ((error as any)?.status && (error as any)?.code) throw error;
    throw Errors.badRequest("上传会话无效或已过期");
  }
}

function buildForumMediaRelativePath(ext: string) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const relativeDir = path.join("forum", month);
  const baseName = `${Date.now()}-${randomUUID()}`;
  return path.posix.join(relativeDir.replace(/\\/g, "/"), `${baseName}.${ext}`);
}

function normalizeMimeType(mime: string | null | undefined) {
  return String(mime || "").trim().toLowerCase();
}

function resolveMediaKind(mime: string, originalName = "") {
  if (Object.prototype.hasOwnProperty.call(MIME_EXT, mime)) return "image" as const;
  if (Object.prototype.hasOwnProperty.call(VIDEO_MIME_EXT, mime)) return "video" as const;
  const ext = normalizeKnownExtension(originalName, ["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm", "ogv", "mov", "m4v", "mkv"]);
  if (["jpg", "png", "webp", "gif"].includes(ext)) return "image" as const;
  if (["mp4", "webm", "ogv", "mov", "m4v", "mkv"].includes(ext)) return "video" as const;
  return "";
}

function resolveUploadExtension(kind: "image" | "video", mime: string, originalName: string) {
  if (kind === "image") {
    return MIME_EXT[mime] || normalizeKnownExtension(originalName, ["jpg", "jpeg", "png", "webp", "gif"]);
  }
  return VIDEO_MIME_EXT[mime] || normalizeKnownExtension(originalName, ["mp4", "webm", "ogv", "mov", "m4v", "mkv"]);
}

function normalizeKnownExtension(name: string, allow: string[]) {
  const ext = path.extname(String(name || "")).replace(/^\./, "").toLowerCase();
  if (!allow.includes(ext)) return "";
  return ext === "jpeg" ? "jpg" : ext;
}
