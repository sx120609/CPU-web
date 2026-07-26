import { CARRIER_SUFFIX, Carrier, CampusMode, LOGIN_BASE } from "./constants";

// 纯函数，无 IO。scripts/campus-net-test.cjs 直接对这里做断言。

export type ResolvedMode = "pppoe" | "campus";

export type LoginResult = {
  ok: boolean;
  alreadyOnline: boolean;
  fatal: boolean;
  message: string;
};

// 剥 JSONP 外壳。两个接口的外壳不一样（chkstatus 结尾无分号，login 有），
// 用同一个正则吃掉，不要抄原版那两套写死的字符偏移。
export const parseJsonp = <T>(raw: string): T | undefined => {
  const matched = /^[^(]*\(([\s\S]*?)\)\s*;?\s*$/.exec(raw.trim());
  if (!matched) return undefined;
  try {
    return JSON.parse(matched[1]) as T;
  } catch {
    return undefined;
  }
};

// auto 模式下按本机 IP 段猜入口。
// 注意 192.* 被判为宽带，尽管校园网网关本身是 192.168.199.21 ——
// 这是原版的有意为之（宿舍路由器 NAT 之后是 192.168.x），所以 UI 必须允许手动覆盖。
export const resolveMode = (setting: CampusMode, localIp: string): ResolvedMode => {
  if (setting !== "auto") return setting;
  const parts = localIp.split(".");
  if (parts.length !== 4) return "campus";
  if (parts[0] === "192") return "pppoe";
  if (parts[0] === "10" && ["12", "31", "33"].includes(parts[1])) return "pppoe";
  return "campus";
};

export const isValidStudentId = (value: string): boolean => /^[A-Za-z0-9]+$/.test(value.trim());

export type LoginUrlInput = {
  mode: ResolvedMode;
  studentId: string;
  password: string;
  carrier: Carrier;
  wlanUserIp: string;
  wlanAcIp?: string;
  wlanAcName?: string;
};

// 参数顺序、重复的 lang、写死的 mac 全部照抄原版，不要"整理"。
// %2C0%2C 是已编码的 ",0,"（DrCOM 的账号域标记），%40 是 "@" ——
// 千万不能对整段再 encodeURIComponent，否则会变成 %252C。
// 也不要用 URLSearchParams：它会二次编码、合并重复键、可能重排顺序。
export const buildLoginUrl = (input: LoginUrlInput): string => {
  const suffix = input.mode === "pppoe" ? CARRIER_SUFFIX[input.carrier] : "";
  // 原版不对密码做任何编码，密码里有 & % + # 或空格就把 URL 拼坏了。这里修掉。
  const password = encodeURIComponent(input.password);
  const shared = [
    `user_account=%2C0%2C${input.studentId}${suffix}`,
    `user_password=${password}`,
    `wlan_user_ip=${input.wlanUserIp}`,
    "wlan_user_ipv6=",
    "wlan_user_mac=000000000000",
    `wlan_ac_ip=${input.wlanAcIp ?? ""}`,
    `wlan_ac_name=${input.wlanAcName ?? ""}`
  ];
  const tail = input.mode === "pppoe"
    ? ["jsVersion=4.2.2", "terminal_type=1", "lang=zh-cn", "v=9745", "lang=zh"]
    : ["jsVersion=3.3.3", "v=1954"];
  return `${LOGIN_BASE[input.mode]}&${[...shared, ...tail].join("&")}`;
};

// 日志与 UI 都用它。无条件生效 —— 原版把这道防线挂在一个用户可开的 TestMode 开关上，
// 结果默认就往日志里写明文密码。
export const redactUrl = (value: string): string =>
  value.replace(/([?&](?:user_password|password|secret)=)[^&]*/gi, "$1***");

type LoginPayload = { result?: number; ret_code?: number; msg?: string };

export const parseLoginResponse = (raw: string, hints: readonly string[]): LoginResult => {
  const payload = parseJsonp<LoginPayload>(raw);
  if (!payload) return { ok: false, alreadyOnline: false, fatal: false, message: "网络错误" };
  if (payload.result === 1) return { ok: true, alreadyOnline: false, fatal: false, message: "登录成功" };
  if (payload.result === 0 && payload.ret_code === 2) {
    return { ok: true, alreadyOnline: true, fatal: false, message: "本设备已在线，无需重复登录" };
  }
  // 服务端 msg 没有码表，原文透传给用户比自建映射靠谱
  const message = (payload.msg || "").trim() || "登录失败";
  return { ok: false, alreadyOnline: false, fatal: hints.some((hint) => message.includes(hint)), message };
};
