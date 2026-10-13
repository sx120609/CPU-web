<template>
  <el-button
    v-if="allowed && dialogPlacement && !blocked && !opened"
    class="extension-entry"
    @click="open(dialogPlacement)"
    >站点扩展</el-button
  >
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
        <span>{{ opened.version.name }} · 站点扩展</span
        ><el-button @click="close"
          >{{ opened.slot === "splash" ? "跳过，继续浏览" : "关闭" }} ·
          {{ remaining }}s</el-button
        >
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
  left: 18px;
  bottom: 28px;
  z-index: 1000;
  box-shadow: var(--cpu-shadow-card);
}
:global(html[data-cpu-web-tabbar] .extension-entry) {
  bottom: calc(var(--cpu-web-tabbar-reserve, 56px) + 28px);
}
.extension-overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.45);
  z-index: 4000;
  display: grid;
  place-items: center;
  padding: 18px;
}
.extension-panel {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  height: min(740px, 85dvh);
  background: var(--cpu-card);
  border-radius: var(--cpu-radius-l);
  overflow: hidden;
}
.extension-panel header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  flex-shrink: 0;
  color: var(--cpu-text);
}
.extension-panel .workshop-runtime {
  flex: 1;
}
.extension-panel.splash {
  width: min(960px, 100%);
}
</style>
