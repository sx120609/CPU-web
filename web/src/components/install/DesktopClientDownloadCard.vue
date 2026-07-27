<template>
  <section class="desktop-client-card" aria-label="桌面客户端下载">
    <div class="desktop-client-copy">
      <strong>桌面版已推出</strong>
      <span>Windows 与 Apple Silicon（M 芯片）Mac 均可使用，联网助手与学习通工具都在桌面版中。</span>
    </div>

    <div v-if="windowsDownload.available || macDownload.available" class="desktop-client-links">
      <a
        v-if="windowsDownload.available"
        :href="windowsDownload.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        下载 Windows 版
      </a>
      <a
        v-if="macDownload.available"
        :href="macDownload.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        下载 Mac M 芯片版
      </a>
    </div>
    <span v-else-if="loading" class="desktop-client-status">正在获取下载链接…</span>
    <span v-else class="desktop-client-status">下载服务暂时不可用，请稍后再试。</span>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  getDesktopDownload,
  getMacDesktopDownload,
  type DesktopDownloadInfo,
} from "@/api/site";

const emptyDownload = (): DesktopDownloadInfo => ({
  available: false,
  url: "",
  version: "",
  password: "",
});

const windowsDownload = ref<DesktopDownloadInfo>(emptyDownload());
const macDownload = ref<DesktopDownloadInfo>(emptyDownload());
const loading = ref(true);

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
.desktop-client-card {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-surface));
}

.desktop-client-copy {
  display: grid;
  gap: 2px;
}

.desktop-client-copy strong {
  color: var(--cpu-text);
  font-size: 14px;
}

.desktop-client-copy span,
.desktop-client-status {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.desktop-client-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.desktop-client-links a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--cpu-primary);
  border-radius: 8px;
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.desktop-client-links a:first-child {
  background: var(--cpu-primary);
  color: #fff;
}

.desktop-client-links a:hover {
  background: var(--cpu-primary);
  color: #fff;
}

@media (max-width: 420px) {
  .desktop-client-links {
    display: grid;
  }

  .desktop-client-links a {
    width: 100%;
  }
}
</style>
