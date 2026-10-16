<template>
  <div
    class="wk-player"
    :class="{ 'is-game': version?.type === 'game' }"
    :data-workshop-orientation="version?.manifest.game?.orientation"
  >
    <header class="wk-player-bar">
      <button type="button" class="wk-player-btn" aria-label="返回" @click="leave">
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <WorkIcon
        v-if="work && version"
        :slug="work.slug"
        :name="version.name"
        :type="version.type"
        :size="28"
      />
      <div class="wk-player-title">
        <b>{{ version?.name || "打开作品" }}</b>
        <small v-if="version && work">v{{ version.version }} · {{ work.author.nickname }}</small>
      </div>
      <em v-if="previewId" class="wk-chip is-warn">预览</em>
      <button
        v-if="phase !== 'loading' && version"
        type="button"
        class="wk-player-btn"
        aria-label="重新打开"
        @click="restart"
      >
        <el-icon><RefreshRight /></el-icon>
      </button>
      <button
        v-if="phase === 'running' && canFullscreen"
        type="button"
        class="wk-player-btn"
        aria-label="全屏"
        @click="enterFullscreen"
      >
        <el-icon><FullScreen /></el-icon>
      </button>
    </header>

    <div class="wk-player-body">
      <div v-if="phase === 'error'" class="wk-player-state" role="alert">
        <el-icon class="wk-player-state-icon"><WarningFilled /></el-icon>
        <b>{{ error }}</b>
        <p v-if="previewId">预览只对作者和管理员开放，链接 30 分钟内有效。</p>
        <div class="wk-actions">
          <el-button v-if="version" type="primary" @click="restart">重试</el-button>
          <el-button @click="leave">返回</el-button>
        </div>
      </div>
      <div v-else-if="phase === 'loading'" class="wk-player-state" role="status">
        <p>正在读取作品…</p>
      </div>
      <div
        v-else
        ref="stageEl"
        class="wk-player-stage"
        :class="{ 'has-aspect': Boolean(aspectRatio), 'is-portrait': aspectRatio > 0 && aspectRatio < 1 }"
        :style="aspectRatio ? { '--wk-ratio': String(aspectRatio) } : undefined"
      >
        <WorkshopRuntime
          :key="runKey"
          ref="runtime"
          :work-id="workId"
          :version="version!"
          :preview="Boolean(previewId)"
          @close="leave"
          @ready="phase = 'running'"
          @error="runtimeError"
        />
        <div v-if="phase === 'starting'" class="wk-player-veil" role="status">
          <WorkIcon :slug="work!.slug" :name="version!.name" :type="version!.type" :size="72" />
          <b>{{ version!.name }}</b>
          <span>正在打开…</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, FullScreen, RefreshRight, WarningFilled } from "@element-plus/icons-vue";
import { workshopApi, type WorkshopVersion, type WorkshopWork } from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import WorkIcon from "./WorkIcon.vue";
import WorkshopRuntime from "./WorkshopRuntime.vue";
import { workshopError } from "./shared";
import "./workshop.css";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const workId = computed(() => String(route.params.id));
const previewId = computed(() =>
  typeof route.query.versionId === "string" ? route.query.versionId : "",
);
const work = ref<WorkshopWork | null>(null);
const version = ref<WorkshopVersion | null>(null);
const phase = ref<"loading" | "starting" | "running" | "error">("loading");
const error = ref("");
const runKey = ref(0);
const runtime = ref<InstanceType<typeof WorkshopRuntime>>();
const stageEl = ref<HTMLElement>();
const aspectRatio = computed(() => version.value?.manifest.game?.aspectRatio || 0);
const canFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
let generation = 0;

