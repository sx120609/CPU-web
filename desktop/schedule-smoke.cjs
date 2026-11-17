const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { TabManager } = require("./dist/electron/tabs.js");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cpu-schedule-smoke-"));
app.setPath("userData", profile);
const fixture = fs.readFileSync(path.join(__dirname, "scripts", "schedule-fixture.html"), "utf8");
const origin = "https://cputime.cn";
const header = "[data-cpu-desktop-schedule-nav]";
let window, tabs, contents;

const evaluate = source => contents.executeJavaScript(source);
async function until(source, description) {
  const end = Date.now() + 8000;
  while (!await evaluate(source)) {
    assert.ok(Date.now() < end, description);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

async function run() {
  // Serve both test origins from memory; no request reaches either website.
  session.defaultSession.protocol.handle("https", () => new Response(fixture, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  }));
  window = new BrowserWindow({ show: false, frame: false, width: 1024, height: 700 });
  tabs = new TabManager(window, {
    appVersion: "test", isNavigable: () => true, registerKind() {}, openExternally() {},
    onDidFinishLoad() {}, onNavigation() {}, onChange() {}
  });
  await tabs.openSiteTab(site => site.loadURL(origin + "/schedule?week=12"));
  contents = tabs.activeContents();
  // macOS delivers native resize events to a visible BrowserWindow; TabManager
  // uses these events to resize the embedded WebContentsView.
  window.showInactive();
  contents.setBackgroundThrottling(false);
  const count = `document.querySelectorAll('${header}').length`;
  const visible = `document.querySelector('${header}')?.getBoundingClientRect().height > 0`;
  await until(`${visible} && ${count} === 1`, "A direct launch with a query works without an earlier site header");
  const destinations = await evaluate(`Array.from(document.querySelectorAll('${header} a[href]'), a => a.origin === location.origin && a.pathname)`);
  assert.ok(destinations.includes("/home") && destinations.includes("/services"), "Direct launch provides first-party navigation");
  await contents.loadURL(origin + "/home");
  assert.equal(await evaluate(count), 0, "The home page already has its own header");

  await evaluate("document.querySelector('.top-nav a[href=\"/schedule\"]').click()");
  await until(`${visible} && ${count} === 1`, "The desktop schedule needs exactly one visible header");
  await until("document.querySelector('.schedule-exit-btn').getBoundingClientRect().height === 0", "The header replaces Exit");
  await until(`(() => {
    const left = selector => document.querySelector(selector).getBoundingClientRect().left;
    return innerWidth >= 960 && left('.week-switcher') < left('.sem-select') && left('.sem-select') < left('.view-switch');
  })()`, "Wide layout places the week controls on the left and semester and views on the right");

  await evaluate("document.querySelector('.view-switch button:last-child').click()");
  await until("!!document.querySelector('.schedule-page.view-month .week-title')", "The original month control remains interactive");
  await evaluate("document.querySelector('button[aria-label=\"回到今天\"]').click()");
  assert.equal(await evaluate("document.querySelector('.week-title b').textContent"), "本月", "The original jump-to-today action still works");
  const light = await evaluate(`getComputedStyle(document.querySelector('${header}')).backgroundColor`);
  await evaluate("document.documentElement.classList.add('dark'); document.querySelector('.schedule-page').classList.add('is-dark')");
  await until(`getComputedStyle(document.querySelector('${header}')).backgroundColor !== ${JSON.stringify(light)}`, "The header follows the live dark theme");

  window.setContentSize(700, 600);
  await until(`innerWidth <= 768 && !(${visible}) && document.querySelector('.mobile-tabbar').getBoundingClientRect().height > 0`, "Narrow windows keep the original bottom navigation");
  window.setContentSize(1024, 700);
  await until(`innerWidth >= 960 && ${visible} && ${count} === 1`, "Expanding the window restores one desktop header");
  await evaluate(`Array.from(document.querySelectorAll('${header} a[href]')).find(a => a.pathname === '/home' && a.getBoundingClientRect().width > 0).click()`);
  await until(`location.pathname === '/home' && ${count} === 0 && !!document.querySelector('.topbar')`, "Using desktop navigation leaves the timetable");
  await evaluate("history.back()");
  await until(`location.pathname === '/schedule' && ${visible} && ${count} === 1`, "History navigation restores a single header");

  // A subsequent site update can supply its own header without an app update.
  await evaluate(`(() => {
    document.querySelector('.schedule-page').classList.add('has-site-header');
    const native = document.createElement('header');
    native.className = 'topbar';
    document.querySelector('.layout-root').prepend(native);
  })()`);
  await until(`${count} === 0 && !document.querySelector('[data-cpu-desktop-schedule]')`, "A site-provided header takes precedence");
  await contents.loadURL("https://unrelated.invalid/schedule");
  await evaluate("document.documentElement.classList.toggle('dark'); document.body.append(document.createElement('div'))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.equal(await evaluate(count), 0, "A similar page on another origin stays untouched");
  console.log("Desktop timetable smoke passed: SPA navigation, toolbar geometry, live theme, compact window, current website and origin isolation");
}

const deadline = setTimeout(() => { console.error("Desktop timetable smoke timed out"); app.exit(1); }, 45000);
app.whenReady().then(run).then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  clearTimeout(deadline);
  tabs?.destroy();
  window?.destroy();
  app.exit(code);
}
app.on("quit", () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
