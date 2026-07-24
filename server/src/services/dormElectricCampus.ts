/**
 * 校园网内宿舍用电查询客户端。
 *
 * 仅由出站 Agent 调用。主服务通过 Agent WebSocket 调度查询，不直接暴露
 * 校园侧接口，也不再依赖公网 FRP。
 */
import { createHash } from "node:crypto";

const DEFAULT_CAMPUS_BASE = "http://10.200.13.18:8899";
const APP_ID = "XzJ0YzzEtk0HbVOk";
const SIGN_SALT = "ruGQQlUhZxJhQqKY8lYGYcN6UJWwNRL3";

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

export async function queryDormElectricFromCampus(studentNo: string): Promise<DormElectricResult> {
  if (!studentNo) throw new Error("学号为空");
  const payload: Record<string, unknown> = {
    appId: APP_ID,
    openId: studentNo,
    stuNo: true,
  };
  payload.sign = computeSign(payload);

  const targetUrl = new URL("/api/wxapp/my3", getCampusBaseUrl());
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await fetch(targetUrl, {
        method: "POST",
        headers: { accept: "*/*", "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("查询超时，校园侧响应过慢，请稍后重试");
    throw new Error(`电费查询失败：${error?.message || error}`);
  }

  if (!response.ok) throw new Error(`电费接口返回 HTTP ${response.status}`);

  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error("电费接口返回格式异常");
  }

  if (typeof body?.code === "number" && body.code !== 0) {
    const message = body?.msg || body?.message || "校园侧拒绝";
    if (/sign|签名/i.test(String(message))) {
      throw new Error(`签名失效（${message}）—— 学校可能已更换签名参数`);
    }
    throw new Error(`校园侧返回错误：${message}`);
  }

  return normalizeDormElectricResponse(body);
}

function getCampusBaseUrl() {
  const raw = String(process.env.DORM_ELECTRIC_CAMPUS_BASE || DEFAULT_CAMPUS_BASE).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DORM_ELECTRIC_CAMPUS_BASE 必须是有效的校内 HTTP 地址");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("DORM_ELECTRIC_CAMPUS_BASE 必须是不含凭据、查询参数和片段的 HTTP 地址");
  }
  return url;
}

/** 复现校园侧 SPA 的 getSign(body)。 */
function computeSign(body: Record<string, unknown>) {
  const keys = Object.keys(body).filter((key) => key !== "sign").sort();
  let source = "";
  for (const key of keys) {
    let value = body[key];
    if (value === undefined || value === null) value = "";
    source += `${key.toLowerCase()}=${typeof value === "object" ? JSON.stringify(value) : String(value)}&`;
  }
  source += `key=${SIGN_SALT}`;
  return createHash("sha1").update(source).digest("hex");
}

function normalizeDormElectricResponse(input: unknown): DormElectricResult {
  const rooms = Array.isArray(input) ? input as any[] : null;
  const room: any = rooms ? rooms[0] : input as any;
  if (!room || (typeof room.errCode === "number" && room.errCode !== 0)) {
    return {
      balance: null,
      remainKwh: null,
      usedKwh: null,
      price: null,
      room: null,
      building: null,
      floor: null,
      area: null,
      lastUpdate: null,
      raw: input,
    };
  }
  const meter = Array.isArray(room.meters) ? room.meters[0] : null;

  return {
    balance: finiteNumber(meter?.amount),
    remainKwh: finiteNumber(meter?.remain),
    usedKwh: finiteNumber(meter?.val),
    price: finiteNumber(meter?.price),
    room: room?.name ?? null,
    building: room?.buiName ?? null,
    floor: room?.floorName ?? null,
    area: room?.areaName ?? null,
    lastUpdate: meter?.readTime ?? null,
    raw: input,
  };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
