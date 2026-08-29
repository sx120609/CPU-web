(function enforceCanonicalHttpsTransport() {
  var location = window.location;
  var hostname = String(location.hostname || '').toLowerCase().replace(/\.$/, '');
  var productionHosts = ['cputime.cn', 'www.cputime.cn', 'cpu.lizmt.cn'];

  if (location.protocol !== 'http:' || productionHosts.indexOf(hostname) === -1) return;

  var target = 'https://cputime.cn' + location.pathname + location.search + location.hash;
  location.replace(target);
})();
