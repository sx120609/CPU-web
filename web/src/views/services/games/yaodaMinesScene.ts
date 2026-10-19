// 清扫药大雷的画面。六种雷、小旗和主菜单的图各是一张图（src/assets/yaoda-mines），换图只需要替换文件；
// 格子、数字和特效是画出来的。只按引擎状态和动画记录作画，不改引擎状态。
import flagArt from "@/assets/yaoda-mines/flag.webp";
import menuArt from "@/assets/yaoda-mines/menu.webp";
import alarmArt from "@/assets/yaoda-mines/mine-alarm.webp";
import capsuleArt from "@/assets/yaoda-mines/mine-capsule.webp";
import examArt from "@/assets/yaoda-mines/mine-exam.webp";
import flaskArt from "@/assets/yaoda-mines/mine-flask.webp";
import reportArt from "@/assets/yaoda-mines/mine-report.webp";
import rollcallArt from "@/assets/yaoda-mines/mine-rollcall.webp";
import { roundedPath, vertical, type Context } from "./gameArt";
import { CELL_FLAG, CELL_HIDDEN, CELL_OPEN, minesNeighbors, type MinesBoard, type MinesState } from "./yaodaMinesEngine";

/** 雷的图，顺序和引擎里的 MINE_KINDS 一致。 */
const MINE_ART = [alarmArt, examArt, rollcallArt, reportArt, flaskArt, capsuleArt];

export interface MinesLayout {
  left: number;
  top: number;
  cell: number;
  columns: number;
  rows: number;
}

/** 飘起来的“+12”。 */
export interface MinesFloater {
  text: string;
  x: number;
  y: number;
  /** 出现时的时刻（秒，performance.now() / 1000）。 */
  born: number;
}

/**
 * 动画记录：每一格什么时候翻开、什么时候插的旗，雷什么时候亮出来。时间都是真实时间（秒），
 * 暂停和开局前也照样走，所以不用引擎的对局时间。
 */
export interface MinesFx {
  board: MinesBoard | null;
  boardAt: number;
  shownAt: Float64Array;
  flagAt: Float64Array;
  mineAt: Float64Array;
  boomAt: number;
  clearAt: number;
}

export interface MinesPress {
  x: number;
  y: number;
  /** 长按插旗的进度，0 到 1。 */
  hold: number;
}

/** 场地上下要让出来的高度（画布坐标）：上面是计分、倒计时和关卡名，下面是翻开／插旗的切换。 */
export interface MinesInsets {
  top: number;
  bottom: number;
}

export interface MinesSceneState {
  /** 逻辑宽高：宽固定 420，高随屏幕比例变化。 */
  width: number;
  height: number;
  insets: MinesInsets;
  game: MinesState;
  fx: MinesFx;
  now: number;
  press: MinesPress | null;
  /** 暂停时把盘面盖住，不让人趁停表慢慢想。 */
  covered: boolean;
  floaters: MinesFloater[];
}

export const MINES_FLOATER_SECONDS = 0.75;
/** 页面还没量出浮层位置时用的默认让位。 */
export const MINES_DEFAULT_INSETS: MinesInsets = { top: 118, bottom: 86 };
const NUMBER_COLORS = ["", "#2f6fd6", "#2b9a50", "#e0473b", "#5a45c0", "#b04428", "#16898a", "#3a4046", "#7b848c"];
const FONT = "ui-rounded, \"SF Pro Rounded\", \"HarmonyOS Sans SC\", \"PingFang SC\", system-ui, sans-serif";

const ART: Record<string, string> = { flag: flagArt, menu: menuArt };
MINE_ART.forEach((source, index) => {
  ART[`mine-${index}`] = source;
});

const images = new Map<string, HTMLImageElement>();
/** 每加载好一张图加一，存好的小图跟着作废重做。 */
let artVersion = 0;

function loadArt() {
  if (typeof Image === "undefined") return Promise.resolve();
  return Promise.all(Object.entries(ART).map(([key, source]) => new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      images.set(key, image);
      artVersion += 1;
      resolve();
    };
    image.onerror = () => resolve();
    image.src = source;
  }))).then(() => undefined);
}

