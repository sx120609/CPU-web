<template>
  <div class="campus3d-page">
    <div ref="hostEl" class="campus3d-host" />
    <p v-if="failed" class="campus3d-error" role="alert">{{ failed }}</p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import styleText from "./campus3d/style.css?inline";

const hostEl = ref<HTMLDivElement | null>(null);
const failed = ref("");
let dispose: (() => void) | null = null;
let themeObserver: MutationObserver | null = null;
let unmounted = false;

function syncTheme(host: HTMLElement) {
  host.dataset.theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
}

onMounted(async () => {
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
    dispose = mountCampus3D(shadow, { emblemUrl, calliUrl, data, outer });
  } catch (error) {
    console.error("[campus3d]", error);
    if (!unmounted) failed.value = "三维校园加载失败，请刷新页面重试。";
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  themeObserver?.disconnect();
  themeObserver = null;
  dispose?.();
  dispose = null;
});
</script>

<style scoped>
.campus3d-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
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
  color: var(--cpu-text-secondary);
  font-size: 14px;
}
</style>
