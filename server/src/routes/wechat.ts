import express, { Router } from "express";
import { authRequired } from "../middleware/auth";
import { ok } from "../utils/response";
import { getSiteOrigin } from "../services/siteSettings";
import {
  completeWechatOauthBinding,
  createWechatBindQrCode,
  createWechatBindToken,
  createWechatJsSdkConfig,
  createWechatOauthBindUrl,
  decodeWechatCallback,
  deleteUserWechatBinding,
  encodeWechatPassiveTextReply,
  getUserWechatProfile,
  processWechatInbound,
  verifyWechatCallback,
} from "../services/wechatService";

export const wechatRouter = Router();

wechatRouter.get("/callback", async (req, res, next) => {
  try {
    const echo = await verifyWechatCallback({
      signature: queryString(req.query.signature),
      msgSignature: queryString(req.query.msg_signature),
      timestamp: queryString(req.query.timestamp),
      nonce: queryString(req.query.nonce),
      echoStr: queryString(req.query.echostr),
      encryptType: queryString(req.query.encrypt_type),
    });
    res.type("text/plain; charset=utf-8").send(echo);
  } catch (error) {
    next(error);
  }
});

wechatRouter.post("/callback", express.text({ type: ["text/xml", "application/xml", "*/xml"], limit: "1mb" }), async (req, res, next) => {
  try {
    const message = await decodeWechatCallback({
      body: typeof req.body === "string" ? req.body : "",
      signature: queryString(req.query.signature),
      msgSignature: queryString(req.query.msg_signature),
      timestamp: queryString(req.query.timestamp),
      nonce: queryString(req.query.nonce),
      encryptType: queryString(req.query.encrypt_type),
    });
    const result = await processWechatInbound(message, { passiveReply: true });
    if (result.replyText) {
      const encrypted = queryString(req.query.encrypt_type) === "aes" || Boolean(queryString(req.query.msg_signature));
      const body = await encodeWechatPassiveTextReply(message, result.replyText, encrypted);
      res.type("application/xml; charset=utf-8").send(body);
      return;
    }
    res.type("text/plain; charset=utf-8").send("success");
  } catch (error) {
    next(error);
  }
});

wechatRouter.get("/oauth/callback", async (req, res) => {
  const origin = String(getSiteOrigin() || "").trim().replace(/\/+$/, "");
  const target = `${origin}/messages?tab=settings`;
  try {
    const code = queryString(req.query.code);
    const state = queryString(req.query.state);
    if (!code || !state) throw new Error("微信授权参数不完整");
    await completeWechatOauthBinding(code, state);
    res.redirect(`${target}&wechat=bound`);
  } catch (error) {
    console.warn("[wechat] oauth binding failed", error instanceof Error ? error.message : error);
    res.redirect(`${target}&wechat=error`);
  }
});

wechatRouter.get("/me", authRequired, async (req, res, next) => {
  try {
    ok(res, await getUserWechatProfile(req.user!.userId, req.browserSession?.jwxtToken));
  } catch (error) {
    next(error);
  }
});

wechatRouter.post("/js-sdk-config", authRequired, express.json(), async (req, res, next) => {
  try {
    ok(res, await createWechatJsSdkConfig(String(req.body?.url || "")));
  } catch (error) {
    next(error);
  }
});

wechatRouter.post("/oauth-url", authRequired, async (req, res, next) => {
  try {
    ok(res, await createWechatOauthBindUrl(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

wechatRouter.post("/bind-qr", authRequired, async (req, res, next) => {
  try {
    ok(res, await createWechatBindQrCode(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

wechatRouter.post("/bind-token", authRequired, async (req, res, next) => {
  try {
    ok(res, await createWechatBindToken(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

wechatRouter.delete("/binding", authRequired, async (req, res, next) => {
  try {
    ok(res, await deleteUserWechatBinding(req.user!.userId));
  } catch (error) {
    next(error);
  }
});

function queryString(value: unknown) {
  return typeof value === "string" ? value : "";
}