async function load() {
  const seq = ++generation;
  phase.value = "loading";
  error.value = "";
  work.value = null;
  version.value = null;
  try {
    const result = await workshopApi.detail(workId.value);
    if (seq !== generation) return;
    const selected = previewId.value
      ? result.versions?.find((item) => item.id === previewId.value)
      : result.versions?.find((item) => item.id === result.publishedVersionId) || result.version;
    if (!selected) throw new Error("该版本不存在或你没有预览权限");
    if (!previewId.value && (result.disabled || selected.id !== result.publishedVersionId))
      throw new Error("作品尚未公开或已下架");
    work.value = result;
    version.value = selected;
    start();
  } catch (cause) {
    if (seq !== generation) return;
    error.value = workshopError(cause, "作品暂时无法打开");
    phase.value = "error";
  }
}
function start() {
  runKey.value++;
  phase.value = "starting";
}
function restart() {
  if (!version.value) {
    void load();
    return;
  }
  error.value = "";
  start();
}
function runtimeError(message: string) {
  error.value = message;
  phase.value = "error";
}
function leave() {
  generation++;
  // 从工坊里点进来的原路返回；直接打开链接的回到作品详情。
  if (window.history.state?.back) router.back();
  else void router.replace(`/workshop/${workId.value}`);
}
async function enterFullscreen() {
  try {
    await (runtime.value?.enterFullscreen() ?? stageEl.value?.requestFullscreen());
  } catch {
    /* 浏览器不支持全屏时留在页面内继续使用 */
  }
}
watch([workId, previewId, () => auth.sessionVersion], load, { immediate: true });
</script>

<style scoped>
/* 铺满整个视口，盖住站点的顶栏和底栏（做法同站内小游戏的 .flight-shell）。
   层级低于 Element Plus 的弹层（5000 起），作品请求的提示和确认框才能显示在上面。 */
.wk-player {
  --wk-safe-bottom: max(env(safe-area-inset-bottom, 0px), calc(var(--cpu-harmony-bottom-clearance, 72px) - 72px));
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  background: var(--cpu-bg);
  color: var(--cpu-text);
}
.wk-player.is-game { background: #0e1012; color: #eceef1; }

.wk-player-bar {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  /* 原生壳（安卓/iOS Next/鸿蒙）已把 WebView 放在状态栏下方，MainLayout 会把这个变量置 0；
     直接用 env() 会在安卓上再留一截状态栏高度的空白。iOS 浏览器和 PWA 仍取系统安全区。 */
  padding: var(--cpu-safe-area-inset-top, 0px) 8px 0;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
}
.wk-player.is-game .wk-player-bar {
  border-bottom-color: #23272c;
  background: #16191d;
}
.wk-player-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  line-height: 1.3;
}
.wk-player-title b {
  overflow: hidden;
  font-size: var(--cpu-fs-m);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-player-title small {
  overflow: hidden;
  font-size: var(--cpu-fs-xs);
  opacity: 0.65;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-player-btn {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: none;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.wk-player-btn:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
@media (hover: hover) {
  .wk-player-btn:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
}

.wk-player-body {
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: center;
  padding: 16px 16px max(16px, var(--wk-safe-bottom));
  container-type: size;
}
.wk-player-stage {
  position: relative;
  width: 100%;
  max-width: 1100px;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}
.wk-player.is-game .wk-player-stage {
  max-width: none;
  border-color: #23272c;
  background: #000;
}
/* 声明了宽高比的游戏按比例放进可用区域，四周留黑。 */
@supports (width: 1cqw) {
  .wk-player-stage.has-aspect {
    width: min(100cqw, 100cqh * var(--wk-ratio));
    height: min(100cqh, 100cqw / var(--wk-ratio));
  }
}
.wk-player-stage:fullscreen {
  width: 100%;
  max-width: none;
  height: 100%;
  border: 0;
  border-radius: 0;
}

.wk-player-veil,
.wk-player-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}
.wk-player-veil {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--cpu-card);
  color: var(--cpu-text);
}
.wk-player-veil b { font-size: var(--cpu-fs-l); font-weight: 600; }
.wk-player-veil span { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.wk-player-state b { max-width: 420px; font-size: var(--cpu-fs-l); font-weight: 600; }
.wk-player-state p { margin: 0; font-size: var(--cpu-fs-s); opacity: 0.7; }
.wk-player-state-icon { color: var(--cpu-hue-amber-ink); font-size: 32px; }
.wk-player.is-game .wk-player-state-icon { color: #f5b942; }
.wk-player-state .wk-actions { margin-top: 6px; justify-content: center; }

@media (max-width: 700px) {
  .wk-player-body { padding: 0 0 var(--wk-safe-bottom); }
  .wk-player-stage { border: 0; border-radius: 0; }
  /* 竖屏游戏在手机上直接铺满，不为了凑比例在上下留黑。 */
  .wk-player-stage.has-aspect.is-portrait { width: 100%; height: 100%; }
}
</style>
