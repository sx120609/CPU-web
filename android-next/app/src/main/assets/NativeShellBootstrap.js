// Android native shell bootstrap. Installed at document start for the trusted
// origin only; "__CPU_APP_ORIGIN__" is replaced by the shell before injection.
// It mirrors the iOS `bridgeScript()`: hide the Web bars the native shell
// replaces, expose `window.CPUTimeNative`, and report routes, auth and
// appearance changes. Pinia-dependent pieces live in NativeWebCompatibility.js.
(() => {
  if (location.origin !== "__CPU_APP_ORIGIN__") return;
  if (!/CPUTimeNative\//i.test(navigator.userAgent)) return;
  if (window.__cpuAndroidShellBootstrap) return;
  window.__cpuAndroidShellBootstrap = true;

  const port = window.CPUAndroidNativePort;
  const send = (message) => {
    let text;
    try { text = JSON.stringify(message); } catch (_) { return false; }
    try {
      if (port && typeof port.postMessage === 'function') { port.postMessage(text); return true; }
      const legacy = window.CPUAndroidNative;
      if (legacy && typeof legacy.post === 'function') { legacy.post(text); return true; }
    } catch (_) {}
    return false;
  };
  const post = (payload) => send({ kind: 'post', payload });

  const pageRoutePrefixes = ['/forum/topic', '/post', '/services/tools/yaoda-can-fly',
    '/services/tools/voicehub', '/voicehub'];
  const style = document.createElement('style');
  style.id = 'cpu-android-native-shell';
  style.textContent = [
    'html[data-cpu-android-native] { --cpu-ios-bottom-clearance: 0px; }',
    // The document is the scroll owner. The shared iOS styles make body an
    // auto-height overflow:auto container; combined with overscroll:none it
    // traps one-finger gestures in current Chromium even though body has no
    // scroll range. Explicit modal locks below still own the body when open.
    'html[data-cpu-android-native][data-cpu-ios-next] body { overflow: visible; }',
    'html[data-cpu-android-native] body.el-popup-parent--hidden,',
    'html[data-cpu-android-native] body.el-message-box-parent--hidden,',
    'html[data-cpu-android-native] body.el-image-viewer-parent--hidden,',
    'html[data-cpu-android-native] body.el-tour-parent--hidden { overflow: hidden; }',
    // The native shell supplies both bars. The Web top bar stays in the DOM so
    // its drawer and account actions remain reusable.
    'html[data-cpu-android-native] .layout-root > .topbar,',
    'html[data-cpu-android-native] .layout-root > .mobile-tabbar,',
    'html[data-cpu-android-native] #boot-screen { display: none !important; }',
    'html[data-cpu-android-native] .independent-service-note { display: none !important; }',
    'html[data-cpu-android-native] .layout-root {',
    '  --layout-mobile-tabbar-reserve: 0px !important;',
    '  --liquid-tabbar-reserve: 0px !important;',
    '  --cpu-safe-area-inset-top: 0px !important;',
    '  --cpu-ios-inline-inset: 12px;',
    '  padding-bottom: 0 !important;',
    '}',
    'html[data-cpu-android-native] .layout-root .main { padding-bottom: 16px !important; }',
    'html[data-cpu-android-native] .layout-root .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) { padding-top: 14px !important; }',
    'html[data-cpu-android-native] .layout-root .main.main--bare,',
    'html[data-cpu-android-native] .layout-root .main.main--full-width,',
    'html[data-cpu-android-native] .layout-root .main.main--mobile-topic { padding-top: 0 !important; }',
    'html[data-cpu-android-native] .layout-root:not(.layout-root--full-width) > .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) { padding-inline: var(--cpu-ios-inline-inset) !important; }',
    'html[data-cpu-android-native] .forum-post-fab { bottom: 16px !important; }',
    // A native tab tap swaps pages instantly: a crossfade would freeze the old
    // page at its scroll position on top of the new one.
    'html[data-cpu-android-native] .page-route-enter-active,',
    'html[data-cpu-android-native] .page-route-leave-active { transition: none !important; }',
  ].join('\n');
  const installChrome = () => {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.cpuAndroidNative = '1';
    root.dataset.cpuIosNext = '1';
    root.dataset.cpuPlatform = 'android';
    if (!style.isConnected) (document.head || root).appendChild(style);
  };
  installChrome();
  addEventListener('DOMContentLoaded', installChrome, { once: true });

  const bridge = window.CPUTimeNative || {};
  bridge.isNativeShell = true;
  bridge.platform = 'android';
  bridge.version = '1';
  bridge.postNative = post;
  bridge.__resolve = (id, text) => send({ kind: 'resolve', id: String(id), value: typeof text === 'string' ? text : 'null' });
  bridge.navigate = (path) => {
    if (bridge.nativeNavigationDepth > 0) return false;
    return post({ type: 'navigate', path: String(path == null ? '' : path) });
  };
  bridge.ready = () => post({ type: 'ready' });
  bridge.schedulePrefetched = (snapshot) => post({ type: 'schedulePrefetched', snapshot });
  bridge.scheduleWeekPrefetched = bridge.schedulePrefetched;
  bridge.authChanged = (value, canAccessAdmin = false, ready = true, authenticated) => {
    const info = value && typeof value === 'object' ? value : {
      account: String(value == null ? '' : value), canAccessAdmin, ready,
      authenticated: authenticated === undefined ? Boolean(value) : Boolean(authenticated),
    };
    const account = String(info.account == null ? '' : info.account);
    return post({
      type: 'authChanged', account,
      authenticated: info.authenticated === undefined ? Boolean(account) : Boolean(info.authenticated),
      ready: info.ready === undefined ? true : Boolean(info.ready),
      canAccessAdmin: Boolean(info.canAccessAdmin),
    });
  };
  bridge.notificationsChanged = (unreadCount = 0, directUnreadCount = 0) => post({
    type: 'notificationsChanged',
    unreadCount: Math.max(0, Number(unreadCount) || 0),
    directUnreadCount: Math.max(0, Number(directUnreadCount) || 0),
  });
  window.CPUTimeNative = bridge;

  const observeAppearance = () => {
    const root = document.documentElement;
    if (!root) return;
    const report = () => post({
      type: 'appearance', dark: root.dataset.theme === 'dark',
      mode: root.dataset.appearanceMode || 'system',
    });
    new MutationObserver(report).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-appearance-mode'] });
    report();
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', observeAppearance, { once: true });
  else observeAppearance();

  const routePath = () => (location.pathname || '/') + (location.search || '') + (location.hash || '');
  const updatePageChrome = () => {
    const path = location.pathname;
    const owns = pageRoutePrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'));
    if (document.documentElement) document.documentElement.toggleAttribute('data-cpu-page-navigation', owns);
  };
  let lastPath = '';
  const notifyRoute = () => {
    const path = routePath();
    updatePageChrome();
    if (path === lastPath) return;
    lastPath = path;
    post({ type: 'route', path });
  };
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    history[method] = function (...args) {
      const result = original.apply(this, args);
      notifyRoute();
      return result;
    };
  }
  addEventListener('popstate', notifyRoute);
  addEventListener('hashchange', notifyRoute);
  notifyRoute();
})();
