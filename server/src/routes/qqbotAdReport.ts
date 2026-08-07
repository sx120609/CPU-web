import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../prisma";
import { verifyQqBotGroupAdminIdentity } from "../services/qqbot";
import { callQqBotAction } from "../services/qqbot/connection";

export const qqBotAdReportRouter = Router();

const REPORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,160}$/;

qqBotAdReportRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

qqBotAdReportRouter.get("/:token", async (req, res, next) => {
  try {
    if (!req.user) return redirectToLogin(req, res);
    const context = await loadReportContext(req.params.token);
    if (!context.ok) return renderState(res, context.status, context.title, context.message);
    if (context.report.status !== "open") {
      return renderState(res, 200, "该通报已处理", "群内通报消息已经完成处理，无需重复操作。", "success");
    }
    const identity = await resolveBoundAdmin(req.user.userId, context.report.groupId);
    if (!identity.ok) return renderState(res, identity.status, identity.title, identity.message);
    return res.type("html").send(renderActionPage(context.report, context.group, identity.qqId));
  } catch (error) {
    next(error);
  }
});

qqBotAdReportRouter.post("/:token", async (req, res, next) => {
  try {
    if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
      return renderState(res, 403, "请求已拦截", "请回到药大拾间页面重新打开管理员处理链接。");
    }
    if (!req.user) return redirectToLogin(req, res);
    const context = await loadReportContext(req.params.token);
    if (!context.ok) return renderState(res, context.status, context.title, context.message);
    if (context.report.status !== "open") {
      return renderState(res, 200, "该通报已处理", "群内通报消息已经完成处理，无需重复操作。", "success");
    }
    const identity = await resolveBoundAdmin(req.user.userId, context.report.groupId);
    if (!identity.ok) return renderState(res, identity.status, identity.title, identity.message);

    const action = normalizeAction(req.body?.action);
    if (!action) return renderState(res, 400, "操作无效", "请选择页面提供的处理操作后重试。");
    if (action === "kick" && !context.group.allowKick) {
      return renderState(res, 403, "功能未开启", "该群尚未允许通过机器人移出成员。");
    }
    if (action === "kick-block" && !context.group.allowKickAndBlock) {
      return renderState(res, 403, "功能未开启", "该群尚未允许通过机器人移出并拉黑成员。");
    }

    if (action !== "acknowledge") {
      const offenderRole = await verifyQqBotGroupAdminIdentity(context.report.groupId, context.report.offenderQqId);
      if (offenderRole.verified) {
        return renderState(res, 403, "不能执行该操作", "被通报账号当前也是群主或管理员，请在 QQ 群内人工处理。");
      }
      await callQqBotAction("set_group_kick", {
        group_id: numericId(context.report.groupId),
        user_id: numericId(context.report.offenderQqId),
        reject_add_request: false,
      });
      if (action === "kick-block") {
        await prisma.qqBotGroupBlockedUser.upsert({
          where: {
            groupId_qqId: {
              groupId: context.report.groupId,
              qqId: context.report.offenderQqId,
            },
          },
          create: {
            groupId: context.report.groupId,
            qqId: context.report.offenderQqId,
            nickname: context.report.offenderNickname,
            blockedByQqId: identity.qqId,
            source: "ad-report",
            reason: context.report.reason,
          },
          update: {
            nickname: context.report.offenderNickname,
            blockedByQqId: identity.qqId,
            source: "ad-report",
            reason: context.report.reason,
          },
        });
      }
    }

    await prisma.qqBotGroupAdReport.update({
      where: { id: context.report.id },
      data: {
        status: "handled",
        handledAt: new Date(),
        handledByQqId: identity.qqId,
        handledAction: action,
      },
    });
    if (context.report.reportMessageId) {
      await callQqBotAction("delete_msg", {
        message_id: numericId(context.report.reportMessageId),
      }).catch(() => undefined);
    }

    const successMessage = action === "acknowledge"
      ? "已确认处理，群内通报消息会自动撤回。"
      : action === "kick"
        ? "已将该账号移出群聊，并撤回群内通报消息。"
        : "已将该账号移出群聊、加入本群黑名单，并撤回群内通报消息。";
    return renderState(res, 200, "处理完成", successMessage, "success");
  } catch (error) {
    next(error);
  }
});

function reportTokenHash(token: string) {
  return createHash("sha256").update(`qqbot-ad-report:${token}`).digest("hex");
}

async function loadReportContext(rawToken: unknown) {
  const token = String(rawToken || "").trim();
  if (!REPORT_TOKEN_PATTERN.test(token)) {
    return { ok: false as const, status: 404, title: "链接无效", message: "该管理员处理链接不完整或已经失效。" };
  }
  const report = await prisma.qqBotGroupAdReport.findUnique({
    where: { tokenHash: reportTokenHash(token) },
  });
  if (!report) {
    return { ok: false as const, status: 404, title: "链接无效", message: "没有找到对应的广告通报记录。" };
  }
  const availability = classifyQqBotAdReportAvailability(report.status, report.expiresAt);
  if (availability === "expired") {
    if (report.status === "open") {
      await prisma.qqBotGroupAdReport.update({ where: { id: report.id }, data: { status: "expired" } }).catch(() => undefined);
    }
    return { ok: false as const, status: 410, title: "链接已过期", message: "处理链接已过期，请在群内重新触发通报或人工处理。" };
  }
  const group = await prisma.qqBotGroup.findUnique({ where: { groupId: report.groupId } });
  if (!group) {
    return { ok: false as const, status: 404, title: "群配置不存在", message: "没有找到该群的机器人配置。" };
  }
  return { ok: true as const, report, group };
}

