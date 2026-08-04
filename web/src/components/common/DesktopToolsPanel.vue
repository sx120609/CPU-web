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
            <strong>网课小工具</strong>
            <small>从客户端面板选择网课平台，助手会在对应标签页接管任务，进度与日志可直接查看</small>
          </div>
        </li>
      </ul>

      <div class="platform-tabs" role="tablist" aria-label="选择桌面客户端平台">
        <button
          id="desktop-platform-tab-windows"
          type="button"
          role="tab"
          :class="{ active: activePlatform === 'windows' }"
          :aria-selected="activePlatform === 'windows'"
          aria-controls="desktop-platform-panel"
          :tabindex="activePlatform === 'windows' ? 0 : -1"
          @click="activePlatform = 'windows'"
          @keydown.right.prevent="activePlatform = 'macos'"
        >
          <span class="tab-mark">WIN</span>
          <span>
            <strong>Windows</strong>
            <small>10 / 11 · 64 位</small>
          </span>
        </button>
        <button
          id="desktop-platform-tab-macos"
          type="button"
          role="tab"
          :class="{ active: activePlatform === 'macos' }"
          :aria-selected="activePlatform === 'macos'"
          aria-controls="desktop-platform-panel"
          :tabindex="activePlatform === 'macos' ? 0 : -1"
          @click="activePlatform = 'macos'"
          @keydown.left.prevent="activePlatform = 'windows'"
        >
          <span class="tab-mark">M</span>
          <span>
            <strong>macOS</strong>
            <small>Apple Silicon · M 芯片</small>
          </span>
        </button>
      </div>

      <section
        id="desktop-platform-panel"
        class="platform-panel"
        role="tabpanel"
        :aria-labelledby="`desktop-platform-tab-${activePlatform}`"
      >
        <header class="platform-panel-head">
          <div>
            <small>{{ activePlatform === "windows" ? "WINDOWS 客户端" : "MACOS 客户端" }}</small>
            <strong>{{ activePlatform === "windows" ? "Windows 下载安装" : "M 芯片 Mac 下载安装" }}</strong>
            <span>
              {{ activePlatform === "windows"
                ? "适用于 Windows 10 / 11 的 64 位电脑"
                : "适用于 M1 及后续 M 系列芯片，不支持 Intel Mac" }}
            </span>
          </div>
          <code v-if="activeDownload.version">v{{ activeDownload.version }}</code>
        </header>

        <el-button
          v-if="activeDownload.available"
          class="download-button"
          type="primary"
          :icon="Download"
          @click="openDownload"
        >
          {{ activeDownload.password
            ? "前往网盘下载"
            : activePlatform === "windows"
              ? "下载 Windows 客户端"
              : "下载 macOS 客户端（M 芯片）" }}
        </el-button>
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          :title="downloadsLoaded ? '该平台安装包暂时不可用，请稍后再试' : '正在获取下载信息…'"
        />

        <!-- 网盘分享页要先输提取码，不给出来用户就卡在那一步 -->
        <div v-if="activeDownload.available && activeDownload.password" class="pass-row">
          <span>提取码</span>
          <code>{{ activeDownload.password }}</code>
          <el-button link type="primary" :icon="CopyDocument" @click="copyPassword">
            {{ copied ? "已复制" : "复制" }}
          </el-button>
        </div>

        <div v-if="activePlatform === 'windows'" class="install-guide">
          <div class="guide-title">
            <span>安装</span>
            <strong>Windows 出现「未知发布者」怎么办？</strong>
          </div>
          <ol>
            <li>下载完成后双击安装包。</li>
            <li>若 SmartScreen 拦截，点击提示框里的「更多信息」。</li>
            <li>点击「仍要运行」，按安装向导完成安装。</li>
          </ol>
          <p>这是因为安装包尚未购买代码签名证书，并不代表安装包存在安全问题。</p>
        </div>

        <div v-else class="install-guide">
          <div class="guide-title">
            <span>安装</span>
            <strong>macOS 首次打开被拦截怎么办？</strong>
          </div>
          <ol>
            <li>打开 DMG，把「药大拾间桌面端」拖入「应用程序」，然后先正常双击一次。</li>
            <li>若提示无法验证开发者，打开「系统设置 → 隐私与安全性」。</li>
            <li>向下找到刚被阻止的应用，点击「仍要打开」，用密码或 Touch ID 确认。</li>
          </ol>
          <p>也可在「应用程序」里右键应用并选择「打开」。无需关闭系统安全保护，也不需要运行终端绕过命令。</p>
        </div>

        <p class="platform-foot">
          {{ activePlatform === "windows"
            ? "支持 Windows 10 / 11（64 位）。"
            : "仅支持 Apple Silicon（M1 及后续 M 系列）Mac，暂不支持 Intel 机型。" }}
        </p>
      </section>
    </div>
  </section>
  <DownloadSafetyGuideDialog v-model="downloadGuideVisible" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Close, Connection, CopyDocument, Download, Monitor, Notebook } from "@element-plus/icons-vue";
