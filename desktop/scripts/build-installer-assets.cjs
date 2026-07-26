#!/usr/bin/env node
// 生成 NSIS 安装向导的品牌图与 Windows 用的 .ico。
//
//   npm run assets:installer
//
// NSIS 只认未压缩 BMP 与 ICO，仓库里只有 PNG。侧边图与页眉图先用 HTML/CSS 排版，
// 再离屏渲染截图转 BMP —— 手写像素运算画不出正常的字体排版。

const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "build");
const LOGO = path.join(OUT, "icon.png");

// NSIS 规定的尺寸，不能改
const SIDEBAR = { width: 164, height: 314 };
const HEADER = { width: 150, height: 57 };
const GAP = 20;

/** 24 位未压缩 BMP，自底向上，每行 4 字节对齐；输入是 nativeImage 的 BGRA */
const writeBmp = (file, image) => {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const buffer = Buffer.alloc(54 + rowSize * height);

  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(rowSize * height, 34);

  for (let y = 0; y < height; y += 1) {
    const rowStart = 54 + (height - 1 - y) * rowSize;   // BMP 自底向上
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = rowStart + x * 3;
      buffer[target] = bgra[source];                     // B
      buffer[target + 1] = bgra[source + 1];             // G
      buffer[target + 2] = bgra[source + 2];             // R
    }
  }
  fs.writeFileSync(file, buffer);
  console.log(`${path.basename(file)}  ${width}×${height}  ${(buffer.length / 1024).toFixed(1)} KiB`);
};

/** Vista 起的 ICO 可以直接内嵌 PNG，容器头只有 22 字节 */
const writeIco = (file, png) => {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);         // type = icon
  header.writeUInt16LE(1, 4);         // 只放一个尺寸
  header.writeUInt8(0, 6);            // 256 用 0 表示
  header.writeUInt8(0, 7);
  header.writeUInt16LE(1, 10);        // planes
  header.writeUInt16LE(32, 12);       // bpp
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync(file, Buffer.concat([header, png]));
  console.log(`${path.basename(file)}  256×256  ${((22 + png.length) / 1024).toFixed(1)} KiB`);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 截取页面上的一块区域，并把高 DPI 屏带来的缩放降回目标尺寸 */
const captureRegion = async (contents, rect) => {
  const shot = await contents.capturePage(rect);
  const { width } = shot.getSize();
  return width === rect.width ? shot : shot.resize({ width: rect.width, height: rect.height, quality: "best" });
};

