import { installIosNextScheduleBridge } from "../../web/src/utils/iosNextScheduleBridge";
import { useAuthStore, useJwxtStore } from "./adapters";
import { scheduleEnvelope, type NativeSnapshot } from "./envelope";

const host = window as any;
if (host.webkit?.messageHandlers?.cpuIOS && !host.CPUWatchRefresh) {
  let installed = false;
  let busy = false;
  let queued = false;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout>;
  const post = (value: Record<string, unknown>) => host.webkit.messageHandlers.cpuIOS.postMessage({ action: "watchSchedule", version: 1, ...value });
  const publish = async (input: NativeSnapshot) => {
    const revision = epoch;
    if (!input.auth?.authenticated) { post({ status: "loginRequired" }); return; }
    try {
      const value = await scheduleEnvelope(input);
      if (revision !== epoch) return;
      const payload = JSON.stringify(value);
      if (new TextEncoder().encode(payload).length > 60 * 1024) throw new Error("size limit");
      post({ payload });
    } catch { if (revision === epoch) post({ status: "sourceUnavailable" }); }
  };
  const local: Record<string, any> = { CPUTimeNative: {
    authChanged: () => { epoch++; scheduleRefresh(); },
    schedulePrefetched: publish,
    // Intermediate weeks are not full replacements. Publish the foreground week,
    // then the complete semester once the shared loader has finished prefetching.
  } };
  async function refresh() {
    if (busy) { queued = true; return; }
    if (!useAuthStore() || !useJwxtStore()) { post({ status: "loginRequired" }); return; }
    if (!installed) { installIosNextScheduleBridge(undefined, {}, local); installed = true; }
    busy = true;
    const revision = epoch;
    const timeout = setTimeout(() => post({ status: "sourceUnavailable" }), 45000);
    try {
      const result = await local.CPUTimeNativeScheduleFetch(undefined, undefined, true);
      if (revision === epoch) await publish(result);
    } catch { post({ status: "sourceUnavailable" }); }
    finally {
      clearTimeout(timeout);
      busy = false;
      if (queued) { queued = false; scheduleRefresh(); }
    }
  }
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  }
  host.CPUWatchRefresh = scheduleRefresh;

  // Observe completion only; never read or copy request headers, bodies or credentials.
  // Axios uses XHR. The shared loader uses fetch, so its own calls do not recurse.
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    let relevant = false;
    try {
      const target = new URL(String(url), location.href);
      relevant = target.origin === location.origin && (
        /^\/api\/jwxt\/(schedule|graduate-schedule|schedule-edits)$/.test(target.pathname)
        || /^\/api\/auth\/(sso-login|logout)$/.test(target.pathname));
    } catch {}
    if (relevant) this.addEventListener("load", () => {
      if (this.status >= 200 && this.status < 300) { epoch++; scheduleRefresh(); }
    }, { once: true });
    return (open as any).call(this, method, url, ...args);
  } as typeof open;
  addEventListener("pageshow", scheduleRefresh);
  addEventListener("online", scheduleRefresh);
  // The academic Pinia store is lazy on guest/home pages. Retry initialization
  // briefly; later successful login/schedule XHR or manual refresh also retries.
  let attempts = 0;
  const ready = () => {
    if (useAuthStore() && useJwxtStore()) { scheduleRefresh(); return; }
    if (++attempts < 120) setTimeout(ready, 250);
    else post({ status: "loginRequired" });
  };
  ready();
}