export function classifyQqBotAdReportAvailability(
  status: string,
  expiresAt: Date,
  now = Date.now(),
): "open" | "expired" | "handled" {
  if (status === "expired" || expiresAt.getTime() <= now) return "expired";
  if (status !== "open") return "handled";
  return "open";
}

async function resolveBoundAdmin(userId: number, groupId: string) {
  const binding = await prisma.qqBotBinding.findFirst({
    where: { userId, enabled: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!binding) {
    return {
      ok: false as const,
      status: 403,
      title: "请先绑定 QQ",
      message: "当前站点账号尚未绑定 QQ。请前往个人中心完成绑定后，再重新打开本链接。",
    };
  }
  const permission = await verifyQqBotGroupAdminIdentity(groupId, binding.qqId);
  if (!permission.verified) {
    return {
      ok: false as const,
      status: 403,
      title: "没有管理权限",
      message: `当前账号绑定的 QQ（${maskQq(binding.qqId)}）不是该群的群主或管理员。`,
    };
  }
  return { ok: true as const, qqId: binding.qqId, role: permission.role };
}

function redirectToLogin(req: Request, res: Response) {
  const target = String(req.originalUrl || req.url || "/");
  return res.redirect(302, `/login?redirect=${encodeURIComponent(target)}`);
}

function normalizeAction(value: unknown) {
  const action = String(value || "").trim();
  if (action === "acknowledge" || action === "kick" || action === "kick-block") return action;
  return "";
}

function numericId(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

function maskQq(value: string) {
  if (value.length <= 5) return value;
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderActionPage(report: any, group: any, adminQqId: string) {
  const name = report.offenderNickname ? `${report.offenderNickname}（${report.offenderQqId}）` : report.offenderQqId;
  const actions = [
    `<button class="primary" name="action" value="acknowledge">确认已处理</button>`,
    group.allowKick ? `<button name="action" value="kick">移出群聊</button>` : "",
    group.allowKickAndBlock ? `<button class="danger" name="action" value="kick-block">移出并拉黑</button>` : "",
  ].filter(Boolean).join("");
  return pageShell("处理广告通报", `
    <span class="eyebrow">QQ 群广告过滤</span>
    <h1>处理广告通报</h1>
    <p class="lead">已使用站点账号及绑定 QQ 完成管理员身份核验。</p>
    <div class="card">
      <dl>
        <div><dt>群聊</dt><dd>${escapeHtml(report.groupName || group.name || report.groupId)}</dd></div>
        <div><dt>被通报账号</dt><dd>${escapeHtml(name)}</dd></div>
        <div><dt>累计命中</dt><dd>${escapeHtml(report.hitCount)} 次</dd></div>
        <div><dt>识别原因</dt><dd>${escapeHtml(report.reason)}</dd></div>
        <div><dt>当前管理员</dt><dd>${escapeHtml(maskQq(adminQqId))}</dd></div>
      </dl>
    </div>
    <form method="post" class="actions">${actions}</form>
    <p class="hint">操作提交时会再次实时核验群身份；完成后机器人会自动撤回群内通报消息。</p>
  `);
}

function renderState(res: Response, status: number, title: string, message: string, tone: "normal" | "success" = "normal") {
  return res.status(status).type("html").send(pageShell(title, `
    <div class="state ${tone}"><span class="state-icon">${tone === "success" ? "✓" : "!"}</span></div>
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(message)}</p>
    ${title === "请先绑定 QQ" ? '<a class="button-link" href="/profile">前往个人中心</a>' : '<button onclick="window.close()">关闭页面</button>'}
  `));
}

function pageShell(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 药大拾间</title><style>
  :root{color-scheme:light dark;--bg:#f5f8f7;--card:#fff;--text:#172033;--muted:#6d7b91;--line:#dce6e3;--brand:#4d917d;--brand-soft:#e9f3f0;--danger:#c54c4c}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;display:grid;place-items:center;padding:24px}.shell{width:min(620px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:32px;box-shadow:0 24px 70px rgba(33,70,61,.12)}.eyebrow{display:inline-block;color:var(--brand);font-size:14px;font-weight:700;letter-spacing:.08em}h1{font-size:28px;margin:10px 0 8px}.lead{color:var(--muted);line-height:1.75;margin:0 0 24px}.card{border:1px solid var(--line);border-radius:18px;background:var(--brand-soft);padding:4px 20px}dl{margin:0}dl div{display:grid;grid-template-columns:105px 1fr;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}dl div:last-child{border-bottom:0}dt{color:var(--muted)}dd{margin:0;word-break:break-word}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}button,.button-link{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:12px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block}.primary,.button-link{background:var(--brand);border-color:var(--brand);color:white}.danger{border-color:#e8b8b8;color:var(--danger)}.hint{font-size:13px;color:var(--muted);line-height:1.7;margin:18px 0 0}.state{text-align:center}.state-icon{display:inline-grid;place-items:center;width:64px;height:64px;border-radius:50%;background:#fff2df;color:#b9781f;font-size:32px;font-weight:800}.state.success .state-icon{background:var(--brand-soft);color:var(--brand)}@media(max-width:560px){body{padding:14px}.shell{padding:24px 20px;border-radius:20px}h1{font-size:24px}dl div{grid-template-columns:1fr;gap:5px}.actions{display:grid}.actions button{width:100%}}@media(prefers-color-scheme:dark){:root{--bg:#091713;--card:#10231e;--text:#edf7f4;--muted:#a4b9b2;--line:#29433b;--brand:#69ad99;--brand-soft:#17352d;--danger:#ff9696}.shell{box-shadow:none}.state-icon{background:#3b2c17}}
  </style></head><body><main class="shell">${body}</main></body></html>`;
}
