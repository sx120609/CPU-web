import { Router } from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { registerForumImageAsset } from "../services/imageModeration";
import { saveMediaAsset } from "../services/mediaStorage";
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

const VIDEO_MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
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
    const kind = resolveMediaKind(file.mimetype);
    if (!kind) throw Errors.badRequest("仅支持 JPG、PNG、WebP、GIF 图片或 MP4、WebM、MOV、M4V、MKV、OGV 视频");

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const relativeDir = path.join("forum", month);
    const ext = resolveUploadExtension(kind, file.mimetype, file.originalname);
    if (!ext) throw Errors.badRequest("当前文件格式暂不支持上传");
    const baseName = `${Date.now()}-${randomUUID()}`;
    const relativePath = path.posix.join(relativeDir.replace(/\\/g, "/"), `${baseName}.${ext}`);
    const saved = await saveMediaAsset({
      relativePath,
      buffer: file.buffer,
      contentType: file.mimetype || undefined,
    });

    if (kind === "image") {
      await registerForumImageAsset({
        url: saved.url,
        localPath: saved.localPath,
        mimeType: file.mimetype,
        fileSize: file.size,
        createdById: req.user!.userId,
      }).catch(() => null);
      ok(res, {
        kind,
        url: saved.url,
        posterUrl: "",
        mimeType: file.mimetype,
      });
      return;
    }

    await registerForumVideoAsset({
      url: saved.url,
      localPath: saved.localPath,
      mimeType: file.mimetype,
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
      mimeType: file.mimetype,
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

function resolveMediaKind(mime: string) {
  if (Object.prototype.hasOwnProperty.call(MIME_EXT, mime)) return "image" as const;
  if (Object.prototype.hasOwnProperty.call(VIDEO_MIME_EXT, mime)) return "video" as const;
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
