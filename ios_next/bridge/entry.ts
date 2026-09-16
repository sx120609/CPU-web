import {
  installIosNativeAuthBridge,
  installIosNextScheduleBridge,
  nativeScheduleAuthInfo,
} from "../../web/src/utils/iosNextScheduleBridge";
import { isIosNextNativeShell, liveApp, useAuthStore, useJwxtStore } from "./adapters";

if (isIosNextNativeShell() && (window as any).CPUTimeNative) {
  const host = window as any;
  let attempts = 0;

  // The native menu can be opened while an older deployed Web bundle is still
  // restoring its Pinia stores. Install the refresh hook before checking for
  // an existing schedule bridge so those bundles receive the same role update
  // path as the current Web client.
  const refreshNativeAuth = async () => {
    const auth = useAuthStore();
    const initial = nativeScheduleAuthInfo();
    host.CPUTimeNative.authChanged?.(initial);
    try {
      if (auth?.isLoggedIn && typeof auth.refreshSelfSilently === "function") {
        await auth.refreshSelfSilently();
      } else if (typeof auth?.fetchMe === "function") {
        await auth.fetchMe({ probe: true });
      }
    } catch {
      // Keep the last known capability on a transient profile failure.
    }
    const info = nativeScheduleAuthInfo();
    host.CPUTimeNative.authChanged?.(info);
    return info;
  };
  host.CPUTimeNative.refreshAuth = refreshNativeAuth;

  // Restoring a cached native timetable is independent of fetching its data.
  // Reuse the existing Web cookie/remember-login machinery once per account
  // before native starts its otherwise non-interactive background refresh.
  let academicRestore: { account: string; task: Promise<boolean> } | undefined;
  host.CPUTimeNative.restoreAcademicSession = async () => {
    const auth = useAuthStore();
    if (!auth) return false;
    if (!auth.ready) await auth.fetchMe?.({ probe: true }).catch(() => undefined);
    if (!auth.ready || !auth.isLoggedIn) return false;
    const jwxt = useJwxtStore();
    if (!jwxt) return false;
    const account = nativeScheduleAuthInfo().account;
    if (academicRestore?.account === account) return academicRestore.task;
    const task = (async () => {
      jwxt.hydrate();
      return Boolean(await jwxt.ensureSession({
        refresh: true, silent: true, allowAutoLogin: true,
        repairUnavailableSession: false,
      }));
    })().catch(() => false);
    academicRestore = { account, task };
    const restored = await task;
    if (!restored && academicRestore?.task === task) academicRestore = undefined;
    return restored;
  };

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
    const info = nativeScheduleAuthInfo();
    host.CPUTimeNative.authChanged?.(info);
  };

  const install = () => {
    installAppearanceBridge();
    if (typeof host.CPUTimeNativeScheduleFetch === "function") {
      host.CPUTimeNative.ready?.();
      return;
    }
    if (useAuthStore()) {
      installIosNativeAuthBridge(useAuthStore());
      if (useJwxtStore()) {
        installIosNextScheduleBridge(liveApp().config.globalProperties.$router);
      } else {
        // Guest home pages may never instantiate the academic store. They must
        // show the login state, not fail while waiting for a nonexistent store.
        const unsubscribe = useAuthStore().$subscribe(
          () => {
            const info = nativeScheduleAuthInfo();
            host.CPUTimeNative.authChanged?.(info);
          }, { detached: true });
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
