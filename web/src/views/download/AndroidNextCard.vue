<template>
  <section v-if="next && !insideNext" class="next-card" aria-labelledby="next-card-title">
    <div class="next-head">
      <h2 id="next-card-title" class="next-title">药大拾间 NEXT</h2>
      <span class="next-badge">测试版 {{ next.versionName }}</span>
    </div>
    <p class="next-lead">
      独立的测试版应用：可以自己组装的导航栏和工作台、能连网页一起换色的主题，以及只下载变化部分的增量更新。
    </p>
    <ul v-if="next.notes.length" class="next-notes">
      <li v-for="note in next.notes.slice(0, 5)" :key="note">{{ note }}</li>
    </ul>
    <p class="next-hint">
      和正式版是两个应用，可以同时安装，需要单独登录；不想用了直接卸载，正式版不受影响。
    </p>
    <a class="next-action" :href="NEXT_DOWNLOAD_URL" rel="nofollow">下载药大拾间 NEXT</a>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { canInstallAndroidApk, isAndroidNativeApp, isAndroidNextApp } from "@/utils/clientInfo";

/**
 * Invitation to 药大拾间 NEXT, the separate Android test app, once it is
 * published. Its APK comes from the enterprise drive like every APK; inside
 * NEXT itself the card is hidden.
 */
const NEXT_DOWNLOAD_URL = "/api/site/downloads/android-next-app";

type NextBuild = { versionCode: number; versionName: string; notes: string[] };
const next = ref<NextBuild | null>(null);
const insideNext = isAndroidNextApp();

onMounted(async () => {
  if (insideNext || (!isAndroidNativeApp() && !canInstallAndroidApk())) return;
  try {
    const response = await fetch("/api/site/downloads/android", { cache: "no-store" });
    const value = (await response.json())?.data?.next;
    if (value && Number.isSafeInteger(value.versionCode) && typeof value.versionName === "string" && /^\d+\.\d+\.\d+$/.test(value.versionName)) {
      next.value = {
        versionCode: value.versionCode,
        versionName: value.versionName,
        notes: Array.isArray(value.notes) ? value.notes.filter((note: unknown) => typeof note === "string" && note.trim()) : [],
      };
    }
  } catch { /* the invitation is optional */ }
});
</script>

<style scoped>
.next-card {
  margin: 16px 0 0;
  padding: 16px;
  border-radius: var(--cpu-radius-l);
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-card));
  color: var(--cpu-text);
}

.next-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.next-title {
  margin: 0;
  font-size: var(--cpu-fs-l);
  font-weight: 650;
}

.next-badge {
  padding: 1px 8px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
  font-size: var(--cpu-fs-xs);
  font-weight: 600;
}

.next-lead,
.next-hint {
  margin: 8px 0 0;
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}

.next-hint {
  color: var(--cpu-text-secondary);
}

.next-notes {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}

.next-action {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  margin-top: 12px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
</style>
