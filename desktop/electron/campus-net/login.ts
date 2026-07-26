import {
  Carrier,
  CampusMode,
  CHKSTATUS_URL,
  FATAL_MESSAGE_HINTS,
  REQUEST_TIMEOUT_MS
} from "./constants";
import { campusLog } from "./log";
import { detectLocalIp, httpGetText } from "./net";
import {
  buildLoginUrl,
  isValidStudentId,
  LoginResult,
  parseJsonp,
  parseLoginResponse,
  redactUrl,
  resolveMode,
  ResolvedMode
} from "./protocol";
import { readCampusCredential } from "./credential-store";

export type LoginOptions = {
  mode: CampusMode;
  carrier: Carrier;
  wlanAcIp?: string;
  wlanAcName?: string;
  // 环境探测已经确定了接入方式与本机地址时传进来，省一轮重复探测
  resolvedMode?: ResolvedMode;
  localIp?: string;
};

export type LoginOutcome = LoginResult & { mode?: ResolvedMode; localIp?: string };

// chkstatus 只是拿网关看到的那个 IP（ss5），不是挑战值。
// 拿不到就用本机 IP 顶上，绝不能因此中断登录。
const fetchGatewayIp = async (mode: ResolvedMode): Promise<string | undefined> => {
  try {
    const response = await httpGetText(CHKSTATUS_URL[mode], REQUEST_TIMEOUT_MS);
    const payload = parseJsonp<{ ss5?: string }>(response.body);
    const ip = payload?.ss5?.trim();
    return ip || undefined;
  } catch {
    return undefined;
  }
};

export const performLogin = async (options: LoginOptions): Promise<LoginOutcome> => {
  const credential = await readCampusCredential();
  if (!credential) {
    return { ok: false, alreadyOnline: false, fatal: true, message: "尚未保存校园网学号与密码" };
  }
  const studentId = credential.studentId.trim();
  if (!isValidStudentId(studentId)) {
    return { ok: false, alreadyOnline: false, fatal: true, message: "学号格式不正确" };
  }

  const localIp = options.localIp ?? await detectLocalIp();
  if (!localIp) {
    return { ok: false, alreadyOnline: false, fatal: false, message: "取不到本机地址，请检查网络连接后重试" };
  }

  const mode = options.resolvedMode ?? resolveMode(options.mode, localIp);
  if (mode === "pppoe" && !options.carrier) {
    return { ok: false, alreadyOnline: false, fatal: true, message: "宽带模式需要先选择运营商", mode, localIp };
  }

  const wlanUserIp = (await fetchGatewayIp(mode)) ?? localIp;
  const url = buildLoginUrl({
    mode,
    studentId,
    password: credential.password,
    carrier: options.carrier,
    wlanUserIp,
    wlanAcIp: options.wlanAcIp,
    wlanAcName: options.wlanAcName
  });
  campusLog("info", `发起认证（${mode === "pppoe" ? "宽带" : "校园网"}，出口 ${wlanUserIp}）：${redactUrl(url)}`);

  try {
    const response = await httpGetText(url, REQUEST_TIMEOUT_MS);
    const result = parseLoginResponse(response.body, FATAL_MESSAGE_HINTS);
    campusLog(result.ok ? "info" : "warn", `认证结果：${result.message}`);
    return { ...result, mode, localIp };
  } catch (error) {
    const message = "网络连接失败，请确认已连上校园网；使用路由器时请确认是自动获取 IP";
    campusLog("error", `${message}（${error instanceof Error ? error.message : String(error)}）`);
    return { ok: false, alreadyOnline: false, fatal: false, message, mode, localIp };
  }
};
