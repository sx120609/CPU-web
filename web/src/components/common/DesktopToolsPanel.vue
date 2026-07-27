<template>
  <section class="desktop-tools">
    <header class="tools-head">
      <div class="tools-title">
        <el-icon><Monitor /></el-icon>
        <div>
          <strong>桌面小工具</strong>
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
            <small>在客户端标签页中打开学习通，答题辅助自动接管，进度与日志在客户端里直接看</small>
          </div>
        </li>
      </ul>

      <div v-if="download.available || macDownload.available" class="tools-actions">
        <el-button v-if="download.available" type="primary" :icon="Download" @click="openDownload(download)">
          {{ download.password ? "前往网盘下载" : "下载 Windows 客户端" }}
        </el-button>
        <el-button v-if="macDownload.available" plain type="primary" :icon="Download" @click="openDownload(macDownload)">
          下载 macOS 客户端（M 芯片）
        </el-button>
      </div>
      <template v-if="download.available">
        <!-- 网盘分享页要先输提取码，不给出来用户就卡在那一步 -->
        <div v-if="download.password" class="pass-row">
          <span>提取码</span>
          <code>{{ download.password }}</code>
          <el-button link type="primary" :icon="CopyDocument" @click="copyPassword">
            {{ copied ? "已复制" : "复制" }}
          </el-button>
        </div>
      </template>
      <el-alert
        v-if="!download.available && !macDownload.available"
        type="info"
        :closable="false"
        show-icon
        title="客户端正在打包中，稍后开放下载"
      />

      <!-- 安装包没有代码签名，所有人都会撞到这个提示，先讲清楚免得以为是病毒 -->
      <div class="install-tip">
        <strong>安装时 Windows 会提示「未知发布者」</strong>
        <p>这是因为安装包没有购买代码签名证书，不是安全问题。点提示框里的「更多信息」，再点「仍要运行」即可。</p>
      </div>

      <div class="install-tip mac-tip">
        <strong>macOS 首次打开被拦截怎么办？</strong>
        <ol>
          <li>打开 DMG，把「药大拾间桌面端」拖入「应用程序」，然后先正常双击一次。</li>
          <li>若系统提示无法验证开发者，打开「系统设置 → 隐私与安全性」，向下找到刚被阻止的应用。</li>
          <li>点「仍要打开」，用密码或 Touch ID 确认，再点一次「打开」。这个按钮只有尝试打开后才会出现。</li>
        </ol>
        <p>也可在「应用程序」里右键应用，选择「打开」并再次确认。无需关闭系统安全保护，也不需要运行终端绕过命令。</p>
      </div>

      <p class="tools-foot">支持 Windows 10 / 11（64 位）与 Apple Silicon（M1 及后续 M 系列）Mac。macOS 暂不支持 Intel 机型。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Close, Connection, CopyDocument, Download, Monitor, Notebook } from "@element-plus/icons-vue";
import { getDesktopDownload, getMacDesktopDownload, type DesktopDownloadInfo } from "@/api/site";

const emit = defineEmits<{ (event: "close"): void }>();

// 只在网页里出现：桌面端把这些工具做成了应用自己的标签页，
// MainLayout 那边已经把这个悬浮球关掉了。
const download = ref<DesktopDownloadInfo>({ available: false, url: "", version: "", password: "" });
const macDownload = ref<DesktopDownloadInfo>({ available: false, url: "", version: "", password: "" });
const copied = ref(false);

function openDownload(target: DesktopDownloadInfo) {
  if (target.url) window.open(target.url, "_blank", "noopener");
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(download.value.password);
    copied.value = true;
    window.setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // 剪贴板不可用时提取码本身就显示在旁边，用户可以手抄
  }
}

onMounted(async () => {
  // 下载信息由站点设置下发，没配置就显示"正在打包中"，不给死链接
  [download.value, macDownload.value] = await Promise.all([
    getDesktopDownload(),
    getMacDesktopDownload(),
  ]);
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
  flex-wrap: wrap;
  gap: 10px;
}

.pass-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px dashed var(--cpu-border);
  border-radius: 10px;
  background: var(--cpu-surface-soft);
  font-size: 13px;

  > span {
    color: var(--cpu-text-secondary);
  }

  code {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 2px;
    color: var(--cpu-primary-dark);
  }
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

  ol {
    margin: 7px 0 0;
    padding-left: 20px;
    color: var(--cpu-text-secondary);
    font-size: 12.5px;
    line-height: 1.7;
  }
}

.mac-tip {
  border-color: color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft));
  background: color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-surface));
}

.tools-foot {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
</style>
