import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { createQqBindToken, deleteUserQqBinding, getUserQqBotProfile, handleQqBotWebhook } from "../services/qqbot";

export const qqBotRouter = Router();

qqBotRouter.post("/webhook", async (req, res, next) => {
  try {
    const secret = String(req.headers["x-qqbot-secret"] ?? req.query.secret ?? "");
    const result = await handleQqBotWebhook(req.body, secret);
    ok(res, result);
  } catch (e) { next(e); }
});

qqBotRouter.post("/bind-token", authRequired, async (req, res, next) => {
  try {
    ok(res, await createQqBindToken(req.user!.userId));
  } catch (e) { next(e); }
});

qqBotRouter.get("/me", authRequired, async (req, res, next) => {
  try {
    ok(res, await getUserQqBotProfile(req.user!.userId));
  } catch (e) { next(e); }
});

qqBotRouter.delete("/binding", authRequired, async (req, res, next) => {
  try {
    ok(res, await deleteUserQqBinding(req.user!.userId));
  } catch (e) { next(e); }
});
