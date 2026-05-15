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

const TARGET_URL = "http://10.200.13.18:8899/api/wxapp/my3";
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
  balance: number | null;
  room?: string | null;
  building?: string | null;
  lastUpdate?: string | null;
  raw?: Record<string, unknown>;
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

  let resp: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      resp = await fetch(TARGET_URL, {
        method: "POST",
        headers: { "accept": "*/*", "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("查询超时，请稍后重试");
    throw new Error("无法访问宿舍电费接口（仅校园网可达，请确认服务器在校园网或已 VPN）");
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
 * 把 SPA 后端返回的 JSON 拍平成 DormElectricResult。
 *
 * 字段名当前是按常见命名猜的；首次查询成功后看 raw 实际字段再精修。
 */
function normalize(j: Record<string, unknown>): DormElectricResult {
  const data: any = (j as any).data ?? j;

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  return {
    balance:
      num(data?.balance) ??
      num(data?.surplus) ??
      num(data?.余额) ??
      num(data?.electricity) ??
      num(data?.kwh) ??
      null,
    room: data?.room ?? data?.roomNo ?? data?.房间 ?? data?.roomName ?? null,
    building: data?.building ?? data?.楼栋 ?? data?.buildingName ?? null,
    lastUpdate: data?.lastUpdate ?? data?.updateTime ?? data?.time ?? data?.更新时间 ?? null,
    raw: j,
  };
}
