import { Router } from "express";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Errors, ok } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const uploadRouter = Router();

const imageSchema = z.object({
  image: z.string().min(1),
});

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_IMAGE_BYTES = 600 * 1024;

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
    const uploadRoot = path.resolve(process.cwd(), "uploads");
    const outputDir = path.join(uploadRoot, relativeDir);
    await mkdir(outputDir, { recursive: true });

    const filename = `${Date.now()}-${randomUUID()}.${ext}`;
    await writeFile(path.join(outputDir, filename), parsed.buffer);
    ok(res, { url: `/uploads/${relativeDir.replace(/\\/g, "/")}/${filename}` });
  } catch (e) {
    next(e);
  }
});

function parseDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return { mime: match[1].toLowerCase(), buffer };
}
