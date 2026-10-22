<template>
  <div class="campus3d-page">
    <div ref="hostEl" class="campus3d-host" />
    <p v-if="failed" class="campus3d-error" role="alert">{{ failed }}</p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import styleText from "./campus3d/style.css?inline";
import { request } from "@/api/request";

const router = useRouter();
const hostEl = ref<HTMLDivElement | null>(null);
const failed = ref("");
let dispose: (() => void) | null = null;
let themeObserver: MutationObserver | null = null;
let unmounted = false;

// 联机：自由探索时每 ~250 ms 同步一次位置。走站点自己的请求封装（登录态、CSRF），失败不弹提示，
// 也不让高频的同步请求把页面其他接口的缓存标成过期。
type PresenceState = { sid: string; key: string };
const quiet = { suppressErrorMessage: true, preserveResponseCache: true };
const presence = {
  join: () => request.post<{ sid: string; key: string; pid: string; name: string }>("/tools/campus-3d/presence/join", {}, quiet),
  sync: (body: PresenceState & { s: number[]; h?: boolean }) =>
    request.post<{ t: number; n: number; p: Array<[string, string, number, number, number, number, number, number, number]> }>("/tools/campus-3d/presence/sync", body, quiet),
  leave: (body: PresenceState) => request.post("/tools/campus-3d/presence/leave", body, quiet).catch(() => undefined),
};

function syncTheme(host: HTMLElement) {
  host.dataset.theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function leave() {
  if (window.history.state?.back) router.back();
  else void router.push({ name: "service-tool-detail", params: { slug: "school_calendar" } });
}

onMounted(async () => {
  document.documentElement.classList.add("campus3d-open");
  const host = hostEl.value;
  if (!host) return;
  syncTheme(host);
  themeObserver = new MutationObserver(() => syncTheme(host));
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styleText;
  shadow.replaceChildren(style);

  try {
    const [{ emblemUrl, calliUrl }, { buildCampusUI }, { mountCampus3D }, data, outer] = await Promise.all([
      import("./campus3d/images.js"),
      import("./campus3d/ui.js"),
      import("./campus3d/app.js"),
      import("./campus3d/osm-data.json").then((m) => m.default),
      import("./campus3d/osm-outer.json").then((m) => m.default),
    ]);
    if (unmounted) return;
    host.style.setProperty("--wm", `url("${calliUrl}")`);
    buildCampusUI(shadow, { emblemUrl });
    const back = shadow.querySelector<HTMLButtonElement>("#m-back");
    if (back) {
      back.hidden = false;
      back.addEventListener("click", leave);
    }
    dispose = mountCampus3D(shadow, { emblemUrl, calliUrl, data, outer, presence });
  } catch (error) {
    console.error("[campus3d]", error);
    if (!unmounted) failed.value = "三维校园加载失败，请返回后重试。";
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  document.documentElement.classList.remove("campus3d-open");
  themeObserver?.disconnect();
  themeObserver = null;
  dispose?.();
  dispose = null;
});
</script>

<style scoped>
:global(html.campus3d-open),
:global(html.campus3d-open body) {
  overflow: hidden !important;
  overscroll-behavior: none;
}

/* 全屏地图盖住站点顶栏和底栏。鸿蒙壳不提供 safe-area，只给“底栏 + 手势条 + 间距”的总和；
   这里没有底栏，减掉底栏的 72 就是手势条要让开的高度。 */
.campus3d-page {
  --safe-b: max(env(safe-area-inset-bottom, 0px), calc(var(--cpu-harmony-bottom-clearance, 72px) - 72px));
  position: fixed;
  inset: 0;
  z-index: 5000;
  overflow: hidden;
  background: #b9c9d6;
}

.campus3d-host {
  position: absolute;
  inset: 0;
}

.campus3d-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: #1d1d1f;
  font-size: 14px;
}
</style>
