import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { validate } from "../middleware/validate";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";

export const integrationsRouter = Router();

const voiceHubNotificationSchema = z.object({
  userId: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(4000),
  type: z.string().trim().min(1).max(80),
  songId: z.number().int().positive().optional(),
  level: z.enum(["strong", "normal", "weak"]).optional(),
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

      const result = deliverable.length
        ? await prisma.notification.createMany({
            data: deliverable.map((item) => ({
              userId: item.userId,
              category: "service-tool",
              level: item.level ?? "normal",
              title: item.title,
              content: item.content,
              payload: JSON.stringify({
                type: item.type,
                toolCode: "voicehub",
                ...(item.songId ? { voiceHubSongId: item.songId } : {}),
              }),
              link: "/voicehub/",
              source: "药苑之声",
            })),
          })
        : { count: 0 };

      ok(res, {
        count: result.count,
        skipped: input.length - result.count,
      });
    } catch (error) {
      next(error);
    }
  },
);
