export function isLegacyJwxtLoginPage(html: string) {
  const hasPasswordInput = /<input\b[^>]*(?:type=["']password["']|name=["']password["'])/i.test(html);
  const hasLoginForm = /<form\b[^>]*(?:id=["']loginForm["']|action=["'][^"']*(?:login|logon)[^"']*["'])/i.test(html);
  const hasLoginCopy = /请先登录系统|登录个人中心|登录超时|重新登录/u.test(html);
  const hasLegacyLoginTitle = /<title\b[^>]*>[^<]*综合教务管理系统[^<]*<\/title>/iu.test(html);

  return (hasPasswordInput && (hasLoginForm || hasLoginCopy || hasLegacyLoginTitle))
    || (hasLoginForm && hasLoginCopy);
}
