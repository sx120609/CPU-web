import { createHash } from "node:crypto";
import { formatClock, formatDateTime, formatDay, dayKey, formatDuration } from "./time.mjs";

// 颜色、字号、圆角与主站 web/src/styles/index.scss 的 --cpu-* 变量逐值对应（同 web/public/legal.css）。
// 状态三色另取：主站的警告橙和危险红在色觉障碍下分不开，这里用绿、琥珀、红，并给异常日加圆点作第二重标记。
const STYLE = `
:root{color-scheme:light;--bg:#f2f3f5;--surface:#fff;--line:#e4e6ea;--text:#16191d;--text-2:#4e5661;--text-3:#666e7a;--brand:#086f63;--ok:#0f9d6c;--warn:#e8a013;--bad:#dc3b3b;--none:#d5d9df}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0e1012;--surface:#1a1d21;--line:#2b3036;--text:#eceef1;--text-2:#b0b7c1;--text-3:#8e96a2;--brand:#36d0b7;--ok:#2fc48d;--warn:#eba51f;--bad:#ee5f58;--none:#3a4048}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Inter Variable","HarmonyOS Sans SC",-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
a{color:var(--brand);text-decoration:none}
a:focus-visible{border-radius:6px;outline:2px solid var(--brand);outline-offset:2px}
h1,h2,p{margin:0}
svg{display:block;flex:none}
.bar{background:var(--surface);box-shadow:inset 0 -1px 0 var(--line)}
.bar-in,main{max-width:792px;margin:0 auto;padding:0 16px}
.bar-in{display:flex;height:56px;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:8px;color:var(--text);font-size:16px;font-weight:600}
.brand span{color:var(--text-3);font-size:13px;font-weight:400}
.back{font-size:13px}
main{padding-bottom:48px}
.notice{margin:16px 0 0;padding:10px 16px;border-radius:10px;background:var(--surface);color:var(--text-2);font-size:13px}
.summary{display:flex;margin-top:16px;padding:20px 16px;align-items:center;gap:12px;border-radius:14px;background:var(--surface)}
.summary h1{font-size:18px;font-weight:600;line-height:1.4}
.summary p,.note{color:var(--text-3);font-size:12px}
h2{margin:24px 4px 8px;color:var(--text-3);font-size:13px;font-weight:400}
.group{border-radius:14px;background:var(--surface)}
.row{padding:14px 16px}
.row+.row{box-shadow:inset 0 1px 0 var(--line)}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.name{min-width:0;font-weight:600}
.name span{margin-left:8px;color:var(--text-3);font-size:12px;font-weight:400}
.state{display:flex;flex:none;align-items:center;gap:6px;color:var(--text-2);font-size:13px}
.state span{margin-right:4px;color:var(--text-3);font-size:12px}
.reason{margin-top:2px;color:var(--text-2);font-size:13px}
.bars{display:flex;height:24px;margin:10px -1px 0}
.b{--c:var(--none);position:relative;min-width:0;flex:1 1 0;padding:0 1px;border-radius:3px;background:var(--c) content-box;font-style:normal}
.b.up{--c:var(--ok)}
.b.partial{--c:var(--warn)}
.b.down{--c:var(--bad)}
.b.partial::before,.b.down::before{position:absolute;bottom:-7px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--c);content:""}
.b:hover{background-color:color-mix(in srgb,var(--c) 55%,var(--surface))}
.b:hover::after{position:absolute;z-index:1;top:calc(100% + 9px);left:50%;padding:4px 8px;border-radius:6px;background:var(--text);color:var(--surface);font-size:12px;line-height:1.5;white-space:nowrap;content:attr(data-tip);pointer-events:none;transform:translateX(-50%)}
.b:nth-child(-n+14):hover::after{left:1px;transform:none}
.b:nth-last-child(-n+14):hover::after{right:1px;left:auto;transform:none}
.axis{display:flex;margin-top:10px;justify-content:space-between;gap:8px;color:var(--text-3);font-size:12px}
.axis .narrow{display:none}
.item{display:flex;padding:12px 16px;align-items:baseline;justify-content:space-between;gap:4px 16px;flex-wrap:wrap}
.item+.item{box-shadow:inset 0 1px 0 var(--line)}
.item div{min-width:0}
.item b{font-weight:600}
.item .why{margin-left:8px;color:var(--text-2);font-size:13px}
.item .meta{color:var(--text-3);font-size:12px}
.tag{margin-left:8px;padding:1px 8px;border-radius:999px;background:var(--bg);color:var(--text-2);font-size:12px;font-weight:400}
.cert{display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--none)}
.dot.up{background:var(--ok)}
.dot.partial{background:var(--warn)}
.dot.down{background:var(--bad)}
.empty{padding:16px;color:var(--text-3);font-size:13px}
.legend{display:flex;margin:12px 4px 0;gap:4px 16px;flex-wrap:wrap;color:var(--text-3);font-size:12px}
.legend span{display:flex;align-items:center;gap:6px}
.legend i{width:8px;height:12px;border-radius:2px;background:var(--none)}
.legend .up{background:var(--ok)}
.legend .partial{background:var(--warn)}
.legend .down{background:var(--bad)}
.note{margin:24px 4px 0;line-height:1.8}
@media (max-width:640px){
.name span{display:block;margin-left:0}
.b:nth-child(-n+45){display:none}
.b:nth-child(-n+57):hover::after{left:1px;transform:none}
.axis .wide{display:none}
.axis .narrow{display:inline}
.incident .meta{flex-basis:100%}
}
`.trim();

