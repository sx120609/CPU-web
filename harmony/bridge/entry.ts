import { installIosNextScheduleBridge } from "../../web/src/utils/iosNextScheduleBridge";
import { isNativeScheduleShell, liveApp, useAuthStore, useJwxtStore } from "./adapters";
import { installHarmonyEditor } from './editor';
import { installHarmonyShellObserver } from './shell';

if (isNativeScheduleShell() && (window as any).CPUTimeNative) {
  installHarmonyShellObserver();
  installHarmonyEditor();
  let attempts = 0;
  const install = () => {
    const host = window as any;
    if (typeof host.CPUTimeNativeScheduleFetch === "function") {
      host.CPUTimeNative.ready?.();
      return;
    }
    if (useAuthStore()) {
      if (useJwxtStore()) {
        installIosNextScheduleBridge(liveApp().config.globalProperties.$router);
      } else {
        // Guest home pages may never instantiate the academic store. They must
        // show the login state, not fail while waiting for a nonexistent store.
        const unsubscribe = useAuthStore().$subscribe(() => host.CPUTimeNative.authChanged?.(), { detached: true });
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
      }
      return;
    }
    if (++attempts < 120) setTimeout(install, 250);
    else host.CPUTimeNative.ready?.(); // surface the explicit error, never stay loading forever
  };
  install();
}
