<template>
  <div ref="stage" class="workshop-runtime">
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!url" role="status">正在打开作品…</p>
    <iframe
      v-if="url"
      ref="frame"
      :src="url"
      :title="version.name"
      sandbox="allow-scripts"
      allow="
        camera 'none';
        microphone 'none';
        geolocation 'none';
        payment 'none';
        clipboard-read 'none';
        clipboard-write 'none';
        accelerometer 'none';
        gyroscope 'none';
        magnetometer 'none';
      "
      referrerpolicy="no-referrer"
    />
    <div v-if="fullscreen" class="runtime-fullscreen-controls">
      <el-button @click="exitFullscreen">退出全屏</el-button
      ><el-button @click="emit('close')">关闭作品</el-button>
    </div>
    <p v-if="connectionHint" class="runtime-status" role="status">
      {{ connectionHint }}
    </p>
    <div
      v-if="pending"
      class="runtime-consent"
      role="dialog"
      aria-modal="true"
      :aria-label="consentTitle"
    >
      <p>
        来自作品「{{ version.name }}」的请求：{{ consentTitle }}：{{
          consentMessage
        }}
      </p>
      <el-button @click="finishConsent(false)">取消</el-button
      ><el-button type="primary" @click="grantConsent">{{
        pending === "motion"
          ? "启用摇一摇"
          : pending === "fullscreen"
            ? "进入全屏"
            : "同意"
      }}</el-button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import {
  workshopApi,
  type WorkshopVersion,
  type WorkshopStorage,
} from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import { useAppearanceStore } from "@/stores/appearance";
import {
  createWorkshopBridge,
  serializeWorkshopSave,
  type WorkshopCapabilityResult,
} from "@/utils/workshopBridge";
import { workshopError } from "./shared";
const props = withDefaults(
  defineProps<{
    workId: string;
    version: WorkshopVersion;
    preview?: boolean;
    slot?: "page" | "splash" | "dialog";
  }>(),
  { preview: false, slot: "page" },
);
const emit = defineEmits<{ close: []; ready: []; error: [message: string] }>();
const auth = useAuthStore(),
  appearance = useAppearanceStore(),
  router = useRouter();
const stage = ref<HTMLElement>(),
  frame = ref<HTMLIFrameElement>(),
  url = ref(""),
  error = ref("");
const pending = ref<"motion" | "fullscreen" | "confirm" | "navigation" | null>(
  null,
);
const consentTitle = ref(""),
  consentMessage = ref(""),
  fullscreen = ref(false),
  connectionHint = ref("");
let consentTimer: ReturnType<typeof setTimeout> | undefined,
  connectionTimer: ReturnType<typeof setTimeout> | undefined;
let consent: ((result: WorkshopCapabilityResult) => void) | undefined;
let bridge: ReturnType<typeof createWorkshopBridge> | undefined,
  generation = 0,
  timer: ReturnType<typeof setInterval> | undefined;
let shakeEnabled = false,
  lastShake = 0,
  lastVector: number[] | undefined;
let sizeObserver: ResizeObserver | undefined;
const motionSupported = () =>
  window.isSecureContext && "DeviceMotionEvent" in window;
