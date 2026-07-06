import type {
  RadioMusicProvider,
  RadioMusicSearchResult,
  RadioMusicSelection,
} from "@/api/radio";

export const radioBrandName = "药苑之声";
export const radioBrandTitle = `${radioBrandName} beta`;

export const weekdayOptions = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
] as const;

export function weekdayLabel(value?: number | null) {
  return weekdayOptions.find((item) => item.value === value)?.label || "未排期";
}

export function semesterStatusText(value: string) {
  if (value === "active") return "进行中";
  if (value === "archived") return "已归档";
  return "草稿";
}

export function semesterStatusTag(value: string) {
  if (value === "active") return "success";
  if (value === "archived") return "info";
  return "warning";
}

export function scheduleStatusText(value: string) {
  if (value === "published") return "已发布";
  if (value === "archived") return "已归档";
  return "草稿";
}

export function scheduleStatusTag(value: string) {
  if (value === "published") return "success";
  if (value === "archived") return "info";
  return "warning";
}

export function requestStatusText(value: string) {
  if (value === "approved") return "已通过";
  if (value === "fulfilled") return "已播出";
  if (value === "rejected") return "已拒绝";
  return "待处理";
}

export function requestStatusTag(value: string) {
  if (value === "approved") return "success";
  if (value === "fulfilled") return "success";
  if (value === "rejected") return "danger";
  return "warning";
}

export function musicProviderLabel(value: RadioMusicProvider) {
  return value === "qq" ? "QQ 音乐" : "网易云";
}

export function formatDurationMs(value?: number | null) {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration <= 0) return "时长未识别";
  const totalSeconds = Math.floor(duration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function sourceAvatarText(value: string) {
  return String(value || "歌").trim().slice(0, 1) || "歌";
}

export function splitTags(raw: string) {
  return raw
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function toDateInput(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export function toDateTimeLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function normalizeDateField(value: string) {
  return value.trim() ? value.trim() : null;
}

export function normalizeDateTimeField(value: string) {
  return value.trim() ? value.trim() : null;
}

export function toSourceSelection(item: RadioMusicSearchResult): RadioMusicSelection {
  return {
    provider: item.provider,
    trackId: item.trackId,
    mediaMid: item.mediaMid ?? null,
    album: item.album || null,
    cover: item.cover || null,
    duration: item.duration || null,
  };
}

export function resultTrackKey(
  item?: Pick<RadioMusicSelection, "provider" | "trackId" | "mediaMid"> | null,
) {
  if (!item) return "";
  return `${item.provider}:${item.trackId}:${item.mediaMid ?? ""}`;
}

export function responseStatus(error: unknown) {
  return (error as { response?: { status?: number } })?.response?.status;
}

export function responseMessage(error: unknown) {
  return (error as { response?: { data?: { message?: string } }; message?: string })
    ?.response?.data?.message
    || (error as { message?: string })?.message
    || "";
}
