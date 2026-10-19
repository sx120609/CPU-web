import { liveApp, postNative } from './adapters';

const ROOT_TITLES: Record<string, string> = {
  '/home': '药大拾间', '/jwxt': '教务', '/schedule': '课表', '/services': '服务', '/profile': '我的',
};
/** Pages with their own navigation or immersive controls own the full surface. */
export const PAGE_ROUTE_PREFIXES = ['/forum/topic', '/post', '/services/tools/yaoda-can-fly',
  '/services/tools/voicehub', '/voicehub'];

export function readHeaderState(router: any, stores: Map<string, any>, doc: Document = document) {
  const route = router.currentRoute.value;
  const path = route.path;
  const authenticated = Boolean(stores.get('auth')?.isLoggedIn);
  const messages = stores.get('message');
  const pageNavigation = PAGE_ROUTE_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'))
    || route.meta?.nativeChrome === 'page';
  return {
    path, fullPath: String(route.fullPath || path),
    title: ROOT_TITLES[path] || String(route.meta?.title || '药大拾间'),
    contentReady: doc.body?.dataset?.cpuAppReady === '1' || Boolean(doc.querySelector('.layout-root')),
    pageNavigation,
    back: !Object.prototype.hasOwnProperty.call(ROOT_TITLES, path), authenticated,
    unread: authenticated ? Math.max(0, Number(messages?.unreadCount) || 0) : 0,
    directUnread: authenticated ? Math.max(0, Number(messages?.directUnreadCount) || 0) : 0,
  };
}

export function runHeaderAction(action: string, root: string, router: any, stores: Map<string, any>) {
  if (action === 'back') {
    if (typeof (window as any).CPUAndroidBack === 'function') return (window as any).CPUAndroidBack(root);
    const back = window.history.state?.back;
    if (typeof back === 'string' && back.startsWith('/') && !back.startsWith('//')) router.back();
    else return router.push(root);
  } else if (action === 'messages') {
    return router.push(stores.get('auth')?.isLoggedIn
      ? (stores.get('message')?.directUnreadCount ? '/messages?tab=private' : '/messages') : '/login');
  } else if (action === 'login') {
    return router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  }
}

/** Mirror the Web route title, back state and unread counts into the native top bar. */
export function installAndroidHeader(): void {
  const host = window as any;
  const globals = liveApp()?.config.globalProperties;
  const router = globals?.$router;
  const stores = globals?.$pinia?._s;
  if (host.__cpuAndroidHeader || !router?.currentRoute || !document.body) return;
  host.__cpuAndroidHeader = true;
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
    const state = readHeaderState(router, stores);
    const payload = JSON.stringify(state);
    if (payload !== previous) {
      previous = payload;
      postNative({ type: 'header', state });
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  host.CPUAndroidHeaderAction = (action: string, root: string) => runHeaderAction(action, root, router, stores);
  router.afterEach(schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true,
    attributes: true, attributeFilter: ['data-cpu-app-ready'] });
  update();
}
