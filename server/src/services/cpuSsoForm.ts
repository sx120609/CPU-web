import * as cheerio from "cheerio";

const CPU_ID_SSO_HOST = "id.cpu.edu.cn";

export interface CpuSsoPasswordForm {
  hidden: Record<string, string>;
  submitUrl: string;
  needCaptcha: boolean;
}

function assertTrustedCpuSsoUrl(url: URL) {
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.host.toLowerCase() !== CPU_ID_SSO_HOST
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error("统一认证登录表单提交地址不受信任");
  }
}

export function buildCpuSsoSubmitUrl(
  pageUrl: string,
  hidden: Record<string, string>,
  formAction = "/sso/login",
) {
  const page = new URL(pageUrl);
  assertTrustedCpuSsoUrl(page);

  const submit = new URL(formAction || "/sso/login", page);
  if (hidden.service) submit.searchParams.set("service", hidden.service);
  assertTrustedCpuSsoUrl(submit);
  return submit.toString();
}

export function parseCpuSsoPasswordForm(html: string, pageUrl: string): CpuSsoPasswordForm {
  const $ = cheerio.load(html);
  let form = $("form#loginForm").first();
  if (!form.length) {
    form = $("form").filter((_, element) => {
      const candidate = $(element);
      return candidate.find('input[name="username"]').length > 0
        && candidate.find('input[name="password"]').length > 0;
    }).first();
  }
  if (!form.length) {
    throw new Error("无法解析统一认证密码登录表单");
  }

  const hidden: Record<string, string> = {};
  form.find('input[type="hidden"][name]').each((_, element) => {
    const input = $(element);
    const name = (input.attr("name") || "").trim();
    if (name) hidden[name] = (input.attr("value") || "").trim();
  });
  if (!hidden.execution) {
    throw new Error("无法解析统一认证登录页（缺少 execution）。学校 SSO 可能已变更，请联系管理员。");
  }

  return {
    hidden,
    submitUrl: buildCpuSsoSubmitUrl(pageUrl, hidden, (form.attr("action") || "").trim()),
    // useVCode 表示本次请求确实要求验证码；isUseVCode 只是功能总开关。
    needCaptcha: hidden.useVCode === "true",
  };
}

/** 与学校登录页 login() 中的两次 Base64 完全一致；不规范化或改写任何字符。 */
export function encodeCpuSsoCredential(value: string) {
  const once = Buffer.from(value, "utf8").toString("base64");
  return Buffer.from(once, "utf8").toString("base64");
}

export function buildCpuSsoSubmitBody(
  hidden: Record<string, string>,
  args: { username: string; password: string; captcha?: string },
) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(hidden)) body.set(key, value);
  if (!body.get("_eventId")) body.set("_eventId", "submit");
  body.set("username", encodeCpuSsoCredential(args.username));
  body.set("password", encodeCpuSsoCredential(args.password));
  // 官方表单中该复选框默认选中；服务端不会执行页面保存账号密码的 JavaScript。
  body.set("rememberpwd", "on");

  if (args.captcha) {
    // 验证码输入框会由 SSO 页面按错误次数动态插入，兼容已观察到的字段名。
    body.set("rcode", args.captcha);
    body.set("vCode", args.captcha);
    body.set("captcha", args.captcha);
    body.set("authCode", args.captcha);
  }
  return body;
}

export function buildCpuSsoSubmitHeaders(pageUrl: string, submitUrl: string) {
  const page = new URL(pageUrl);
  const submit = new URL(submitUrl);
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: submit.origin,
    Referer: page.toString(),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
  };
}
