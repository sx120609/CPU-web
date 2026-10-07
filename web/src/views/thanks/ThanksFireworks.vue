<template>
  <canvas ref="canvasEl" aria-hidden="true"></canvas>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

// 致谢页的烟花层：平时什么都不画，celebrate() 时才启动动画循环，放完自动停下。
interface Spark { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number; colour: string }

// Apple 系统色
const SPARK_COLOURS = ["#2997ff", "#ff9f0a", "#30d158", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a"];
const TAU = Math.PI * 2;

const canvasEl = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let sparks: Spark[] = [];
let raf = 0;
let last = 0;
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
}

function frame(now: number) {
  if (!ctx) return;
  const dt = Math.min(now - (last || now), 50) / 1000;
  last = now;
  ctx.clearRect(0, 0, width, height);
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
  if (sparks.length || timers.length) raf = requestAnimationFrame(frame);
  else raf = 0;
}

/** 在视口坐标 (x, y) 炸开一朵烟花。 */
function burst(x: number, y: number) {
  const colour = SPARK_COLOURS[Math.floor(Math.random() * SPARK_COLOURS.length)];
  for (let i = 0; i < 110; i += 1) {
    const angle = Math.random() * TAU;
    const speed = 60 + Math.random() * 340;
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      ttl: 0.9 + Math.random() * 1.1,
      size: 1 + Math.random() * 1.8,
      colour: Math.random() < 0.8 ? colour : "#ffffff",
    });
  }
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

/** 连放一串烟花，铺满上半屏。 */
function celebrate(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    const timer = window.setTimeout(() => {
      timers.splice(timers.indexOf(timer), 1);
      burst(width * (0.12 + Math.random() * 0.76), height * (0.14 + Math.random() * 0.42));
    }, i * 200);
    timers.push(timer);
  }
}

onMounted(() => {
  resize();
  window.addEventListener("resize", resize);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  timers.forEach((timer) => window.clearTimeout(timer));
  window.removeEventListener("resize", resize);
});

defineExpose({ burst, celebrate });
</script>
