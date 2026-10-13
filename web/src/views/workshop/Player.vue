<template>
  <div class="pk-page pk-page--wide workshop-player">
    <header class="pk-head">
      <router-link class="pk-back" :to="`/workshop/${workId}`"
        >← 作品详情</router-link
      >
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true">{{
          version?.type === "game" ? "🎮" : "✦"
        }}</span>
        <div class="pk-title-copy">
          <h1>
            {{ version?.name || "打开作品"
            }}<em v-if="previewId" class="pk-badge">私密预览</em>
          </h1>
          <p v-if="version">
            v{{ version.version }} · {{ work?.author.nickname }}
          </p>
        </div>
        <el-button v-if="runtimeUrl" @click="enterFullscreen">全屏</el-button>
        <el-button v-if="runtimeUrl" @click="stop">关闭作品</el-button>
      </div>
    </header>

    <p v-if="loading" class="pk-notice" role="status">正在读取作品…</p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
    />
    <section v-if="version && !runtimeUrl && !loading" class="player-intro">
      <p class="player-description">{{ version.description }}</p>
      <p v-if="previewId" class="pk-notice">
        这是未公开的版本预览。预览存档与正式作品分开保存，仅用于本机测试。
      </p>
      <p v-if="storageAllowed" class="player-storage">{{ storageHint }}</p>
      <p
        v-if="version.type === 'game' && version.manifest.game"
        class="player-storage"
      >
        支持{{ controlLabel
        }}{{
          version.manifest.game.orientation === "landscape"
            ? " · 建议横屏使用"
            : ""
        }}
      </p>
      <el-button type="primary" :loading="launching" @click="launch">{{
        version.type === "game"
          ? "开始游戏"
          : version.type === "extension"
            ? "打开扩展"
            : "打开工具"
      }}</el-button>
    </section>

    <section
      v-if="runtimeUrl"
      ref="stageEl"
      class="player-stage"
      :class="{
        'is-game': version?.type === 'game',
        'has-aspect': Boolean(version?.manifest.game?.aspectRatio),
      }"
      :style="stageStyle"
    >
      <WorkshopRuntime
        ref="runtime"
        :work-id="workId"
        :version="version!"
        :preview="Boolean(previewId)"
        @close="stop"
        @ready="connected = true"
        @error="runtimeError"
      />
    </section>
    <p v-if="runtimeUrl && !connected" class="player-storage" role="status">
      {{ connectionHint }}
    </p>
    <p v-if="runtimeUrl && connected && storageAllowed" class="player-storage">
      {{ storageHint }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  workshopApi,
  type WorkshopVersion,
  type WorkshopWork,
} from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import WorkshopRuntime from "./WorkshopRuntime.vue";
import { workshopError } from "./shared";
import "@/styles/page-kit.css";
const route = useRoute(),
  auth = useAuthStore();
const workId = computed(() => String(route.params.id));
const previewId = computed(() =>
  typeof route.query.versionId === "string" ? route.query.versionId : "",
);
const work = ref<WorkshopWork | null>(null),
  version = ref<WorkshopVersion | null>(null);
const loading = ref(false),
  launching = ref(false),
  error = ref(""),
  runtimeUrl = ref(""),
  connected = ref(false);
const runtime = ref<InstanceType<typeof WorkshopRuntime>>(),
  stageEl = ref<HTMLElement>();
const connectionHint = "正在连接作品…";
let generation = 0;
const storageAllowed = computed(() =>
  Boolean(version.value?.manifest.permissions?.includes("storage")),
);
const storageHint = computed(() =>
  previewId.value
    ? "此预览只能读写自己的本机测试存档。"
    : auth.isLoggedIn
      ? "作品可以读写你在此作品中的独立云端存档与设置。"
      : "访客进度仅保存在当前浏览器；登录后使用独立的账号存档。",
);
const controlLabel = computed(
  () =>
    version.value?.manifest.game?.controls
      .map((c) => ({ pointer: "鼠标", keyboard: "键盘", touch: "触屏" })[c])
      .join("、") || "网页操作",
);
const stageStyle = computed(() =>
  version.value?.manifest.game?.aspectRatio
    ? { "--workshop-ratio": String(version.value.manifest.game.aspectRatio) }
    : {},
);
function stop() {
  generation++;
  runtime.value?.stop();
  runtimeUrl.value = "";
  connected.value = false;
  launching.value = false;
}
async function load() {
  stop();
  const seq = generation;
  loading.value = true;
  error.value = "";
  work.value = null;
  version.value = null;
  try {
    const result = await workshopApi.detail(workId.value);
    if (seq !== generation) return;
    const selected = previewId.value
      ? result.versions?.find((v) => v.id === previewId.value)
      : result.versions?.find((v) => v.id === result.publishedVersionId) ||
        result.version;
    if (!selected) throw new Error("该版本不存在或你没有预览权限");
    if (
      !previewId.value &&
      (result.disabled || selected.id !== result.publishedVersionId)
    )
      throw new Error("作品尚未公开或已下架");
    work.value = result;
    version.value = selected;
  } catch (cause) {
    if (seq === generation)
      error.value = workshopError(cause, "作品暂时无法打开");
  } finally {
    if (seq === generation) loading.value = false;
  }
}
function launch() {
  if (version.value) runtimeUrl.value = "active";
}
function runtimeError(message: string) {
  stop();
  error.value = message;
}
async function enterFullscreen() {
  try {
    await stageEl.value?.requestFullscreen();
  } catch {
    error.value = "当前浏览器不支持全屏，可以继续在页面内使用。";
  }
}
watch([workId, previewId, () => auth.sessionVersion], load, {
  immediate: true,
});
</script>

<style scoped>
.player-intro {
  padding: 24px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}
.player-description {
  margin: 0 0 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.player-storage {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.player-stage {
  width: 100%;
  min-height: 480px;
  height: min(78dvh, 900px);
  overflow: hidden;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
}
.player-stage.is-game {
  background: #141c1e;
}
.player-stage.has-aspect {
  position: relative;
  max-width: calc(min(78dvh, 900px) * var(--workshop-ratio));
  min-height: 0;
  height: auto;
  margin-inline: auto;
  aspect-ratio: var(--workshop-ratio);
}
.player-stage.has-aspect :deep(.workshop-runtime) {
  position: absolute;
  inset: 0;
}
.player-stage:fullscreen {
  height: 100dvh;
  border: 0;
  border-radius: 0;
}
.player-stage.has-aspect:fullscreen {
  width: 100%;
  max-width: none;
  height: 100dvh;
  aspect-ratio: auto;
}
@media (max-width: 640px) {
  .player-stage {
    min-height: 420px;
    height: 76dvh;
  }
  .player-intro {
    padding: 18px;
  }
}
</style>
