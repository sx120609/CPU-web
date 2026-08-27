import { Router } from "express";
import { prisma } from "../prisma";
import { decodeDataAvatar } from "../utils/publicAvatar";
import { withCache } from "../services/cache";

export const userAvatarRouter = Router();

userAvatarRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.sendStatus(404);
    const requestedVersion = String(req.query.v || "").trim();
    const avatar = await withCache("user-avatar", [id, requestedVersion || "current"], 60 * 60_000, async () => {
      const user = await prisma.user.findUnique({ where: { id }, select: { avatar: true } });
      return user?.avatar || null;
    });
    const decoded = avatar ? decodeDataAvatar(avatar) : null;
    if (!decoded?.data.length) return res.sendStatus(404);

    const etag = `"avatar-${decoded.version}"`;
    const immutable = requestedVersion === decoded.version;
    res.setHeader("ETag", etag);
    res.setHeader(
      "Cache-Control",
      immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300, stale-while-revalidate=86400",
    );
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.type(decoded.contentType);
    res.setHeader("Content-Length", String(decoded.data.length));
    return res.send(decoded.data);
  } catch (error) {
    return next(error);
  }
});
