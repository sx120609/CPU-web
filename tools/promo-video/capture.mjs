// 用真实前端渲染宣传片素材：启动 web/ 的 Vite 开发服务器和 VoiceHub 的构建产物，用 Playwright 打开真实页面，
// 所有接口请求由 mock-*.mjs 应答，再按镜头需要截图到 output/promo/screens/，并写出 manifest.json 给 index.html 用。
//
//   npm ci --prefix web && npm run build:cpu --prefix voicehub   # 首次准备
//   node tools/promo-video/capture.mjs                           # 生成全部素材
//   node tools/promo-video/capture.mjs forum                     # 只重拍名字里包含 forum 的镜头
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveApi } from "./mock-api.mjs";
import { NOW, localState } from "./mock-data.mjs";
import { voicehubFixtures, COVER_COLORS } from "./mock-voicehub.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const outDir = path.join(root, "output", "promo", "screens");
const assetDir = path.join(root, "output", "promo", "voicehub-assets");
mkdirSync(outDir, { recursive: true });
mkdirSync(path.join(assetDir, "covers"), { recursive: true });
const filters = process.argv.slice(2);
const manifestFile = path.join(outDir, "manifest.json");
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    return require(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  }
}

function startServer(label, args, { cwd, env, ready }) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not start in 90s`)), 90_000);
    const onData = (chunk) => {
      if (ready.test(String(chunk))) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${label} exited with ${code}`)));
  });
}

/** 封面是抽象渐变图，配乐片段截自 score.py 合成的成片配乐，保证播放器能真正解码。 */
function prepareVoicehubAssets() {
  COVER_COLORS.forEach(([a, b], i) => {
    const file = path.join(assetDir, "covers", `${i + 1}.jpg`);
    if (existsSync(file)) return;
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `gradients=s=600x600:c0=${a}:c1=${b}:c2=${a}:x0=0:y0=0:x1=600:y1=600:nb_colors=3:type=linear`, "-frames:v", "1", "-q:v", "3", file]);
  });
  const audio = path.join(assetDir, "demo.wav");
  if (!existsSync(audio)) {
    const score = path.join(root, "output", "promo", "score.wav");
    if (!existsSync(score)) spawnSync("python3", [path.join(here, "score.py"), score], { stdio: "inherit" });
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "12", "-t", "40", "-i", score, "-ac", "2", "-ar", "44100", audio]);
  }
}

// 手机截图视口比 844 少 47px：成片里会在上方补一条状态栏，凑成完整的手机屏幕。
const PHONE = { viewport: { width: 390, height: 797 }, deviceScaleFactor: 3, isMobile: true, hasTouch: false };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

// scroll：另存一张隐藏固定元素的整页图，成片里在顶栏和底栏之间滚动；elements：把单个组件裁成浮动卡片。
const SHOTS = [
  { name: "schedule-week", device: PHONE, path: "/schedule", waitFor: ".week-course" },
  { name: "jwxt-grades", device: PHONE, path: "/jwxt", scroll: true, waitFor: ".grade-card", elements: [{ name: "grade-card", selector: ".grade-card", count: 3 }] },
  { name: "jwxt-progress", device: PHONE, path: "/jwxt", prepare: (page) => page.click("#edu-m-tab-progress"), waitFor: ".overall", elements: [{ name: "progress-overall", selector: ".overall", count: 1 }] },
  { name: "forum-feed", device: PHONE, path: "/forum", scroll: true, waitFor: ".feed-card", elements: [{ name: "feed-card", selector: ".feed-card", count: 8 }] },
  { name: "home-phone", device: PHONE, path: "/home", waitFor: ".feed-card" },
  { name: "home-desktop", device: DESKTOP, path: "/home" },
  { name: "services-phone", device: PHONE, path: "/services", scroll: true, elements: [{ name: "services-tools", selector: ".svc-m-tool-grid", count: 1 }] },
  { name: "announcements-phone", device: PHONE, path: "/announcements", waitFor: ".announce-item", elements: [{ name: "announce-list", selector: ".announce-list", count: 1 }] },
  { name: "voicehub-schedule", app: "voicehub", device: PHONE, path: "/voicehub/", waitFor: ".schedule-items .song-card" },
  { name: "voicehub-songs", app: "voicehub", device: PHONE, path: "/voicehub/", prepare: (page) => page.click('.section-tab:has-text("歌曲列表")'), waitFor: ".song-list .song-card" },
  { name: "voicehub-player", app: "voicehub", device: PHONE, path: "/voicehub/", waitFor: ".lyrics-modal-overlay", settle: 3000, prepare: (page) => openPlayer(page) },
  {
    name: "voicehub-lyrics", app: "voicehub", device: PHONE, path: "/voicehub/", waitFor: ".lyrics-modal-overlay", settle: 4500,
    prepare: async (page) => {
      await openPlayer(page);
      await page.waitForTimeout(1200);
      await page.click(".mobile-pagination-dots .dot:nth-child(2)");
      // 歌词的弹簧动画由音频进度驱动：停在第二句中段，等动画落定再拍。
      await page.waitForFunction(() => (document.querySelector("audio")?.currentTime ?? 0) >= 6.6, null, { timeout: 20_000 });
      await page.evaluate(() => document.querySelector("audio").pause());
    },
  },
];

