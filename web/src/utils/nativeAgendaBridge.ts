import { watch } from "vue";
import type { Router } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useAgendaStore } from "@/stores/agenda";
import { isNativeScheduleShell } from "@/utils/clientInfo";
import { nativeScheduleAccountKey } from "@/utils/iosNextScheduleBridge";
import type { AgendaItem } from "@/utils/agenda";

/**
 * 原生 App 的课表里画日程用的入口：`window.CPUTimeNativeAgenda(request)`。
 *
 * - `{ action: "list", refresh?: boolean }`：同步一次（`refresh: false` 只读本机副本）后返回
 *   `{ authenticated, account, items, relay }`。`items` 是规整过的日程，规则见 shared/agenda.ts。
 * - `{ action: "toggle", id, date, done }`：勾掉或取消勾掉一次，返回同样的结果。
 * - `{ action: "open", item?, date?, start? }`：打开网页的日程页（有 item 时直接编辑那一条，
 *   没有时新建，带上日期和开始时间）。
 *
 * 请求走这个网页自己的登录会话，所以安卓、鸿蒙、iOS 不用各自再做一套鉴权。列表有变化时，
 * 如果原生注入了 `CPUTimeNative.agendaChanged`，会调用它（不带参数）。
 */
type AgendaRequest = {
  action?: string;
  refresh?: boolean;
  id?: string;
  date?: string;
  done?: boolean;
  item?: string;
  start?: string;
};

type AgendaReply = {
  authenticated: boolean;
  account: string;
  items: AgendaItem[];
  relay: boolean;
  error?: string;
};

export function installNativeAgendaBridge(router: Router) {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  if (typeof host.CPUTimeNativeAgenda === "function") return;
  const auth = useAuthStore();
  const agenda = useAgendaStore();

  const reply = (): AgendaReply => (agenda.attach()
    ? {
      authenticated: true,
      account: nativeScheduleAccountKey(),
      items: JSON.parse(JSON.stringify(agenda.items)),
      relay: agenda.relay,
      ...(agenda.error ? { error: agenda.error } : {}),
    }
    : { authenticated: false, account: "", items: [], relay: false });

  host.CPUTimeNativeAgenda = async (request: AgendaRequest = {}) => {
    try {
      if (!auth.isLoggedIn || !agenda.attach()) return reply();
      switch (request.action) {
        case "toggle":
          if (request.id && typeof request.date === "string") agenda.setDone(request.id, request.date, request.done !== false);
          await agenda.sync();
          return reply();
        case "open": {
          const query: Record<string, string> = {};
          if (request.item) query.item = request.item;
          else query.new = "1";
          if (request.date) query.date = request.date;
          if (request.start) query.start = request.start;
          await router.push({ path: "/agenda", query });
          return reply();
        }
        default:
          if (request.refresh !== false) await agenda.sync();
          return reply();
      }
    } catch (error) {
      return { ...reply(), error: error instanceof Error ? error.message : "日程暂时读不出来" };
    }
  };

  let lastSignature = "";
  watch(() => agenda.items, (items) => {
    const signature = JSON.stringify(items.map((item) => [item.id, item.updatedAt]));
    if (signature === lastSignature) return;
    lastSignature = signature;
    host.CPUTimeNative?.agendaChanged?.();
  }, { deep: false });
}
