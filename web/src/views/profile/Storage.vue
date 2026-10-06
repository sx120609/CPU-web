<template>
  <main class="pk-page pk-page--narrow storage-page" :aria-busy="measuring || clearing">
    <header class="pk-head">
      <router-link v-if="auth.isLoggedIn" class="pk-back" to="/profile"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>我的</router-link>
      <div class="pk-title">
        <span class="pk-tile" style="--tone: #2563eb" aria-hidden="true"><el-icon><Coin /></el-icon></span>
        <div class="pk-title-copy">
          <h1>存储与缓存</h1>
          <p>清理不会退出登录，也不会删除草稿和个人设置</p>
        </div>
      </div>
    </header>

    <section class="pk-card storage-summary" aria-label="缓存占用">
      <p class="storage-summary-label">可清理的缓存</p>
      <p class="storage-summary-value" role="status">
        <strong>{{ measuring && !cleanableBytes ? "计算中…" : formatBytes(cleanableBytes) }}</strong>
        <span v-if="appBytes !== null">应用数据共 {{ formatBytes(appBytes) }}</span>
      </p>
      <div class="storage-meter" aria-hidden="true">
        <i v-for="row in meterRows" :key="row.id" :style="{ '--tone': row.tone, flexGrow: row.bytes ?? 0 }"></i>
      </div>
      <ul class="storage-legend" aria-hidden="true">
        <li v-for="row in rows" :key="row.id" :style="{ '--tone': row.tone }"><i></i>{{ row.title }}</li>
      </ul>
    </section>

    <section class="pk-card pk-card--flush" aria-labelledby="storage-list-title">
      <header class="storage-list-head">
        <h2 id="storage-list-title" class="pk-h2">选择要清理的内容</h2>
        <button data-cpu-button="surface" type="button" class="pk-link storage-all" :disabled="clearing" @click="toggleAll">
          {{ allSelected ? "取消全选" : "全选" }}
        </button>
      </header>
      <ul class="pk-rows">
        <li v-for="row in rows" :key="row.id">
          <button
            data-cpu-button="surface"
            type="button"
            role="checkbox"
            class="pk-row storage-row"
            :style="{ '--tone': row.tone }"
            :aria-checked="row.selected"
            :disabled="clearing"
            @click="row.selected = !row.selected"
          >
            <span class="storage-check" :class="{ 'is-on': row.selected }" aria-hidden="true">
              <el-icon v-if="row.selected"><Check /></el-icon>
            </span>
            <span class="pk-tile pk-tile--sm" aria-hidden="true"><el-icon><component :is="row.icon" /></el-icon></span>
            <span class="pk-row-copy">
              <b>{{ row.title }}</b>
              <small>{{ row.description }}</small>
            </span>
            <span class="storage-size">{{ row.bytes === null ? "计算中…" : formatBytes(row.bytes) }}</span>
          </button>
        </li>
      </ul>
      <footer class="storage-actions">
        <p>{{ selectionHint }}</p>
        <button
          data-cpu-button="primary"
          type="button"
          class="storage-clear"
          :disabled="!canClear"
          @click="clearSelected"
        >{{ clearing ? "正在清理…" : "清理所选" }}</button>
      </footer>
    </section>

    <section class="pk-card pk-card--soft storage-kept">
      <h2 class="pk-h2">这些内容不会被清理</h2>
      <p class="pk-muted">登录状态、保存的教务账号、课表背景和自定义课程、未发布的草稿、外观设置。</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, markRaw, onMounted, reactive, ref, type Component } from "vue";
import { ArrowLeft, Box, Calendar, Check, Coin, Document, Files, Picture } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import "@/styles/page-kit.css";
import { invalidateResponseCache } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import {
  clearNativeStorage,
  clearWebStorage,
  formatBytes,
  hasNativeStorageBridge,
  measureNativeStorage,
  measureWebStorage,
  type NativeStorageCategoryId,
  type NativeStorageUsage,
  type StorageCategoryId,
  type WebStorageCategoryId,
} from "@/utils/storageCleanup";

