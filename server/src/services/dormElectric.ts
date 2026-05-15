/**
 * 宿舍用电查询
 *
 * 校园侧入口 SPA：http://10.200.13.18:8899/h5/#/?no={学号}
 * SPA 自己算 sign 然后 POST 到 /api/wxapp/my3 拿数据。我们绕开 SPA 直接调它的 API。
 *
 * sign 算法（从 SPA 的 index.xxxxx.js 反编译得到）：
 *   1. 收集 body 里除 sign 外的所有 key，按字母序排序
 *   2. 拼接：lowercase(key1)=value1&lowercase(key2)=value2&...&key=SALT
 *      - 对 Object/Array 值用 JSON.stringify，其他值直接 toString（boolean true → "true"）
 *      - 末尾的 `key` 是字面量字符串 "key"，不是占位
 *   3. 整段做 SHA1（hex 小写 40 字符）
 *
 * SALT 与 appId 来自 SPA 源码硬编码，所有学号共用。
 *
 * ⚠️ 仅校园网可达：10.200.13.18 是内网 IP。**部署服务器必须在校园网**或能 VPN 到校园网。
 */
import { createHash } from "node:crypto";

/**
 * 校园侧 API base URL。
 *
 * 默认指向校内私网 IP——仅当部署服务器**也在校园网**时可用。
 * 公网部署时可用 frp 内网穿透：把 10.200.13.18:8899 暴露成公网域名/端口，
 * 然后设环境变量 DORM_ELECTRIC_BASE 覆盖。例如：
 *   DORM_ELECTRIC_BASE=http://electric.lizmt.cn
 *   DORM_ELECTRIC_BASE=https://cpu-tunnel.example.com:23456
 *
 * 注意：sign 算法和 SALT 与 host 无关，所以替换 base 不需要改任何其他代码。
 * 但学校原始服务器可能根据 Host header 校验，frp 用 type=tcp 转发最稳。
 */
/**
 * 校园侧 API base URL —— **每次调用读 env**，避免模块加载顺序与 dotenv.config()
 * 竞速时拿到 undefined 退回默认值。
 *
 * 默认 http://10.200.13.18:8899 仅校园网可达。公网部署时设 .env：
 *   DORM_ELECTRIC_BASE=http://sz.weicheng.wang:8899
 */
function getBaseUrl(): string {
  return (process.env.DORM_ELECTRIC_BASE || "http://10.200.13.18:8899").replace(/\/$/, "");
}

const APP_ID = "XzJ0YzzEtk0HbVOk";
const SIGN_SALT = "ruGQQlUhZxJhQqKY8lYGYcN6UJWwNRL3";

/** 复现 SPA 的 getSign(body) */
function computeSign(body: Record<string, unknown>): string {
  const keys = Object.keys(body).filter((k) => k !== "sign").sort();
  let s = "";
  for (const k of keys) {
    let v = body[k];
    if (v === undefined || v === null) v = "";
    const valueStr = (typeof v === "object")
      ? JSON.stringify(v)
      : String(v); // boolean true → "true"; number 5 → "5"
    s += `${k.toLowerCase()}=${valueStr}&`;
  }
  s += `key=${SIGN_SALT}`;
  return createHash("sha1").update(s).digest("hex");
}

const CACHE_TTL_MS = 30_000;

export interface DormElectricResult {
  /** 剩余金额（元） */
  balance: number | null;
  /** 剩余电量（度 / kWh） */
  remainKwh: number | null;
  /** 累计已用电量（度） */
  usedKwh: number | null;
  /** 电价（元/度） */
  price: number | null;
  /** 房间，如 "0313房间" */
  room: string | null;
  /** 楼栋，如 "H6" */
  building: string | null;
  /** 楼层，如 "第3层" */
  floor: string | null;
  /** 校区，如 "江宁校区" */
  area: string | null;
  /** 抄表时间，如 "2026-05-15 13:05" */
  lastUpdate: string | null;
  /** 原始响应（调试用） */
  raw?: unknown;
}

const cache = new Map<string, { at: number; result: DormElectricResult }>();

export async function queryDormElectric(studentNo: string): Promise<DormElectricResult> {
  if (!studentNo) throw new Error("学号为空");

  const cached = cache.get(studentNo);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const payload: Record<string, unknown> = {
    appId: APP_ID,
    openId: studentNo, // SPA 里这个字段是 sessionId，?no=学号 进入时 SPA 把学号写入 sessionId
    stuNo: true,
  };
  payload.sign = computeSign(payload);

  const base = getBaseUrl();
  const targetUrl = `${base}/api/wxapp/my3`;

  let resp: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      resp = await fetch(targetUrl, {
        method: "POST",
        headers: { "accept": "*/*", "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`查询超时（${targetUrl}），请稍后重试`);
    throw new Error(`无法访问宿舍电费接口（实际请求 ${targetUrl}）：${e?.message || e}`);
  }

  if (!resp.ok) {
    throw new Error(`电费接口返回 HTTP ${resp.status}`);
  }

  let body: any;
  try { body = await resp.json(); }
  catch { throw new Error("电费接口返回格式异常"); }

  // 校园侧通常会用 { code, msg, data } 包裹，sign 错时 code != 0
  if (typeof body?.code === "number" && body.code !== 0) {
    const msg = body?.msg || body?.message || "校园侧拒绝";
    if (/sign|签名/i.test(String(msg))) {
      throw new Error(`签名失效（${msg}）—— 学校可能已更换 SALT，需要重新抓取 SPA 源码`);
    }
    throw new Error(`校园侧返回错误：${msg}`);
  }

  const result = normalize(body);
  cache.set(studentNo, { at: Date.now(), result });
  return result;
}

/**
 * 校园侧响应结构（实测）：
 *   [{
 *     rid, name: "0313房间", areaName: "江宁校区",
 *     buiName: "H6", floorName: "第3层",
 *     meters: [{ val, remain, amount, price, readTime, ... }],
 *     waters: [], errCode: 0, errMsg: null
 *   }]
 *
 * 学号没绑宿舍时返回 [] 或带 errCode != 0。
 */
function normalize(j: unknown): DormElectricResult {
  const arr = Array.isArray(j) ? (j as any[]) : null;
  const room: any = arr ? arr[0] : (j as any);
  if (!room || (typeof room.errCode === "number" && room.errCode !== 0)) {
    return {
      balance: null, remainKwh: null, usedKwh: null, price: null,
      room: null, building: null, floor: null, area: null, lastUpdate: null,
      raw: j,
    };
  }
  const meter = Array.isArray(room.meters) ? room.meters[0] : null;

  const n = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const x = parseFloat(v);
      return Number.isFinite(x) ? x : null;
    }
    return null;
  };

  return {
    balance: n(meter?.amount),
    remainKwh: n(meter?.remain),
    usedKwh: n(meter?.val),
    price: n(meter?.price),
    room: room?.name ?? null,
    building: room?.buiName ?? null,
    floor: room?.floorName ?? null,
    area: room?.areaName ?? null,
    lastUpdate: meter?.readTime ?? null,
    raw: j,
  };
}
