import { liveApp } from './adapters';

const ROOTS = ['/home', '/jwxt', '/schedule', '/services', '/profile'];
const BACK_BUTTONS = '.mobile-topic-back, .board-back-btn, .back-btn, .back-link, .mobile-back-link, .back-to-site, .corner-back';

export function localReturnPath(value: unknown): string {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value) ? value : '';
}

export function parentRoute(path: string, fallback = '/home'): string {
  if (/^\/services\/tools\/filestore\/(submit|status)\//.test(path)) return '/services/tools/filestore';
  if (/^\/services\/tools\/grade-checks\//.test(path)) return '/services/tools/grade_check';
  if (/^\/services\/tools\/file-collections\//.test(path) || path === '/services/tools/filestore') return '/services/tools/file_collect';
  for (const root of ['/services/tools', '/services', '/profile', '/messages', '/coursereview', '/forum']) {
    if (path.startsWith(root + '/')) return root;
  }
  if (path === '/vip' || path === '/sponsor' || path === '/admin') return '/profile';
  if (path.startsWith('/u/') || path.startsWith('/post')) return '/forum';
  if (path === '/register') return '/login';
  return localReturnPath(fallback) || '/home';
}

export function createHarmonyNavigation(router: any, host: any = window) {
  let trail: { path: string; scroll: number }[] = [{ path: router.currentRoute.value.fullPath, scroll: 0 }];
  let pending = false;
  const browserBack = router.back.bind(router);
  const fullPath = (route: any) => route.fullPath || route.path;
  const pathname = (path: string) => path.split(/[?#]/)[0];
  router.beforeEach(() => {
    if (trail.length) trail[trail.length - 1].scroll = Number(host.scrollY) || 0;
    return true;
  });
  router.afterEach((to: any, _from: any, failure: unknown) => {
    pending = false;
    if (failure) return;
    const next = fullPath(to);
    const index = trail.findLastIndex(item => item.path === next);
    if (index >= 0) {
      const returning = index < trail.length - 1;
      const scroll = trail[index].scroll;
      trail = trail.slice(0, index + 1);
      if (returning) host.requestAnimationFrame(() => host.requestAnimationFrame(() => host.scrollTo(0, scroll)));
    } else if (ROOTS.includes(to.path)) {
      trail = [{ path: next, scroll: 0 }];
    } else if (trail.length && pathname(trail[trail.length - 1].path) === to.path) {
      trail[trail.length - 1].path = next;
    } else {
      trail.push({ path: next, scroll: 0 });
    }
  });

  const back = async (fallback = '/home', preferred = ''): Promise<boolean> => {
    if (pending) return true;
    const current = router.currentRoute.value;
    const target = [localReturnPath(preferred), trail.at(-2)?.path, localReturnPath(current.query?.from),
      parentRoute(current.path, ROOTS.includes(current.path) ? current.path : fallback)]
      .find(value => value && value !== fullPath(current));
    if (!target) return false;
    pending = true;
    if (localReturnPath(host.history.state?.back) === target) {
      browserBack();
    } else {
      try { await router.replace(target); } finally { pending = false; }
    }
    return true;
  };
  const openTab = async (path: string) => {
    const target = localReturnPath(path);
    if (!target) return;
    const result = await router.replace(target);
    if (!result) trail = [{ path: fullPath(router.currentRoute.value), scroll: 0 }];
    return result;
  };
  return { back, openTab };
}

export function installHarmonyNavigation(): void {
  const host = window as any;
  const router = liveApp()?.config.globalProperties.$router;
  if (host.CPUHarmonyBack || !router?.currentRoute) return;
  const navigation = createHarmonyNavigation(router);
  host.CPUHarmonyBack = navigation.back;
  host.CPUHarmonyOpenTab = navigation.openTab;
  router.back = () => { void navigation.back(); };
  document.addEventListener('click', (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>(BACK_BUTTONS);
    if (!button || button.closest('[aria-modal="true"]') || button.hasAttribute('disabled')) return;
    const route = router.currentRoute.value;
    let preferred = '';
    if (button.matches('.back-to-site')) preferred = localReturnPath(button.getAttribute('href'));
    else if (button.matches('.back-link, .mobile-back-link, .corner-back') || route.path.startsWith('/services/')) {
      preferred = parentRoute(route.path);
    } else if (button.matches('.mobile-topic-back, .board-back-btn')) {
      preferred = localReturnPath(route.query?.from);
      if (!preferred && button.getAttribute('aria-label') === '返回上页') preferred = '/announcements';
    }
    const fallback = button.getAttribute('aria-label') === '返回上页' ? '/announcements' : parentRoute(route.path);
    event.preventDefault(); event.stopImmediatePropagation();
    void navigation.back(fallback, preferred);
  }, true);
}
