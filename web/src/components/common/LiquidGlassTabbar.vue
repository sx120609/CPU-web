<template>
  <div :class="{ 'is-hidden': hidden }">
    <nav ref="bar" class="glass-bar" :class="{ 'has-refraction': baseMap }" :style="barStyle"
      aria-label="移动端主导航" @pointerdown="start" @pointermove="move" @pointerup="finish"
      @pointercancel="cancel" @lostpointercapture="cancel" @click.capture="guardClick">
      <svg class="glass-filter" aria-hidden="true" width="0" height="0">
        <defs>
          <filter :id="filterId" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
            <feImage :href="baseMap" width="100%" height="100%" result="lens" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="lens" scale="48" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter :id="`${filterId}-selection`" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
            <feImage :href="selectionMap" width="100%" height="100%" result="lens" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="lens" scale="48" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div class="glass-base" aria-hidden="true" />
      <div class="glass-tabs" :style="{ maskImage: contentMask }">
        <RouterLink v-for="(item, index) in items" :key="item.label" :to="item.to" class="glass-tab"
          :aria-current="index === activeIndex ? 'page' : undefined" draggable="false" @click="activate(index)">
          <span class="glass-tab-content"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></span>
        </RouterLink>
      </div>
      <div v-show="activeIndex >= 0 || pressed" class="glass-lens" :style="lensStyle" aria-hidden="true">
        <div class="glass-lens-content" :style="magnifiedStyle">
          <span v-for="item in items" :key="item.label" class="glass-tab">
            <span class="glass-tab-content"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></span>
          </span>
        </div>
      </div>
    </nav>
  </div>
</template>

<script setup lang="ts">
// Miuix iOS-like navigation port. Copyright 2026, compose-miuix-ui contributors.
// Apache-2.0; upstream revision and adaptation notes: public/licenses/miuix/NOTICE.txt.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch, type Component } from 'vue';
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router';
import { createLensMap, stepSpring, type SpringState } from '@/utils/liquidGlass';

const props = defineProps<{
  items: { label: string; icon: Component; to: RouteLocationRaw }[];
  activeIndex: number;
  hidden: boolean;
}>();
const router = useRouter();
const bar = ref<HTMLElement>();
const pressed = ref(false);
const width = ref(0);
const baseMap = ref('');
const selectionMaps = shallowRef<string[]>([]);
const filterId = `liquid-nav-${useId().replace(/:/g, '')}`;
const initial = Math.max(0, props.activeIndex);
const frame = shallowRef({ position: initial, progress: 0, glow: 0, scaleX: 1, scaleY: 1, panel: 0 });
let position: SpringState = { value: initial, velocity: 0 };
let progress: SpringState = { value: 0, velocity: 0 };
let glow: SpringState = { value: 0, velocity: 0 };
let scaleX: SpringState = { value: 1, velocity: 0 };
let scaleY: SpringState = { value: 1, velocity: 0 };
let panel: SpringState = { value: 0, velocity: 0 };
let target = initial;
let releasePending = false;
let animation = 0;
let lastFrame = 0;
let pointer: number | null = null;
let downX = 0;
let lastX = 0;
let rectLeft = 0;
let dragged = false;
let suppressClickUntil = 0;
let observer: ResizeObserver | undefined;
let motionPreference: MediaQueryList | undefined;
const tabWidth = computed(() => Math.max(0, width.value - 8) / Math.max(1, props.items.length));
const selectionMap = computed(() => selectionMaps.value[Math.round(frame.value.progress * 16)] || '');
const barStyle = computed(() => ({
  '--count': props.items.length,
  '--press': frame.value.progress,
  '--glow': frame.value.glow,
  '--spot-x': `${(frame.value.position + 0.5) * tabWidth.value + 4}px`,
  '--panel': `${frame.value.panel}px`,
  '--base-scale': 1 + 16 / Math.max(1, width.value) * frame.value.progress,
  '--refraction': `url("#${filterId}")`,
  '--selection-refraction': `url("#${filterId}-selection")`,
}));
const lensStyle = computed(() => ({
  width: `${tabWidth.value}px`,
  transform: `translate3d(${frame.value.position * tabWidth.value + frame.value.panel}px,0,0) scale(${frame.value.scaleX},${frame.value.scaleY})`,
}));
const magnifiedStyle = computed(() => ({
  width: `${width.value - 8}px`,
  left: `${-frame.value.position * tabWidth.value}px`,
  transformOrigin: `${(frame.value.position + 0.5) * tabWidth.value}px 50%`,
  transform: `scale(${1 / frame.value.scaleX},${1 / frame.value.scaleY})`,
}));
// Cut the unselected glyphs out under the lens so magnified text never doubles up.
const contentMask = computed(() => {
  if (props.activeIndex < 0 && !pressed.value) return 'none';
  const w = tabWidth.value * frame.value.scaleX;
  const h = 56 * frame.value.scaleY;
  const x = (frame.value.position + 0.5) * tabWidth.value - w / 2;
  const y = (56 - h) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.value - 8}" height="56"><rect width="100%" height="100%" fill="white"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${28 * frame.value.scaleX}" ry="${28 * frame.value.scaleY}" fill="black"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
});

