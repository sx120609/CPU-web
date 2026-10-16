// The native timetables of the iOS, Android and HarmonyOS apps read their data
// through the site app running in the app's shared web view. When that view
// sits on a page outside the site app (点歌台, the legal pages) or the site app
// failed to start, the timetable has nobody to ask and its refresh button did
// nothing. This stand-in answers instead: a refresh the user asked for brings
// the site app back and finishes there (see iosNextScheduleBridge.ts); any
// other request says how to recover. It never takes a page the user is
// reading away from them, because only an explicit refresh on the timetable
// navigates.
(function installNativeScheduleStandIn() {
  var ua = String((window.navigator && window.navigator.userAgent) || '');
  if (!/CPUTimeNative\//i.test(ua)) return;
  var script = document.currentScript;
  // The site app installs the real bridge itself; stand in only when it clearly
  // has not started (the Android and HarmonyOS shells give up after 30 s).
  var siteApp = Boolean(script && script.hasAttribute('data-site-app'));
  var harmony = /CPUWebHarmonyApp\//i.test(ua);
  var leaving = false;

  function standIn(semester, week, force, background) {
    if (!force || background) {
      return Promise.resolve({
        version: 1,
        auth: { authenticated: true },
        error: '课表需要重新连接，刷新一下即可恢复。'
      });
    }
    if (!leaving) {
      leaving = true;
      try {
        window.sessionStorage.setItem('cpu-native-schedule-refresh', JSON.stringify({
          semester: semester || '',
          week: week || '',
          at: Date.now()
        }));
      } catch (error) {
        // Without storage the site app still loads; the refresh is then not forced.
      }
      setTimeout(function () {
        if (siteApp) window.location.reload();
        else window.location.replace('/home');
      }, 100);
    }
    // The HarmonyOS shell does not know a cancelled result. Leaving its request
    // open lets the navigation cancel it; the others are told so before it starts.
    if (harmony) return new Promise(function () {});
    return Promise.resolve({ version: 1, auth: { authenticated: true }, cancelled: true });
  }

  function install() {
    if (typeof window.CPUTimeNativeScheduleFetch === 'function') return;
    window.CPUTimeNativeScheduleFetch = standIn;
  }

  if (siteApp) setTimeout(install, 32000);
  else install();
})();
