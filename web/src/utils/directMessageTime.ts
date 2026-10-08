import dayjs from "dayjs";
import { fmtDate } from "./format";

// API Date values are ISO 8601 with Z. Preserve explicit offsets and display in
// the device's local zone. Legacy offset-free values retain dayjs's local-time
// interpretation; calendar grouping and sorting must use that same parser.
export function messageTimestamp(value: string) {
  return dayjs(value).valueOf();
}

export function dayKey(value: string) {
  return fmtDate(value, "YYYY-MM-DD");
}

export function shortTime(value: string, now = new Date()) {
  return fmtDate(value, dayjs(value).isSame(now, "day") ? "HH:mm" : "MM-DD");
}

export function messageTime(value: string) {
  return fmtDate(value, "MM-DD HH:mm");
}

export function clockTime(value: string) {
  return fmtDate(value, "HH:mm");
}

export function dayLabel(value: string, now = new Date()) {
  const date = dayjs(value);
  const today = dayjs(now);
  if (date.isSame(today, "day")) return "今天";
  if (date.isSame(today.subtract(1, "day"), "day")) return "昨天";
  return fmtDate(value, date.year() === today.year() ? "M月D日" : "YYYY年M月D日");
}
