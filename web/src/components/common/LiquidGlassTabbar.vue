<template>
  <div :class="{ 'is-hidden': hidden }">
    <nav ref="bar" class="glass-bar" :style="{ '--count': items.length }" aria-label="移动端主导航"
      @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel"
      @lostpointercapture="cancel" @click.capture="guardClick">
      <div ref="base" class="glass-base" aria-hidden="true" />
      <div ref="lens" class="glass-lens" aria-hidden="true"><span ref="highlight" class="glass-highlight" /></div>
      <div ref="tabs" class="glass-tabs glass-tab-targets">
        <RouterLink v-for="(item, index) in items" :key="item.label" :to="item.to" class="glass-tab"
          :aria-current="index === activeIndex ? 'page' : undefined" draggable="false" @click="activate(index)">
          <span class="glass-tab-content"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>

<script setup lang="ts">
// Miuix iOS-like navigation port. Copyright 2026, compose-miuix-ui contributors.
// Apache-2.0; upstream revision and adaptation notes: public/licenses/miuix/NOTICE.txt.
import { onBeforeUnmount, onMounted, ref, watch, nextTick, type Component } from 'vue';
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router';
import { stepSpring, type SpringState } from '@/utils/liquidGlass';

const props = defineProps<{
  items: { label: string; icon: Component; to: RouteLocationRaw }[];
  activeIndex: number;
  hidden: boolean;
}>();
const router = useRouter();
const bar = ref<HTMLElement>();
const base = ref<HTMLElement>();
const lens = ref<HTMLElement>();
const highlight = ref<HTMLElement>();
const tabs = ref<HTMLElement>();
let glyphs: HTMLElement[] = [];
let width = 0;
let tabWidth = 0;
let position: SpringState = { value: Math.max(0, props.activeIndex), velocity: 0 };
let progress: SpringState = { value: 0, velocity: 0 };
let scaleX: SpringState = { value: 1, velocity: 0 };
let scaleY: SpringState = { value: 1, velocity: 0 };
let target = position.value;
let pressed = false;
let releasePending = false;
let animation = 0;
let lastFrame = 0;
let pointer: number | null = null;
let downX = 0;
let rectLeft = 0;
let dragged = false;
let suppressClickUntil = 0;
let observer: ResizeObserver | undefined;
let motionPreference: MediaQueryList | undefined;

// Keep the animation outside Vue's render loop; only transforms and small glyph colors change.
function paint() {
  if (!lens.value || !base.value || !highlight.value) return;
  const reduced = motionPreference?.matches;
  const press = reduced ? 0 : Math.max(0, Math.min(1, progress.value));
  const velocity = position.velocity / Math.max(1, props.items.length - 1) / 10;
  const sx = reduced ? 1 : scaleX.value / (1 - Math.max(-0.2, Math.min(0.2, velocity * 0.75)));
  const sy = reduced ? 1 : scaleY.value * (1 - Math.max(-0.2, Math.min(0.2, velocity * 0.25)));
  const visible = props.activeIndex >= 0 || pressed;
  lens.value.style.opacity = visible ? '1' : '0';
  lens.value.style.transform = `translate3d(${position.value * tabWidth}px,0,0) scale(${sx},${sy})`;
  base.value.style.transform = `scale(${1 + 16 / Math.max(1, width) * press})`;
  highlight.value.style.opacity = String(press);
  glyphs.forEach((glyph, index) => {
    const proximity = visible ? Math.max(0, 1 - Math.abs(index - position.value)) : 0;
    glyph.style.transform = `translate3d(0,${-2 * press * proximity}px,0) scale(${1 + 0.2 * press * proximity})`;
    glyph.style.setProperty('--selection', `${proximity * 100}%`);
  });
}

