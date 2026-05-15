/**
 * 宿舍用电查询
 *
 * 校园侧入口页是 SPA：http://10.200.13.18:8899/h5/#/?no={学号}
 * 实际数据由 SPA 加载后调用一个 XHR 拿。本服务直接 fetch 那个 XHR endpoint，
 * 在站内回显查询结果，避免用户跳出。
 *
 * ⚠️ 仅校园网可达：10.200.13.18 是内网 IP。生产服务器须接入校园网；外网部署会超时。
 *
 * TODO: 待用户提供真实 XHR URL + 响应字段后替换下面占位实现。
 */
import { setTimeout as delay } from "node:timers/promises";

/** 校园侧 XHR 接口（占位） —— 用户提供后替换 */
const ELECTRIC_API_BASE = "http://10.200.13.18:8899";

export interface DormElectricResult {
  /** 当前剩余电费（元） */
  balance: number | null;
  /** 宿舍门牌 / 房间号 */
  room?: string | null;
  /** 楼栋 */
  building?: string | null;
  /** 最近一次更新时间（ISO 字符串或服务端原文） */
  lastUpdate?: string | null;
  /** 原始响应（调试用，最小子集） */
  raw?: Record<string, unknown>;
}

/**
 * 简单内存缓存：同一学号 30 秒内的查询直接复用，
 * 避免用户连点刷新对学校接口造成压力。
 */
const cache = new Map<string, { at: number; result: DormElectricResult }>();
const CACHE_TTL_MS = 30_000;

export async function queryDormElectric(studentNo: string): Promise<DormElectricResult> {
  if (!studentNo) throw new Error("学号为空");

  const cached = cache.get(studentNo);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  // ============ 占位实现 ============
  // 真实接口形如：
  //   GET  ${ELECTRIC_API_BASE}/h5/api/getBalance?stuNo=2023xxxx
  //   POST ${ELECTRIC_API_BASE}/api/electric/query  body: { stuNo }
  // 待用户贴出 XHR URL 后替换这一段。
  const url = `${ELECTRIC_API_BASE}/PLACEHOLDER_API?no=${encodeURIComponent(studentNo)}`;

  let resp: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      resp = await fetch(url, { signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("查询超时，请稍后重试");
    }
    // ECONNREFUSED / 网络不通 —— 多半是服务器没接校园网
    throw new Error("无法访问宿舍电费接口（仅校园网可达）");
  }

  if (!resp.ok) {
    throw new Error(`电费接口返回 ${resp.status}`);
  }

  let body: any;
  try {
    body = await resp.json();
  } catch {
    throw new Error("电费接口返回格式异常");
  }

  // 解析（占位字段映射 —— 待用户贴出响应示例后改）
  const result: DormElectricResult = {
    balance: typeof body?.balance === "number" ? body.balance
           : typeof body?.余额 === "number" ? body.余额
           : null,
    room: body?.room ?? body?.roomNo ?? body?.房间 ?? null,
    building: body?.building ?? body?.楼栋 ?? null,
    lastUpdate: body?.lastUpdate ?? body?.updateTime ?? body?.更新时间 ?? null,
    raw: body,
  };

  cache.set(studentNo, { at: Date.now(), result });
  return result;
}

/** 测试用：让单元/手动调用绕开 cache */
export function _clearCacheForTesting() {
  cache.clear();
  return delay(0);
}