function finishConsent(enabled: boolean, reason = "用户取消") {
  clearTimeout(consentTimer);
  pending.value = null;
  consent?.({ enabled, ...(!enabled ? { reason } : {}) });
  consent = undefined;
}
function requestConsent(
  kind: "motion" | "fullscreen" | "confirm" | "navigation",
  title = "",
  message = "",
): Promise<WorkshopCapabilityResult> {
  if (kind === "motion" && !motionSupported()) {
    ElMessage.info("当前浏览器无法使用摇一摇");
    return Promise.resolve({
      enabled: false,
      reason: "当前浏览器不支持或连接不安全",
    });
  }
  if (pending.value)
    return Promise.resolve({ enabled: false, reason: "已有待确认请求" });
  pending.value = kind;
  consentTitle.value = title || (kind === "motion" ? "摇一摇授权" : "全屏请求");
  consentMessage.value =
    message ||
    (kind === "motion"
      ? "仅传递摇动提示，不提供原始传感器数据。"
      : "进入全屏显示。");
  consentTimer = setTimeout(() => finishConsent(false, "确认已超时"), 30000);
  return new Promise((resolve) => {
    consent = resolve;
  });
}
async function grantConsent() {
  const kind = pending.value,
    seq = generation;
  try {
    if (kind === "confirm" || kind === "navigation") {
      finishConsent(true);
      return;
    }
    if (kind === "fullscreen") {
      await stage.value?.requestFullscreen();
      if (seq === generation)
        finishConsent(Boolean(document.fullscreenElement), "全屏不可用");
    }
    if (kind === "motion") {
      const motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
        requestPermission?: () => Promise<string>;
      };
      const result = motion.requestPermission
        ? await motion.requestPermission()
        : "granted";
      if (seq !== generation) return;
      shakeEnabled = result === "granted";
      syncMotion();
      finishConsent(shakeEnabled, "未获得摇一摇授权");
      if (!shakeEnabled) ElMessage.info("未启用摇一摇，可以继续使用作品");
    }
  } catch {
    if (seq === generation) {
      finishConsent(false, "浏览器拒绝请求");
      ElMessage.info("浏览器未允许此操作，可以继续使用作品");
    }
  }
}
function motion(event: DeviceMotionEvent) {
  const a = event.accelerationIncludingGravity;
  if (!a || a.x === null || a.y === null || a.z === null) return;
  const v = [a.x, a.y, a.z];
  const previous = lastVector;
  lastVector = v;
  if (
    previous &&
    Math.hypot(...v.map((n, i) => n - previous[i]!)) > 18 &&
    Date.now() - lastShake > 1200
  ) {
    lastShake = Date.now();
    bridge?.notify("shake", {});
  }
}
function syncMotion() {
  window.removeEventListener("devicemotion", motion);
  lastVector = undefined;
  if (shakeEnabled && !document.hidden && url.value)
    window.addEventListener("devicemotion", motion);
}
function stop() {
  generation++;
  if (
    document.fullscreenElement &&
    stage.value &&
    (stage.value.contains(document.fullscreenElement) ||
      document.fullscreenElement.contains(stage.value))
  )
    void document.exitFullscreen().catch(() => {});
  bridge?.notify("hide", "close");
  bridge?.notify("pause", "close");
  bridge?.dispose();
  bridge = undefined;
  clearInterval(timer);
  clearTimeout(connectionTimer);
  connectionHint.value = "";
  shakeEnabled = false;
  url.value = "";
  syncMotion();
  finishConsent(false, "作品已关闭");
}
async function checkAvailability() {
  if (props.preview || !url.value) return;
  const seq = generation;
  try {
    const current = await workshopApi.detail(props.workId);
    if (
      seq === generation &&
      (current.disabled || current.publishedVersionId !== props.version.id)
    ) {
      stop();
      emit("close");
    }
  } catch (cause) {
    const status = (cause as { response?: { status?: number } })?.response
      ?.status;
    if (seq === generation && (status === 403 || status === 404)) {
      stop();
      emit("close");
    }
  }
}
async function start() {
  stop();
  error.value = "";
  const seq = generation,
    selected = props.version,
    id = props.workId,
    userId = auth.user?.id,
    cloud = Boolean(userId) && !props.preview;
  const localKey = `cpu-workshop:save:${userId || "guest"}:${id}${props.preview ? `:preview:${selected.id}` : ""}`;
  try {
    const ticket = props.preview
      ? await workshopApi.preview(selected.id)
      : await workshopApi.play(id);
    if (seq !== generation) return;
    if (ticket.versionId !== selected.id)
      throw new Error("作品版本已更新，请重新打开");
    const target = new URL(ticket.url, location.origin);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      !target.pathname.startsWith("/api/workshop-runtime/")
    )
      throw new Error("作品运行地址无效");
    url.value = target.href;
    await nextTick();
    if (seq !== generation || !frame.value) return;
    bridge = createWorkshopBridge({
      frame: frame.value,
      appId: id,
      permissions: selected.manifest.permissions || [],
      environment: () => ({
        name: selected.name,
        type: selected.type,
        version: selected.version,
        theme: appearance.isDark ? "dark" : "light",
        locale: "zh-CN",
        slot: props.slot,
        viewport: {
          width: stage.value?.clientWidth || 0,
          height: stage.value?.clientHeight || 0,
        },
        capabilities: selected.manifest.permissions || [],
        motionSupported: motionSupported(),
        storageAvailable:
          selected.manifest.permissions?.includes("storage") || false,
        storageScope: props.preview ? "preview" : cloud ? "account" : "browser",
        game: selected.manifest.game,
      }),
      storage: {
        async get() {
          if (cloud)
            return (await workshopApi.getStorage(id, selected.id)).data;
          const value = localStorage.getItem(localKey);
          return value ? JSON.parse(value) : null;
        },
        async set(value) {
          if (cloud) {
            await workshopApi.setStorage(
              id,
              selected.id,
              value as WorkshopStorage,
            );
            return;
          }
          localStorage.setItem(localKey, serializeWorkshopSave(value));
        },
        async remove() {
          if (cloud) {
            await workshopApi.deleteStorage(id, selected.id);
            return;
          }
          localStorage.removeItem(localKey);
        },
      },
      handlers: {
        getSiteInfo: () => workshopApi.publicSite(),
        listWorks: (params) => workshopApi.publicCatalog(params),
        toast: (params) => {
          ElMessage({
            message: `来自「${selected.name}」：${params.message}`,
            type: params.type || "info",
            dangerouslyUseHTMLString: false,
          });
        },
        async confirm(params) {
          if (seq !== generation) return { confirmed: false };
          const result = await requestConsent(
            "confirm",
            params.title,
            params.message,
          );
          return { confirmed: result.enabled && seq === generation };
        },
        async navigate(target) {
          if (seq !== generation) return;
          const destinations = {
            workshop: "/workshop",
            games: "/services/tools/games",
            tools: "/services/tools",
          };
          const result = await requestConsent(
            "navigation",
            "页面跳转",
            `打开${{ workshop: "创意工坊", games: "游戏", tools: "工具" }[target]}页面。`,
          );
          if (result.enabled && seq === generation)
            await router.push(destinations[target]);
        },
        requestFullscreen: () =>
          seq === generation
            ? requestConsent("fullscreen")
            : Promise.resolve({ enabled: false, reason: "作品已关闭" }),
        requestShake: () =>
          seq === generation
            ? requestConsent("motion")
            : Promise.resolve({ enabled: false, reason: "作品已关闭" }),
        close: () => {
          if (seq === generation) emit("close");
        },
      },
      onReady() {
        clearTimeout(connectionTimer);
        connectionHint.value = "";
        emit("ready");
        bridge?.notify(document.hidden ? "hide" : "show", "launch");
      },
    });
    connectionTimer = setTimeout(() => {
      if (seq === generation) {
        connectionHint.value = "作品连接超时，请关闭后重试。";
        emit("error", connectionHint.value);
      }
    }, 10000);
    if (!props.preview)
      timer = setInterval(() => void checkAvailability(), 30000);
  } catch (cause) {
    if (seq === generation) {
      stop();
      error.value = workshopError(cause, "作品启动失败");
      emit("error", error.value);
    }
  }
}
function fullscreenChanged() {
  fullscreen.value = Boolean(
    document.fullscreenElement &&
    (document.fullscreenElement === stage.value ||
      document.fullscreenElement.contains(stage.value || null)),
  );
}
function exitFullscreen() {
  void document.exitFullscreen().catch(() => {});
}
function visibility() {
  bridge?.notify(document.hidden ? "hide" : "show", "visibility");
  bridge?.notify(document.hidden ? "pause" : "resume", "visibility");
  syncMotion();
  if (!document.hidden) void checkAvailability();
}
function resize() {
  bridge?.notify("resize", {
    width: stage.value?.clientWidth || 0,
    height: stage.value?.clientHeight || 0,
  });
}
watch(
  () => appearance.isDark,
  () =>
    bridge?.notify("themechange", {
      theme: appearance.isDark ? "dark" : "light",
    }),
);
watch(
  () => auth.sessionVersion,
  () => {
    stop();
    emit("close");
  },
);
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    sizeObserver = new ResizeObserver(resize);
    if (stage.value) sizeObserver.observe(stage.value);
  }
  void start();
  document.addEventListener("fullscreenchange", fullscreenChanged);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", resize);
});
onBeforeUnmount(() => {
  sizeObserver?.disconnect();
  stop();
  document.removeEventListener("fullscreenchange", fullscreenChanged);
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("resize", resize);
});
defineExpose({ stop, enterFullscreen: () => stage.value?.requestFullscreen() });
</script>
<style scoped>
.workshop-runtime {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.workshop-runtime iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.runtime-consent {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  padding: 24px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  z-index: 2;
}
.runtime-consent p {
  flex-basis: 100%;
  text-align: center;
}
.runtime-fullscreen-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  display: flex;
  gap: 8px;
}
.runtime-status {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: var(--cpu-card);
}
.workshop-runtime:fullscreen {
  background: var(--cpu-card);
}
</style>