const buildPage = (logoUri) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${SIDEBAR.width}px;
    height: ${SIDEBAR.height + GAP + HEADER.height}px;
    overflow: hidden;
    background: #ffffff;
  }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* 侧边图：欢迎页与完成页左侧整条。
     只有 164×314，所以层次全靠光影而不是元素数量：
     底色斜向渐变 → 右上暖光（主站 hero 的招牌）→ 左下冷光补深度
     → 一道极淡的斜向高光 → 顶边一条内发光细线 → 全局细颗粒压掉渐变的色带。 */
  .sidebar {
    position: absolute; top: 0; left: 0;
    width: ${SIDEBAR.width}px; height: ${SIDEBAR.height}px;
    padding: 28px 20px;
    background: linear-gradient(163deg, #3cbda7 0%, #189a84 30%, #148f7b 58%, #0b6353 100%);
    color: #fff; overflow: hidden;
    isolation: isolate;
  }
  .glow-warm {
    position: absolute; top: -86px; right: -92px; width: 224px; height: 224px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(245,158,11,.30) 0%, rgba(245,158,11,.10) 44%, rgba(245,158,11,0) 70%);
  }
  .glow-cool {
    position: absolute; bottom: -104px; left: -78px; width: 216px; height: 216px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(94,228,204,.24) 0%, rgba(94,228,204,0) 66%);
  }
  .sheen {
    position: absolute; inset: 0;
    background: linear-gradient(112deg, rgba(255,255,255,0) 34%, rgba(255,255,255,.085) 50%, rgba(255,255,255,0) 64%);
  }
  .topline {
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.42) 42%, rgba(255,255,255,0) 100%);
  }
  /* 细颗粒：渐变在 24 位 BMP 上容易出色带，加一点噪点能压住 */
  .grain {
    position: absolute; inset: 0; opacity: .05;
    background-image:
      radial-gradient(rgba(255,255,255,.9) .5px, transparent .5px),
      radial-gradient(rgba(0,0,0,.9) .5px, transparent .5px);
    background-size: 3px 3px, 4px 4px;
    background-position: 0 0, 1px 2px;
  }

  .logo-tile {
    position: relative; width: 54px; height: 54px; border-radius: 14px;
    background: rgba(255,255,255,.10);
    box-shadow:
      0 8px 20px rgba(3,34,28,.36),
      inset 0 1px 0 rgba(255,255,255,.34);
    display: grid; place-items: center;
  }
  .logo { width: 40px; height: 40px; border-radius: 10px; }

  .name {
    position: relative; margin-top: 22px;
    font-size: 22px; font-weight: 700; letter-spacing: 1.5px;
    text-shadow: 0 2px 10px rgba(3,34,28,.34);
  }
  .name-rule {
    position: relative; margin-top: 12px; width: 30px; height: 3px; border-radius: 3px;
    background: linear-gradient(90deg, #fcd34d, #f59e0b 62%, rgba(245,158,11,.20));
    box-shadow: 0 1px 6px rgba(245,158,11,.45);
  }
  .sub {
    position: relative; margin-top: 11px;
    font-size: 11px; color: rgba(255,255,255,.80); letter-spacing: 4px;
  }
  .foot { position: absolute; left: 20px; right: 20px; bottom: 22px; }
  .rule {
    height: 1px;
    background: linear-gradient(90deg, rgba(255,255,255,.42), rgba(255,255,255,.05));
  }
  .tag { margin-top: 10px; font-size: 9.5px; color: rgba(255,255,255,.60); letter-spacing: 1.1px; }

  /* 页眉图：内页右上角，NSIS 那块底色是白的 */
  .header {
    position: absolute; top: ${SIDEBAR.height + GAP}px; left: 0;
    width: ${HEADER.width}px; height: ${HEADER.height}px;
    display: flex; align-items: center; justify-content: flex-end; gap: 8px;
    padding: 0 12px; background: #fff;
  }
  .header .logo { width: 26px; height: 26px; border-radius: 7px; box-shadow: none; }
  .header .text { text-align: left; }
  .header .hname { font-size: 12px; font-weight: 700; color: #0d6e5e; line-height: 1.25; }
  .header .hsub { font-size: 9px; color: #64748b; letter-spacing: 1px; }
</style></head>
<body>
  <div class="sidebar">
    <div class="glow-warm"></div>
    <div class="glow-cool"></div>
    <div class="sheen"></div>
    <div class="grain"></div>
    <div class="topline"></div>
    <div class="logo-tile"><img class="logo" src="${logoUri}" alt=""></div>
    <div class="name">药大拾间</div>
    <div class="name-rule"></div>
    <div class="sub">桌面端</div>
    <div class="foot"><div class="rule"></div><div class="tag">CPU · 校园互助服务</div></div>
  </div>
  <div class="header">
    <img class="logo" src="${logoUri}" alt="">
    <div class="text"><div class="hname">药大拾间</div><div class="hsub">桌面端</div></div>
  </div>
</body></html>`;

app.whenReady().then(async () => {
  const source = nativeImage.createFromPath(LOGO);
  if (source.isEmpty()) {
    console.error(`读不到 ${LOGO}`);
    app.exit(1);
    return;
  }
  const logoUri = source.resize({ width: 128, height: 128, quality: "best" }).toDataURL();

  // 两张图画在同一页里，只加载一次：同一进程里第二次 load 会 ERR_FAILED，
  // 用 capturePage 的区域参数分别截出来正好绕开。
  const htmlFile = path.join(OUT, ".installer-assets.tmp.html");
  fs.writeFileSync(htmlFile, buildPage(logoUri), "utf8");

  const window = new BrowserWindow({
    width: SIDEBAR.width,
    height: SIDEBAR.height + GAP + HEADER.height,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: "#ffffff",
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true }
  });

  try {
    await window.loadFile(htmlFile);
    await wait(1200);                 // 等字体上屏，否则截到换字体前的一帧

    writeBmp(path.join(OUT, "installerSidebar.bmp"),
      await captureRegion(window.webContents, { x: 0, y: 0, ...SIDEBAR }));
    fs.copyFileSync(path.join(OUT, "installerSidebar.bmp"), path.join(OUT, "uninstallerSidebar.bmp"));
    console.log("uninstallerSidebar.bmp  （复用安装侧边图）");

    writeBmp(path.join(OUT, "installerHeader.bmp"),
      await captureRegion(window.webContents, { x: 0, y: SIDEBAR.height + GAP, ...HEADER }));

    writeIco(path.join(OUT, "icon.ico"), source.resize({ width: 256, height: 256, quality: "best" }).toPNG());
  } catch (error) {
    console.error(`生成失败：${error.message}`);
    app.exit(1);
    return;
  } finally {
    window.destroy();
    fs.rmSync(htmlFile, { force: true });
  }
  app.exit(0);
});