import { getDesktopDownload, getMacDesktopDownload, type DesktopDownloadInfo } from "@/api/site";
import DownloadSafetyGuideDialog from "@/components/common/DownloadSafetyGuideDialog.vue";

const emit = defineEmits<{ (event: "close"): void }>();
type DesktopPlatform = "windows" | "macos";

// 只在网页里出现：桌面端把这些工具做成了应用自己的标签页，
// MainLayout 那边已经把这个悬浮球关掉了。
const download = ref<DesktopDownloadInfo>({ available: false, url: "", version: "", password: "" });
const macDownload = ref<DesktopDownloadInfo>({ available: false, url: "", version: "", password: "" });
const downloadsLoaded = ref(false);
const activePlatform = ref<DesktopPlatform>(detectPreferredPlatform());
const copied = ref(false);
const downloadGuideVisible = ref(false);
const activeDownload = computed(() => activePlatform.value === "windows" ? download.value : macDownload.value);

function detectPreferredPlatform(): DesktopPlatform {
  const looksLikeDesktopMac = navigator.platform.toLowerCase().includes("mac") && navigator.maxTouchPoints <= 1;
  return looksLikeDesktopMac ? "macos" : "windows";
}

function openDownload() {
  if (!activeDownload.value.url) return;
  window.open(activeDownload.value.url, "_blank", "noopener");
  if (activePlatform.value === "windows") downloadGuideVisible.value = true;
}

async function copyPassword() {
  try {
    await navigator.clipboard.writeText(activeDownload.value.password);
    copied.value = true;
    window.setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // 剪贴板不可用时提取码本身就显示在旁边，用户可以手抄
  }
}

onMounted(async () => {
  // 下载信息由站点设置下发，没配置就显示"正在打包中"，不给死链接
  try {
    [download.value, macDownload.value] = await Promise.all([
      getDesktopDownload(),
      getMacDesktopDownload(),
    ]);
  } finally {
    downloadsLoaded.value = true;
  }
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
  flex: 1 1 auto;
  gap: 14px;
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
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

.platform-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding: 5px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 13px;
  background: var(--cpu-surface-soft);

  button {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    min-height: 58px;
    padding: 9px 10px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--cpu-text-secondary);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;

    > span:last-child {
      display: grid;
      min-width: 0;
    }

    strong {
      color: inherit;
      font-size: 13.5px;
    }

    small {
      overflow: hidden;
      color: var(--cpu-text-muted);
      font-size: 10.5px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &.active {
      border-color: color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
      background: var(--cpu-surface);
      color: var(--cpu-primary-dark);
      box-shadow: 0 3px 10px rgba(29, 55, 49, 0.06);
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--cpu-primary) 55%, transparent);
      outline-offset: 1px;
    }
  }
}

.tab-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: -0.3px;
}

.platform-panel {
  display: grid;
  gap: 13px;
  padding: 15px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface);
}

.platform-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  small {
    color: var(--cpu-primary);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  strong {
    color: var(--cpu-text);
    font-size: 16px;
  }

  span {
    color: var(--cpu-text-secondary);
    font-size: 12px;
    line-height: 1.55;
  }

  > code {
    flex: none;
    padding: 4px 7px;
    border-radius: 999px;
    background: var(--cpu-primary-soft);
    color: var(--cpu-primary-dark);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 700;
  }
}

.download-button {
  width: 100%;
  min-height: 42px;
  margin: 0;
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

.install-guide {
  padding: 12px 13px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 24%, var(--cpu-border-soft));
  border-radius: 11px;
  background: color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-surface));

  .guide-title {
    display: flex;
    align-items: center;
    gap: 8px;

    span {
      padding: 3px 6px;
      border-radius: 6px;
      background: var(--cpu-primary);
      color: #fff;
      font-size: 10px;
      font-weight: 800;
    }

    strong {
      color: var(--cpu-text);
      font-size: 13px;
    }
  }

  ol {
    margin: 9px 0 0;
    padding-left: 20px;
    color: var(--cpu-text-secondary);
    font-size: 12px;
    line-height: 1.65;
  }

  p {
    margin: 7px 0 0;
    color: var(--cpu-text-muted);
    font-size: 11.5px;
    line-height: 1.6;
  }
}

.platform-foot {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 420px) {
  .tools-body {
    padding: 15px;
  }

  .platform-tabs button {
    gap: 7px;
    padding: 8px;
  }

  .tab-mark {
    width: 29px;
    height: 29px;
  }

  .platform-panel {
    padding: 13px;
  }
}
</style>