/** 点排期里的第一首歌开始播放；手机版式里点播放条本身就会展开全屏播放器。 */
async function openPlayer(page) {
  await page.waitForSelector(".schedule-items .song-cover");
  await page.locator(".schedule-items .song-cover").first().click();
  await page.waitForSelector(".music-widget", { state: "visible" });
  await page.waitForTimeout(1500);
  await page.click(".music-widget .title");
}

const selected = SHOTS.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
// 开发服务器会重写这两份自动生成的声明文件；截图结束后原样还原，不在工作区留下改动。
const generated = ["components.d.ts", "auto-imports.d.ts"].map((name) => path.join(root, "web", name)).filter((file) => existsSync(file));
const snapshots = generated.map((file) => [file, readFileSync(file)]);
const servers = [];
const WEB_PORT = 5199;
const HUB_PORT = 3099;
if (selected.some((s) => s.app !== "voicehub")) {
  servers.push(await startServer("vite", [path.join(root, "web", "node_modules", "vite", "bin", "vite.js"), "--port", String(WEB_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: path.join(root, "web"), ready: /Local:/ }));
}
if (selected.some((s) => s.app === "voicehub")) {
  prepareVoicehubAssets();
  servers.push(await startServer("voicehub", [path.join(root, "voicehub", ".output", "server", "index.mjs")], {
    cwd: path.join(root, "voicehub"),
    ready: /Listening/i,
    env: {
      // 数据库地址指向一个关闭的端口：页面数据全部在浏览器里被拦截，服务端查询会立即失败而不是卡住。
      DATABASE_URL: "postgresql://capture:capture@127.0.0.1:1/capture", CPU_WEB_ORIGIN: "http://127.0.0.1:1",
      NUXT_APP_BASE_URL: "/voicehub/", NUXT_PUBLIC_API_BASE: "/voicehub/api", NUXT_PUBLIC_SITE_TITLE: "药苑之声",
      NITRO_HOST: "127.0.0.1", NITRO_PORT: String(HUB_PORT),
    },
  }));
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--autoplay-policy=no-user-gesture-required"] });
const unknown = new Set();
const hub = voicehubFixtures();

async function routeWeb(page) {
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const hit = resolveApi(req.method(), url.pathname, url.searchParams);
    if (hit === undefined) unknown.add(`${req.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: hit ?? null, message: "" }) });
  });
}

async function routeVoicehub(page) {
  // 歌词默认会去几个外部歌词源找；全部挡掉，只用本地接口返回的原创歌词。
  await page.route((url) => url.hostname !== "127.0.0.1", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route((url) => url.pathname.startsWith("/voicehub/__mock/"), (route) => {
    const file = new URL(route.request().url()).pathname.split("/__mock/")[1];
    const local = file.startsWith("covers/") ? path.join(assetDir, file) : path.join(assetDir, "demo.wav");
    route.fulfill({ contentType: file.endsWith(".wav") ? "audio/wav" : "image/jpeg", body: readFileSync(local) });
  });
  await page.route((url) => url.pathname.startsWith("/voicehub/api/"), (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/voicehub/, "");
    if (!(p in hub.routes)) unknown.add(`voicehub ${route.request().method()} ${p}`);
    route.fulfill({ json: p in hub.routes ? hub.routes[p] : { success: true, data: null } });
  });
}

/** 量出固定顶栏的下沿和固定底栏的上沿（CSS 像素），成片据此把滚动内容夹在中间。 */
const measureChrome = () => {
  const fixed = [...document.querySelectorAll("body *")].filter((el) => {
    const pos = getComputedStyle(el).position;
    const r = el.getBoundingClientRect();
    return (pos === "fixed" || pos === "sticky") && r.width > innerWidth * 0.8 && r.height > 0 && r.height < 160;
  }).map((el) => el.getBoundingClientRect());
  const top = fixed.filter((r) => r.top <= 1).reduce((m, r) => Math.max(m, r.bottom), 0);
  const bottom = fixed.filter((r) => r.bottom >= innerHeight - 1).reduce((m, r) => Math.min(m, r.top), innerHeight);
  return { headerBottom: Math.round(top), tabTop: Math.round(bottom) };
};
const hideFixed = () => {
  for (const el of document.querySelectorAll("body *")) {
    const pos = getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") el.style.setProperty("visibility", "hidden", "important");
  }
};

async function closeDialogs(page) {
  for (const label of ["我知道了", "暂不", "稍后", "关闭"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.first().isVisible().catch(() => false)) await button.first().click().catch(() => {});
  }
}

try {
  for (const shot of selected) {
    const context = await browser.newContext({ ...shot.device, serviceWorkers: "block", locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "light" });
    await context.addInitScript(({ seed }) => {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    }, { seed: { "cpu-announcement-intro-v1": "1", "cpu-appearance-mode-v1": "light", ...localState } });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    page.on("pageerror", (err) => console.warn(`[${shot.name}] page error: ${err.message}`));
    const isHub = shot.app === "voicehub";
    await (isHub ? routeVoicehub(page) : routeWeb(page));
    await page.goto(`http://127.0.0.1:${isHub ? HUB_PORT : WEB_PORT}${shot.path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (isHub) await page.waitForSelector(".home-loader", { state: "detached", timeout: 60_000 }).catch(() => {});
    else await page.waitForSelector('body[data-cpu-app-ready="1"]', { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1200);
    await closeDialogs(page);
    if (shot.prepare) await shot.prepare(page);
    if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 30_000 });
    await page.waitForTimeout(shot.settle ?? 900);
    await page.addStyleTag({ content: "::-webkit-scrollbar{display:none} *{scrollbar-width:none}" });

    const file = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
    const entry = { file: `${shot.name}.png`, width: shot.device.viewport.width, height: shot.device.viewport.height };
    // 先量好顶栏和底栏，再把固定元素藏起来：组件裁图和整页图里都不该带底栏和悬浮按钮。
    if (shot.scroll) Object.assign(entry, await page.evaluate(measureChrome));
    await page.evaluate(hideFixed);
    for (const el of shot.elements || []) {
      const items = page.locator(el.selector);
      const n = Math.min(el.count, await items.count());
      entry[el.name] = [];
      for (let i = 0; i < n; i += 1) {
        const item = items.nth(i);
        await item.scrollIntoViewIfNeeded();
        const box = await item.boundingBox();
        const name = `${el.name}-${i + 1}.png`;
        await item.screenshot({ path: path.join(outDir, name), animations: "disabled", caret: "hide" });
        entry[el.name].push({ file: name, width: Math.round(box.width), height: Math.round(box.height) });
      }
    }
    if (shot.scroll) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const full = `${shot.name}-full.png`;
      await page.screenshot({ path: path.join(outDir, full), fullPage: true, animations: "disabled", caret: "hide" });
      entry.full = full;
      entry.fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    }
    manifest[shot.name] = entry;
    console.log(`${shot.name}: ${JSON.stringify(entry)}`);
    await context.close();
  }
} finally {
  await browser.close();
  for (const server of servers) server.kill();
  for (const [file, content] of snapshots) writeFileSync(file, content);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}
if (unknown.size) console.warn(`unmocked endpoints (answered with null):\n  ${[...unknown].sort().join("\n  ")}`);
