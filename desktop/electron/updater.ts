import { app, Notification, shell } from "electron";
import { oauthConfig } from "./config";

// 只做"发现新版本并提示"，不做静默下载替换。
//
// 原因是安装包没有代码签名：electron-updater 在 Windows 上靠签名的发布者信息
// 验证更新包，未签名就只能关掉校验，那等于在所有用户机器上装了一条不可验真的
// 代码执行通道。改成提示 + 跳浏览器下载，用户仍然自己决定运行安装包，
// 信任锚点是主站的 HTTPS 证书。
//
// 将来拿到代码签名证书，可以换成 electron-updater 做真正的自动更新。

export type UpdateInfo = {
  current: string;
  latest: string;
  url: string;
  hasUpdate: boolean;
};

// "1.10.2" 要比 "1.9.0" 新，所以必须按段做数值比较，不能字符串比大小
export const compareVersions = (left: string, right: string): number => {
  const parse = (value: string): number[] =>
    value.trim().replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

export const checkForUpdate = async (): Promise<UpdateInfo> => {
  const current = app.getVersion();
  const empty: UpdateInfo = { current, latest: "", url: "", hasUpdate: false };
  try {
    const response = await fetch(new URL("/api/site/downloads/desktop", oauthConfig.origin).toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return empty;
    const payload = await response.json() as { data?: { available?: boolean; url?: string; version?: string } };
    const info = payload.data ?? {};
    const latest = String(info.version ?? "").trim();
    const url = String(info.url ?? "").trim();
    // 服务端没填版本号就无从比较，宁可不提示也不要误报
    if (!info.available || !latest || !url) return empty;
    return { current, latest, url, hasUpdate: compareVersions(latest, current) > 0 };
  } catch {
    return empty;
  }
};

export const openUpdateDownload = (url: string): void => {
  try {
    // 服务端可能给相对路径（下载走我们自己的跳转端点时），按主站地址补全。
    // 不补的话 new URL 直接抛错，表现为"点了去下载什么都没发生"。
    const target = new URL(url, oauthConfig.origin);
    if (target.protocol === "https:") void shell.openExternal(target.href);
  } catch {
    // 地址不合法就什么都不做
  }
};

export const notifyUpdate = (info: UpdateInfo): void => {
  if (!info.hasUpdate) return;
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: "药大拾间桌面端有新版本",
      body: `当前 v${info.current}，最新 v${info.latest}。点击前往下载。`
    });
    notification.on("click", () => openUpdateDownload(info.url));
    notification.show();
  } catch {
    // 通知失败不影响主流程
  }
};
