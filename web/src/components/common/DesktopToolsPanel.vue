<template>
  <section class="desktop-tools">
    <header class="tools-head">
      <div class="tools-title">
        <el-icon><Monitor /></el-icon>
        <div>
          <strong>PC 小工具</strong>
          <small>{{ inDesktop ? `桌面端 v${desktopVersion}` : "需要在桌面端中使用" }}</small>
        </div>
      </div>
      <el-button link :icon="Close" aria-label="关闭" @click="emit('close')" />
    </header>

    <!-- 网页端：这些能力做不到，只能引导下载 -->
    <div v-if="!inDesktop" class="tools-body">
      <div class="promo">
        <p class="promo-lead">这些小工具需要访问本机网络与后台进程，浏览器里做不到，得用桌面端。</p>
        <ul class="promo-list">
          <li>
            <span class="promo-icon"><el-icon><Connection /></el-icon></span>
            <div>
              <strong>联网小工具</strong>
              <small>校园网自动认证，掉线自动重连，开机自启后台常驻</small>
            </div>
          </li>
          <li>
            <span class="promo-icon"><el-icon><Notebook /></el-icon></span>
            <div>
              <strong>刷题小工具</strong>
              <small>在受控窗口中打开学习平台，内置学习辅助脚本与校园 AI 解答</small>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="downloadUrl" class="tools-actions">
        <el-button type="primary" :icon="Download" @click="openDownload">下载 Windows 客户端</el-button>
      </div>
      <el-alert v-else type="info" :closable="false" show-icon title="客户端正在打包中，稍后开放下载" />

      <p class="tools-foot">仅支持 Windows 与 macOS。安装后用当前账号授权登录即可。</p>
    </div>

    <!-- 桌面端：直接操作真实能力 -->
    <div v-else class="tools-body">
      <article class="tool-card">
        <header>
          <div class="tool-name">
            <el-icon><Connection /></el-icon>
            <strong>联网小工具</strong>
          </div>
          <el-tag :type="campusTagType" size="small" effect="light">{{ campusMessage }}</el-tag>
        </header>
        <p v-if="!onCampus" class="tool-hint">
          当前不在校园网环境，无需认证。连上校园网后会自动识别并接管。
        </p>
        <p v-else-if="!campusState?.hasCredential" class="tool-hint">
          还没保存校园网学号密码。在客户端设置里填一次，之后掉线会自动重连。
        </p>
        <p v-else class="tool-hint">
          已保存学号 {{ campusState.studentId }}<span v-if="campusState.localIp"> · 本机 {{ campusState.localIp }}</span>
        </p>
        <div class="tool-actions">
          <el-button
            type="primary"
            size="small"
            :loading="campusBusy"
            :disabled="!campusState?.hasCredential || !onCampus"
            @click="connectCampus"
          >
            立即连接
          </el-button>
          <el-button size="small" :disabled="campusBusy" @click="recheckCampus">重新检测</el-button>
        </div>
      </article>

      <article class="tool-card">
        <header>
          <div class="tool-name">
            <el-icon><Notebook /></el-icon>
            <strong>刷题小工具</strong>
          </div>
        </header>
        <p class="tool-hint">在独立窗口中打开学习平台，并注入学习辅助脚本。</p>
        <div class="tool-actions">
          <el-button type="primary" size="small" :loading="learningBusy" @click="openLearning">
            打开学习平台
          </el-button>
        </div>
      </article>

      <p v-if="actionMessage" class="tool-message" :data-error="actionError">{{ actionMessage }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Close, Connection, Download, Monitor, Notebook } from "@element-plus/icons-vue";
import { getDesktopBridge, isDesktopNativeApp } from "@/utils/clientInfo";
import { getDesktopDownloadUrl } from "@/api/site";

const emit = defineEmits<{ (event: "close"): void }>();

const bridge = getDesktopBridge();
const inDesktop = isDesktopNativeApp();
const desktopVersion = ref(bridge?.getVersionName?.() || "");

const downloadUrl = ref("");
const campusState = ref<any>(null);
const campusBusy = ref(false);
const learningBusy = ref(false);
const actionMessage = ref("");
const actionError = ref(false);

const campusMessage = computed(() => campusState.value?.message || "未启用");
const campusTagType = computed(() => {
  const status = campusState.value?.status;
  if (status === "online") return "success";
  if (status === "paused") return "danger";
  if (status === "offline") return "warning";
  // off-campus 是正常状态，不是错误：人就是不在学校
  return "info";
});

const onCampus = computed(() => campusState.value?.status !== "off-campus");

const say = (message: string, error = false) => {
  actionMessage.value = message;
  actionError.value = error;
};

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

async function connectCampus() {
  if (!bridge?.campusNet) return;
  campusBusy.value = true;
  say("正在认证校园网…");
  try {
    const state = await bridge.campusNet.loginNow();
    campusState.value = state;
    say(state.message, state.status !== "online");
  } catch (error) {
    say(errorText(error, "认证失败。"), true);
  } finally {
    campusBusy.value = false;
  }
}

async function recheckCampus() {
  if (!bridge?.campusNet) return;
  campusBusy.value = true;
  try {
    campusState.value = await bridge.campusNet.checkNow();
    say("已触发检测。");
  } catch (error) {
    say(errorText(error, "检测失败。"), true);
  } finally {
    campusBusy.value = false;
  }
}

async function openLearning() {
  if (!bridge?.openLearning) return;
  learningBusy.value = true;
  try {
    await bridge.openLearning();
    say("学习平台已在新窗口打开。");
  } catch (error) {
    say(errorText(error, "无法打开学习平台。"), true);
  } finally {
    learningBusy.value = false;
  }
}

function openDownload() {
  if (!downloadUrl.value) return;
  window.open(downloadUrl.value, "_blank", "noopener");
}

onMounted(async () => {
  if (inDesktop && bridge?.campusNet) {
    try {
      campusState.value = await bridge.campusNet.getState();
      bridge.campusNet.onState((state) => {
        campusState.value = state;
      });
    } catch {
      /* 桥不可用时保持默认展示 */
    }
    return;
  }
  // 下载地址由站点设置下发，没配置就显示"正在打包中"
  try {
    downloadUrl.value = await getDesktopDownloadUrl();
  } catch {
    downloadUrl.value = "";
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
  gap: 14px;
  padding: 18px;
  overflow-y: auto;
}

.promo-lead {
  margin: 0 0 14px;
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

.tools-foot {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.tool-card {
  padding: 14px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface-soft);

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
}

.tool-name {
  display: flex;
  align-items: center;
  gap: 8px;

  .el-icon {
    color: var(--cpu-primary);
  }
}

.tool-hint {
  margin: 0 0 12px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.tool-actions {
  display: flex;
  gap: 8px;
}

.tool-message {
  margin: 0;
  font-size: 13px;
  color: var(--cpu-primary-dark);

  &[data-error="true"] {
    color: var(--cpu-danger);
  }
}
</style>
