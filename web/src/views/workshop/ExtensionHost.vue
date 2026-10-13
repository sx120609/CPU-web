<template>
  <button
    v-if="allowed && dialogPlacement && !blocked && !opened"
    type="button"
    class="extension-entry"
    @click="open(dialogPlacement)"
  >
    {{ dialogPlacement.version.name }}
  </button>
  <div
    v-if="opened"
    class="extension-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="opened.version.name"
  >
    <section
      class="extension-panel"
      :class="{ splash: opened.slot === 'splash' }"
    >
      <header>
        <span class="extension-name">
          <b>{{ opened.version.name }}</b>
          <small>来自创意工坊的扩展</small>
        </span>
        <el-button size="small" @click="close">{{ opened.slot === "splash" ? "跳过" : "关闭" }} {{ remaining }}s</el-button>
      </header>
      <WorkshopRuntime
        :key="opened.version.id"
        :work-id="opened.workId"
        :version="opened.version"
        :slot="opened.slot"
        @close="close"
        @error="close"
      />
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { workshopApi, type WorkshopPlacement } from "@/api/workshop";
import WorkshopRuntime from "./WorkshopRuntime.vue";
const props = defineProps<{ blocked: boolean }>(),
  route = useRoute(),
  auth = useAuthStore();
const allowed = computed(() =>
  [
    "/home",
    "/services",
    "/services/tools",
    "/services/tools/games",
    "/workshop",
    "/workshop/develop",
  ].includes(route.path),
);
const placements = ref<WorkshopPlacement[]>([]),
  opened = ref<WorkshopPlacement | null>(null),
  remaining = ref(0);
const dialogPlacement = computed(() =>
  placements.value.find((p) => p.slot === "dialog"),
);
let deadline = 0,
  seq = 0,
  seen = false,
  poll: ReturnType<typeof setInterval> | undefined,
  tick: ReturnType<typeof setInterval> | undefined;
try {
  seen = sessionStorage.getItem("cpu-workshop:splash-seen") === "1";
} catch {
  seen = true;
}
function close() {
  seq++;
  opened.value = null;
  clearInterval(tick);
}
function importantDialogVisible() {
  return [...document.querySelectorAll<HTMLElement>(".el-overlay")].some(
    (el) =>
      getComputedStyle(el).display !== "none" &&
      el.getBoundingClientRect().height > 0,
  );
}
function open(item: WorkshopPlacement) {
  if (
    !allowed.value ||
    props.blocked ||
    document.hidden ||
    importantDialogVisible()
  )
    return;
  close();
  opened.value = item;
  deadline =
    Date.now() +
    Math.min(item.maxDurationSeconds, item.slot === "splash" ? 15 : 120) * 1000;
  remaining.value = Math.ceil((deadline - Date.now()) / 1000);
  tick = setInterval(() => {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining.value === 0) close();
  }, 250);
}
function maybeSplash() {
  if (
    seen ||
    !allowed.value ||
    props.blocked ||
    document.hidden ||
    importantDialogVisible()
  )
    return;
  const item = placements.value.find((p) => p.slot === "splash");
  if (!item) return;
  seen = true;
  try {
    sessionStorage.setItem("cpu-workshop:splash-seen", "1");
  } catch {
    /* 内存标记仍限制本次打开 */
  }
  open(item);
}
async function refresh() {
  if (!allowed.value) {
    placements.value = [];
    return;
  }
  const requestSeq = seq;
  try {
    const data = await workshopApi.placements();
    if (requestSeq !== seq) return;
    placements.value = data.items;
    if (
      opened.value &&
      !data.items.some(
        (p) =>
          p.slot === opened.value?.slot &&
          p.version.id === opened.value?.version.id,
      )
    )
      close();
    maybeSplash();
  } catch {
    /* 扩展加载失败不阻塞页面 */
  }
}
function visibility() {
  if (!document.hidden) void refresh();
}
watch(
  () => route.fullPath,
  () => {
    close();
    void refresh();
  },
);
watch(
  () => auth.sessionVersion,
  () => {
    close();
    void refresh();
  },
);
watch(
  () => props.blocked,
  (blocked) => {
    if (blocked) close();
    else maybeSplash();
  },
);
onMounted(() => {
  void refresh();
  poll = setInterval(() => {
    if (!document.hidden) void refresh();
  }, 30000);
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  close();
  clearInterval(poll);
  document.removeEventListener("visibilitychange", visibility);
});
</script>
<style scoped>
.extension-entry {
  position: fixed;
  bottom: 28px;
  left: 18px;
  z-index: 1000;
  max-width: 180px;
  min-height: 36px;
  padding: 0 14px;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-float);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
:global(html[data-cpu-web-tabbar] .extension-entry) {
  bottom: calc(var(--cpu-web-tabbar-reserve, 56px) + 28px);
}
.extension-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 0.5);
}
.extension-panel {
  display: flex;
  width: min(720px, 100%);
  height: min(740px, 85dvh);
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}
.extension-panel header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text);
}
.extension-name { display: flex; min-width: 0; flex-direction: column; line-height: 1.35; }
.extension-name b {
  overflow: hidden;
  font-size: var(--cpu-fs-m);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.extension-name small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.extension-panel .workshop-runtime { flex: 1; }
.extension-panel.splash { width: min(960px, 100%); }
</style>
