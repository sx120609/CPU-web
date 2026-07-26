import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import { LOCAL_IP_TIMEOUT_MS, PROBE_HOST, PROBE_PORT, REQUEST_TIMEOUT_MS } from "./constants";

const MAX_BODY_BYTES = 64 * 1024;

// UDP connect 不发包，只让内核按路由表选出口网卡，再读回本地地址。
// 用 os.networkInterfaces() 会在装了 VMware / WSL / Hyper-V 的机器上挑错网卡，
// 这正是原版用这个技巧要规避的问题。
export const detectLocalIp = (timeoutMs = LOCAL_IP_TIMEOUT_MS): Promise<string | undefined> =>
  new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const done = (value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* 已关闭 */ }
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    socket.unref();
    socket.on("error", () => done(undefined));
    try {
      socket.connect(PROBE_PORT, PROBE_HOST, () => {
        try { done(socket.address().address); } catch { done(undefined); }
      });
    } catch {
      done(undefined);
    }
  });

export type TextResponse = { status: number; body: string };

// 用 node:http 而不是 Electron 的 net：目标是内网明文地址，
// Chromium 网络栈会套用系统代理，内网地址被代理掉就必然失败。
export const httpGetText = (url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<TextResponse> =>
  new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          request.destroy();
          reject(new Error("响应内容过大"));
        }
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("请求超时")));
    request.on("error", reject);
  });
