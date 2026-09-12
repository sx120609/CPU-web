import { installIosNextScheduleBridge, nativeScheduleAccountKey } from "../../web/src/utils/iosNextScheduleBridge";
import { isIosNextNativeShell, liveApp, useAuthStore, useJwxtStore } from "./adapters";

if (isIosNextNativeShell() && (window as any).CPUTimeNative) {
  const host = window as any;
  let attempts = 0;

  const installAppearanceBridge = () => {
    if (typeof host.__cpuSetAppearanceMode === "function") return true;
    const app = liveApp();
    const store = app?.config?.globalProperties?.$pinia?._s?.get("appearance");
    if (!store || typeof store.setMode !== "function") return false;
    host.__cpuSetAppearanceMode = (mode: unknown) => {
      if (mode === "light" || mode === "dark" || mode === "system") store.setMode(mode);
    };
    return true;
  };

  // The native shell needs the launch state once, not only on the next store
  // change: a session restored before this bundle installed would otherwise
  // never reach the native login gate. Waiting for the auth store's restore to
  // settle keeps a transient "not signed in yet" from gating a real session.
  const reportInitialAuth = (remaining = 60) => {
    const auth = useAuthStore();
    if (auth && auth.ready !== true && remaining > 0) {
      setTimeout(() => reportInitialAuth(remaining - 1), 100);
      return;
    }
    host.CPUTimeNative.authChanged?.(nativeScheduleAccountKey());
  };

  const install = () => {
    installAppearanceBridge();
    if (typeof host.CPUTimeNativeScheduleFetch === "function") {
      host.CPUTimeNative.ready?.();
      return;
    }
    if (useAuthStore()) {
      if (useJwxtStore()) {
        installIosNextScheduleBridge(liveApp().config.globalProperties.$router);
        reportInitialAuth();
      } else {
        // Guest home pages may never instantiate the academic store. They must
        // show the login state, not fail while waiting for a nonexistent store.
        const unsubscribe = useAuthStore().$subscribe(
          () => host.CPUTimeNative.authChanged?.(nativeScheduleAccountKey()), { detached: true });
        host.CPUTimeNativeScheduleFetch = async (semester?: string, week?: string, force?: boolean) => {
          for (let n = 0; n < 12 && useAuthStore().isLoggedIn && !useJwxtStore(); n++) {
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          if (!useJwxtStore()) return { version: 1, auth: { authenticated: false } };
          unsubscribe?.();
          installIosNextScheduleBridge(liveApp().config.globalProperties.$router);
          return host.CPUTimeNativeScheduleFetch(semester, week, force);
        };
        host.CPUTimeNative.openWebRoute = (path: string) => liveApp().config.globalProperties.$router.push(path);
        host.CPUTimeNative.ready?.();
        reportInitialAuth();
      }
      return;
    }
    if (++attempts < 120) setTimeout(install, 250);
    else host.CPUTimeNative.ready?.(); // surface the explicit error, never stay loading forever
  };
  install();
}
