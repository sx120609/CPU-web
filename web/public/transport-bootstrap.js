(function enforceCanonicalHttpsTransport() {
  var location = window.location;
  var hostname = String(location.hostname || '').toLowerCase().replace(/\.$/, '');
  var productionHosts = ['cputime.cn', 'www.cputime.cn', 'cpu.lizmt.cn'];

  if (location.protocol !== 'http:' || productionHosts.indexOf(hostname) === -1) return;

  var target = 'https://cputime.cn' + location.pathname + location.search + location.hash;
  location.replace(target);
})();

(function loadNativeScheduleStandIn() {
  // Native shells only: a stand-in for the timetable bridge in case the site
  // app never starts (web/public/native-shell-return.js). Browsers skip it.
  var navigator = window.navigator;
  var document = window.document;
  if (!navigator || !document || !/CPUTimeNative\//i.test(String(navigator.userAgent || ''))) return;
  function load() {
    try {
      var script = document.createElement('script');
      script.async = true;
      script.setAttribute('data-site-app', '');
      // The site's CSP requires Trusted Types: the URL passes through the
      // app's default policy, which its security bootstrap installs before
      // DOMContentLoaded. Without it the app did not start at all, and there
      // is nothing left to load the stand-in with.
      script.src = '/native-shell-return.js';
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      // Keep the page free of uncaught errors.
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