// 每分钟取一次新页面并替换主体，保留滚动位置；取不到时提示数据可能过期。
const SCRIPT = `
(function(){var main=document.getElementById("status"),stale=document.getElementById("stale");
if(!main||!stale||!window.fetch||!window.DOMParser)return;
function refresh(){if(document.hidden)return;
fetch(location.pathname,{cache:"no-store"}).then(function(response){if(!response.ok)throw 0;return response.text()}).then(function(html){
var next=new DOMParser().parseFromString(html,"text/html"),fresh=next.getElementById("status");if(!fresh)throw 0;
main.replaceWith(fresh);main=fresh;document.title=next.title;stale.hidden=true}).catch(function(){stale.hidden=false})}
setInterval(refresh,(+main.getAttribute("data-refresh")||60)*1000);
document.addEventListener("visibilitychange",refresh)})();
`.trim();

const LOGO = '<rect x="12" y="12" width="84" height="84" rx="18" fill="#0F8F7F"/><rect x="30" y="31" width="48" height="8" rx="2" fill="#FFF"/><rect x="30" y="47" width="48" height="8" rx="2" fill="#FFF"/><rect x="30" y="63" width="30" height="8" rx="2" fill="#FFF"/><path d="M70 61l6 6l13 -17l6 5l-18 24l-13 -12z" fill="#F59E0B"/>';
const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${LOGO}</svg>`)}`;

// 四种状态各用一个外形（圆、三角、方、空心圆），不只靠颜色区分。
const ICONS = {
  up: '<circle cx="8" cy="8" r="7" fill="var(--ok)"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  partial: '<path d="M8 1.5 15 14H1z" fill="var(--warn)" stroke="var(--warn)" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.9v.1" fill="none" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round"/>',
  down: '<rect x="1" y="1" width="14" height="14" rx="4" fill="var(--bad)"/><path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" fill="none" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round"/>',
  unknown: '<circle cx="8" cy="8" r="6" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-dasharray="2.6 2.1"/>',
};
const ICON_OF = { up: "up", slow: "partial", partial: "partial", down: "down", unknown: "unknown" };

const sha256 = (content) => `'sha256-${createHash("sha256").update(content).digest("base64")}'`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `style-src ${sha256(STYLE)}`,
  `script-src ${sha256(SCRIPT)}`,
  "img-src data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ESCAPES[character]);
}

function icon(status, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[ICON_OF[status]]}</svg>`;
}

export function formatUptime(ratio) {
  if (ratio === null) return "暂无数据";
  if (ratio === 1) return "100%";
  // 向下取到两位小数：有过失败就不显示成 100%。
  return `${(Math.floor(ratio * 10000) / 100).toFixed(2)}%`;
}

function renderBar(day) {
  const detail = day.level === "none"
    ? "无数据"
    : `可用率 ${formatUptime(day.uptime)}${day.failed ? `，${day.failed} 次探测失败` : ""}`;
  return `<i class="b ${day.level}" data-tip="${escapeHtml(`${formatDay(day.date)} · ${detail}`)}"></i>`;
}

function renderCheck(check, view) {
  const figures = [`近 ${view.historyDays} 天可用率 ${formatUptime(check.uptime)}`];
  if (check.responseMs !== null) figures.push(`响应 ${check.responseMs} ms`);
  const reason = check.status === "down"
    ? `<p class="reason">${escapeHtml(check.reason)}${check.since ? ` · ${escapeHtml(formatDateTime(check.since, view.timezone))} 起` : ""}</p>`
    : "";
  return `<article class="row">
