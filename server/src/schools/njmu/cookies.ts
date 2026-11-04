/**
 * 按「域名 + 路径」保存的 cookie。南医教务同一个域名下 /sso 和 /jwglxt 各有一个 JSESSIONID，
 * 只按域名存会互相覆盖，教务就拿到了 SSO 那边的会话。
 */
type Cookie = { name: string; path: string; value: string };
export type PathCookieJarJson = Record<string, Array<[name: string, path: string, value: string]>>;

/** RFC 6265 默认路径：请求路径去掉最后一段。 */
function defaultPath(requestPath: string) {
  if (!requestPath.startsWith("/")) return "/";
  const cut = requestPath.lastIndexOf("/");
  return cut <= 0 ? "/" : requestPath.slice(0, cut);
}

function pathMatches(cookiePath: string, requestPath: string) {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

export class PathCookieJar {
  private byHost = new Map<string, Cookie[]>();

  static fromJson(input: PathCookieJarJson | null | undefined) {
    const jar = new PathCookieJar();
    for (const [host, list] of Object.entries(input ?? {})) {
      if (!Array.isArray(list)) continue;
      jar.byHost.set(host, list.filter((item) => Array.isArray(item) && item[0]).map(([name, path, value]) => ({ name, path: path || "/", value: String(value ?? "") })));
    }
    return jar;
  }

  toJson(): PathCookieJarJson {
    const out: PathCookieJarJson = {};
    for (const [host, list] of this.byHost) if (list.length) out[host] = list.map((item) => [item.name, item.path, item.value]);
    return out;
  }

  /** 收下响应里的 Set-Cookie；requestPath 用来算没写 Path 时的默认路径。 */
  ingest(setCookie: string[] | string | null | undefined, host: string, requestPath = "/") {
    if (!setCookie) return;
    for (const header of Array.isArray(setCookie) ? setCookie : [setCookie]) {
      const [pair, ...attributes] = header.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let path = defaultPath(requestPath);
      let expired = value === "";
      for (const attribute of attributes) {
        const [key, ...rest] = attribute.split("=");
        const attrName = key.trim().toLowerCase();
        const attrValue = rest.join("=").trim();
        if (attrName === "path" && attrValue.startsWith("/")) path = attrValue;
        if (attrName === "max-age" && Number(attrValue) <= 0) expired = true;
        if (attrName === "expires" && Date.parse(attrValue) < Date.now()) expired = true;
      }
      const list = (this.byHost.get(host) ?? []).filter((item) => !(item.name === name && item.path === path));
      if (!expired) list.push({ name, path, value });
      this.byHost.set(host, list);
    }
  }

  /** 请求头里的 Cookie：只带路径匹配的，路径长的排前面。 */
  serializeFor(url: URL) {
    return (this.byHost.get(url.host) ?? [])
      .filter((item) => pathMatches(item.path, url.pathname))
      .sort((a, b) => b.path.length - a.path.length)
      .map((item) => `${item.name}=${item.value}`)
      .join("; ");
  }

  value(host: string, name: string) {
    return (this.byHost.get(host) ?? []).find((item) => item.name === name)?.value ?? "";
  }

  cookies(host: string) {
    return [...(this.byHost.get(host) ?? [])];
  }

  clearHost(host: string) {
    this.byHost.delete(host);
  }
}
