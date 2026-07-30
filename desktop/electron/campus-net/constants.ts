// 校园网认证的固定参数，来自 cpu_net（GPL-3.0）的 src/Core/Constants/NetworkConstants.cs。
//
// 这是 DrCOM eportal 的明文口令分支：没有挑战值、没有加密、没有签名，
// 学号和密码直接进 URL query。整条链路是明文 HTTP，且只在校内网关之间跑。
//
// 这些明文地址只允许 campus-net/ 内部使用。应用其余部分（导航、用户脚本代理）
// 一律 https-only，不要因为这里有 http 就去放宽 electron/policy.ts。

export type CampusMode = "pppoe" | "campus" | "auto";
export type Carrier = "" | "cmcc" | "unicom" | "telecom";

// 宽带（运营商 PPPoE）网关
export const BROADBAND_GATEWAY = "172.17.253.3";
// 校园网网关
export const CAMPUS_GATEWAY = "192.168.199.21";

export const CHKSTATUS_URL: Record<"pppoe" | "campus", string> = {
  pppoe: `http://${BROADBAND_GATEWAY}/drcom/chkstatus?callback=dr1002`,
  campus: `http://${CAMPUS_GATEWAY}/drcom/chkstatus?callback=dr1002`
};

export const LOGIN_BASE: Record<"pppoe" | "campus", string> = {
  pppoe: `http://${BROADBAND_GATEWAY}:801/eportal/portal/login?callback=dr1004&login_method=1`,
  campus: `http://${CAMPUS_GATEWAY}:801/eportal/?c=Portal&a=login&callback=dr1004&login_method=1`
};

// 运营商后缀。校园网模式不带后缀 —— 它不是第四个运营商，是另一套入口。
export const CARRIER_SUFFIX: Record<Carrier, string> = {
  "": "",
  cmcc: "%40cmcc",
  unicom: "%40unicom",
  telecom: "%40telecom"
};

export const CARRIER_LABEL: Record<Carrier, string> = {
  "": "未选择",
  cmcc: "中国移动",
  unicom: "中国联通",
  telecom: "中国电信"
};

// UDP 选路探测：只 connect 不发包，让内核按路由表选出口网卡。
// 比 os.networkInterfaces() 可靠 —— 后者在装了 VMware / WSL / Hyper-V 的机器上会挑错网卡。
export const PROBE_HOST = "8.8.8.8";
export const PROBE_PORT = 65530;

export const DEFAULT_TEST_URL = "http://www.msftconnecttest.com/connecttest.txt";
export const DEFAULT_TEST_CODE = "Microsoft Connect Test";

export const REQUEST_TIMEOUT_MS = 5000;
export const LOCAL_IP_TIMEOUT_MS = 2000;

// 网关探测要快：它只用来回答"人在不在校园网里"，不在的时候连不上是常态，
// 不该让用户等 5 秒。
export const GATEWAY_PROBE_TIMEOUT_MS = 1500;

// 原版是 5 秒轮询且不防重入，弱网下请求会叠在一起。15 秒足够，下限 5 秒。
export const DEFAULT_INTERVAL_SEC = 15;
export const MIN_INTERVAL_SEC = 5;
export const MAX_INTERVAL_SEC = 600;

// 网络已经稳定连通时不需要继续按重连频率探测。网卡变化、系统唤醒和解锁都会
// 立即触发检测，所以 30 秒足以兼顾校园网会话掉线后的恢复速度与后台资源占用。
export const HEALTHY_PROBE_INTERVAL_SEC = 30;

// 判定为不在校园网之后的轮询间隔。在家用的人不该每 15 秒被探一次，
// 真正把人带回校园网的是换网络这件事，那个由网卡签名变化即时触发。
export const OFF_CAMPUS_INTERVAL_SEC = 120;
// 网卡地址变化的检查间隔。纯本地读取，不产生任何网络请求。
export const NETWORK_WATCH_INTERVAL_MS = 4000;

// 退避与熔断。临时故障会持续低频重试，只有明确的凭据类错误才暂停；
// 这样学校维护或时间策略限制解除后，客户端能够自行恢复。
export const MAX_BACKOFF_MS = 300_000;

// 服务端 msg 没有错误码枚举，只能软判定。命中即认为是凭据类不可恢复错误，
// 立刻暂停自动重连，不等失败计数攒到上限。
export const FATAL_MESSAGE_HINTS = ["密码", "账号", "帐号", "欠费", "不存在", "停机", "禁用"];
