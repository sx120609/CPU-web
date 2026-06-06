import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocket } from "ws";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type CliOptions = {
  _: string[];
  flags: Map<string, string[]>;
};

const DEFAULT_BASE_URL = process.env.WEIWALL_BASE_URL || "https://s.weiwall.com";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";
const execFileAsync = promisify(execFile);

function printUsage() {
  console.log(`
WeiWall helper

Usage:
  npm run weiwall -- parse-url --url "<wechat callback url>"
  npm run weiwall -- exchange-code --url "<wechat callback url>"
  npm run weiwall -- exchange-code --school cpu --code "<oauth code>"
  npm run weiwall -- capture-token --adb "D:\\platform-tools\\adb.exe"
  npm run weiwall -- tenant
  npm run weiwall -- topic --id 31669159
  npm run weiwall -- topic --id 31669159 --token "<bearer token>"
  npm run weiwall -- api --path /api/client/topics/31669159 --token "<bearer token>"

Commands:
  parse-url      Parse a callback URL and decode nested path parameters
  exchange-code  Exchange { school, code } for the platform Bearer token
  capture-token  Read token from a connected Android WeChat WebView via adb
  tenant         Print tenant info from /api/client/tenant
  topic          Fetch one topic. Without token it falls back to read_only
  api            Send an arbitrary API request

Common flags:
  --base <url>       Override base URL, default: ${DEFAULT_BASE_URL}
  --tenant <id>      Override Tenant header
  --token <token>    Bearer token for authenticated requests
  --show-token       Print the full token in exchange-code output
  --adb <path>       adb.exe path for capture-token

api flags:
  --path <path>      API path such as /api/client/topics/31669159
  --method <verb>    GET | POST | PUT | DELETE
  --data <json>      Inline JSON body or @path/to/file.json
`);
}

function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    if (eq >= 0) {
      const key = arg.slice(2, eq);
      const value = arg.slice(eq + 1);
      const values = flags.get(key) ?? [];
      values.push(value);
      flags.set(key, values);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, ["true"]);
      continue;
    }

    const values = flags.get(key) ?? [];
    values.push(next);
    flags.set(key, values);
    i++;
  }

  return { _: positional, flags };
}

function flag(opts: CliOptions, name: string): string | undefined {
  return opts.flags.get(name)?.at(-1);
}

function requireFlag(opts: CliOptions, name: string): string {
  const value = flag(opts, name);
  if (!value) throw new Error(`缺少参数 --${name}`);
  return value;
}

function hasFlag(opts: CliOptions, name: string) {
  return opts.flags.has(name);
}

function baseUrl(opts: CliOptions) {
  return flag(opts, "base") || DEFAULT_BASE_URL;
}

function decodeRepeatedly(input: string | null | undefined, maxRounds = 6) {
  let value = String(input ?? "");
  for (let i = 0; i < maxRounds; i++) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) return value;
      value = decoded;
    } catch {
      return value;
    }
  }
  return value;
}

function parseMaybeUrl(input: string) {
  const text = input.trim();
  try {
    return new URL(text);
  } catch {
    return new URL(text.startsWith("?") ? `${DEFAULT_BASE_URL}/${text}` : `${DEFAULT_BASE_URL}/?${text}`);
  }
}

function parseWechatCallback(input: string) {
  const url = parseMaybeUrl(input);
  const school = url.searchParams.get("school") || "";
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const rawPath = url.searchParams.get("path") || "";
  const decodedPath = decodeRepeatedly(rawPath);

  return {
    input,
    href: url.toString(),
    school,
    code,
    state,
    path: rawPath,
    pathDecoded: decodedPath,
  };
}

async function readDataArg(input?: string): Promise<unknown> {
  if (!input) return undefined;
  if (input.startsWith("@")) {
    const file = input.slice(1);
    return JSON.parse(await fs.readFile(file, "utf8"));
  }
  return JSON.parse(input);
}

function maskToken(token: string) {
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

function adbPath(opts: CliOptions) {
  return (
    flag(opts, "adb") ||
    process.env.ADB_PATH ||
    "adb"
  );
}

function ensureMethod(input?: string): HttpMethod {
  const upper = String(input || "GET").toUpperCase();
  if (upper === "GET" || upper === "POST" || upper === "PUT" || upper === "DELETE") return upper;
  throw new Error(`不支持的 method: ${input}`);
}

function buildUrl(base: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, base).toString();
}

function maybeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function requestApi(args: {
  base: string;
  path: string;
  method?: HttpMethod;
  token?: string;
  tenant?: string | number;
  body?: unknown;
  contentType?: "application/json" | "application/x-www-form-urlencoded";
}) {
  const method = args.method || "GET";
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": DEFAULT_UA,
  });

  if (args.token) headers.set("Authorization", `Bearer ${args.token}`);
  if (args.tenant !== undefined && args.tenant !== "") headers.set("Tenant", String(args.tenant));

  let body: string | undefined;
  if (method !== "GET" && args.body !== undefined) {
    const contentType = args.contentType || "application/json";
    headers.set("Content-Type", contentType);
    if (contentType === "application/x-www-form-urlencoded") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries((args.body ?? {}) as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }
      body = params.toString();
    } else {
      body = JSON.stringify(args.body);
    }
  }

  const res = await fetch(buildUrl(args.base, args.path), { method, headers, body });
  const text = await res.text();
  return { res, text, json: maybeJson(text) };
}

async function execAdb(adb: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(adb, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
  });
  return { stdout, stderr };
}

function parseAdbDevices(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("List of devices attached"))
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((row) => row.serial);
}

async function cdpEvaluate(wsUrl: string, expression: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("CDP timeout"));
    }, 15000);

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "Page.enable" }));
      ws.send(JSON.stringify({
        id: 3,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id !== 3) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text || "Runtime exception"));
        return;
      }
      resolve(msg.result?.result?.value);
    });
  });
}

async function detectTenant(base: string) {
  const result = await requestApi({ base, path: "/api/client/tenant" });
  if (!result.res.ok || !result.json?.data?.tenantId) {
    throw new Error("无法自动获取 tenantId");
  }
  return result.json.data.tenantId as number;
}

function summarizeEnvelope(label: string, result: { res: Response; text: string; json: any }) {
  console.log(`${label}: ${result.res.status} ${result.res.statusText}`);
  if (result.json) console.log(JSON.stringify(result.json, null, 2));
  else console.log(result.text);
}

function looksLikeFieldValidation(json: any, fields: string[]) {
  const message = String(json?.errmsg || json?.message || "");
  return fields.some((field) => message.includes(field) && message.includes("不能为空"));
}

async function commandTenant(opts: CliOptions) {
  const result = await requestApi({ base: baseUrl(opts), path: "/api/client/tenant" });
  summarizeEnvelope("tenant", result);
}

async function commandParseUrl(opts: CliOptions) {
  const input = requireFlag(opts, "url");
  console.log(JSON.stringify(parseWechatCallback(input), null, 2));
}

