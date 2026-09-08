import { liveApp } from './adapters';

const ROOT_TITLES: Record<string, string> = {
  '/home': '药大拾间', '/jwxt': '教务', '/schedule': '课表', '/services': '服务', '/profile': '我的',
};

export function readHeaderState(router: any, stores: Map<string, any>, doc: Document = document) {
  const route = router.currentRoute.value;
  const path = route.path;
  const authenticated = Boolean(stores.get('auth')?.isLoggedIn);
  const messages = stores.get('message');
  return {
    path, title: ROOT_TITLES[path] || String(route.meta?.title || '药大拾间'),
    contentReady: doc.body?.dataset?.cpuAppReady === '1',
    visible: Boolean(doc.querySelector('.layout-root > .topbar')),
    back: !Object.prototype.hasOwnProperty.call(ROOT_TITLES, path), authenticated,
    unread: authenticated ? Math.max(0, Number(messages?.unreadCount) || 0) : 0,
    directUnread: authenticated ? Math.max(0, Number(messages?.directUnreadCount) || 0) : 0,
  };
}

export function runHeaderAction(action: string, root: string, router: any, stores: Map<string, any>) {
  if (action === 'back') {
    if (typeof (window as any).CPUHarmonyBack === 'function') return (window as any).CPUHarmonyBack(root);
    const back = window.history.state?.back;
    if (typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')) router.back();
    else return router.push(root);
  } else if (action === 'messages') {
    return router.push(stores.get('auth')?.isLoggedIn
      ? (stores.get('message')?.directUnreadCount ? '/messages?tab=private' : '/messages') : '/login');
  } else if (action === 'login') {
    return router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  } else if (action === 'more') {
    // Keep server-configured shortcuts and account actions in the existing drawer.
    document.querySelector<HTMLButtonElement>('.topbar .mobile-actions button[aria-label="更多"]')?.click();
  } else if (action === 'refresh') {
    window.location.reload();
  }
}

export function installHarmonyHeader(): void {
  const host = window as any;
  const globals = liveApp()?.config.globalProperties;
  const router = globals?.$router;
  const stores = globals?.$pinia?._s;
  if (host.__cpuHarmonyHeader || !host.CPUHarmony?.headerChanged || !router?.currentRoute || !document.body) return;
  host.__cpuHarmonyHeader = true;
  let previous = '';
  let queued = false;
  const subscribed = new Set<string>();
  const update = () => {
    queued = false;
    for (const name of ['auth', 'message']) {
      const store = stores?.get(name);
      if (store && !subscribed.has(name)) {
        subscribed.add(name);
        store.$subscribe(schedule, { detached: true });
      }
    }
    const payload = JSON.stringify(readHeaderState(router, stores));
    if (payload !== previous) {
      previous = payload;
      host.CPUHarmony.headerChanged(payload);
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  host.CPUHarmonyHeaderAction = (action: string, root: string) => runHeaderAction(action, root, router, stores);
  router.afterEach(schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true,
    attributes: true, attributeFilter: ['data-cpu-app-ready'] });
  update();
}
