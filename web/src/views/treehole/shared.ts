import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { treeholeApi, type TreeholeShift } from "@/api/treehole";

// 同一张图在页面里只取一次；树洞图片要带登录凭据读取，不能直接用 <img src>。
const imageUrls = new Map<number, Promise<string>>();

export function loadTreeholeImageUrl(id: number) {
  let pending = imageUrls.get(id);
  if (!pending) {
    pending = treeholeApi.imageBlob(id).then((blob) => URL.createObjectURL(blob));
    imageUrls.set(id, pending);
    pending.catch(() => imageUrls.delete(id));
  }
  return pending;
}

export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const ROOM_CATEGORIES = [
  { value: "praise", label: "夸夸室" },
  { value: "vent", label: "倾诉室" },
  { value: "cry", label: "哭哭室" },
  { value: "relax", label: "解压室" },
  { value: "other", label: "其他" },
];

export const CRISIS_TYPES = ["自伤自杀风险", "严重情绪困扰", "遭受欺凌或暴力", "家庭或人际危机", "疑似精神疾病", "其他"];

export const URGENCY_OPTIONS = [
  { value: "normal", label: "一般" },
  { value: "high", label: "较高" },
  { value: "urgent", label: "紧急" },
] as const;

export function urgencyLabel(value: string) {
  return URGENCY_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export function caseStatusLabel(value: string) {
  if (value === "open") return "待处理";
  if (value === "following") return "跟进中";
  if (value === "closed") return "已结案";
  return value;
}

export function tagLabel(value?: string) {
  if (value === "focus") return "重点关注";
  if (value === "crisis") return "高危转介";
  return "普通情绪";
}

export function tagTone(value?: string) {
  if (value === "crisis") return "is-danger";
  if (value === "focus") return "is-warn";
  return "";
}

export function minuteText(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function parseMinute(text: string) {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(text.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute <= 24 * 60 ? minute : null;
}

export function shiftText(shift: TreeholeShift) {
  return `${WEEKDAYS[shift.weekday - 1]} ${minuteText(shift.startMinute)}–${minuteText(shift.endMinute)}`;
}

function beijingParts(value: string | Date) {
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay() || 7,
    time: `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`,
  };
}

/** 统一按北京时间显示：今天只显示时刻，今年显示月日，再早带年份。 */
export function timeText(value: string | Date | null | undefined) {
  if (!value) return "";
  const target = beijingParts(value);
  const now = beijingParts(new Date());
  if (target.year === now.year && target.month === now.month && target.day === now.day) return target.time;
  if (target.year === now.year) return `${target.month}月${target.day}日 ${target.time}`;
  return `${target.year}年${target.month}月${target.day}日 ${target.time}`;
}

export function clockText(value: string | Date) {
  return beijingParts(value).time;
}

function dayKey(value: string | Date) {
  const parts = beijingParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayLabel(value: string | Date) {
  const target = beijingParts(value);
  const today = beijingParts(new Date());
  const yesterday = beijingParts(new Date(Date.now() - 86_400_000));
  if (dayKey(value) === `${today.year}-${today.month}-${today.day}`) return "今天";
  if (dayKey(value) === `${yesterday.year}-${yesterday.month}-${yesterday.day}`) return "昨天";
  const date = target.year === today.year ? `${target.month}月${target.day}日` : `${target.year}年${target.month}月${target.day}日`;
  return `${date} ${WEEKDAYS[target.weekday - 1]}`;
}

const GROUP_GAP_MS = 5 * 60_000;

export type ChatLine<T> = {
  message: T;
  /** 跨天时在这条消息前插一条日期分隔 */
  day: string | null;
  /** 同一人连续发的几条只在第一条上显示名字 */
  showAuthor: boolean;
  /** 时间只显示在一串连续消息的最后一条下面 */
  showTime: boolean;
};

/** 按发送人和时间把消息排成聊天行：连续几条合成一组，跨天插日期。系统提示自成一组。 */
export function chatLines<T extends { createdAt: string }>(messages: T[], senderKey: (message: T) => string) {
  return messages.map((message, index): ChatLine<T> => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const key = senderKey(message);
    const at = new Date(message.createdAt).getTime();
    const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
    const joinsPrevious = Boolean(previous) && !newDay
      && senderKey(previous) === key
      && at - new Date(previous.createdAt).getTime() < GROUP_GAP_MS;
    const joinsNext = Boolean(next)
      && dayKey(next.createdAt) === dayKey(message.createdAt)
      && senderKey(next) === key
      && new Date(next.createdAt).getTime() - at < GROUP_GAP_MS;
    return { message, day: newDay ? dayLabel(message.createdAt) : null, showAuthor: !joinsPrevious, showTime: !joinsNext };
  });
}

export function nextShiftText(value: string | null | undefined) {
  if (!value) return "暂无排班";
  const target = beijingParts(value);
  return `下次在岗 ${WEEKDAYS[target.weekday - 1]} ${target.month}月${target.day}日 ${target.time}`;
}

/**
 * 定时刷新：页面在后台时暂停，切回前台立刻刷新一次。
 * interval 可以是函数，用来按当前状态（例如实时聊天还是留言）调整频率。
 */
export function usePolling(task: () => Promise<void>, interval: number | (() => number)) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  const delay = () => (typeof interval === "function" ? interval() : interval);
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void tick(), delay());
  };
  const tick = async () => {
    if (stopped || running) return;
    if (document.visibilityState === "hidden") {
      schedule();
      return;
    }
    running = true;
    try {
      await task();
    } catch {
      /* 下一轮再试 */
    } finally {
      running = false;
      schedule();
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void tick();
  };

  onMounted(() => {
    schedule();
    document.addEventListener("visibilitychange", onVisible);
  });
  onBeforeUnmount(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  });
  return { refreshNow: tick };
}

/**
 * 聊天滚动：本来就在底部时，新消息到了跟着滚到底；往上翻着看旧消息时不打断，
 * 只累计“新消息”数，点提示条再回到底部。
 */
export function useChatScroll(body: Ref<HTMLElement | null>) {
  const unseen = ref(0);

  function nearBottom() {
    const el = body.value;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  async function toBottom(smooth = false) {
    await nextTick();
    const el = body.value;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    unseen.value = 0;
  }

  /** 合并新消息前调用，返回合并后要做的事。 */
  function beforeIncoming() {
    const stick = nearBottom();
    return async (added: number, mine = false) => {
      if (!added) return;
      if (stick || mine) await toBottom();
      else unseen.value += added;
    };
  }

  function onScroll() {
    if (unseen.value && nearBottom()) unseen.value = 0;
  }

  /** 手机键盘弹起会把可视区域压矮，之前在底部的话要重新贴底。 */
  function keepBottomOnResize() {
    const el = body.value;
    if (!el || typeof ResizeObserver === "undefined") return () => undefined;
    let wasNearBottom = true;
    const track = () => { wasNearBottom = nearBottom(); };
    el.addEventListener("scroll", track, { passive: true });
    const observer = new ResizeObserver(() => {
      if (wasNearBottom) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", track);
    };
  }

  return { unseen, nearBottom, toBottom, beforeIncoming, onScroll, keepBottomOnResize };
}

export function errorText(error: unknown, fallback = "加载失败，请稍后重试") {
  const anyError = error as { response?: { data?: { message?: string } }; message?: string };
  return anyError?.response?.data?.message || anyError?.message || fallback;
}