function tick(now: number) {
  animation = 0;
  const dt = Math.min((now - (lastFrame || now - 16.67)) / 1000, 0.064);
  lastFrame = now;
  const reduced = motionPreference?.matches;
  position = reduced ? { value: target, velocity: 0 } : stepSpring(position, target, dt, 1000, 1);
  if (releasePending && Math.abs(position.value - target) < Math.max(1, props.items.length - 1) * 0.025) releasePending = false;
  const held = pressed.value || releasePending;
  progress = reduced ? { value: 0, velocity: 0 } : stepSpring(progress, held ? 1 : 0, dt, 1000, 1);
  glow = reduced ? { value: 0, velocity: 0 } : stepSpring(glow, pressed.value ? 1 : 0, dt, 300, 0.5);
  const scale = held && !reduced ? 78 / 56 : 1;
  scaleX = stepSpring(scaleX, scale, dt, 250, 0.6);
  scaleY = stepSpring(scaleY, scale, dt, 250, 0.7);
  if (!pressed.value) panel = stepSpring(panel, 0, dt, 300, 1);
  const velocity = position.velocity / Math.max(1, props.items.length - 1) / 10;
  frame.value = {
    position: position.value,
    progress: Math.max(0, Math.min(1, progress.value)),
    glow: Math.max(0, Math.min(1, glow.value)),
    scaleX: reduced ? 1 : scaleX.value / (1 - Math.max(-0.2, Math.min(0.2, velocity * 0.75))),
    scaleY: reduced ? 1 : scaleY.value * (1 - Math.max(-0.2, Math.min(0.2, velocity * 0.25))),
    panel: reduced ? 0 : panel.value,
  };
  const settled = (state: SpringState, value: number) => Math.abs(state.value - value) < 0.001 && Math.abs(state.velocity) < 0.01;
  if (!settled(position, target) || (!reduced && (!settled(progress, held ? 1 : 0) || !settled(glow, pressed.value ? 1 : 0))) || !settled(scaleX, scale) || !settled(scaleY, scale) || (!pressed.value && !settled(panel, 0))) {
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
  if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || props.hidden || !tabWidth.value) return;
  pointer = event.pointerId;
  downX = lastX = event.clientX;
  rectLeft = bar.value!.getBoundingClientRect().left;
  dragged = false;
  target = Math.max(0, Math.min(props.items.length - 1, Math.floor((event.clientX - rectLeft - 4) / tabWidth.value)));
  pressed.value = true;
  releasePending = false;
  wake();
}
function move(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  const delta = event.clientX - lastX;
  const inside = event.clientX >= rectLeft && event.clientX <= rectLeft + width.value;
  if (inside && lastX >= rectLeft && lastX <= rectLeft + width.value) target = Math.max(0, Math.min(props.items.length - 1, target + delta / tabWidth.value));
  if (Math.abs(event.clientX - downX) > 3) {
    dragged = true;
    if (!bar.value?.hasPointerCapture(event.pointerId)) bar.value?.setPointerCapture(event.pointerId);
  }
  const fraction = Math.max(-1, Math.min(1, (event.clientX - downX) / width.value));
  panel = { value: 4 * Math.sign(fraction) * (1 - (1 - Math.abs(fraction)) ** 3), velocity: 0 };
  lastX = event.clientX;
  wake();
}
function releaseCapture() {
  const captured = pointer;
  pointer = null;
  if (captured !== null && bar.value?.hasPointerCapture(captured)) bar.value.releasePointerCapture(captured);
}
function finish(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  pressed.value = false;
  target = Math.round(target);
  releasePending = true;
  if (dragged) {
    suppressClickUntil = performance.now() + 400;
    const item = props.items[target];
    if (item) void router.push(item.to);
  }
  releaseCapture();
  wake();
}
function cancel() {
  if (pointer === null) return;
  pressed.value = false;
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
watch(() => props.activeIndex, index => { if (!pressed.value) { target = Math.max(0, index); wake(); } });
watch(() => props.hidden, () => cancel());
watch(() => props.items.length, () => { cancel(); resize(); });

function resize() {
  const nextWidth = Math.round(bar.value?.clientWidth || 0);
  if (!nextWidth) return;
  width.value = nextWidth;
  if (!/Chrome|Chromium|Edg\//.test(navigator.userAgent)) return;
  baseMap.value = createLensMap(nextWidth, 64, 24, 24);
  const itemWidth = Math.round((nextWidth - 8) / Math.max(1, props.items.length));
  selectionMaps.value = Array.from({ length: 17 }, (_, step) => createLensMap(itemWidth, 56, 10 * step / 16, 14 * step / 16, true));
}
onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  observer = new ResizeObserver(resize);
  if (bar.value) observer.observe(bar.value);
  window.addEventListener('pointerup', cancel);
  window.addEventListener('blur', cancel);
});
onBeforeUnmount(() => {
  releaseCapture();
  if (animation) cancelAnimationFrame(animation);
  observer?.disconnect();
  window.removeEventListener('pointerup', cancel);
  window.removeEventListener('blur', cancel);
});
</script>

