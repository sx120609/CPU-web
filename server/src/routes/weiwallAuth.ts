import { Router } from "express";
import { completeWeiwallTokenAuthCallback } from "../services/weiwallSync";

export const weiwallAuthRouter = Router();

function renderResultPage(input: { ok: boolean; title: string; message: string }) {
  const color = input.ok ? "#0f766e" : "#b91c1c";
  const bg = input.ok ? "#ecfdf5" : "#fef2f2";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${input.title}</title>
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fb; color: #111827; }
      .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .card { width: min(560px, 100%); background: #fff; border-radius: 18px; padding: 28px 24px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08); }
      .badge { display: inline-block; padding: 6px 12px; border-radius: 999px; background: ${bg}; color: ${color}; font-size: 13px; font-weight: 700; }
      h1 { margin: 16px 0 10px; font-size: 24px; }
      p { margin: 0; color: #4b5563; line-height: 1.75; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="badge">${input.ok ? "授权成功" : "授权失败"}</div>
        <h1>${input.title}</h1>
        <p>${input.message}</p>
      </div>
    </div>
  </body>
</html>`;
}

weiwallAuthRouter.get("/callback", async (req, res) => {
  try {
    const result = await completeWeiwallTokenAuthCallback({
      flowToken: String(req.query.flow || ""),
      school: typeof req.query.school === "string" ? req.query.school : undefined,
      code: typeof req.query.code === "string" ? req.query.code : undefined,
    });
    res.type("html").send(renderResultPage({
      ok: true,
      title: result.title,
      message: result.message,
    }));
  } catch (error: any) {
    res.status(400).type("html").send(renderResultPage({
      ok: false,
      title: "逛逛 Token 更新失败",
      message: error?.message ?? "授权回调处理失败，请返回后台重新生成二维码再试。",
    }));
  }
});
