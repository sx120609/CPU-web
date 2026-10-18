<template>
  <section v-if="next" class="next-card" aria-labelledby="next-card-title">
    <div class="next-head">
      <h2 id="next-card-title" class="next-title">药大拾间 NEXT</h2>
      <span class="next-badge">测试版 {{ next.versionName }}</span>
    </div>
    <p class="next-lead">
      先于正式版拿到新功能：可以自己组装的导航栏和工作台、能连网页一起换色的主题，以及只下载变化部分的增量更新。
    </p>
    <ul v-if="next.notes.length" class="next-notes">
      <li v-for="note in next.notes.slice(0, 5)" :key="note">{{ note }}</li>
    </ul>
    <p class="next-hint">{{ hint }}</p>
    <a v-if="!nativeUpdater" class="next-action" :href="BETA_DOWNLOAD_URL" rel="nofollow">下载测试版</a>
    <button v-else type="button" class="next-action" @click="openNativeUpdater">打开测试通道设置</button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { canInstallAndroidApk, isAndroidNativeApp } from "@/utils/clientInfo";

/**
 * Invitation to the Android test channel while a NEXT build is newer than the
 * release. Clients up to V59 have no channel switch, so they install the test
 * build here (from the enterprise drive, like every APK); V60 and later join in
 * the app's own settings.
 */
const BETA_DOWNLOAD_URL = "/api/site/downloads/android-app?channel=beta";

type NextBuild = { versionCode: number; versionName: string; notes: string[] };
const next = ref<NextBuild | null>(null);

const bridge = () => (window as any).CPUAndroid as { supportsNativeUpdater?: () => boolean; openNativeUpdater?: () => void } | undefined;
const nativeUpdater = computed(() => {
  try { return isAndroidNativeApp() && bridge()?.supportsNativeUpdater?.() === true; } catch { return false; }
});
const hint = computed(() => nativeUpdater.value
  ? "在拾间里打开“设置 → 更新与测试通道”，点“加入药大拾间 NEXT”。随时可以退出。"
  : "覆盖安装，账号和课表都会保留。之后可在“设置 → 更新与测试通道”退出；退出后保留当前版本，等正式版追上后自动回到正式通道。");

function openNativeUpdater() {
  try { bridge()?.openNativeUpdater?.(); } catch { /* older shell */ }
}

onMounted(async () => {
  if (!isAndroidNativeApp() && !canInstallAndroidApk()) return;
  try {
    const response = await fetch("/api/site/downloads/android", { cache: "no-store" });
    const value = (await response.json())?.data?.beta;
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
