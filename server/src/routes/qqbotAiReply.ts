import * as cheerio from "cheerio";
import { marked } from "marked";
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

export function renderQqBotAiReplyPage(record: QqBotAiReplyShareRecord): string {
  const answerHtml = renderShareMarkdown(record.answer || "暂时没有可展示的回答。");
  const actions = record.actions
    .map((action) => (
      '<a class="action-card" href="' + escapeAttribute(action.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="action-icon">🔗</span>' +
        '<span class="action-copy"><strong>' + escapeHtml(action.label) + '</strong><small>打开相关入口</small></span>' +
        '<span class="action-arrow" aria-hidden="true">→</span>' +
      "</a>"
    ))
    .join("");
  const createdAt = record.createdAt.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
  const actionBlock = actions
    ? '<section class="action-list"><h2>相关入口</h2>' + actions + "</section>"
    : "";

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>拾间AI · 在线回答</title>",
    "<style>",
    ':root{--cpu-primary:#0f8f78;--cpu-primary-strong:#0b7866;--cpu-page:#f5fbfa;--cpu-card:#fff;--cpu-surface:#f8fbfa;--cpu-surface-subtle:#f3f7f6;--cpu-border-soft:#dce9e6;--cpu-text:#24323a;--cpu-text-secondary:#687b78;--cpu-text-muted:#8a9b98;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
    "*{box-sizing:border-box}",
    "body{margin:0;min-height:100vh;padding:18px 12px 28px;background:var(--cpu-page);color:var(--cpu-text)}",
    ".assistant-page{width:min(920px,100%);margin:0 auto}",
    ".assistant-shell{display:flex;flex-direction:column;gap:16px;min-height:calc(100vh - 46px);padding:20px;background:var(--cpu-card);border:1px solid var(--cpu-border-soft);border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.04)}",
    ".assistant-head{display:flex;align-items:center;gap:12px}",
    ".assistant-head-copy{flex:1;min-width:0}",
    ".assistant-mark{display:grid;width:42px;height:42px;place-items:center;border-radius:13px;color:#fff;background:linear-gradient(135deg,#0f8f78,#17aa8d);box-shadow:0 7px 18px rgba(22,135,118,.22);font-size:18px;font-weight:800}",
    ".assistant-head h1{margin:0;font-size:21px}",
    ".assistant-head p{margin:3px 0 0;color:var(--cpu-text-secondary);font-size:12px}",
    ".share-status{flex:0 0 auto;padding:7px 11px;border:1px solid #b9ded5;border-radius:999px;color:var(--cpu-primary-strong);background:#f0faf7;font-size:12px}",
    ".share-meta{margin:-3px 4px 0;color:var(--cpu-text-muted);font-size:11px;line-height:1.4}",
    ".conversation{display:flex;flex:1;flex-direction:column;gap:14px;min-height:160px;padding:2px 4px 8px}",
    ".message{display:flex;flex-direction:column;gap:5px;max-width:86%}",
    ".message--user{align-self:flex-end;align-items:flex-end}",
    ".message--assistant{align-self:stretch;width:100%;max-width:100%}",
    ".message-label{color:var(--cpu-text-muted);font-size:10px}",
    ".message-bubble{min-width:64px;padding:11px 13px;border:1px solid var(--cpu-border-soft);border-radius:14px;background:var(--cpu-surface-subtle)}",
    ".message--user .message-bubble{min-width:0;padding:2px 0;border:0;border-radius:0;color:var(--cpu-primary-strong);background:transparent;box-shadow:none;text-align:right}",
    ".user-message-content{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;font-size:14px;font-weight:700}",
    ".message--assistant .message-bubble{min-width:0;padding:0 2px;border:0;border-radius:0;background:transparent}",
    ".message-markdown{max-width:100%;overflow-x:auto;overflow-wrap:anywhere;line-height:1.7;font-size:14px}",
    ".message-markdown>:first-child{margin-top:0}",
    ".message-markdown>:last-child{margin-bottom:0}",
    ".message-markdown p{margin:.65em 0;white-space:normal}",
    ".message-markdown h1,.message-markdown h2,.message-markdown h3,.message-markdown h4{margin:1em 0 .45em;line-height:1.35}",
    ".message-markdown h1{font-size:1.35em}.message-markdown h2{font-size:1.22em}.message-markdown h3{font-size:1.1em}",
    ".message-markdown ul,.message-markdown ol{margin:.65em 0;padding-left:1.5em}",
    ".message-markdown li+li{margin-top:.3em}",
    ".message-markdown blockquote{margin:.75em 0;padding:.2em 0 .2em .85em;border-left:3px solid var(--cpu-primary);color:var(--cpu-text-secondary)}",
    ".message-markdown a{color:var(--cpu-primary-strong);text-decoration:underline;text-underline-offset:2px}",
    ".message-markdown code{padding:.12em .35em;border-radius:5px;background:var(--cpu-surface);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em}",
    ".message-markdown pre{max-width:100%;margin:.75em 0;overflow-x:auto;padding:11px 12px;border:1px solid var(--cpu-border-soft);border-radius:9px;background:var(--cpu-surface)}",
    ".message-markdown pre code{padding:0;background:transparent;white-space:pre}",
    ".message-markdown hr{margin:1em 0;border:0;border-top:1px solid var(--cpu-border-soft)}",
    ".message-markdown table{width:100%;margin:.75em 0;border-collapse:collapse}",
    ".message-markdown th,.message-markdown td{padding:6px 8px;border:1px solid var(--cpu-border-soft);text-align:left}",
    ".message-markdown img{display:block;max-width:100%;height:auto;border-radius:10px}",
    ".action-list{display:grid;gap:8px;margin-top:11px}",
    ".action-list h2{margin:0 0 2px;color:var(--cpu-primary-strong);font-size:18px}",
    ".action-card{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid var(--cpu-border-soft);border-radius:10px;color:var(--cpu-text);background:var(--cpu-card);text-decoration:none}",
    ".action-card:hover{border-color:var(--cpu-primary);background:#f6fcfa}",
    ".action-icon{flex:0 0 auto;font-size:21px}.action-copy{display:flex;flex:1;flex-direction:column;min-width:0}.action-copy strong{font-size:13px}.action-copy small{margin-top:2px;color:var(--cpu-text-secondary);line-height:1.45;font-size:11px}.action-arrow{color:var(--cpu-primary);font-size:20px}",
    ".assistant-disclaimer{margin:-8px 0 0;color:var(--cpu-text-muted);text-align:center;font-size:11px;line-height:1.4}",
    "@media (max-width:640px){body{padding:0}.assistant-shell{min-height:100vh;border-right:0;border-left:0;border-radius:0;padding:18px 16px}.share-status{font-size:11px}.message{max-width:94%}.message-markdown{font-size:14px}.action-card{padding:11px}}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="assistant-page">',
    '<section class="assistant-shell">',
    '<header class="assistant-head"><span class="assistant-mark">拾</span><div class="assistant-head-copy"><h1>拾间AI</h1><p>问功能、找入口，也可以直接聊天</p></div><span class="share-status">在线回答</span></header>',
    '<div class="share-meta">生成时间：' + escapeHtml(createdAt) + "</div>",
    '<div class="conversation" aria-live="polite">',
    '<article class="message message--user"><div class="message-bubble"><p class="user-message-content">' + escapeHtml(record.question || "未记录问题") + "</p></div></article>",
    '<article class="message message--assistant"><div class="message-label">拾间AI</div><div class="message-bubble"><div class="message-markdown">' + answerHtml + "</div>" + actionBlock + "</div></article>",
    "</div>",
    '<p class="assistant-disclaimer">内容由 AI 生成，请注意甄别，并以官方信息为准。</p>',
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderShareMarkdown(markdown: string): string {
  const raw = marked.parse(String(markdown || ""), {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
  const $ = cheerio.load('<div id="share-markdown">' + raw + "</div>", null, false);
  const root = $("#share-markdown");
  const allowedTags = new Set([
    "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4",
    "hr", "img", "li", "ol", "p", "pre", "strong", "sub", "sup", "table",
    "tbody", "td", "th", "thead", "tr", "ul",
  ]);
  const allowedAttributes: Record<string, Set<string>> = {
    a: new Set(["href", "title", "target", "rel"]),
    img: new Set(["src", "alt", "title", "loading", "referrerpolicy"]),
  };

  root.find("script,style,iframe,object,embed,svg,math,link,meta,form,input,button").remove();
  root.find("*").each((_index, node) => {
    const element = node as any;
    const tag = String(element.name || "").toLowerCase();
    if (!allowedTags.has(tag)) {
      $(element).replaceWith($(element).contents());
      return;
    }
    const permitted = allowedAttributes[tag] || new Set<string>();
    for (const attribute of Object.keys(element.attribs || {})) {
      if (!permitted.has(attribute)) $(element).removeAttr(attribute);
    }
    if (tag === "a") {
      const href = $(element).attr("href") || "";
      if (isSafeShareUrl(href)) {
        $(element).attr("target", "_blank").attr("rel", "noopener noreferrer");
      } else {
        $(element).removeAttr("href").removeAttr("target").removeAttr("rel");
      }
    }
    if (tag === "img") {
      const src = $(element).attr("src") || "";
      if (!isSafeShareUrl(src)) $(element).remove();
      else $(element).attr("loading", "lazy").attr("referrerpolicy", "no-referrer");
    }
  });
  return root.html() || "<p>暂时没有可展示的回答。</p>";
}

function isSafeShareUrl(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderNotFoundPage(): string {
  return [
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>回答不存在</title></head>",
    '<body style="margin:0;padding:48px 20px;font-family:system-ui,Microsoft YaHei,sans-serif;background:#f5fbfa;color:#24323a">',
    '<main style="max-width:620px;margin:auto;padding:32px;border:1px solid #dce9e6;border-radius:20px;background:#fff">',
    "<h1>回答不存在</h1><p>这个在线回答可能已经过期，或者链接不完整。</p>",
    "</main></body></html>",
  ].join("");
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
