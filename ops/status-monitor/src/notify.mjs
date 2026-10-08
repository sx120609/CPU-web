import { httpRequest } from "./probe.mjs";
import { formatClock, formatDateTime, formatDay, dayKey, formatDuration } from "./time.mjs";

const RETRY_DELAYS_MS = [2000, 5000];

function describeEvent(event, timezone) {
  if (event.type === "test") return `这是一条测试消息，发送于 ${formatClock(event.sentAt, timezone)}，无需处理。`;
  if (event.type === "down") return `${event.name}：${event.reason}（${formatClock(event.startedAt, timezone)} 起）`;
  if (event.type === "recovered") {
    const sameDay = dayKey(event.startedAt, timezone) === dayKey(event.resolvedAt, timezone);
    const started = sameDay ? formatClock(event.startedAt, timezone) : formatDateTime(event.startedAt, timezone);
    const what = event.kind === "degraded" ? "降级" : "中断";
    return `${event.name}：${what} ${formatDuration(event.resolvedAt - event.startedAt)}（${started}–${formatClock(event.resolvedAt, timezone)}）`;
  }
  if (event.type === "degraded") {
    return `${event.name}：${event.reason}${event.detail ? `，${event.detail}` : ""}（${formatClock(event.startedAt, timezone)} 起）`;
  }
  const expiry = formatDay(dayKey(event.expiresAt, timezone));
  return event.daysLeft < 0 ? `${event.host}：证书已过期（${expiry}）` : `${event.host}：证书还有 ${event.daysLeft} 天到期（${expiry}）`;
}

// 名称以字母或数字结尾（教务 Agent、www.cputime.cn）时，和后面的中文之间留一个空格。
const headline = (events, what) => (events.length === 1
  ? `${events[0].name}${/[A-Za-z0-9]$/u.test(events[0].name) ? " " : ""}${what}`
  : `${events.length} 项服务${what}`);

const HEADLINES = {
  down: (events) => headline(events, "中断"),
  degraded: (events) => headline(events, "降级"),
  recovered: (events) => headline(events, "已恢复"),
  certificate: () => "证书即将到期",
  test: () => "通知测试",
};
const PREFIXES = { down: "中断｜", degraded: "降级｜", recovered: "恢复｜", certificate: "证书｜", test: "" };

// 把同一批事件合成一条消息，全站故障时不会连发十几条。
export function formatMessage(events, { siteName, publicUrl, timezone }) {
  const types = [...new Set(events.map((event) => event.type))];
  const mixed = types.length > 1;
  const title = `【${siteName}】${mixed ? "服务状态变化" : HEADLINES[types[0]](events)}`;
  const lines = events.map((event) => `${mixed ? PREFIXES[event.type] : ""}${describeEvent(event, timezone)}`);
  if (publicUrl) lines.push(`状态页：${publicUrl}`);
  return { title, text: [title, ...lines].join("\n") };
}

export function buildPayload(channel, message, events, context) {
  if (channel.format === "text") return { msgtype: "text", text: { content: message.text } };
  if (channel.format === "feishu") return { msg_type: "text", content: { text: message.text } };
  if (channel.format === "onebot") return { ...channel.target, message: message.text };
  return { title: message.title, text: message.text, site: context.siteName, statusPage: context.publicUrl, events };
}

// 企业微信、钉钉、飞书、OneBot 在请求格式不对或密钥失效时仍然返回 HTTP 200，错误码写在响应体里。
const REJECTION_KEYS = { text: "errcode", feishu: "code", onebot: "retcode" };

function rejectionOf(channel, body) {
  const key = REJECTION_KEYS[channel.format];
  if (!key) return "";
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.[key] === "number" && parsed[key] !== 0) {
      return String(parsed.errmsg ?? parsed.msg ?? parsed.message ?? parsed.wording ?? `${key} ${parsed[key]}`).slice(0, 200);
    }
  } catch {
    // 响应体不是 JSON 时，以 HTTP 状态码为准。
  }
  return "";
}

export function createNotifier({
  channels,
  context,
  logger,
  request = httpRequest,
  delayMs = 15000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  let pending = [];
  let timer = null;
  let sending = Promise.resolve();

  async function deliver(channel, events) {
    const message = formatMessage(events, context);
    const body = JSON.stringify(buildPayload(channel, message, events, context));
    const headers = { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) };
    if (channel.token) headers.Authorization = `Bearer ${channel.token}`;

    let failure = "";
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        const response = await request(channel.url, { method: "POST", headers, body, followRedirects: false, timeoutMs: 10000 });
        failure = response.status >= 200 && response.status < 300 ? rejectionOf(channel, response.body) : `HTTP ${response.status}`;
        // 对方明确拒绝（内容或密钥问题）时重试也不会成功。
        if (!failure || response.status < 500) break;
      } catch (error) {
        failure = error.reason || error.code || "请求失败";
      }
    }
    // 通知地址里带密钥，日志只写渠道名。
    if (failure) logger.error("notify_failed", { channel: channel.name, reason: failure });
    else logger.info("notify_sent", { channel: channel.name, events: events.length });
    return { channel: channel.name, ok: !failure, reason: failure };
  }

  function send(events) {
    const deliveries = channels
      .map((channel) => [channel, events.filter((event) => channel.events.includes(event.type))])
      .filter(([, wanted]) => wanted.length)
      .map(([channel, wanted]) => deliver(channel, wanted));
    return Promise.all(deliveries);
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending.length) return sending;
    const events = pending;
    pending = [];
    sending = sending.then(() => send(events)).catch((error) => {
      logger.error("notify_crashed", { message: error.message });
      return [];
    });
    return sending;
  }

  return {
    flush,
    send,
    push(events) {
      if (!events.length || !channels.length) return;
      pending.push(...events);
      timer ??= setTimeout(flush, delayMs);
    },
  };
}
