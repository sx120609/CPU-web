import { createWorkshopSDK, createLocalPreviewSDK } from "./workshop/sdk.js";
import { createGameShell } from "./workshop/shells.js";

const sdk =
  new URLSearchParams(location.search).get("preview") === "1"
    ? createLocalPreviewSDK({ appId: "star-catcher", name: "星星接力", type: "game" })
    : createWorkshopSDK();
const canvas = document.createElement("canvas");
canvas.tabIndex = 0;
canvas.setAttribute("aria-label", "点击星星得分；空格也可得分");
const ctx = canvas.getContext("2d");
let score = 0;
let remaining = 30;
let previous = 0;
let frame = 0;
let target = { x: 0.5, y: 0.5 };
let gentle = false;
function randomTarget() {
  target = { x: 0.15 + Math.random() * 0.7, y: 0.2 + Math.random() * 0.6 };
}
function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#70c5ce";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff55";
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc((i * 79 + 35) % width, (i * 127 + 90) % height, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffe19b";
  ctx.strokeStyle = "#403c39";
  ctx.lineWidth = 4;
  const radius = gentle ? 42 : 32;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const distance = i % 2 ? radius / 2 : radius;
    const x = target.x * width + Math.cos(angle) * distance;
    const y = target.y * height + Math.sin(angle) * distance;
    if (!i) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#173f7d";
  ctx.textAlign = "center";
  ctx.font = "bold 14px system-ui";
  ctx.fillText("点击星星 · 空格也可操作", width / 2, height - 36);
}
function tick(time) {
  if (shell.phase !== "playing") return;
  if (previous) remaining = Math.max(0, remaining - (time - previous) / 1000);
  previous = time;
  shell.setStatus(`剩余 ${Math.ceil(remaining)} 秒`);
  draw();
  if (!remaining) {
    shell.end({ score, summary: "30 秒星星接力完成" });
    return;
  }
  frame = requestAnimationFrame(tick);
}
function stop() {
  cancelAnimationFrame(frame);
  previous = 0;
}
const shell = createGameShell({
  container: document.querySelector("#app"),
  sdk,
  title: "星星接力",
  description: "30 秒内点亮尽可能多的星星",
  stage: canvas,
  settings: [{ id: "gentle", label: "更大的星星", default: false }],
  onStart(settings) {
    gentle = settings.gentle;
    score = 0;
    remaining = 30;
    randomTarget();
    previous = 0;
    frame = requestAnimationFrame(tick);
  },
  onPause: stop,
  onResume() {
    previous = 0;
    frame = requestAnimationFrame(tick);
  },
  onStop: stop,
});
function hit() {
  if (shell.phase !== "playing") return;
  shell.setScore(++score);
  randomTarget();
  draw();
}
canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const distance = Math.hypot(
    event.clientX - rect.left - target.x * rect.width,
    event.clientY - rect.top - target.y * rect.height,
  );
  if (distance <= (gentle ? 50 : 40)) hit();
});
canvas.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    hit();
  }
});
window.addEventListener(
  "pagehide",
  () => {
    shell.destroy();
    sdk.destroy();
  },
  { once: true },
);
