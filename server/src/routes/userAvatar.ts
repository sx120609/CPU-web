import { Router } from "express";
import { prisma } from "../prisma";
import { decodeDataAvatar } from "../utils/publicAvatar";
import { withCache } from "../services/cache";
import { TtlLru } from "../utils/loadShield";

export const userAvatarRouter = Router();
const AVATAR_VERSION_RE = /^[a-f0-9]{16}$/;

const AVATAR_REFRESH_BURST = 3;
const AVATAR_REFRESH_INTERVAL_MS = 10_000;
const avatarRefreshBudget = new TtlLru<{ tokens: number; updatedAt: number }>({ maxEntries: 20_000 });

function takeAvatarRefresh(id: number, now = Date.now()) {
  const key = String(id);
  const budget = avatarRefreshBudget.get(key, now) ?? { tokens: AVATAR_REFRESH_BURST, updatedAt: now };
  budget.tokens = Math.min(AVATAR_REFRESH_BURST, budget.tokens + (now - budget.updatedAt) / AVATAR_REFRESH_INTERVAL_MS);
  budget.updatedAt = now;
  const allowed = budget.tokens >= 1;
  if (allowed) budget.tokens -= 1;
  avatarRefreshBudget.set(key, budget, AVATAR_REFRESH_BURST * AVATAR_REFRESH_INTERVAL_MS, now);
  return allowed;
}

userAvatarRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.sendStatus(404);
    const requestedVersion = String(req.query.v || "").trim();
    // 每个用户只缓存一份头像，避免任意 ?v= 参数制造大量多 MB 的缓存条目；
    // 请求的版本与缓存不一致时强制回源一次，刚更换的头像可以立即生效。
    const loadAvatar = (refresh = false) => withCache("user-avatar", [id], 60 * 60_000, async () => {
      const user = await prisma.user.findUnique({ where: { id }, select: { avatar: true } });
      return user?.avatar || null;
    }, { refresh });
    let avatar = await loadAvatar();
    let decoded = avatar ? decodeDataAvatar(avatar) : null;
    // 版本号由请求方随意填写：每个用户可以连续强制回源 3 次（连续换头像仍立即生效），之后每 10 秒恢复一次，
    // 随机版本号刷不穿缓存。
    if (AVATAR_VERSION_RE.test(requestedVersion) && decoded?.version !== requestedVersion && takeAvatarRefresh(id)) {
      avatar = await loadAvatar(true);
      decoded = avatar ? decodeDataAvatar(avatar) : null;
    }
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
