const MODERN_JWXT_HOST = "jwxt.cpu.edu.cn";
const CPU_ID_SSO_HOST = "id.cpu.edu.cn";

function trustedCpuUrl(value: string, expectedHost: string, pathCheck: (pathname: string) => boolean) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.hostname.toLowerCase() !== expectedHost
    || url.username
    || url.password
    || url.hash
    || !pathCheck(url.pathname)
  ) throw new Error("新版教务统一认证跳转地址不受信任");
  return url;
}

/**
 * jwxt 的 sso.jsp 不直接返回 302，而是返回一段 window.location 脚本。
 * 这里只接受 id.cpu.edu.cn/sso/login，且 service 必须精确回到 jwxt 的 sso.jsp。
 */
export function extractModernJwxtSsoRedirect(html: string, pageUrl: string) {
  trustedCpuUrl(pageUrl, MODERN_JWXT_HOST, (pathname) => pathname === "/jsxsd/sso.jsp");

  const match = html.match(
    /window\.location(?:\.href)?\s*=\s*(["'])([^"']+)\1/i,
  ) || html.match(
    /window\.location\.replace\(\s*(["'])([^"']+)\1\s*\)/i,
  );
  if (!match?.[2]) throw new Error("新版教务未返回统一认证跳转地址");

  const target = trustedCpuUrl(
    new URL(match[2], pageUrl).toString(),
    CPU_ID_SSO_HOST,
    (pathname) => pathname === "/sso/login",
  );
  const serviceValue = target.searchParams.get("service");
  if (!serviceValue) throw new Error("新版教务统一认证缺少 service 参数");
  const service = trustedCpuUrl(
    serviceValue,
    MODERN_JWXT_HOST,
    (pathname) => pathname === "/jsxsd/sso.jsp",
  );
  if (service.search) throw new Error("新版教务统一认证 service 参数不受信任");
  return target.toString();
}

export function isModernJwxtLoginPage(html: string) {
  return /<form\b[^>]*action=["'][^"']*LoginToXk/i.test(html)
    && /name=["']userAccount["']/i.test(html);
}
