<template>
  <!--
    原生 App 里的宿舍课表页。界面就是课表页的宿舍弹窗（DormDialog），这里把它铺在页面里：
    不留遮罩、不锁滚动，原生壳也不把它当成盖住整屏的网页弹窗（data-cpu-inline-dialog），
    所以原生顶栏、底栏和返回都照常工作。
  -->
  <main class="dorm-schedule-page" :class="{ 'own-header': ownHeader }" :style="pageStyle" data-cpu-inline-dialog>
    <div ref="host" class="dorm-schedule-host" />
    <DormDialog
      v-if="host"
      :model-value="open"
      :page-style="pageStyle"
      :initial-code="code"
      :sync-now="syncNow"
      :sync-version="syncVersion"
      :append-to="host"
      :modal="false"
      :lock-scroll="false"
      :show-close="ownHeader"
      modal-class="dorm-schedule-overlay"
      class="dorm-schedule-sheet"
      @update:model-value="onToggle"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { normalizeScheduleTheme, scheduleThemeCssVars, scheduleThemeDarkCssVars } from "@/components/jwxt/scheduleTheme";
import { useAppearanceStore } from "@/stores/appearance";
import { isIosNativeApp } from "@/utils/clientInfo";
import { normalizeDormInviteCode } from "@/utils/dormScheduleRoute";
import { nativeDormSync } from "@/utils/nativeDormBridge";
import DormDialog from "@/views/schedule/DormDialog.vue";
import type { DormSyncNowOptions } from "@/views/schedule/dormSync";
import { SCHEDULE_THEME_STORAGE_KEY, scheduleSurfaceCssVars } from "@/views/schedule/pageVars";
import { readStoredScheduleStyle, rgbToCss, scheduleStyleCanvas, scheduleStyleCssVars } from "@/views/schedule/scheduleStyle";

const route = useRoute();
const router = useRouter();
const appearance = useAppearanceStore();

const host = ref<HTMLElement | null>(null);
const open = ref(false);
const syncVersion = ref(0);
const code = computed(() => normalizeDormInviteCode(route.query.code));
// 安卓和鸿蒙的原生顶栏带标题和返回；iOS 的原生顶栏没有返回，保留弹窗自己的标题栏和关闭按钮。
const ownHeader = isIosNativeApp();

const visualStyle = readStoredScheduleStyle();
const palette = normalizeScheduleTheme(readStoredTheme());

function readStoredTheme() {
  try {
    return localStorage.getItem(SCHEDULE_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

const pageStyle = computed(() => {
  const canvas = scheduleStyleCanvas(visualStyle, appearance.isDark);
  return {
    ...scheduleThemeCssVars(palette),
    ...(appearance.isDark ? scheduleThemeDarkCssVars(palette) : {}),
    ...scheduleSurfaceCssVars({ dark: appearance.isDark }),
    ...(canvas ? { "--schedule-page-bg": rgbToCss(canvas) } : {}),
    ...scheduleStyleCssVars({ style: visualStyle, palette, dark: appearance.isDark }),
  };
});

/** 宿舍弹窗的“立即同步”：上传原生交来的本学期课表（含本机修改）。 */
function syncNow(options?: DormSyncNowOptions) {
  return nativeDormSync().then((sync) => sync.syncNow(options));
}

let disposed = false;
let stopSynced: (() => void) | null = null;

/** 关掉宿舍课表就是回到原生课表；网页这一页留着，下次回到网页时宿舍课表仍在。 */
async function onToggle(value: boolean) {
  open.value = value;
  if (value) return;
  await router.replace("/schedule").catch(() => undefined);
  await nextTick();
  if (!disposed && route.name === "dorm-schedule") open.value = true;
}

onMounted(async () => {
  // 弹窗要在挂载后再打开，才会触发它的 open 事件去加载宿舍状态。
  await nextTick();
  if (disposed) return;
  open.value = true;
  const sync = await nativeDormSync();
  if (disposed) return;
  // 原生课表在后台交来新课表并上传成功后，页面跟着刷新室友视图和“同步于”。
  stopSynced = sync.onSynced(() => { syncVersion.value += 1; });
});

onBeforeUnmount(() => {
  disposed = true;
  stopSynced?.();
});
</script>

<style scoped>
.dorm-schedule-page {
  min-height: 100%;
  padding: 0 0 calc(16px + env(safe-area-inset-bottom, 0px));
  background: var(--schedule-surface-bg, var(--cpu-card));
  color: var(--schedule-text, var(--cpu-text));
}

/* DormDialog 本来是居中弹窗；这里让它的外层回到文档流里，像普通页面一样随页面滚动。 */
.dorm-schedule-page :deep(.dorm-schedule-overlay),
.dorm-schedule-page :deep(.dorm-schedule-overlay .el-overlay-dialog) {
  position: static !important;
  inset: auto !important;
  z-index: auto !important;
  display: block;
  overflow: visible;
  background: none;
}

.dorm-schedule-page :deep(.el-dialog.dorm-schedule-sheet) {
  width: min(640px, 100%);
  max-width: 100%;
  margin: 0 auto;
  padding: 14px 16px 8px;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  color: var(--schedule-text, var(--cpu-text));
}

.dorm-schedule-page :deep(.dorm-schedule-sheet .el-dialog__title),
.dorm-schedule-page :deep(.dorm-schedule-sheet .el-dialog__body) {
  color: var(--schedule-text, var(--cpu-text));
}

.dorm-schedule-page :deep(.dorm-schedule-sheet .el-dialog__header) {
  background: transparent;
}

/* 原生顶栏已经写了“宿舍课表”并带返回，不再重复一行标题。 */
.dorm-schedule-page:not(.own-header) :deep(.dorm-schedule-sheet .el-dialog__header) {
  display: none;
}
</style>
