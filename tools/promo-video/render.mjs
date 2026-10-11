// 把 index.html 逐帧截成 PNG，再交给 ffmpeg 编码成 MP4，配乐由 score.py 现场合成。
//
//   node tools/promo-video/render.mjs                    # 完整成片 → output/promo/yaoda-shijian-promo.mp4
//   node tools/promo-video/render.mjs --stills 7,14.5    # 只导出指定秒数的静帧，用来检查画面
//   node tools/promo-video/render.mjs --from 12 --to 18  # 只渲染一段（无配乐），用来检查动效
//
// 依赖：Playwright（含 Chromium）、ffmpeg、python3 + numpy。
import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { spawn, spawnSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return pairs;
  }, []),
);
const fps = Number(args.fps || 30);
const outDir = path.resolve(root, args.dir || "output/promo");
const outFile = path.resolve(root, args.out || path.join(outDir, "yaoda-shijian-promo.mp4"));
mkdirSync(outDir, { recursive: true });
mkdirSync(path.dirname(outFile), { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return require(path.join(globalRoot, "playwright"));
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = await serve();
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (err) => {
  console.error("page error:", err.message);
  process.exitCode = 1;
});
await page.goto(`http://127.0.0.1:${server.address().port}/tools/promo-video/index.html?render`);
await page.evaluate(() => window.__ready);
const duration = await page.evaluate(() => window.__duration);

async function frame(t) {
  await page.evaluate((time) => window.__seek(time), t);
  return page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } });
}

try {
  if (args.stills) {
    for (const t of args.stills.split(",").map(Number)) {
      const file = path.join(outDir, `still-${t.toFixed(2)}.png`);
      await page.evaluate((time) => window.__seek(time), t);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      console.log(file);
    }
  } else {
    const from = Number(args.from || 0);
    const to = Math.min(duration, Number(args.to || duration));
    const full = from === 0 && to === duration && args["no-audio"] !== "true";
    let audio = null;
    if (full) {
      audio = path.join(outDir, "score.wav");
      const synth = spawnSync("python3", [path.join(here, "score.py"), audio], { stdio: "inherit" });
      if (synth.status !== 0) throw new Error("score.py failed");
    }
    const ffArgs = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"];
    if (audio) ffArgs.push("-i", audio);
    ffArgs.push(
      // 轻微的亮度颗粒同时充当抖动，压住深色渐变的色带。
      "-vf", "format=yuv420p,noise=c0s=4:c0f=t+u",
      "-c:v", "libx264", "-preset", args.preset || "slow", "-crf", args.crf || "18", "-profile:v", "high",
      "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    );
    if (audio) ffArgs.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest");
    ffArgs.push("-movflags", "+faststart", outFile);
    const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((resolve, reject) => ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
    const total = Math.round((to - from) * fps);
    const started = Date.now();
    for (let i = 0; i < total; i += 1) {
      const png = await frame(from + i / fps);
      if (!ff.stdin.write(png)) await new Promise((resolve) => ff.stdin.once("drain", resolve));
      if (i % fps === 0) {
        const eta = ((Date.now() - started) / (i + 1)) * (total - i - 1) / 1000;
        process.stdout.write(`\rframe ${i + 1}/${total} · eta ${Math.round(eta)}s   `);
      }
    }
    ff.stdin.end();
    await done;
    console.log(`\n${outFile}`);
  }
} finally {
  await browser.close();
  server.close();
}