async function commandExchangeCode(opts: CliOptions) {
  const callback = flag(opts, "url") ? parseWechatCallback(requireFlag(opts, "url")) : null;
  const school = flag(opts, "school") || callback?.school || "";
  const code = flag(opts, "code") || callback?.code || "";
  if (!school) throw new Error("缺少 school。可传 --school，或在 --url 里带上 school");
  if (!code) throw new Error("缺少 code。可传 --code，或在 --url 里带上 code");

  const base = baseUrl(opts);
  const tenant = flag(opts, "tenant") || await detectTenant(base).catch(() => undefined);
  const payload = { school, code };

  let result = await requestApi({
    base,
    path: "/api/client/users",
    method: "POST",
    tenant,
    body: payload,
  });

  // 部分 uni-app 服务端更偏向 form body，这里做一次兼容重试。
  if (result.json && looksLikeFieldValidation(result.json, ["school", "code"])) {
    result = await requestApi({
      base,
      path: "/api/client/users",
      method: "POST",
      tenant,
      body: payload,
      contentType: "application/x-www-form-urlencoded",
    });
  }

  if (!result.json) {
    summarizeEnvelope("exchange-code", result);
    return;
  }

  const token = String(result.json?.data?.token || "");
  const userInfo = result.json?.data?.userInfo;
  const showToken = hasFlag(opts, "show-token");

  const summary = {
    ok: result.res.ok && token.length > 0,
    base,
    tenant: tenant ?? null,
    school,
    codePreview: code ? `${code.slice(0, 6)}...` : "",
    token: showToken ? token : (token ? maskToken(token) : ""),
    tokenLength: token.length,
    userInfo: userInfo
      ? {
          uuid: userInfo.uuid ?? null,
          nickname: userInfo.nickname ?? "",
          schoolEn: userInfo.schoolEn ?? "",
          schoolSimpleName: userInfo.schoolSimpleName ?? "",
        }
      : null,
    raw: result.json,
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function commandTopic(opts: CliOptions) {
  const id = requireFlag(opts, "id");
  const token = flag(opts, "token");
  const tenant = flag(opts, "tenant") || await detectTenant(baseUrl(opts)).catch(() => undefined);
  const path = token ? `/api/client/topics/${id}` : `/api/client/topics/read_only/${id}`;
  const result = await requestApi({
    base: baseUrl(opts),
    path,
    token,
    tenant,
  });
  summarizeEnvelope("topic", result);
}

async function commandCaptureToken(opts: CliOptions) {
  const adb = adbPath(opts);
  const port = Number(flag(opts, "port") || "9223");
  const devices = parseAdbDevices((await execAdb(adb, ["devices"])).stdout);
  const online = devices.find((item) => item.state === "device");
  if (!online) throw new Error("没有检测到可用的 Android 设备，请先确认 adb devices 显示为 device");

  const unixList = (
    await execAdb(adb, ["shell", "cat /proc/net/unix | grep -E 'devtools_remote|webview|xweb'"])
  ).stdout;
  const socketMatches = Array.from(unixList.matchAll(/@(webview_devtools_remote_\d+)/g)).map((m) => m[1]);
  if (!socketMatches.length) {
    throw new Error("设备上没有发现可调试的 WebView socket，请先在微信里打开目标页面");
  }

  let chosenSocket = "";
  let chosenPid = "";
  for (const socket of socketMatches) {
    const pid = socket.match(/_(\d+)$/)?.[1] || "";
    if (!pid) continue;
    const cmdline = (await execAdb(adb, ["shell", `cat /proc/${pid}/cmdline`])).stdout;
    if (cmdline.includes("com.tencent.mm")) {
      chosenSocket = socket;
      chosenPid = pid;
      break;
    }
  }
  if (!chosenSocket) {
    throw new Error("没找到属于 com.tencent.mm 的可调试 WebView socket");
  }

  await execAdb(adb, ["forward", `tcp:${port}`, `localabstract:${chosenSocket}`]);
  const pageListRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  const pages = (await pageListRes.json()) as Array<{
    id: string;
    title: string;
    url: string;
    webSocketDebuggerUrl: string;
  }>;
  const targetPage =
    pages.find((page) => page.url.startsWith("https://s.weiwall.com/")) ||
    pages.find((page) => page.title.includes("圈子")) ||
    pages[0];
  if (!targetPage?.webSocketDebuggerUrl) {
    throw new Error("没有找到可用的微信页面调试目标");
  }

  const dump = await cdpEvaluate(
    targetPage.webSocketDebuggerUrl,
    `(() => ({
      href: location.href,
      title: document.title,
      storage: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))
    }))()`,
  );

  const authState = maybeJson(String(dump?.storage?.auth || ""))?.state ?? {};
  const extConfigState = maybeJson(String(dump?.storage?.extConfig || ""))?.state?.extConfig ?? {};
  const userState = maybeJson(String(dump?.storage?.user || ""))?.state?.userInfo ?? {};
  const token = String(authState.token || "");
  const showToken = hasFlag(opts, "show-token");

  console.log(JSON.stringify({
    ok: Boolean(token),
    device: online.serial,
    wechatPid: chosenPid,
    socket: chosenSocket,
    forwardedPort: port,
    pageTitle: dump?.title || "",
    pageUrl: dump?.href || targetPage.url || "",
    tenantId: extConfigState.tenantId ?? null,
    schoolEn: userState.schoolEn ?? "",
    nickname: userState.nickname ?? "",
    token: showToken ? token : maskToken(token),
    tokenLength: token.length,
    storageKeys: Object.keys(dump?.storage || {}),
  }, null, 2));
}

async function commandApi(opts: CliOptions) {
  const base = baseUrl(opts);
  const method = ensureMethod(flag(opts, "method"));
  const path = requireFlag(opts, "path");
  const token = flag(opts, "token");
  const explicitTenant = flag(opts, "tenant");
  const tenant = explicitTenant || await detectTenant(base).catch(() => undefined);
  const body = await readDataArg(flag(opts, "data"));

  const result = await requestApi({
    base,
    path,
    method,
    token,
    tenant,
    body,
  });

  summarizeEnvelope("api", result);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const command = opts._[0] || "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "tenant") {
    await commandTenant(opts);
    return;
  }

  if (command === "parse-url") {
    await commandParseUrl(opts);
    return;
  }

  if (command === "exchange-code") {
    await commandExchangeCode(opts);
    return;
  }

  if (command === "capture-token") {
    await commandCaptureToken(opts);
    return;
  }

  if (command === "topic") {
    await commandTopic(opts);
    return;
  }

  if (command === "api") {
    await commandApi(opts);
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

main().catch((error: any) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
