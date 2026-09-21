import crypto from "node:crypto";
import fs from "node:fs/promises";
import http2 from "node:http2";
import { getApnsConfig, type ApnsConfig } from "./apnsConfig";

type ApnsEnvironment = "production" | "sandbox";

type ApnsResponse = { status: number; body: string; headers: http2.IncomingHttpHeaders };

const JWT_TTL_MS = 45 * 60_000;
const APPLE_REFERENCE_UNIX = 978307200;
let cachedJWT: { value: string; keyID: string; teamID: string; keyPath: string; expiresAt: number } | null = null;

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function makeProviderToken(keyPath: string, keyID: string, teamID: string) {
  const now = Date.now();
  if (cachedJWT && cachedJWT.expiresAt > now + 60_000 && cachedJWT.keyID === keyID
    && cachedJWT.teamID === teamID && cachedJWT.keyPath === keyPath) return cachedJWT.value;
  const key = crypto.createPrivateKey(await fs.readFile(keyPath, "utf8"));
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyID, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: teamID, iat: Math.floor(now / 1000) }));
  const signingInput = `${header}.${payload}`;
  // JWT ES256 requires the JOSE raw R||S signature, not OpenSSL's default DER
  // encoding. Node exposes the required format through dsaEncoding.
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const value = `${signingInput}.${signature}`;
  cachedJWT = { value, keyID, teamID, keyPath, expiresAt: now + JWT_TTL_MS };
  return value;
}

function hostFor(environment: ApnsEnvironment) {
  return environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
}

function postHttp2(environment: ApnsEnvironment, path: string, headers: Record<string, string>, body: string, method = "POST", origin = `https://${hostFor(environment)}`): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(origin);
    let settled = false;
    const finish = (error?: Error, response?: ApnsResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.destroy();
      if (error) reject(error);
      else resolve(response!);
    };
    const timeout = setTimeout(() => finish(new Error("APNs 请求超时")), 15000);
    timeout.unref();
    client.once("error", (error) => finish(error));
    const request = client.request({
      ":method": method,
      ":path": path,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      ...headers,
    });
    let responseBody = "";
    let status = 0;
    let receivedHeaders: http2.IncomingHttpHeaders = {};
    request.setEncoding("utf8");
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] || 0);
      receivedHeaders = responseHeaders;
    });
    request.on("data", (chunk) => { responseBody += chunk; });
    request.on("end", () => finish(undefined, { status, body: responseBody, headers: receivedHeaders }));
    request.on("error", (error) => finish(error));
    request.end(body);
  });
}

export function appleReferenceSeconds(unixSeconds: number) {
  return unixSeconds - APPLE_REFERENCE_UNIX;
}

export function unixSecondsFromActivityDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Swift's default Date encoding is seconds from 2001 (about 8e8 today),
    // while Unix timestamps for supported schedules are above 1.5e9.
    return value < 1_500_000_000 ? value + APPLE_REFERENCE_UNIX : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  return null;
}

export async function sendLiveActivityPayload(input: {
  token: string;
  environment: ApnsEnvironment;
  bundleID: string;
  payload: Record<string, unknown>;
}) {
  const config = await getApnsConfig();
  if (!config.configured) throw new Error("APNs 尚未配置完整");
  if (input.bundleID !== config.bundleID) throw new Error("Bundle ID 与 CPU APNs 配置不一致");
  const token = input.token.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (!token || token.length > 512) throw new Error("APNs device token 无效");
  const providerToken = await makeProviderToken(config.keyPath, config.keyID, config.teamID);
  const response = await postHttp2(input.environment, `/3/device/${token}`, {
    authorization: `bearer ${providerToken}`,
    "apns-push-type": "liveactivity",
    "apns-topic": `${input.bundleID}.push-type.liveactivity`,
    "apns-priority": "10",
    "apns-expiration": "0",
  }, JSON.stringify(input.payload));
  if (response.status < 200 || response.status >= 300) {
    let reason = response.body;
    try { reason = (JSON.parse(response.body) as { reason?: string }).reason || reason; } catch { /* keep raw body */ }
    const error = new Error(`APNs 返回 ${response.status}: ${reason || "未知错误"}`) as Error & { status?: number; apnsReason?: string };
    error.status = response.status;
    error.apnsReason = reason;
    throw error;
  }
  return response;
}

/** Send a school-channel Live Activity broadcast (iOS 26+). */
export async function sendLiveActivityBroadcast(input: {
  environment: ApnsEnvironment;
  bundleID: string;
  channelID: string;
  payload: Record<string, unknown>;
  priority?: number;
  expiration?: number;
  collapseID?: string;
}) {
  const config = await getApnsConfig();
  if (!config.configured) throw new Error("APNs 尚未配置完整");
  if (input.bundleID !== config.bundleID) throw new Error("Bundle ID 与 CPU APNs 配置不一致");
  const channelID = String(input.channelID || "").trim();
  if (!channelID) throw new Error("APNs 广播频道无效");
  const providerToken = await makeProviderToken(config.keyPath, config.keyID, config.teamID);
  const headers: Record<string, string> = {
    authorization: `bearer ${providerToken}`,
    "apns-channel-id": channelID,
    "apns-push-type": "liveactivity",
    "apns-priority": String(input.priority ?? 10),
    "apns-expiration": String(Math.max(0, Math.floor(input.expiration ?? 0))),
  };
  if (input.collapseID) headers["apns-collapse-id"] = input.collapseID.slice(0, 64);
  const response = await postHttp2(input.environment, `/4/broadcasts/apps/${encodeURIComponent(input.bundleID)}`, headers, JSON.stringify(input.payload));
  if (response.status < 200 || response.status >= 300) {
    let reason = response.body;
    try { reason = (JSON.parse(response.body) as { reason?: string }).reason || reason; } catch { /* keep raw body */ }
    const error = new Error(`APNs 广播返回 ${response.status}: ${reason || "未知错误"}`) as Error & { status?: number; apnsReason?: string };
    error.status = response.status;
    error.apnsReason = reason;
    throw error;
  }
  return response;
}

/** Channels are created by Apple and scoped to this exact App ID/environment. */
export async function createLiveActivityChannel(config: ApnsConfig, environment: ApnsEnvironment): Promise<string> {
  if (!config.configured) throw new Error("请先保存完整的 APNs 凭据");
  const authorization = await makeProviderToken(config.keyPath, config.keyID, config.teamID);
  const origin = environment === "sandbox"
    ? "https://api-manage-broadcast.sandbox.push.apple.com:2195"
    : "https://api-manage-broadcast.push.apple.com:2196";
  const response = await postHttp2(environment, `/1/apps/${encodeURIComponent(config.bundleID)}/channels`, {
    authorization: `bearer ${authorization}`,
  }, JSON.stringify({ "message-storage-policy": 0, "push-type": "LiveActivity" }), "POST", origin);
  if (response.status !== 201) {
    let reason = response.body;
    try { reason = JSON.parse(response.body).reason || reason; } catch { /* preserve response */ }
    throw new Error(`Apple 创建频道失败（${environment}，${response.status}）：${reason || "未知错误"}`);
  }
  const channelID = response.headers["apns-channel-id"];
  if (typeof channelID !== "string" || !channelID.trim()) throw new Error("Apple 未返回 apns-channel-id，频道未保存");
  return channelID.trim();
}
