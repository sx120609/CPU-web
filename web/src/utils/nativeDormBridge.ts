import { watch } from "vue";
import type { Router } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { isNativeScheduleShell } from "@/utils/clientInfo";
import { dormScheduleLocation } from "@/utils/dormScheduleRoute";
import { nativeScheduleAccountKey } from "@/utils/iosNextScheduleBridge";
import { handleNativeDormRequest, type NativeDormRequest, type NativeDormRequestDeps } from "@/utils/nativeDormOffer";
import type { NativeDormSync } from "@/utils/nativeDormSync";

/**
 * 原生 App 的宿舍课表入口：`window.CPUTimeNativeDorm(request)`。宿舍课表的界面是网页
 * `/dorm-schedule`（复用课表页的宿舍弹窗），原生只负责两件事：
 *
 * - `{ action: "offer", snapshot, account?, force? }`：原生课表稳定后，把当前学期整学期课表（含本机修改，
 *   格式同情侣课表上传的 `{ semester, schedule, calendar }`）交给网页。网页记下它，并在账号已加入宿舍时
 *   上传（规则见 nativeDormSync.ts）。`account` 是原生课表所属的账号（`nativeScheduleAuthInfo().account`），
 *   和网页当前账号对不上时不收。返回 `{ result }`，result 同 DormDialog 的 syncNow。
 * - `{ action: "open", code? }`：打开宿舍课表页，有宿舍码时预先填好。
 *
 * 页面的登录状态还没恢复时先等它（最多 8 秒），等不到就返回 `{ missing: true }`，和没有这个桥的旧网页一样；
 * 不带 account 的 offer 这时不收（见 nativeDormOffer.ts）。
 */

let shared: Promise<NativeDormSync> | null = null;

/** 原生壳里共用的一份同步状态：页面和后台上传看到的是同一份原生快照。 */
export function nativeDormSync() {
  if (!shared) {
    shared = import("@/utils/nativeDormSync").then(({ createNativeDormSync }) => {
      const auth = useAuthStore();
      let storage: Storage | null = null;
      try { storage = window.sessionStorage; } catch { storage = null; }
      return createNativeDormSync({ userId: () => (auth.isLoggedIn ? auth.user?.id : null), storage });
    });
  }
  return shared;
}

export function installNativeDormBridge(router: Router) {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  if (typeof host.CPUTimeNativeDorm === "function") return;
  const auth = useAuthStore();
  const authSettled = () => auth.ready
    ? Promise.resolve(true)
    : new Promise<boolean>((resolve) => {
      let stop = () => {};
      const timer = window.setTimeout(() => {
        stop();
        resolve(false);
      }, 8000);
      stop = watch(() => auth.ready, (ready) => {
        if (!ready) return;
        window.clearTimeout(timer);
        stop();
        resolve(true);
      });
    });

  const deps: NativeDormRequestDeps = {
    userId: () => (auth.isLoggedIn ? auth.user?.id : null),
    accountKey: nativeScheduleAccountKey,
    sync: nativeDormSync,
    ready: () => auth.ready,
    settled: authSettled,
    open: (code) => router.push(dormScheduleLocation(code)),
  };
  host.CPUTimeNativeDorm = (request?: NativeDormRequest) => handleNativeDormRequest(request, deps);

  // 换账号或退出登录时扔掉上一个账号的原生快照。
  watch(() => auth.user?.id, (next, previous) => {
    if (previous && next !== previous && shared) void shared.then((sync) => sync.forget());
  });
}
