import { CampusMode, CHKSTATUS_URL, GATEWAY_PROBE_TIMEOUT_MS } from "./constants";
import { detectLocalIp, httpGetText } from "./net";
import { resolveMode, ResolvedMode } from "./protocol";

// 原版没有这一步：它只按本机 IP 段猜接入方式，然后不管人在哪都往校园网网关撞。
// 结果在家里断一下网，就会去认证一个根本不存在的网关，失败、退避、最后弹"认证失败"。
//
// 这里改成直接问网关在不在。DrCOM 的 chkstatus 只在校内网络里可达，
// 能收到任何 HTTP 响应就说明人在校园网里，收不到就是在别处。

export type CampusEnvironment = {
  onCampus: boolean;
  mode?: ResolvedMode;
  localIp?: string;
};

const gatewayResponds = async (mode: ResolvedMode): Promise<boolean> => {
  try {
    // 状态码无所谓，能应答就说明这个网关存在
    await httpGetText(CHKSTATUS_URL[mode], GATEWAY_PROBE_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
};

export const detectEnvironment = async (preferred: CampusMode): Promise<CampusEnvironment> => {
  const localIp = await detectLocalIp();
  const [campusUp, pppoeUp] = await Promise.all([gatewayResponds("campus"), gatewayResponds("pppoe")]);

  const available: ResolvedMode[] = [];
  if (campusUp) available.push("campus");
  if (pppoeUp) available.push("pppoe");
  if (available.length === 0) return { onCampus: false, localIp };

  // 用户显式指定的接入方式优先；它的网关没应答但另一个应答了，就按实际网络走
  // —— 比让用户自己发现"我设错了"要好。
  if (preferred !== "auto" && available.includes(preferred)) return { onCampus: true, mode: preferred, localIp };
  if (available.length === 1) return { onCampus: true, mode: available[0], localIp };

  // 两个网关都通（少见），回落到按 IP 段判断
  return { onCampus: true, mode: resolveMode(preferred, localIp ?? ""), localIp };
};
