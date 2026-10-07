<template>
  <canvas ref="canvasEl" aria-hidden="true"></canvas>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

// 致谢页的背景：星空（随滚动和指针产生视差）、偶尔划过的流星，以及按需触发的烟花。
// calm 为 true 时只画一帧静态星空，不启动动画循环。
const props = defineProps<{ calm?: boolean }>();

interface Star { x: number; y: number; depth: number; size: number; phase: number; speed: number; tint: string }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number; ttl: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number; colour: string }

const STAR_TINTS = ["255,255,255", "170,255,240", "170,200,255", "210,190,255", "255,225,170"];
const SPARK_COLOURS = ["#2ee6c8", "#5aa2ff", "#a98bff", "#ffc857", "#ff7aa8", "#ffffff"];
const TAU = Math.PI * 2;

const canvasEl = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let stars: Star[] = [];
let meteors: Meteor[] = [];
let sparks: Spark[] = [];
let raf = 0;
let last = 0;
let nextMeteorAt = 0;
let pointerX = 0;
let pointerY = 0;
let targetX = 0;
let targetY = 0;
const timers: number[] = [];

function resize() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.min(280, Math.round((width * height) / 6500));
  stars = Array.from({ length: count }, () => {
    const depth = 0.15 + Math.random() * 0.85;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      depth,
      size: 0.4 + depth * 1.1,
      phase: Math.random() * TAU,
      speed: 0.4 + Math.random() * 1.6,
      tint: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
    };
  });
  if (props.calm) draw(0, 0);
}

function wrap(value: number, size: number) {
  const rest = value % size;
  return rest < 0 ? rest + size : rest;
}

function draw(now: number, dt: number) {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const scroll = window.scrollY;
  for (const star of stars) {
    const twinkle = props.calm ? 0.85 : 0.55 + 0.45 * Math.sin(now * 0.001 * star.speed + star.phase);
    const x = wrap(star.x + pointerX * star.depth * 22, width);
    const y = wrap(star.y - scroll * star.depth * 0.14 + pointerY * star.depth * 22, height);
    ctx.fillStyle = `rgba(${star.tint},${((0.2 + 0.8 * star.depth) * twinkle).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, star.size, 0, TAU);
    ctx.fill();
  }

  meteors = meteors.filter((meteor) => meteor.life < meteor.ttl);
  for (const meteor of meteors) {
    meteor.life += dt;
    meteor.x += meteor.vx * dt;
    meteor.y += meteor.vy * dt;
    const fade = Math.sin((meteor.life / meteor.ttl) * Math.PI);
    const tailX = meteor.x - meteor.vx * 0.16;
    const tailY = meteor.y - meteor.vy * 0.16;
    const trail = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
    trail.addColorStop(0, `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`);
    trail.addColorStop(1, "rgba(120,220,255,0)");
    ctx.strokeStyle = trail;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(meteor.x, meteor.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  }

  if (sparks.length) {
    ctx.globalCompositeOperation = "lighter";
    sparks = sparks.filter((spark) => spark.life < spark.ttl);
    for (const spark of sparks) {
      spark.life += dt;
      spark.vx *= 0.985;
      spark.vy = spark.vy * 0.985 + 260 * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      ctx.globalAlpha = Math.max(0, 1 - spark.life / spark.ttl);
      ctx.fillStyle = spark.colour;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(now - (last || now), 50) / 1000;
  last = now;
  pointerX += (targetX - pointerX) * 0.06;
  pointerY += (targetY - pointerY) * 0.06;
  if (now >= nextMeteorAt) {
    if (nextMeteorAt) {
      const speed = 520 + Math.random() * 320;
      meteors.push({ x: width * (0.3 + Math.random() * 0.8), y: -20, vx: -speed * 0.72, vy: speed * 0.7, life: 0, ttl: 0.9 + Math.random() * 0.5 });
    }
    nextMeteorAt = now + 3500 + Math.random() * 6000;
  }
  draw(now, dt);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  targetX = event.clientX / width - 0.5;
  targetY = event.clientY / height - 0.5;
}

/** 在视口坐标 (x, y) 炸开一朵烟花。 */
function burst(x: number, y: number) {
  if (props.calm) return;
  const colour = SPARK_COLOURS[Math.floor(Math.random() * SPARK_COLOURS.length)];
  for (let i = 0; i < 90; i += 1) {
    const angle = Math.random() * TAU;
    const speed = 60 + Math.random() * 300;
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      ttl: 0.9 + Math.random() * 0.9,
      size: 0.8 + Math.random() * 1.6,
      colour: Math.random() < 0.75 ? colour : "#ffffff",
    });
  }
}

/** 连放一串烟花，铺满上半屏。 */
function celebrate(rounds = 7) {
  for (let i = 0; i < rounds; i += 1) {
    timers.push(window.setTimeout(() => {
      burst(width * (0.15 + Math.random() * 0.7), height * (0.15 + Math.random() * 0.4));
    }, i * 220));
  }
}

function start() {
  cancelAnimationFrame(raf);
  last = 0;
  if (props.calm) draw(0, 0);
  else raf = requestAnimationFrame(frame);
}

watch(() => props.calm, start);

onMounted(() => {
  resize();
  start();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  timers.forEach((timer) => window.clearTimeout(timer));
  window.removeEventListener("resize", resize);
  window.removeEventListener("pointermove", onPointerMove);
});

defineExpose({ burst, celebrate });
</script>
