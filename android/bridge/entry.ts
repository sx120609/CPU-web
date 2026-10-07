import {
  installIosNativeAuthBridge,
  installIosNextScheduleBridge,
  nativeScheduleAuthInfo,
} from "../../web/src/utils/iosNextScheduleBridge";
import { isNativeScheduleShell, liveApp, useAuthStore, useJwxtStore } from "./adapters";
import { installAndroidEditor } from "./editor";
import { installAndroidHeader } from "./header";
import { installAndroidNavigation } from "./navigation";
import { installAndroidShares } from "./shares";
import { installAndroidShellObserver } from "./shell";

// Runs after every main-frame load. The document-start script owned by Kotlin
// has already created window.CPUTimeNative; this bundle only adds the pieces
// that need the live Vue app (Pinia stores and router).
if (isNativeScheduleShell() && (window as any).CPUTimeNative && !(window as any).__cpuAndroidCompatibility) {
  const host = window as any;
  host.__cpuAndroidCompatibility = true;
  let attempts = 0;

  // The native quick menu can open while an older deployed Web bundle is still
  // restoring Pinia. Install the refresh hook before any schedule bridge check.
  host.CPUTimeNative.refreshAuth = async () => {
    const auth = useAuthStore();
    host.CPUTimeNative.authChanged?.(nativeScheduleAuthInfo());
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

  // Restoring a cached native timetable is independent of fetching its data.
  // Reuse the Web cookie/remember-login machinery once per account before the
  // otherwise non-interactive background refresh starts.
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
    const store = liveApp()?.config?.globalProperties?.$pinia?._s?.get("appearance");
    if (!store || typeof store.setMode !== "function") return false;
    host.__cpuSetAppearanceMode = (mode: unknown) => {
      if (mode === "light" || mode === "dark" || mode === "system") store.setMode(mode);
    };
    return true;
  };

  // Report the launch state once, not only on the next store change. Waiting
  // for the auth probe keeps a transient "not signed in yet" from gating a
  // real session behind the native login screen.
  const reportInitialAuth = (remaining = 60) => {
    const auth = useAuthStore();
    if (auth && auth.ready !== true && remaining > 0) {
      setTimeout(() => reportInitialAuth(remaining - 1), 100);
      return;
    }
    host.CPUTimeNative.authChanged?.(nativeScheduleAuthInfo());
  };

  installAndroidShellObserver();
  installAndroidEditor();
  installAndroidShares();
  const install = () => {
    const router = liveApp()?.config.globalProperties.$router;
    if (router) {
      installAndroidNavigation();
      installAndroidHeader();
    }
    installAppearanceBridge();
    if (typeof host.CPUTimeNativeScheduleFetch === "function") {
      if (typeof host.CPUTimeNative.nativeLoginBegin !== "function" && useAuthStore()) {
        installIosNativeAuthBridge(useAuthStore());
      }
      host.CPUTimeNative.ready?.();
      reportInitialAuth();
      return;
    }
    if (useAuthStore()) {
      installIosNativeAuthBridge(useAuthStore());
      if (useJwxtStore()) {
        installIosNextScheduleBridge(router);
        reportInitialAuth();
      } else {
        // Guest pages may never instantiate the academic store. They must show
        // the login state instead of waiting for a nonexistent store.
        const unsubscribe = useAuthStore().$subscribe(
          () => host.CPUTimeNative.authChanged?.(nativeScheduleAuthInfo()), { detached: true });
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
