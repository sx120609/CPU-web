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
  var script = document.createElement('script');
  script.src = '/native-shell-return.js';
  script.async = true;
  script.setAttribute('data-site-app', '');
  (document.head || document.documentElement).appendChild(script);
})();
