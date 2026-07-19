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
        <span class="dialog-icon">📶</span>
        <div>
          <strong>CPU 网络连接助手</strong>
          <div class="dialog-badges">
            <span>仅限 Windows</span>
            <span>v4.1.4</span>
          </div>
        </div>
      </div>
    </template>

    <div class="download-intro">
      <p>这是一款 Windows 桌面软件，用于帮助连接药大校园网络。</p>

      <div class="package-card">
        <span class="package-icon">🖥️</span>
        <div>
          <strong>CPU_NET-4.1.4-Installer.exe</strong>
          <small>Windows 桌面端 · 73.7 MB</small>
        </div>
      </div>

      <div class="platform-notice">
        手机、macOS 和其他系统暂不支持。你可以在当前设备查看介绍，但安装包需要在 Windows 电脑上运行。
      </div>

      <p class="project-note">学生开发的开源项目，非学校官方软件。使用前请先阅读项目说明。</p>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <el-button @click="openSource">
          <el-icon><Link /></el-icon>
          GitHub 源码
        </el-button>
        <el-button type="primary" @click="openDownload">
          <el-icon><Download /></el-icon>
          下载 Windows 安装包
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Download, Link } from "@element-plus/icons-vue";

defineProps<{ modelValue: boolean }>();
defineEmits<{ (e: "update:modelValue", value: boolean): void }>();

const DOWNLOAD_URL = "https://carbene.lanzoue.com/ibp7T3xfdupa";
const SOURCE_URL = "https://github.com/SoraNoNeko/cpu_net";

function openDownload() {
  window.open(DOWNLOAD_URL, "_blank", "noopener,noreferrer");
}

function openSource() {
  window.open(SOURCE_URL, "_blank", "noopener,noreferrer");
}
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
  border-radius: 13px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(20, 184, 166, 0.12));
  font-size: 24px;
}

.dialog-heading strong {
  display: block;
  color: var(--cpu-text);
  font-size: 17px;
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
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 11px;
  font-weight: 600;
}

.download-intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.download-intro p {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.package-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-soft);
}

.package-icon {
  font-size: 26px;
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
  font-size: 14px;
}

.package-card small {
  margin-top: 4px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.platform-notice {
  padding: 11px 12px;
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.1);
  color: #92400e;
  font-size: 12px;
  line-height: 1.65;
}

.project-note {
  font-size: 12px !important;
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
