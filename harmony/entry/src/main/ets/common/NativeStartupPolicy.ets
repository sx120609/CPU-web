export const NATIVE_STARTUP_POLICY: string = `
(() => {
  if (window !== window.top || !['https://cputime.cn', 'https://cpu.lizmt.cn'].includes(location.origin)) return;
  const install = () => {
    if (!document.head || !document.documentElement) return false;
    document.documentElement.dataset.cpuHarmonyNative = '1';
    if (!document.getElementById('cpu-harmony-first-paint')) {
      const style = document.createElement('style');
      style.id = 'cpu-harmony-first-paint';
      style.textContent = 'html[data-cpu-harmony-native] #boot-screen, ' +
        'html[data-cpu-harmony-native] .layout-root > .topbar, ' +
        'html[data-cpu-harmony-native] .layout-root > .mobile-tabbar, ' +
        'html[data-cpu-harmony-native] .layout-root > .footer { display: none !important; }';
      document.head.appendChild(style);
    }
    return true;
  };
  if (!install()) {
    const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
  }
})();
`;