type StorageRow = {
  id: StorageCategoryId;
  native: boolean;
  title: string;
  description: string;
  icon: Component;
  tone: string;
  /** null 表示还在统计。 */
  bytes: number | null;
  selected: boolean;
};

const auth = useAuthStore();
// 带原生桥的客户端才有“图片与网络缓存”“临时文件”两类；浏览器和旧版客户端只显示网页端能清的。
const nativeBridge = hasNativeStorageBridge();

const rows = reactive<StorageRow[]>(([
  {
    id: "offline",
    native: false,
    title: "离线资源",
    description: "页面脚本、样式和图标的离线副本，清理后会按需重新下载。",
    icon: Box,
    tone: "#2563eb",
    selected: true,
  },
  {
    id: "network",
    native: true,
    title: "图片与网络缓存",
    description: "浏览过的图片、头像等网络内容。",
    icon: Picture,
    tone: "#0f766e",
    selected: true,
  },
  {
    id: "pages",
    native: false,
    title: "页面数据缓存",
    description: "首页、论坛、服务等页面的数据快照，用来加快打开速度。",
    icon: Document,
    tone: "#7c3aed",
    selected: true,
  },
  {
    id: "temp",
    native: true,
    title: "临时文件",
    description: "分享、导出和上传时产生的临时文件。",
    icon: Files,
    tone: "#d97706",
    selected: true,
  },
  {
    id: "academic",
    native: false,
    title: "课表与教务缓存",
    description: "本机保存的课表和教务数据。清理后需联网重新获取，离线时暂时看不到课表。",
    icon: Calendar,
    tone: "#e11d48",
    selected: false,
  },
] satisfies Array<Omit<StorageRow, "bytes">>)
  .filter((row) => !row.native || nativeBridge)
  // 图标组件不需要响应式代理。
  .map((row) => ({ ...row, icon: markRaw(row.icon), bytes: null })));

const appBytes = ref<number | null>(null);
const measuring = ref(false);
const clearing = ref(false);

const selectedRows = computed(() => rows.filter((row) => row.selected));
const selectedBytes = computed(() => selectedRows.value.reduce((sum, row) => sum + (row.bytes ?? 0), 0));
const cleanableBytes = computed(() => rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0));
const meterRows = computed(() => rows.filter((row) => row.bytes));
const allSelected = computed(() => rows.every((row) => row.selected));
const selectionMeasured = computed(() => selectedRows.value.every((row) => row.bytes !== null));
const canClear = computed(() => !clearing.value && selectionMeasured.value && selectedBytes.value > 0);
const selectionHint = computed(() => {
  if (!selectedRows.value.length) return "请先选择要清理的内容";
  if (!selectionMeasured.value) return `已选 ${selectedRows.value.length} 项，正在计算大小…`;
  if (!selectedBytes.value) return "所选内容没有可清理的缓存";
  return `已选 ${selectedRows.value.length} 项，共 ${formatBytes(selectedBytes.value)}`;
});

function toggleAll() {
  const next = !allSelected.value;
  rows.forEach((row) => { row.selected = next; });
}

function applyNativeUsage(usage: NativeStorageUsage | null) {
  appBytes.value = usage?.totalBytes ?? null;
  for (const row of rows) {
    if (row.native) row.bytes = usage?.categories.find((item) => item.id === row.id)?.bytes ?? 0;
  }
}

async function measure(nativeUsage?: NativeStorageUsage | null) {
  measuring.value = true;
  try {
    await Promise.all([
      ...rows.filter((row) => !row.native).map(async (row) => {
        row.bytes = await measureWebStorage(row.id as WebStorageCategoryId);
      }),
      nativeBridge
        ? Promise.resolve(nativeUsage ?? measureNativeStorage()).then(applyNativeUsage)
        : Promise.resolve(),
    ]);
  } finally {
    measuring.value = false;
  }
}