/** 图都加载完（或失败）以后完成，页面据此重画已经画出去的图标和招牌图。 */
export const minesArtReady = loadArt();

const sprites = new Map<string, HTMLCanvasElement>();
let spriteSignature = "";
let pixel = 1;

function useSprites(context: Context, scene: MinesSceneState, layout: MinesLayout) {
  const scale = typeof context.getTransform === "function" ? context.getTransform().a : 2;
  pixel = Math.min(4, Math.max(0.5, scale || 1));
  const signature = `${pixel.toFixed(3)}:${scene.width}:${scene.height.toFixed(1)}:${layout.cell.toFixed(2)}:${artVersion}`;
  if (signature !== spriteSignature) {
    sprites.clear();
    spriteSignature = signature;
  }
}

/** 取一张宽高为 width × height（画布坐标）的小图，没有就用 draw 画一张；draw 里原点在小图左上角。 */
function sprite(key: string, width: number, height: number, draw: (context: Context) => void) {
  let canvas = sprites.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * pixel));
    canvas.height = Math.max(1, Math.ceil(height * pixel));
    const context = canvas.getContext("2d");
    if (context) {
      context.scale(pixel, pixel);
      draw(context);
    }
    sprites.set(key, canvas);
  }
  return canvas;
}

/** 小图左上角贴在 (x, y)，对齐到屏幕像素。 */
function blit(context: Context, canvas: HTMLCanvasElement, x: number, y: number) {
  context.drawImage(canvas, Math.round(x * pixel) / pixel, Math.round(y * pixel) / pixel, canvas.width / pixel, canvas.height / pixel);
}

/** 以 (x, y) 为中心缩放 scale 倍贴上去，用于弹出、缩小这类短动画。 */
function blitScaled(context: Context, canvas: HTMLCanvasElement, x: number, y: number, scale: number) {
  const width = (canvas.width / pixel) * scale;
  const height = (canvas.height / pixel) * scale;
  context.drawImage(canvas, x - width / 2, y - height / 2, width, height);
}

/** 场地在画布里的位置：上下让出浮层（再留出托盘的边），格子大小随屏幕收放。 */
export function minesLayout(width: number, height: number, columns: number, rows: number, insets: MinesInsets = MINES_DEFAULT_INSETS): MinesLayout {
  const top = insets.top + 10;
  const room = height - top - insets.bottom - 10;
  const cell = Math.max(16, Math.min((width - 28) / columns, room / rows, 48));
  return {
    cell,
    columns,
    rows,
    left: (width - cell * columns) / 2,
    top: top + Math.max(0, (room - cell * rows) * 0.46),
  };
}

/** 画布坐标落在哪一格；不在场地里返回 null。 */
export function minesCellAt(layout: MinesLayout, x: number, y: number) {
  const column = Math.floor((x - layout.left) / layout.cell);
  const row = Math.floor((y - layout.top) / layout.cell);
  if (column < 0 || row < 0 || column >= layout.columns || row >= layout.rows) return null;
  return { x: column, y: row };
}

export function createMinesFx(): MinesFx {
  return {
    board: null,
    boardAt: 0,
    shownAt: new Float64Array(0),
    flagAt: new Float64Array(0),
    mineAt: new Float64Array(0),
    boomAt: -1,
    clearAt: -1,
  };
}

/**
 * 把这一帧以前发生的变化记进动画：新翻开的格子按离 origin 的远近依次弹开，新插的旗记下时刻；
 * 一局结束时雷从踩到的那一格（超时就从正中）往外一圈圈亮出来。
 */
