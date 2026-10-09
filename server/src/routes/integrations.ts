import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { config } from "../config";
import { validate } from "../middleware/validate";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";

import { getSongReviewConfig, reviewSong } from "../services/songAiReview";
import { songReviewInputSchema } from "../services/songReviewPolicy";
import { shopIntegrationRouter } from "./shopIntegration";

export const integrationsRouter = Router();
integrationsRouter.use(shopIntegrationRouter);

const voiceHubNotificationSchema = z.object({
  userId: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(4000),
  type: z.string().trim().min(1).max(80),
  songId: z.number().int().positive().optional(),
  level: z.enum(["strong", "normal", "weak"]).optional(),
  deliveryKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const voiceHubBatchSchema = z.object({
  notifications: z.array(voiceHubNotificationSchema).min(1).max(200),
});

function hasValidVoiceHubSecret(candidate: string) {
  const expected = config.voiceHubIntegrationSecret;
  if (expected.length < 32 || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

integrationsRouter.post(
  "/voicehub/notifications",
  validate(voiceHubBatchSchema),
  async (req, res, next) => {
    try {
      const suppliedSecret = String(req.header("x-voicehub-integration-secret") ?? "");
      if (!hasValidVoiceHubSecret(suppliedSecret)) {
        throw Errors.unauthorized("VoiceHub integration authentication failed");
      }

      const input = req.body.notifications as z.infer<typeof voiceHubNotificationSchema>[];
      const requestedUserIds = [...new Set(input.map((item) => item.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: requestedUserIds } },
        select: { id: true },
      });
      const validUserIds = new Set(users.map((user) => user.id));
      const deliverable = input.filter((item) => validUserIds.has(item.userId));

      let count = 0;
      const plainData: Prisma.NotificationCreateManyInput[] = [];
      for (const item of deliverable) {
        const data = {
              userId: item.userId,
              category: "service-tool",
              level: item.level ?? "normal",
              title: item.title,
              content: item.content,
              payload: JSON.stringify({
                type: item.type,
                toolCode: "voicehub",
                ...(item.songId ? { voiceHubSongId: item.songId } : {}),
                ...(item.deliveryKey ? { deliveryKey: item.deliveryKey } : {}),
              }),
              link: item.type === "SONG_REVIEW_ADVICE" && item.songId ? `/voicehub/?reviewSong=${item.songId}` : "/voicehub/",
              source: "药苑之声",
        };
        if (item.deliveryKey) {
          await prisma.$transaction(async tx => {
            // Cross-process idempotency: a retried VoiceHub outbox delivery must not notify twice.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${item.deliveryKey}, 0))`;
            const existing = await tx.notification.findFirst({ where: { userId: item.userId, source: "药苑之声", payload: { contains: `"deliveryKey":"${item.deliveryKey}"` } }, select: { id: true } });
            if (!existing) await tx.notification.create({ data });
          });
        } else {
          plainData.push(data);
        }
        count++;
      }
      if (plainData.length) await prisma.notification.createMany({ data: plainData });

      ok(res, {
        count,
        skipped: input.length - count,
      });
    } catch (error) {
      next(error);
    }
  },
);


integrationsRouter.get("/voicehub/song-review/config", (req, res, next) => {
  try {
    if (!hasValidVoiceHubSecret(String(req.header("x-voicehub-integration-secret") || ""))) throw Errors.unauthorized("VoiceHub integration authentication failed");
    ok(res, getSongReviewConfig());
  } catch (error) { next(error); }
});

integrationsRouter.post("/voicehub/song-review", async (req, res, next) => {
  try {
    if (!hasValidVoiceHubSecret(String(req.header("x-voicehub-integration-secret") || ""))) throw Errors.unauthorized("VoiceHub integration authentication failed");
    if (!getSongReviewConfig().enabled) throw Errors.forbidden("歌曲审核未启用");
    const input = songReviewInputSchema.parse(req.body);
    ok(res, await reviewSong(input));
  } catch (error) { next(error); }
});