<div class="head"><div class="name">${escapeHtml(check.name)}${check.description ? `<span>${escapeHtml(check.description)}</span>` : ""}</div><div class="state">${check.detail ? `<span>${escapeHtml(check.detail)}</span>` : ""}${icon(check.status)}${escapeHtml(check.statusLabel)}</div></div>${reason}
<div class="bars" role="img" aria-label="${escapeHtml(`${check.name}：${figures[0]}`)}">${check.days.map(renderBar).join("")}</div>
<div class="axis"><span class="wide">${view.historyDays} 天前</span><span class="narrow">${view.historyDays / 2} 天前</span><span>${escapeHtml(figures.join(" · "))}</span><span>今天</span></div>
</article>`;
}

function renderIncident(incident, timezone) {
  const sameDay = incident.resolvedAt !== null && dayKey(incident.startedAt, timezone) === dayKey(incident.resolvedAt, timezone);
  const ended = incident.resolvedAt === null
    ? "至今"
    : (sameDay ? formatClock(incident.resolvedAt, timezone) : formatDateTime(incident.resolvedAt, timezone));
  return `<div class="item incident"><div><b>${escapeHtml(incident.name)}</b>${incident.resolvedAt === null ? '<span class="tag">进行中</span>' : ""}<span class="why">${escapeHtml(incident.reason)}</span></div><div class="meta">${escapeHtml(`${formatDateTime(incident.startedAt, timezone)} – ${ended} · ${formatDuration(incident.durationMs)}`)}</div></div>`;
}

function renderCertificate(certificate, timezone) {
  const remaining = certificate.daysLeft < 0 ? "已过期" : `剩余 ${certificate.daysLeft} 天`;
  return `<div class="item"><div class="cert"><i class="dot ${certificate.level}"></i>${escapeHtml(certificate.host)}</div><div class="meta">${escapeHtml(`${formatDay(dayKey(certificate.expiresAt, timezone))}到期 · ${remaining}`)}</div></div>`;
}

export function renderPage(view) {
  const updated = view.updatedAt
    ? `更新于 ${formatDateTime(view.updatedAt, view.timezone, { seconds: true })}`
    : "正在进行第一轮探测";
  const pageTitle = view.overall.status === "up" || view.overall.status === "unknown" ? view.title : `${view.overall.label} · ${view.title}`;
  const groups = view.groups.map((group) => `<section><h2>${escapeHtml(group.name)}</h2><div class="group">${group.checks.map((check) => renderCheck(check, view)).join("")}</div></section>`).join("\n");
  const incidents = view.incidents.length
    ? view.incidents.map((incident) => renderIncident(incident, view.timezone)).join("")
    : '<div class="empty">近 30 天没有中断记录</div>';
  const certificates = view.certificates.length
    ? `<section><h2>证书有效期</h2><div class="group">${view.certificates.map((certificate) => renderCertificate(certificate, view.timezone)).join("")}</div></section>`
    : "";
  const release = view.release ? `主站当前版本 ${escapeHtml(/^[0-9a-f]{40}$/u.test(view.release) ? view.release.slice(0, 7) : view.release)}。` : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(pageTitle)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<noscript><meta http-equiv="refresh" content="${view.intervalSeconds}"></noscript>
<style>${STYLE}</style>
</head>
<body>
<header class="bar"><div class="bar-in"><a class="brand" href="${escapeHtml(view.siteUrl)}"><svg width="28" height="28" viewBox="12 12 84 84" aria-hidden="true">${LOGO}</svg>${escapeHtml(view.siteName)}<span>服务状态</span></a><a class="back" href="${escapeHtml(view.siteUrl)}">返回主站</a></div></header>
<main>
<p class="notice" id="stale" hidden>暂时连不上状态页，下面的数据可能已经过期。</p>
<div id="status" data-refresh="${view.intervalSeconds}">
<section class="summary">${icon(view.overall.status, 28)}<div><h1>${escapeHtml(view.overall.label)}</h1><p>${escapeHtml(updated)} · 页面每 ${view.intervalSeconds} 秒自动刷新</p></div></section>
${groups}
<div class="legend"><span><i class="up"></i>正常</span><span><i class="partial"></i>短暂异常</span><span><i class="down"></i>中断</span><span><i></i>无数据</span></div>
<section><h2>近期事件</h2><div class="group">${incidents}</div></section>
${certificates}
<p class="note">由独立于主站的服务器定时探测，可用率按探测成功的次数计算。${release}</p>
</div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