export function minesFxSync(fx: MinesFx, game: MinesState, now: number, origin: { x: number; y: number } | null) {
  const board = game.board;
  const size = board.columns * board.rows;
  if (fx.board !== board) {
    fx.board = board;
    fx.boardAt = now;
    fx.shownAt = new Float64Array(size).fill(-1);
    fx.flagAt = new Float64Array(size).fill(-1);
    fx.mineAt = new Float64Array(size).fill(-1);
    fx.boomAt = -1;
    fx.clearAt = -1;
  }
  const from = origin ?? { x: (board.columns - 1) / 2, y: (board.rows - 1) / 2 };
  for (let cell = 0; cell < size; cell += 1) {
    const view = board.view[cell];
    if (view === CELL_OPEN && fx.shownAt[cell] < 0) {
      const distance = Math.hypot(cell % board.columns - from.x, Math.floor(cell / board.columns) - from.y);
      fx.shownAt[cell] = now + Math.min(0.32, distance * 0.022);
    }
    if (view === CELL_FLAG && fx.flagAt[cell] < 0) fx.flagAt[cell] = now;
    if (view !== CELL_FLAG) fx.flagAt[cell] = -1;
  }
  if (game.phase === "clear" && fx.clearAt < 0) fx.clearAt = now;
  if (game.phase === "over" && fx.boomAt < 0) {
    fx.boomAt = now;
    const center = game.hit ?? from;
    for (let cell = 0; cell < size; cell += 1) {
      if (!board.mine[cell]) continue;
      const distance = Math.hypot(cell % board.columns - center.x, Math.floor(cell / board.columns) - center.y);
      fx.mineAt[cell] = now + (game.hit ? 0.18 : 0.05) + distance * 0.045;
    }
  }
}

