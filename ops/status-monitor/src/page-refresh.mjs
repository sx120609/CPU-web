// This closure lives outside the replaceable status fragment. Only an explicit
// user resume starts another five-minute budget; visibility never resets it.
export function installStatusRefresh() {
  var main = document.getElementById('status');
  var stale = document.getElementById('stale');
  var controls = document.getElementById('refresh-controls');
  var note = document.getElementById('refresh-note');
  var resume = document.getElementById('resume-refresh');
  if (!main || !stale || !controls || !note || !resume || !window.fetch || !window.DOMParser || !window.AbortController) return;
  var paused = false, deadline = 0, interval, expiry, active = null;
  function pause() {
    paused = true;
    clearInterval(interval);
    clearTimeout(expiry);
    if (active) active.abort();
    active = null;
    note.textContent = '自动刷新已暂停。' + (main.getAttribute('data-updated') || '') + '。';
    resume.hidden = false;
  }
  function refresh() {
    if (paused) return;
    if (Date.now() >= deadline) { pause(); return; }
    if (document.hidden || active) return;
    var request = new AbortController();
    active = request;
    fetch(location.pathname, { cache: 'no-store', signal: request.signal })
      .then(function(response) { if (!response.ok) throw new Error('refresh failed'); return response.text(); })
      .then(function(html) {
        if (request.signal.aborted || paused || Date.now() >= deadline) return;
        var next = new DOMParser().parseFromString(html, 'text/html');
        var fresh = next.getElementById('status');
        if (!fresh) throw new Error('missing status');
        main.replaceWith(fresh);
        main = fresh;
        document.title = next.title;
        stale.hidden = true;
      }).catch(function() { if (!request.signal.aborted && !paused) stale.hidden = false; })
      .finally(function() { if (active === request) active = null; });
  }
  function start() {
    paused = false;
    deadline = Date.now() + 300000;
    resume.hidden = true;
    note.textContent = '自动刷新将在 5 分钟后暂停，后台检测持续运行。';
    expiry = setTimeout(pause, 300000);
    interval = setInterval(refresh, (+main.getAttribute('data-refresh') || 60) * 1000);
  }
  controls.hidden = false;
  resume.addEventListener('click', function() { if (paused) { start(); refresh(); } });
  document.addEventListener('visibilitychange', refresh);
  start();
}

export const REFRESH_SCRIPT = '(' + installStatusRefresh.toString() + ')();';
