<template>
  <div :class="{ 'is-hidden': hidden }">
    <nav ref="bar" class="glass-bar" :style="{ '--count': items.length }" aria-label="移动端主导航"
      @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel"
      @lostpointercapture="cancel" @click.capture="guardClick">
      <div ref="base" class="glass-base" aria-hidden="true" />
      <div ref="lens" class="glass-lens" aria-hidden="true"><span ref="highlight" class="glass-highlight" /></div>
      <div ref="tabs" class="glass-tabs glass-tab-targets">
        <RouterLink v-for="(item, index) in items" :key="item.label" :to="item.to" class="glass-tab"
          :aria-current="index === activeIndex ? 'page' : undefined" :data-tab-index="index" draggable="false">
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
let settling: Animation[] = [];
let navigationFrame = 0;
let navigationVersion = 0;

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
function stopSettlement() {
  if (!settling.length || !lens.value) return;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(lens.value).transform);
  position = { value: tabWidth ? matrix.m41 / tabWidth : target, velocity: 0 };
  scaleX = { value: matrix.m11, velocity: 0 };
  scaleY = { value: matrix.m22, velocity: 0 };
  progress = { value: Number(highlight.value && getComputedStyle(highlight.value).opacity) || 0, velocity: 0 };
  settling.forEach(item => item.cancel());
  settling = [];
}

// Precompute the spring once so route rendering cannot stall each animation frame.
function settle() {
  if (animation) cancelAnimationFrame(animation);
  animation = 0;
  lastFrame = 0;
  const lensFrames: Keyframe[] = [];
  const baseFrames: Keyframe[] = [];
  const lightFrames: Keyframe[] = [];
  const glyphFrames: Keyframe[][] = glyphs.map(() => []);
  if (!motionPreference?.matches) {
    for (let frame = 0; frame <= 42; frame++) {
      const press = Math.max(0, Math.min(1, progress.value));
      const velocity = position.velocity / Math.max(1, props.items.length - 1) / 10;
      const sx = scaleX.value / (1 - Math.max(-0.2, Math.min(0.2, velocity * 0.75)));
      const sy = scaleY.value * (1 - Math.max(-0.2, Math.min(0.2, velocity * 0.25)));
      lensFrames.push({ transform: `translate3d(${position.value * tabWidth}px,0,0) scale(${sx},${sy})` });
      baseFrames.push({ transform: `scale(${1 + 16 / Math.max(1, width) * press})` });
      lightFrames.push({ opacity: press });
      glyphFrames.forEach((frames, index) => {
        const proximity = Math.max(0, 1 - Math.abs(index - position.value));
        frames.push({ transform: `translate3d(0,${-2 * press * proximity}px,0) scale(${1 + .2 * press * proximity})` });
      });
      position = stepSpring(position, target, 1 / 60, 1000, 1);
      const held = Math.abs(position.value - target) > .025;
      progress = stepSpring(progress, held ? 1 : 0, 1 / 60, 1000, 1);
      scaleX = stepSpring(scaleX, held ? 78 / 56 : 1, 1 / 60, 250, .6);
      scaleY = stepSpring(scaleY, held ? 78 / 56 : 1, 1 / 60, 250, .7);
    }
  }
  position = { value: target, velocity: 0 };
  progress = { value: 0, velocity: 0 };
  scaleX = scaleY = { value: 1, velocity: 0 };
  releasePending = false;
  paint();
  if (!lensFrames.length) return;
  lensFrames[42] = { transform: lens.value!.style.transform };
  baseFrames[42] = { transform: base.value!.style.transform };
  lightFrames[42] = { opacity: 0 };
  glyphFrames.forEach((frames, index) => { frames[42] = { transform: glyphs[index].style.transform }; });
  const play = (element: HTMLElement | undefined, frames: Keyframe[]) => {
    if (element) settling.push(element.animate(frames, { duration: 700, easing: 'linear' }));
  };
  play(lens.value, lensFrames);
  play(base.value, baseFrames);
  play(highlight.value, lightFrames);
  glyphs.forEach((glyph, index) => play(glyph, glyphFrames[index]));
  const current = settling;
  void Promise.all(current.map(item => item.finished)).then(() => {
    if (settling === current) settling = [];
  }).catch(() => undefined);
}
function cancelNavigation() {
  navigationVersion++;
  if (navigationFrame) cancelAnimationFrame(navigationFrame);
  navigationFrame = 0;
}
function navigate(index: number) {
  cancelNavigation();
  const item = props.items[index];
  if (!item) return;
  const version = navigationVersion;
  const commit = () => {
    navigationFrame = 0;
    if (version !== navigationVersion) return;
    const reconcile = () => {
      if (version === navigationVersion && !pressed && target !== Math.max(0, props.activeIndex)) syncSelection();
    };
    void router.push(item.to).then(reconcile, reconcile);
  };
  // Present the indicator before the incoming page starts its synchronous mount work.
  if (motionPreference?.matches) commit();
  else navigationFrame = requestAnimationFrame(() => { navigationFrame = requestAnimationFrame(commit); });
}
function activate(index: number) {
  stopSettlement();
  target = index;
  settle();
  navigate(index);
}
function start(event: PointerEvent) {
  if (pointer !== null || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || props.hidden || !tabWidth) return;
  cancelNavigation();
  stopSettlement();
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
  releaseCapture();
  settle();
  navigate(target);
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
    return;
  }
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab-index]') : null;
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  activate(Number(link.dataset.tabIndex));
}
function syncSelection() {
  if (pressed) return;
  const next = Math.max(0, props.activeIndex);
  if (next === target && settling.length) return;
  stopSettlement();
  target = next;
  settle();
}
watch(() => props.activeIndex, syncSelection);
watch(() => props.hidden, () => cancel());
watch(() => props.items.length, async () => { cancel(); await nextTick(); resize(); });