<style scoped>
.glass-bar { position: relative; width: 100%; height: 64px; padding: 4px; box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-select: none; }
.glass-filter { position: absolute; pointer-events: none; }
.glass-base { position: absolute; inset: 0; border-radius: 999px; background: #ffffff66; -webkit-backdrop-filter: blur(4px) saturate(1.5); backdrop-filter: blur(4px) saturate(1.5); box-shadow: 0 0 10px #0000001a; transform: translateX(var(--panel)) scale(var(--base-scale)); pointer-events: none; }
.has-refraction .glass-base { backdrop-filter: blur(4px) saturate(1.5) var(--refraction); }
.glass-base::before { content: ''; position: absolute; inset: 0; border-radius: inherit; opacity: var(--glow); background: radial-gradient(circle 76.8px at var(--spot-x) 50%, #ffffff1f 50%, rgb(255 255 255 / .10125) 62.5%, rgb(255 255 255 / .06) 75%, rgb(255 255 255 / .01875) 87.5%, transparent), #ffffff0f; mix-blend-mode: plus-lighter; }
.glass-base::after, .glass-lens::after { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; background: conic-gradient(from -45deg, #ffffffb3, #ffffff08 20%, #ffffff05 35%, #ffffff80 50%, #ffffff05 70%, #ffffff08 85%, #ffffffb3); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.glass-base::after { opacity: .75; }
.glass-tabs, .glass-lens-content { display: grid; grid-template-columns: repeat(var(--count), minmax(0, 1fr)); height: 56px; }
.glass-tabs { position: relative; transform: translateX(var(--panel)); mask-mode: luminance; }
.glass-tab { min-width: 0; height: 56px; display: flex; justify-content: center; align-items: center; color: #080808; text-decoration: none; border-radius: 999px; -webkit-tap-highlight-color: transparent; }
.glass-tab-content { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
.glass-tab .el-icon { font-size: 22px; }
.glass-tab-content > span { font-size: 11px; font-weight: 400; line-height: 15px; white-space: nowrap; }
.glass-tab:focus-visible { outline: 2px solid #3482ff; outline-offset: -3px; }
.glass-bar:has(a[aria-current="page"]:focus-visible) .glass-lens { outline: 2px solid #3482ff; outline-offset: -3px; }
.glass-lens { position: absolute; top: 4px; left: 4px; height: 56px; border-radius: 999px; overflow: hidden; pointer-events: none; background: rgb(0 0 0 / calc(.03 * var(--press))); box-shadow: inset 0 0 calc(8px * var(--press)) rgb(0 0 0 / calc(.15 * var(--press))); }
.glass-lens::before { content: ''; position: absolute; inset: 0; background: rgb(0 0 0 / calc(.1 * (1 - var(--press)))); }
.has-refraction .glass-lens { backdrop-filter: var(--selection-refraction); }
.glass-lens::after { opacity: var(--press); }
.glass-lens-content { position: absolute; top: 0; }
.glass-lens-content .glass-tab { color: #3482ff; }
.glass-lens-content .glass-tab-content { transform: scale(calc(1 + .2 * var(--press))); }
html[data-theme="dark"] .glass-base { background: #24242466; box-shadow: 0 0 10px #0003; }
html[data-theme="dark"] .glass-tabs .glass-tab { color: #fff; }
html[data-theme="dark"] .glass-lens::before { background: rgb(255 255 255 / calc(.1 * (1 - var(--press)))); }
@supports not (backdrop-filter: blur(1px)) {
  .glass-base { background: #f7f7f7; }
  html[data-theme="dark"] .glass-base { background: #242424; }
}
</style>
