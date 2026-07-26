<template>
  <section class="desktop-tools">
    <header class="tools-head">
      <div class="tools-title">
        <el-icon><Monitor /></el-icon>
        <div>
          <strong>PC 小工具</strong>
          <small>需要在桌面端中使用</small>
        </div>
      </div>
      <el-button link :icon="Close" aria-label="关闭" @click="emit('close')" />
    </header>

    <div class="tools-body">
      <p class="promo-lead">这些小工具要访问本机网络与后台进程，浏览器里做不到，得用桌面端。</p>

      <ul class="promo-list">
        <li>
          <span class="promo-icon"><el-icon><Connection /></el-icon></span>
          <div>
            <strong>联网小工具</strong>
            <small>校园网自动认证，掉线自动重连；不在校园网时不会瞎试。可开机自启并常驻托盘</small>
          </div>
        </li>
        <li>
          <span class="promo-icon"><el-icon><Notebook /></el-icon></span>
          <div>
            <strong>刷题小工具</strong>
            <small>在客户端标签页中打开学习平台，答题辅助自动接管，进度与日志在客户端里直接看</small>
          </div>
        </li>
      </ul>

      <div v-if="downloadUrl" class="tools-actions">
        <el-button type="primary" :icon="Download" @click="openDownload">下载 Windows 客户端</el-button>
      </div>
      <el-alert v-else type="info" :closable="false" show-icon title="客户端正在打包中，稍后开放下载" />

      <!-- 安装包没有代码签名，所有人都会撞到这个提示，先讲清楚免得以为是病毒 -->
      <div class="install-tip">
        <strong>安装时 Windows 会提示「未知发布者」</strong>
        <p>这是因为安装包没有购买代码签名证书，不是安全问题。点提示框里的「更多信息」，再点「仍要运行」即可。</p>
      </div>

      <p class="tools-foot">支持 Windows 10 / 11（64 位）。安装后用当前账号授权登录即可。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Close, Connection, Download, Monitor, Notebook } from "@element-plus/icons-vue";
import { getDesktopDownloadUrl } from "@/api/site";

const emit = defineEmits<{ (event: "close"): void }>();

// 只在网页里出现：桌面端把这些工具做成了应用自己的标签页，
// MainLayout 那边已经把这个悬浮球关掉了。
const downloadUrl = ref("");

function openDownload() {
  if (downloadUrl.value) window.open(downloadUrl.value, "_blank", "noopener");
}

onMounted(async () => {
  // 下载地址由站点设置下发，没配置就显示"正在打包中"，不给死链接
  downloadUrl.value = await getDesktopDownloadUrl();
});
</script>

<style scoped lang="scss">
.desktop-tools {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.tools-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--cpu-border-soft);
}

.tools-title {
  display: flex;
  align-items: center;
  gap: 10px;

  .el-icon {
    font-size: 20px;
    color: var(--cpu-primary);
  }

  div {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }

  small {
    color: var(--cpu-text-secondary);
    font-size: 12px;
  }
}

.tools-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  overflow-y: auto;
}

.promo-lead {
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
}

.promo-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  small {
    color: var(--cpu-text-secondary);
    line-height: 1.6;
  }
}

.promo-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
}

.tools-actions {
  display: flex;
  gap: 10px;
}

.install-tip {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--cpu-gold) 34%, var(--cpu-border-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--cpu-gold) 8%, var(--cpu-surface));

  strong {
    font-size: 13px;
  }

  p {
    margin: 5px 0 0;
    color: var(--cpu-text-secondary);
    font-size: 12.5px;
    line-height: 1.65;
  }
}

.tools-foot {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
</style>
