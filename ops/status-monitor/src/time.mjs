const DAY_MS = 24 * 60 * 60 * 1000;
const formatters = new Map();

function partsOf(timestamp, timezone) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) parts[part.type] = part.value;
  return parts;
}

export function assertTimezone(timezone) {
  partsOf(0, timezone);
}

// 统计按配置时区的自然日分桶，键形如 2026-10-08。
export function dayKey(timestamp, timezone) {
  const parts = partsOf(timestamp, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 从今天往前数 count 天，按从旧到新排列。用日历运算而不是减 24 小时，夏令时切换日不会重复或漏掉。
export function recentDayKeys(now, timezone, count) {
  const [year, month, day] = dayKey(now, timezone).split("-").map(Number);
  const today = Date.UTC(year, month - 1, day);
  const keys = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(new Date(today - offset * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

export function formatDay(key) {
  const [, month, day] = key.split("-").map(Number);
  return `${month}月${day}日`;
}

export function formatClock(timestamp, timezone, { seconds = false } = {}) {
  const parts = partsOf(timestamp, timezone);
  return `${parts.hour}:${parts.minute}${seconds ? `:${parts.second}` : ""}`;
}

export function formatDateTime(timestamp, timezone, options) {
  return `${formatDay(dayKey(timestamp, timezone))} ${formatClock(timestamp, timezone, options)}`;
}

export function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} 天 ${hours % 24} 小时` : `${days} 天`;
}

export function daysUntil(timestamp, now) {
  return Math.floor((timestamp - now) / DAY_MS);
}
