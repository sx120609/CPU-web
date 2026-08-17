import { Router } from "express";
import { getQqBotAiReplyShare, type QqBotAiReplyShareRecord } from "../services/qqbot/aiReplyShare";

export const qqBotAiReplyRouter = Router();

qqBotAiReplyRouter.get("/:token", async (req, res, next) => {
  try {
    const record = await getQqBotAiReplyShare(req.params.token);
    res.setHeader("Cache-Control", "no-store");
    if (!record) {
      res.status(404).type("html").send(renderNotFoundPage());
      return;
    }
    res.type("html").send(renderQqBotAiReplyPage(record));
  } catch (error) {
    next(error);
  }
});

function renderQqBotAiReplyPage(record: QqBotAiReplyShareRecord): string {
  const actions = record.actions
    .map((action) => `
      <a class="action" href="${escapeAttribute(action.url)}" target="_blank" rel="noopener noreferrer">
        <span>${escapeHtml(action.label)}</span><strong>打开入口&nbsp;→</strong>
      </a>`)
    .join("");
  const createdAt = record.createdAt.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>拾间AI · 在线回答</title>
  <style>
    :root{color:#24323a;background:#eef7f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    *{box-sizing:border-box}
    body{margin:0;padding:24px 14px 40px}
    .shell{width:min(920px,100%);margin:0 auto;background:#fff;border:1px solid #d5e9e4;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(34,91,80,.12)}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px 32px;background:#438f80;color:#fff}
    .brand{display:flex;align-items:center;gap:12px;font-size:27px;font-weight:800;letter-spacing:.02em}
    .brand-mark{width:22px;height:22px;border-radius:50%;background:#dff3ee}
    .tagline{font-size:19px;color:#e8f6f2;white-space:nowrap}
    main{padding:32px}
    .eyebrow{margin:0 0 8px;color:#438f80;font-size:15px;font-weight:700}
    h1{margin:0 0 22px;font-size:28px;line-height:1.4;color:#162a2a}
    .meta{margin:0 0 24px;padding:16px 18px;border-radius:14px;background:#f5faf9;color:#637b76;font-size:14px}
    .meta strong{color:#29453f;font-weight:700}
    .question{margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
    .answer{margin:0;padding:24px 26px;border-radius:16px;background:#fbfdfc;border:1px solid #e1efeb;white-space:pre-wrap;overflow-wrap:anywhere;font:500 18px/1.85 "Microsoft YaHei","PingFang SC",sans-serif;color:#263238}
    .actions{margin-top:26px;display:grid;gap:12px}
    .actions-title{margin:0 0 10px;color:#438f80;font-size:20px;font-weight:800}
    .action{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;border:1px solid #d5e9e4;border-radius:14px;background:#f7fbfa;color:#2f7568;text-decoration:none}
    .action:hover{background:#eef8f5;border-color:#9bcfc2}
    .action strong{font-size:14px;font-weight:700;white-space:nowrap}
    footer{padding:16px 32px;background:#f0f7f5;color:#55716b;font-size:14px;line-height:1.5}
    @media (max-width:640px){body{padding:0}.shell{border-radius:0;border-left:0;border-right:0}.topbar{padding:20px}.tagline{font-size:15px}.brand{font-size:23px}main{padding:22px 18px}.answer{padding:18px;font-size:17px}.action{align-items:flex-start;flex-direction:column;gap:8px}footer{padding:14px 20px}}
  </style>
</head>
<body>
  <article class="shell">
    <header class="topbar"><div class="brand"><span class="brand-mark"></span>拾间AI</div><div class="tagline">药大拾间 · AI 助手</div></header>
    <main>
      <p class="eyebrow">在线查看完整回答</p>
      <h1>拾间AI回答</h1>
      <div class="meta"><strong>你的问题</strong><div class="question">${escapeHtml(record.question || "未记录问题")}</div><div style="margin-top:8px">生成时间：${escapeHtml(createdAt)}</div></div>
      <pre class="answer">${escapeHtml(record.answer || "暂时没有可展示的回答。")}</pre>
      ${actions ? `<section class="actions"><h2 class="actions-title">相关入口</h2>${actions}</section>` : ""}
    </main>
    <footer>以上内容由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。</footer>
  </article>
</body>
</html>`;
}

function renderNotFoundPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>回答不存在</title></head><body style="margin:0;padding:48px 20px;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#eef7f5;color:#24323a"><main style="max-width:620px;margin:auto;padding:32px;border-radius:20px;background:#fff"><h1>回答不存在</h1><p>这个在线回答可能已经过期，或者链接不完整。</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