function resize() {
  const nextWidth = bar.value?.clientWidth || 0;
  if (!nextWidth) return;
  const wasSettling = settling.length > 0;
  stopSettlement();
  width = nextWidth;
  tabWidth = Math.max(0, width - 8) / Math.max(1, props.items.length);
  glyphs = Array.from(tabs.value?.querySelectorAll<HTMLElement>('.glass-tab-content') || []);
  if (lens.value) lens.value.style.width = `${tabWidth}px`;
  if (wasSettling && !pressed) settle();
  else paint();
}
function syncMotionPreference() {
  stopSettlement();
  if (pressed) wake();
  else settle();
}
onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', syncMotionPreference);
  observer = new ResizeObserver(resize);
  if (bar.value) observer.observe(bar.value);
  resize();
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
});
onBeforeUnmount(() => {
  cancelNavigation();
  settling.forEach(item => item.cancel());
  settling = [];
  releaseCapture();
  if (animation) cancelAnimationFrame(animation);
  observer?.disconnect();
  motionPreference?.removeEventListener('change', syncMotionPreference);
  window.removeEventListener('pointerup', finish);
  window.removeEventListener('pointercancel', cancel);
  window.removeEventListener('blur', cancel);
});
</script>

<style scoped>
.glass-bar { --glass-ink: #080808; position: relative; isolation: isolate; width: 100%; height: 64px; padding: 4px; box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-select: none; }
.glass-base { position: absolute; inset: 0; border-radius: 999px; background: linear-gradient(165deg, #ffffff38, #ffffff14 45%, #ffffff24); -webkit-backdrop-filter: blur(.65px) saturate(1.08); backdrop-filter: blur(.65px) saturate(1.08); box-shadow: 0 3px 12px #152b3c12, inset 0 1px .5px #ffffffd9, inset 1px 0 .5px #ffffff80, inset 0 -1px .5px #152b3c26; pointer-events: none; will-change: transform; }
.glass-tabs { position: relative; display: grid; grid-template-columns: repeat(var(--count), minmax(0, 1fr)); height: 56px; }
.glass-tab { min-width: 0; height: 56px; display: flex; justify-content: center; align-items: center; color: var(--glass-ink); text-decoration: none; border-radius: 999px; touch-action: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.glass-tab-content { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: color-mix(in srgb, #3482ff var(--selection, 0%), var(--glass-ink)); will-change: transform; }
.glass-tab .el-icon { font-size: 22px; filter: drop-shadow(0 1px .7px #ffffffa6); }
.glass-tab-content > span { font-size: 11px; font-weight: 400; line-height: 15px; white-space: nowrap; text-shadow: 0 1px 1px #ffffffb3; }
.glass-tab:focus-visible { outline: 2px solid #3482ff; outline-offset: -3px; }
.glass-lens { position: absolute; top: 4px; left: 4px; width: 0; height: 56px; opacity: 0; border-radius: 999px; pointer-events: none; background: linear-gradient(145deg, #ffffff24, #15355108 50%, #ffffff14); box-shadow: inset 0 1px .5px #ffffffb3, inset 0 -1px .5px #1535511f, 0 2px 5px #1535510d; will-change: transform; }
.glass-highlight { position: absolute; inset: 0; border-radius: inherit; opacity: 0; background: linear-gradient(135deg, #ffffffe6, #ffffff33 6%, #ffffff00 18% 78%, #ffffff66); box-shadow: inset 1px 1px 1px #ffffffe6, inset -1px -1px 1px #ffffff80, inset -2px 0 2px #15355126, 0 3px 9px #15355114; will-change: opacity; }
html[data-theme="dark"] .glass-bar { --glass-ink: #fff; }
html[data-theme="dark"] .glass-base { background: linear-gradient(165deg, #ffffff14, #11182724 45%, #ffffff0a); box-shadow: 0 3px 12px #0003, inset 0 1px .5px #ffffff73, inset 1px 0 .5px #ffffff26, inset 0 -1px .5px #0006; }
html[data-theme="dark"] .glass-lens { background: linear-gradient(145deg, #ffffff1f, #ffffff03 50%, #ffffff0d); box-shadow: inset 0 1px .5px #ffffff66, inset 0 -1px .5px #0005, 0 2px 5px #0002; }
html[data-theme="dark"] .glass-highlight { background: linear-gradient(135deg, #ffffff99, #ffffff1a 6%, #ffffff00 18% 78%, #ffffff40); }
html[data-theme="dark"] .glass-tab .el-icon { filter: drop-shadow(0 1px .7px #000a); }
html[data-theme="dark"] .glass-tab-content > span { text-shadow: 0 1px 1px #000b; }
@supports not (backdrop-filter: blur(1px)) {
  .glass-base { background: #f7f7f7; }
  html[data-theme="dark"] .glass-base { background: #242424; }
}
</style>
