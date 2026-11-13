/**
 * 鸿蒙 App 的华为应用内支付桥（原生一侧见 harmony/entry/src/main/ets/common/HarmonyIap.ets）。
 * 原生只转 IAP Kit 的动作；界面、向服务端交单、何时确认发货都在网页里（views/profile/HarmonySponsor.vue）。
 *
 * 原生通过 window.CPUHarmony.iapRequest(id, action, payloadJson) 收请求，
 * 结果用 window.__cpuHarmonyIapResult(id, replyJson) 送回来。带这个方法的是 3.4.0 起的 App。
 */
export type HarmonyIapAction = "environment" | "products" | "purchase" | "unfinished" | "finish";

export type HarmonyIapProduct = {
  id: string;
  name: string;
  description: string;
  localPrice: string;
  microPrice: number;
  currency: string;
};

export type HarmonyIapReply = {
  ok: boolean;
  code?: number;
  message?: string;
  products?: HarmonyIapProduct[];
  purchaseData?: string;
  purchaseDataList?: string[];
};

/** IAP Kit 的错误码里页面要区别对待的几个；负数是桥自己的。 */
export const HARMONY_IAP_CODE = {
  timeout: -1,
  userCanceled: 1001860000,
  systemError: 1001860001,
  networkError: 1001860005,
  notLoggedIn: 1001860050,
  productOwned: 1001860051,
  territoryNotSupported: 1001860054,
} as const;

type Host = { iapRequest?: (id: string, action: string, payload: string) => void };

function host(): Host | null {
  if (typeof window === "undefined") return null;
  const value = (window as any).CPUHarmony as Host | undefined;
  return value && typeof value.iapRequest === "function" ? value : null;
}

export function hasHarmonyIapBridge() {
  return host() !== null;
}

const pending = new Map<string, (reply: HarmonyIapReply) => void>();
let sequence = 0;

function install() {
  const target = window as any;
  if (typeof target.__cpuHarmonyIapResult === "function") return;
  target.__cpuHarmonyIapResult = (id: unknown, replyJson: unknown) => {
    const resolve = pending.get(String(id));
    if (!resolve) return;
    pending.delete(String(id));
    let reply: HarmonyIapReply = { ok: false, code: HARMONY_IAP_CODE.timeout, message: "" };
    try {
      const parsed = JSON.parse(String(replyJson));
      if (parsed && typeof parsed === "object") reply = parsed as HarmonyIapReply;
    } catch {
      // keep the failure reply
    }
    resolve(reply);
  };
}

/**
 * 发一个请求。`timeoutMs` 为 0 时不超时：收银台开着的时候用户可以想多久就多久。
 * 不抛错，失败在返回值的 ok / code 里。
 */
export function harmonyIapRequest(action: HarmonyIapAction, payload: Record<string, unknown> = {}, timeoutMs = 20000): Promise<HarmonyIapReply> {
  const bridge = host();
  if (!bridge) return Promise.resolve({ ok: false, code: HARMONY_IAP_CODE.timeout, message: "bridge unavailable" });
  install();
  sequence += 1;
  const id = `iap_${Date.now().toString(36)}_${sequence}`;
  return new Promise((resolve) => {
    let timer = 0;
    pending.set(id, (reply) => {
      if (timer) window.clearTimeout(timer);
      resolve(reply);
    });
    if (timeoutMs > 0) {
      timer = window.setTimeout(() => {
        if (!pending.delete(id)) return;
        resolve({ ok: false, code: HARMONY_IAP_CODE.timeout, message: "timeout" });
      }, timeoutMs);
    }
    try {
      bridge.iapRequest!(id, action, JSON.stringify(payload));
    } catch {
      pending.delete(id);
      if (timer) window.clearTimeout(timer);
      resolve({ ok: false, code: HARMONY_IAP_CODE.timeout, message: "bridge failed" });
    }
  });
}

/** 把 IAP Kit 的错误码变成给用户看的一句话；用户自己取消返回空串。 */
export function harmonyIapErrorText(reply: HarmonyIapReply, fallback: string) {
  switch (reply.code) {
    case HARMONY_IAP_CODE.userCanceled: return "";
    case HARMONY_IAP_CODE.networkError: return "网络连接异常，请稍后再试";
    case HARMONY_IAP_CODE.notLoggedIn: return "请先在系统设置里登录华为账号";
    case HARMONY_IAP_CODE.territoryNotSupported: return "当前华为账号所在的地区暂不支持应用内购买";
    default: return fallback;
  }
}
