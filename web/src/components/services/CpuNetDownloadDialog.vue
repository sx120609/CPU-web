<template>
  <el-dialog
    :model-value="modelValue"
    width="min(500px, calc(100vw - 32px))"
    align-center
    append-to-body
    :close-on-click-modal="true"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="dialog-heading">
        <el-icon class="dialog-icon" aria-hidden="true"><Monitor /></el-icon>
        <div>
          <strong>药大拾间桌面客户端</strong>
          <div class="dialog-badges">
            <span>Windows 10 / 11</span>
            <span>macOS M 芯片</span>
          </div>
        </div>
      </div>
    </template>

    <div class="download-intro">
      <p>校园网自动连接、学习通辅助与桌面常驻能力已经整合到药大拾间桌面客户端。</p>

      <div class="platform-picker" role="tablist" aria-label="选择桌面客户端平台">
        <button data-cpu-button="option"
          type="button"
          role="tab"
          :aria-selected="activePlatform === 'windows'"
          :class="{ active: activePlatform === 'windows' }"
          @click="activePlatform = 'windows'"
        >
          <strong>Windows</strong>
          <small>10 / 11 · 64 位</small>
        </button>
        <button data-cpu-button="option"
          type="button"
          role="tab"
          :aria-selected="activePlatform === 'macos'"
          :class="{ active: activePlatform === 'macos' }"
          @click="activePlatform = 'macos'"
        >
          <strong>macOS</strong>
          <small>Apple Silicon · M 芯片</small>
        </button>
      </div>

      <div class="package-card">
        <el-icon class="package-icon" aria-hidden="true"><Monitor /></el-icon>
        <div>
          <strong>{{ activePlatform === "windows" ? "Windows 客户端" : "macOS 客户端" }}</strong>
          <small v-if="currentDownload.available">
            {{ currentDownload.version ? `版本 ${currentDownload.version} · ` : "" }}
            {{ activePlatform === "windows" ? "64 位安装包" : "Apple Silicon DMG" }}
          </small>
          <small v-else>{{ loading ? "正在获取下载信息…" : "该平台安装包暂时不可用" }}</small>
        </div>
      </div>

      <div class="platform-notice">
        {{ activePlatform === "windows"
          ? "安装时若 Windows 提示“未知发布者”，点击“更多信息”后选择“仍要运行”。"
          : "首次打开若被系统拦截，请到“系统设置 → 隐私与安全性”中选择“仍要打开”。仅支持 M1 及后续 M 系列芯片。" }}
      </div>

      <p class="project-note">学生开发的校园工具，非学校官方软件。校园网功能不会在非校园网环境中反复尝试连接。</p>
    </div>

    <template #footer>
      <div class="dialog-actions cpu-button-row">
        <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
        <el-button type="primary" :loading="loading" :disabled="!currentDownload.available" @click="openDownload">
          <el-icon><Download /></el-icon>
          {{ activePlatform === "windows" ? "下载 Windows 客户端" : "下载 macOS 客户端" }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Download, Monitor } from "@element-plus/icons-vue";
import { getDesktopDownload, getMacDesktopDownload, type DesktopDownloadInfo } from "@/api/site";

defineProps<{ modelValue: boolean }>();
defineEmits<{ (e: "update:modelValue", value: boolean): void }>();

type DesktopPlatform = "windows" | "macos";
const emptyDownload = (): DesktopDownloadInfo => ({ available: false, url: "", version: "", password: "" });
const activePlatform = ref<DesktopPlatform>(detectPreferredPlatform());
const windowsDownload = ref<DesktopDownloadInfo>(emptyDownload());
const macDownload = ref<DesktopDownloadInfo>(emptyDownload());
const loading = ref(true);
const currentDownload = computed(() => activePlatform.value === "windows"
  ? windowsDownload.value
  : macDownload.value);

function detectPreferredPlatform(): DesktopPlatform {
  const looksLikeDesktopMac = navigator.platform.toLowerCase().includes("mac") && navigator.maxTouchPoints <= 1;
  return looksLikeDesktopMac ? "macos" : "windows";
}

function openDownload() {
  if (!currentDownload.value.url) return;
  window.open(currentDownload.value.url, "_blank", "noopener,noreferrer");
}

onMounted(async () => {
  try {
    [windowsDownload.value, macDownload.value] = await Promise.all([
      getDesktopDownload(),
      getMacDesktopDownload(),
    ]);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.dialog-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 28px;
}

.dialog-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-primary-soft);
  font-size: var(--cpu-fs-xl);
}

.dialog-heading strong {
  display: block;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
  line-height: 1.35;
}

.dialog-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}

.dialog-badges span {
  padding: 2px 7px;
  border: 1px solid rgba(59, 130, 246, 0.24);
  border-radius: var(--cpu-radius-pill);
  background: rgba(59, 130, 246, 0.08);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
}

.download-intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.download-intro p {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-m);
  line-height: 1.7;
}

.platform-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
}

.platform-picker button {
  appearance: none;
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.platform-picker button.active {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-surface);
  color: var(--cpu-primary-dark);
}

.platform-picker strong,
.platform-picker small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-picker strong {
  font-size: var(--cpu-fs-s);
}

.platform-picker small {
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}

.package-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
}

.package-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary-dark);
  font-size: var(--cpu-fs-xl);
}

.package-card div {
  min-width: 0;
}

.package-card strong,
.package-card small {
  display: block;
}

.package-card strong {
  overflow-wrap: anywhere;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
}

.package-card small {
  margin-top: 4px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}

.platform-notice {
  padding: 11px 12px;
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: var(--cpu-radius-m);
  background: rgba(245, 158, 11, 0.1);
  color: var(--cpu-accent);
  font-size: var(--cpu-fs-xs);
  line-height: 1.65;
}

.project-note {
  font-size: var(--cpu-fs-xs) !important;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 520px) {
  .dialog-actions {
    flex-direction: column-reverse;
  }

  .dialog-actions .el-button {
    width: 100%;
    margin-left: 0;
  }
}
</style>
