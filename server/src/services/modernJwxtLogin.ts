import * as cheerio from "cheerio";

export interface ModernJwxtLoginState {
  entryUrl: string;
  loginUrl: string;
  scode: string;
  sxh: string;
}

export function validateModernJwxtLoginState(value: unknown): ModernJwxtLoginState {
  const state = value as Partial<ModernJwxtLoginState>;
  if (
    typeof state?.entryUrl !== "string"
    || typeof state.loginUrl !== "string"
    || typeof state.scode !== "string"
    || typeof state.sxh !== "string"
    || !/^[A-Za-z0-9]{55,512}$/.test(state.scode)
    || !/^\d{55,512}$/.test(state.sxh)
  ) throw new Error("新版教务登录状态无效");

  const entry = new URL(state.entryUrl);
  const login = new URL(state.loginUrl);
  if (
    entry.protocol !== "https:"
    || login.protocol !== "https:"
    || entry.hostname !== "jwxt.cpu.edu.cn"
    || login.hostname !== "jwxt.cpu.edu.cn"
    || entry.username
    || entry.password
    || entry.hash
    || login.username
    || login.password
    || login.hash
    || !entry.pathname.startsWith("/jsxsd/")
    || login.pathname !== "/jsxsd/xk/LoginToXk"
  ) throw new Error("新版教务登录地址不受信任");

  return {
    entryUrl: entry.toString(),
    loginUrl: login.toString(),
    scode: state.scode,
    sxh: state.sxh,
  };
}

export function parseModernJwxtLoginPage(html: string, pageUrl: string): ModernJwxtLoginState {
  const $ = cheerio.load(html);
  const $form = $('form[action*="LoginToXk"]').first();
  const action = ($form.attr("action") || "").trim();
  if (!$form.length || !action || !$form.find('input[name="userAccount"]').length) {
    throw new Error("无法解析新版教务登录页");
  }

  const codeMatch = html.match(
    /var\s+scode\s*=\s*["']([^"']+)["']\s*;\s*var\s+sxh\s*=\s*["']([^"']+)["']/,
  );
  if (!codeMatch || !codeMatch[1] || !/^\d{55,}$/.test(codeMatch[2])) {
    throw new Error("无法解析新版教务登录加密参数");
  }

  const entry = new URL(pageUrl);
  const login = new URL(action, entry);
  if (entry.hostname !== "jwxt.cpu.edu.cn" || login.hostname !== "jwxt.cpu.edu.cn") {
    throw new Error("新版教务登录地址不受信任");
  }

  return validateModernJwxtLoginState({
    entryUrl: entry.toString(),
    loginUrl: login.toString(),
    scode: codeMatch[1],
    sxh: codeMatch[2],
  });
}

/** 与新版登录页 conwork.js 中的 encodeInp 保持一致。 */
export function encodeModernJwxtInput(input: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let output = "";
  let index = 0;
  do {
    const chr1 = input.charCodeAt(index++);
    const chr2 = input.charCodeAt(index++);
    const chr3 = input.charCodeAt(index++);
    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
    let enc4 = chr3 & 63;
    if (Number.isNaN(chr2)) enc3 = enc4 = 64;
    else if (Number.isNaN(chr3)) enc4 = 64;
    output += alphabet.charAt(enc1) + alphabet.charAt(enc2) + alphabet.charAt(enc3) + alphabet.charAt(enc4);
  } while (index < input.length);
  return output;
}

export function buildModernJwxtEncodedCredentials(
  username: string,
  password: string,
  state: Pick<ModernJwxtLoginState, "scode" | "sxh">,
) {
  const code = [
    encodeModernJwxtInput(username),
    encodeModernJwxtInput(password),
    encodeModernJwxtInput(" "),
  ].join("%%%");
  let scode = state.scode;
  let encoded = "";

  for (let index = 0; index < code.length; index++) {
    if (index >= 55) {
      encoded += code.slice(index);
      break;
    }
    const take = Number.parseInt(state.sxh.charAt(index), 10);
    if (!Number.isFinite(take) || take < 0 || scode.length < take) {
      throw new Error("新版教务登录加密参数无效");
    }
    encoded += code.charAt(index) + scode.slice(0, take);
    scode = scode.slice(take);
  }
  return encoded;
}

export function isModernJwxtLoginPage(html: string) {
  return /<form\b[^>]*action=["'][^"']*LoginToXk/i.test(html)
    && /name=["']userAccount["']/i.test(html);
}

export function parseModernJwxtLoginError(html: string) {
  const $ = cheerio.load(html);
  return $("#showMsg, .alert-danger, .errors, .login-error, .errorTip").first().text().trim()
    || "新版教务登录失败，请检查账号、密码和验证码";
}