function drawBackground(context: Context, width: number, height: number) {
  context.fillStyle = vertical(context, 0, height, "#123a43", "#0a2027");
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width * 0.5, -40, 10, width * 0.5, -40, height * 0.75);
  glow.addColorStop(0, "rgba(120, 220, 200, .22)");
  glow.addColorStop(1, "rgba(120, 220, 200, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  // 很淡的点阵，像实验台面
  context.fillStyle = "rgba(180, 240, 225, .05)";
  for (let y = 12; y < height; y += 22) {
    for (let x = (y / 22) % 2 ? 12 : 23; x < width; x += 22) {
      context.beginPath();
      context.arc(x, y, 1.1, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function tileMetrics(layout: MinesLayout) {
  const gap = Math.max(1.6, layout.cell * 0.07);
  const size = layout.cell - gap;
  return { gap, size, radius: size * 0.2, depth: Math.max(1.6, size * 0.08) };
}

/** 没翻开的格子：薄荷绿的凸起小方块。shade 交替一深一浅；pressed 是按下去的样子。 */
function hiddenTile(layout: MinesLayout, shade: number, pressed: boolean) {
  const { size, radius, depth } = tileMetrics(layout);
  return sprite(`hidden:${shade}:${pressed ? 1 : 0}`, size, size, (target) => {
    roundedPath(target, 0, 0, size, size, radius);
    target.fillStyle = pressed ? "#2a7166" : "#2b7a6e";
    target.fill();
    const lift = pressed ? depth * 0.25 : 0;
    const top = shade ? "#88dcca" : "#93e3d2";
    const bottom = shade ? "#4aa999" : "#52b2a2";
    roundedPath(target, 0, lift, size, size - depth, radius);
    target.fillStyle = vertical(target, lift, size - depth + lift, pressed ? "#6cc6b4" : top, pressed ? "#3f9a8b" : bottom);
    target.fill();
    target.lineWidth = 1;
    target.strokeStyle = "rgba(30, 105, 94, .55)";
    target.stroke();
    if (!pressed) {
      roundedPath(target, size * 0.12, size * 0.08, size * 0.76, size * 0.3, radius * 0.7);
      target.fillStyle = "rgba(255, 255, 255, .2)";
      target.fill();
    }
  });
}

/** 翻开的格子：浅色凹下去的台面。 */
function openTile(layout: MinesLayout, shade: number, tone: "plain" | "hit" = "plain") {
  const { size, radius } = tileMetrics(layout);
  return sprite(`open:${shade}:${tone}`, size, size, (target) => {
    roundedPath(target, 0, 0, size, size, radius);
    if (tone === "hit") target.fillStyle = vertical(target, 0, size, "#ff7a62", "#e2483a");
    else target.fillStyle = shade ? "#dfeee9" : "#e8f4f0";
    target.fill();
    target.save();
    roundedPath(target, 0, 0, size, size, radius);
    target.clip();
    target.fillStyle = vertical(target, 0, size * 0.22, tone === "hit" ? "rgba(120, 20, 10, .25)" : "rgba(16, 70, 62, .14)", "rgba(16, 70, 62, 0)");
    target.fillRect(0, 0, size, size * 0.22);
    target.restore();
    roundedPath(target, 0.5, 0.5, size - 1, size - 1, radius);
    target.lineWidth = 1;
    target.strokeStyle = tone === "hit" ? "rgba(140, 30, 20, .5)" : "rgba(16, 70, 62, .12)";
    target.stroke();
  });
}

function numberGlyph(layout: MinesLayout, value: number) {
  const { size } = tileMetrics(layout);
  return sprite(`num:${value}`, size, size, (target) => {
    target.font = `900 ${Math.round(size * 0.64)}px ${FONT}`;
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.fillStyle = NUMBER_COLORS[value] || "#333";
    target.fillText(String(value), size / 2, size * 0.54);
  });
}

/** 一张图缩进边长 box 的方框，正中贴在小图中心；图没到时用一个圆顶替。 */
function artIcon(name: string, size: number, share: number, fallback: string) {
  return sprite(`art:${name}:${share}`, size, size, (target) => {
    const box = size * share;
    const image = images.get(name);
    if (!image) {
      target.beginPath();
      target.arc(size / 2, size / 2, box * 0.36, 0, Math.PI * 2);
      target.fillStyle = fallback;
      target.fill();
      return;
    }
    const scale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    target.imageSmoothingQuality = "high";
    target.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  });
}

/** 结束时插错的旗：旗上压一道红叉。 */
function wrongMark(layout: MinesLayout) {
  const { size } = tileMetrics(layout);
  return sprite("wrong", size, size, (target) => {
    target.lineCap = "round";
    target.lineWidth = Math.max(2, size * 0.09);
    target.strokeStyle = "rgba(255, 255, 255, .9)";
    for (const pass of [0, 1]) {
      if (pass) {
        target.lineWidth = Math.max(1.4, size * 0.06);
        target.strokeStyle = "#e0473b";
      }
      target.beginPath();
      target.moveTo(size * 0.24, size * 0.24);
      target.lineTo(size * 0.76, size * 0.76);
      target.moveTo(size * 0.76, size * 0.24);
      target.lineTo(size * 0.24, size * 0.76);
      target.stroke();
    }
  });
}

function labelSprite(text: string, color: string) {
  const width = text.length * 11 + 14;
  return sprite(`label:${text}:${color}`, width, 26, (target) => {
    target.font = `900 17px ${FONT}`;
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.lineJoin = "round";
    target.lineWidth = 4;
    target.strokeStyle = "rgba(8, 32, 36, .85)";
    target.strokeText(text, width / 2, 13.5);
    target.fillStyle = color;
    target.fillText(text, width / 2, 13.5);
  });
}

function easeOutBack(value: number) {
  const t = Math.min(1, Math.max(0, value)) - 1;
  return 1 + 2.2 * t * t * t + 1.2 * t * t;
}

function drawTray(context: Context, layout: MinesLayout) {
  const width = layout.cell * layout.columns;
  const height = layout.cell * layout.rows;
  const pad = 8;
  context.save();
  context.shadowColor = "rgba(0, 0, 0, .35)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  roundedPath(context, layout.left - pad, layout.top - pad, width + pad * 2 - tileMetrics(layout).gap, height + pad * 2 - tileMetrics(layout).gap, 16);
  context.fillStyle = "rgba(5, 22, 26, .72)";
  context.fill();
  context.restore();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(170, 240, 225, .12)";
  context.stroke();
}

export function drawMinesScene(context: Context, scene: MinesSceneState) {
  const { game, fx, now } = scene;
  const board = game.board;
  const layout = minesLayout(scene.width, scene.height, board.columns, board.rows, scene.insets);
  useSprites(context, scene, layout);
  const background = sprite("background", scene.width, scene.height, (target) => drawBackground(target, scene.width, scene.height));
  context.drawImage(background, 0, 0, scene.width, scene.height);

  // 踩雷的一瞬间整块场地抖一下
  let shakeX = 0;
  let shakeY = 0;
  if (game.cause === "mine" && fx.boomAt >= 0 && now - fx.boomAt < 0.4) {
    const fade = 1 - (now - fx.boomAt) / 0.4;
    shakeX = Math.sin((now - fx.boomAt) * 70) * 6 * fade;
    shakeY = Math.cos((now - fx.boomAt) * 55) * 4 * fade;
  }
  context.save();
  context.translate(shakeX, shakeY);
  drawTray(context, layout);

  const { size, depth } = tileMetrics(layout);
  const appear = now - fx.boardAt;
  const over = game.phase === "over";
  const pressed = new Set<number>();
  if (scene.press && !scene.covered) {
    const index = scene.press.y * board.columns + scene.press.x;
    if (board.view[index] === CELL_HIDDEN) pressed.add(index);
    else if (board.view[index] === CELL_OPEN && board.count[index]) {
      for (const next of minesNeighbors(board, index)) if (board.view[next] === CELL_HIDDEN) pressed.add(next);
    }
  }
  for (let y = 0; y < board.rows; y += 1) {
    for (let x = 0; x < board.columns; x += 1) {
      const cell = y * board.columns + x;
      const shade = (x + y) % 2;
      const left = layout.left + x * layout.cell;
      const top = layout.top + y * layout.cell;
      const centerX = left + size / 2;
      const centerY = top + size / 2;
      // 新一关的格子从左上往右下依次落下来
      const delay = (x + y) * 0.014;
      if (appear < delay + 0.28) {
        const progress = Math.max(0, (appear - delay) / 0.28);
        if (progress <= 0) continue;
        context.globalAlpha = progress;
        blitScaled(context, hiddenTile(layout, shade, false), centerX, centerY - (1 - progress) * 10, 0.85 + 0.15 * progress);
        context.globalAlpha = 1;
        continue;
      }
      const view = scene.covered ? CELL_HIDDEN : board.view[cell];
      const isMine = board.mine[cell] === 1;
      const mineShown = over && isMine && fx.mineAt[cell] >= 0 && now >= fx.mineAt[cell] && view !== CELL_FLAG;
      if (view === CELL_OPEN || mineShown) {
        const shownAt = view === CELL_OPEN ? fx.shownAt[cell] : fx.mineAt[cell];
        if (view === CELL_OPEN && now < shownAt) {
          blit(context, hiddenTile(layout, shade, false), left, top);
          continue;
        }
        const hit = Boolean(game.hit && game.hit.x === x && game.hit.y === y);
        blit(context, openTile(layout, shade, hit ? "hit" : "plain"), left, top);
        if (mineShown) {
          const pop = easeOutBack((now - fx.mineAt[cell]) / 0.3);
          blitScaled(context, artIcon(`mine-${board.kind[cell]}`, size, 0.9, "#e0473b"), centerX, centerY, Math.max(0.01, pop));
        } else if (board.count[cell]) {
          blit(context, numberGlyph(layout, board.count[cell]), left, top);
        }
        // 刚翻开：上面那层小方块缩小淡出
        const age = now - shownAt;
        if (view === CELL_OPEN && age < 0.16) {
          context.globalAlpha = 1 - age / 0.16;
          blitScaled(context, hiddenTile(layout, shade, false), centerX, centerY, 1 - (age / 0.16) * 0.45);
          context.globalAlpha = 1;
        }
        continue;
      }
      blit(context, hiddenTile(layout, shade, pressed.has(cell)), left, top);
      if (view === CELL_FLAG) {
        const flagAge = fx.flagAt[cell] >= 0 ? now - fx.flagAt[cell] : 1;
        const scale = flagAge < 0.25 ? easeOutBack(flagAge / 0.25) : 1;
        blitScaled(context, artIcon("flag", size, 0.78, "#ffb020"), centerX, centerY - depth * 0.5, Math.max(0.01, scale));
        if (over && !isMine && fx.boomAt >= 0 && now - fx.boomAt > 0.35) blit(context, wrongMark(layout), left, top);
      }
    }
  }

  // 长按插旗的进度圈
  if (scene.press && scene.press.hold > 0.05 && !scene.covered) {
    const centerX = layout.left + scene.press.x * layout.cell + size / 2;
    const centerY = layout.top + scene.press.y * layout.cell + size / 2;
    context.lineWidth = 3.5;
    context.lineCap = "round";
    context.strokeStyle = "rgba(255, 255, 255, .35)";
    context.beginPath();
    context.arc(centerX, centerY, size * 0.62, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "#ffb020";
    context.beginPath();
    context.arc(centerX, centerY, size * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, scene.press.hold));
    context.stroke();
  }

  // 踩雷：从那一格炸开一圈冲击波
  if (game.cause === "mine" && game.hit && fx.boomAt >= 0) {
    const age = now - fx.boomAt;
    if (age < 0.6) {
      const centerX = layout.left + game.hit.x * layout.cell + size / 2;
      const centerY = layout.top + game.hit.y * layout.cell + size / 2;
      const radius = layout.cell * (0.6 + age * 7);
      const flash = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      flash.addColorStop(0, `rgba(255, 236, 170, ${0.75 * (1 - age / 0.6)})`);
      flash.addColorStop(0.55, `rgba(255, 120, 70, ${0.35 * (1 - age / 0.6)})`);
      flash.addColorStop(1, "rgba(255, 90, 60, 0)");
      context.fillStyle = flash;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 3 * (1 - age / 0.6);
      context.strokeStyle = `rgba(255, 220, 160, ${1 - age / 0.6})`;
      context.stroke();
    }
  }

  // 清完一关：一道光从左上扫到右下
  if (fx.clearAt >= 0 && game.phase !== "over") {
    const age = now - fx.clearAt;
    if (age < 0.7) {
      const width = layout.cell * layout.columns;
      const height = layout.cell * layout.rows;
      const sweep = -0.4 + (age / 0.7) * 1.8;
      context.save();
      roundedPath(context, layout.left, layout.top, width, height, 10);
      context.clip();
      const band = context.createLinearGradient(layout.left, layout.top, layout.left + width, layout.top + height);
      const at = (value: number) => Math.min(1, Math.max(0, value));
      band.addColorStop(at(sweep - 0.18), "rgba(255, 255, 255, 0)");
      band.addColorStop(at(sweep), "rgba(255, 255, 240, .5)");
      band.addColorStop(at(sweep + 0.18), "rgba(255, 255, 255, 0)");
      context.fillStyle = band;
      context.fillRect(layout.left, layout.top, width, height);
      context.restore();
    }
  }

  for (const floater of scene.floaters) {
    const age = (now - floater.born) / MINES_FLOATER_SECONDS;
    if (age < 0 || age >= 1) continue;
    const label = labelSprite(floater.text, "#ffd27a");
    context.globalAlpha = 1 - age * age;
    const centerX = layout.left + (floater.x + 0.5) * layout.cell;
    const centerY = layout.top + (floater.y + 0.5) * layout.cell - layout.cell * (0.6 + age * 0.9);
    blit(context, label, centerX - label.width / pixel / 2, centerY - label.height / pixel / 2);
  }
  context.globalAlpha = 1;
  context.restore();
}

/** 把一张图缩进方形画布正中：主菜单的招牌图和设置里的图标用。 */
function drawFitted(context: Context, name: string, size: number, share: number) {
  context.clearRect(0, 0, size, size);
  const image = images.get(name);
  if (!image) return;
  const scale = Math.min((size * share) / image.naturalWidth, (size * share) / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
}

/** 主菜单的招牌图：拿着探雷器的药大学生和一颗胶囊雷。 */
export function drawMinesMenuArt(context: Context, size: number) {
  drawFitted(context, "menu", size, 0.96);
}

/** 设置页和结算里的小图标：第几种雷（见 MINE_KINDS），或者小旗。 */
export function drawMinesIcon(context: Context, name: number | "flag", size: number) {
  drawFitted(context, typeof name === "number" ? `mine-${name}` : name, size, 0.92);
}