function tick(now: number) {
  animation = 0;
  const dt = Math.min((now - (lastFrame || now - 16.67)) / 1000, 0.064);
  lastFrame = now;
  const reduced = motionPreference?.matches;
  if (pressed && dragged && !reduced) {
    const velocity = (target - position.value) / Math.max(dt, 0.001);
    position = { value: target, velocity: position.velocity + (velocity - position.velocity) * (1 - Math.exp(-25 * dt)) };
  } else position = reduced ? { value: target, velocity: 0 } : stepSpring(position, target, dt, 1000, 1);
  if (releasePending && Math.abs(position.value - target) < 0.025) releasePending = false;
  const held = pressed || releasePending;
  progress = reduced ? { value: 0, velocity: 0 } : stepSpring(progress, held ? 1 : 0, dt, 1000, 1);
  const scale = held && !reduced ? 78 / 56 : 1;
  scaleX = reduced ? { value: 1, velocity: 0 } : stepSpring(scaleX, scale, dt, 250, 0.6);
  scaleY = reduced ? { value: 1, velocity: 0 } : stepSpring(scaleY, scale, dt, 250, 0.7);
  paint();
  const settled = (state: SpringState, value: number) => Math.abs(state.value - value) < 0.001 && Math.abs(state.velocity) < 0.01;
  if (!settled(position, target) || (!reduced && !settled(progress, held ? 1 : 0)) || !settled(scaleX, scale) || !settled(scaleY, scale)) {
    animation = requestAnimationFrame(tick);
  } else lastFrame = 0;
}
function wake() { if (!animation) animation = requestAnimationFrame(tick); }
function activate(index: number) {
  target = index;
  releasePending = true;
  wake();
}
function start(event: PointerEvent) {
  if (pointer !== null || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || props.hidden || !tabWidth) return;
  pointer = event.pointerId;
  downX = event.clientX;
  rectLeft = bar.value!.getBoundingClientRect().left;
  dragged = false;
  target = Math.max(0, Math.min(props.items.length - 1, Math.floor((event.clientX - rectLeft - 4) / tabWidth)));
  pressed = true;
  releasePending = false;
  // Capture immediately so a touch crossing links or leaving the bar keeps driving the lens.
  bar.value!.setPointerCapture(event.pointerId);
  wake();
}
function move(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  if (Math.abs(event.clientX - downX) > 3) dragged = true;
  if (dragged) target = Math.max(0, Math.min(props.items.length - 1, (event.clientX - rectLeft - 4) / tabWidth - 0.5));
  wake();
}
function releaseCapture() {
  const captured = pointer;
  pointer = null;
  if (captured !== null && bar.value?.hasPointerCapture(captured)) bar.value.releasePointerCapture(captured);
}
function finish(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  pressed = false;
  target = Math.round(target);
  releasePending = true;
  suppressClickUntil = performance.now() + 400;
  const item = props.items[target];
  releaseCapture();
  if (item) void router.push(item.to);
  wake();
}
function cancel() {
  if (pointer === null) return;
  pressed = false;
  target = Math.max(0, props.activeIndex);
  releasePending = false;
  releaseCapture();
  wake();
}
function guardClick(event: MouseEvent) {
  if (event.detail && performance.now() < suppressClickUntil) {
    event.preventDefault();
    event.stopPropagation();
  }
}
watch(() => props.activeIndex, index => { if (!pressed) { target = Math.max(0, index); wake(); } });
watch(() => props.hidden, () => cancel());
watch(() => props.items.length, async () => { cancel(); await nextTick(); resize(); });

function resize() {
  const nextWidth = bar.value?.clientWidth || 0;
  if (!nextWidth) return;
  width = nextWidth;
  tabWidth = Math.max(0, width - 8) / Math.max(1, props.items.length);
  glyphs = Array.from(tabs.value?.querySelectorAll<HTMLElement>('.glass-tab-content') || []);
  if (lens.value) lens.value.style.width = `${tabWidth}px`;
  paint();
}
onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', wake);
  observer = new ResizeObserver(resize);
  if (bar.value) observer.observe(bar.value);
  resize();
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
});
onBeforeUnmount(() => {
  releaseCapture();
  if (animation) cancelAnimationFrame(animation);
  observer?.disconnect();
  motionPreference?.removeEventListener('change', wake);
  window.removeEventListener('pointerup', finish);
  window.removeEventListener('pointercancel', cancel);
  window.removeEventListener('blur', cancel);
});
</script>

<style scoped>
.glass-bar { --glass-ink: #080808; position: relative; isolation: isolate; width: 100%; height: 64px; padding: 4px; box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-select: none; }
.glass-base { position: absolute; inset: 0; border-radius: 999px; background: #ffffff66; -webkit-backdrop-filter: blur(4px) saturate(1.5); backdrop-filter: blur(4px) saturate(1.5); box-shadow: 0 0 10px #0000001a, inset 0 1px 1px #ffffffb3, inset 0 -1px 1px #ffffff40; pointer-events: none; will-change: transform; }
.glass-tabs { position: relative; display: grid; grid-template-columns: repeat(var(--count), minmax(0, 1fr)); height: 56px; }
.glass-tab { min-width: 0; height: 56px; display: flex; justify-content: center; align-items: center; color: var(--glass-ink); text-decoration: none; border-radius: 999px; touch-action: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.glass-tab-content { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: color-mix(in srgb, #3482ff var(--selection, 0%), var(--glass-ink)); will-change: transform; }
.glass-tab .el-icon { font-size: 22px; }
.glass-tab-content > span { font-size: 11px; font-weight: 400; line-height: 15px; white-space: nowrap; }
.glass-tab:focus-visible { outline: 2px solid #3482ff; outline-offset: -3px; }
.glass-lens { position: absolute; top: 4px; left: 4px; width: 0; height: 56px; opacity: 0; border-radius: 999px; pointer-events: none; background: rgb(0 0 0 / .08); will-change: transform; }
.glass-highlight { position: absolute; inset: 0; border-radius: inherit; opacity: 0; background: linear-gradient(155deg, #ffffffa6, #ffffff0d 35%, #ffffff26 70%, #ffffff80); box-shadow: inset 0 1px 1px #ffffffe6, inset 0 -1px 1px #ffffff99, inset 1px 0 3px #ffffff99, inset -1px 0 3px #00000026, 0 4px 12px #00000014; will-change: opacity; }
html[data-theme="dark"] .glass-bar { --glass-ink: #fff; }
html[data-theme="dark"] .glass-base { background: #24242466; box-shadow: 0 0 10px #0003, inset 0 1px 1px #ffffff40, inset 0 -1px 1px #ffffff1a; }
html[data-theme="dark"] .glass-lens { background: rgb(255 255 255 / .1); }
html[data-theme="dark"] .glass-highlight { background: linear-gradient(155deg, #ffffff59, #ffffff05 35%, #ffffff0d 70%, #ffffff33); }
@supports not (backdrop-filter: blur(1px)) {
  .glass-base { background: #f7f7f7; }
  html[data-theme="dark"] .glass-base { background: #242424; }
}
</style>