async function clearSelected() {
  const targets = selectedRows.value.map((row) => row.id);
  if (!canClear.value) return;
  if (targets.includes("academic")) {
    try {
      await ElMessageBox.confirm(
        "课表与教务缓存清理后，需要联网才能重新看到课表和成绩等数据。确认继续？",
        "清理课表与教务缓存",
        { type: "warning", confirmButtonText: "继续清理", cancelButtonText: "取消" },
      );
    } catch {
      return;
    }
  }

  clearing.value = true;
  const before = cleanableBytes.value;
  let nativeUsage: NativeStorageUsage | null | undefined;
  let failed = false;
  try {
    for (const row of selectedRows.value.filter((item) => !item.native)) {
      try {
        await clearWebStorage(row.id as WebStorageCategoryId);
        if (row.id === "pages") invalidateResponseCache();
      } catch {
        failed = true;
      }
    }
    const nativeTargets = targets.filter((id): id is NativeStorageCategoryId => id === "network" || id === "temp");
    if (nativeTargets.length) {
      nativeUsage = await clearNativeStorage(nativeTargets);
      if (!nativeUsage) failed = true;
    }
    await measure(nativeUsage);
  } finally {
    clearing.value = false;
  }

  const freed = Math.max(0, before - cleanableBytes.value);
  if (failed) ElMessage.warning("部分内容未能清理，请稍后重试");
  else ElMessage.success(freed ? `已清理 ${formatBytes(freed)}` : "已清理");
}

onMounted(() => void measure());
</script>

<style scoped>
.storage-summary { display: flex; flex-direction: column; gap: 10px; }
.storage-summary p { margin: 0; }
.storage-summary-label { color: var(--cpu-text-secondary); font-size: 13px; }
.storage-summary-value { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.storage-summary-value strong { font-size: 32px; font-weight: 700; line-height: 1.2; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.storage-summary-value span { color: var(--cpu-text-muted); font-size: 13px; }

.storage-meter { display: flex; height: 10px; gap: 2px; overflow: hidden; border-radius: 999px; background: var(--cpu-surface-soft); }
.storage-meter i { min-width: 4px; flex: 0 0 0; background: var(--tone); }
.storage-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; padding: 0; color: var(--cpu-text-secondary); font-size: 12px; list-style: none; }
.storage-legend li { display: inline-flex; align-items: center; gap: 5px; }
.storage-legend i { width: 8px; height: 8px; border-radius: 3px; background: var(--tone); }

.storage-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 14px 6px; }
.storage-all { min-height: 30px; padding: 0 2px; border: 0; background: none; font: inherit; font-size: 13px; cursor: pointer; }
.storage-all:disabled,
.storage-row:disabled { cursor: default; opacity: .6; }

.storage-row { min-height: 68px; }
.storage-row .pk-row-copy small { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.55; }
.storage-check {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border: 1.5px solid var(--cpu-border);
  border-radius: 7px;
  background: var(--cpu-card);
  color: var(--cpu-button-on-primary, #fff);
  font-size: 14px;
}
.storage-check.is-on { border-color: var(--cpu-primary); background: var(--cpu-primary); }
.storage-size { flex: 0 0 auto; color: var(--cpu-text); font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }

.storage-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px 14px; border-top: 1px solid var(--cpu-border-soft); }
.storage-actions p { min-width: 0; margin: 0; color: var(--cpu-text-secondary); font-size: 13px; }
.storage-clear { min-width: 112px; min-height: 42px; flex: 0 0 auto; padding: 0 20px; border-radius: 12px !important; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.storage-clear:disabled { cursor: default; opacity: .5; }

.storage-kept .pk-muted { margin-top: 6px; }

@media (max-width: 560px) {
  .storage-summary-value strong { font-size: 28px; }
  .storage-actions { flex-direction: column; align-items: stretch; }
  .storage-clear { width: 100%; }
}
</style>
