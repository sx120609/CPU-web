import dayjs from "dayjs";

export function fmtDate(d: string | Date | null | undefined, pattern = "YYYY-MM-DD HH:mm") {
  if (!d) return "—";
  return dayjs(d).format(pattern);
}

export function fmtRelative(d: string | Date | null | undefined) {
  if (!d) return "";
  const target = dayjs(d);
  const now = dayjs();
  const diffMin = target.diff(now, "minute");
  if (Math.abs(diffMin) < 1) return "刚刚";
  if (diffMin > 0) {
    if (diffMin < 60) return `${diffMin} 分钟后`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `${h} 小时后`;
    return target.format("MM-DD HH:mm");
  } else {
    const m = -diffMin;
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const day = Math.floor(h / 24);
    if (day < 30) return `${day} 天前`;
    return target.format("YYYY-MM-DD");
  }
}

export function fmtMoney(cents: number | string) {
  if (typeof cents === "string") return `¥${cents}`;
  return `¥${(cents / 100).toFixed(2)}`;
}

export function fmtKWh(v: number) {
  return `${v.toFixed(1)} 度`;
}
