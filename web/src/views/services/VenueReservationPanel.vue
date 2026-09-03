<template>
  <section class="venue-panel" :class="`is-${launchMode}`">
    <div class="venue-guide">
      <div class="guide-kicker">中国药科大学智慧场馆系统</div>
      <h3>{{ launchMode === "desktop" ? "请使用微信扫码进入" : "在微信中打开场馆预约" }}</h3>
      <p v-if="launchMode === 'desktop'">
        使用微信扫描右侧二维码，即可进入场馆查询与预约页面。
      </p>
      <p v-else-if="launchMode === 'mobile'">
        <template v-if="isIosDevice">
          点击下方按钮调出系统分享面板，选择微信并发送到任意聊天即可使用。
        </template>
        <template v-else>
          点击下方按钮会先复制预约链接，再尝试打开微信。进入微信后，将链接发送到任意聊天并点击即可使用。
        </template>
      </p>
      <p v-else>
        正在跳转至智慧场馆系统；如果没有自动打开，可点击下方按钮继续。
      </p>

      <div class="venue-actions">
        <el-button
          v-if="launchMode === 'mobile' && isIosDevice"
          type="primary"
          size="large"
          @click="shareVenueLink"
        >
          <el-icon><Share /></el-icon>
          用系统分享发送到微信
        </el-button>
        <el-button
          v-else-if="launchMode === 'mobile'"
          type="primary"
          size="large"
          @click="tryOpenWechat"
        >
          <el-icon><Promotion /></el-icon>
          尝试打开微信
        </el-button>
        <el-button
          v-else-if="launchMode === 'wechat'"
          type="primary"
          size="large"
          @click="openVenue"
        >
          立即进入场馆预约
        </el-button>
        <el-button size="large" @click="copyVenueLink">
          <el-icon><CopyDocument /></el-icon>
          复制预约链接
        </el-button>
      </div>

      <div v-if="launchAttempted" class="launch-tip" role="status">
        <el-icon><InfoFilled /></el-icon>
        <span>如果微信没有自动打开，请打开微信，把已复制的链接发送到任意聊天后点击。</span>
      </div>

      <div class="venue-link-row">
        <span>预约链接</span>
        <a :href="venueUrl" target="_blank" rel="noopener noreferrer">{{ venueUrl }}</a>
      </div>
    </div>

    <div v-if="launchMode !== 'wechat'" class="venue-qr-card">
      <div class="qr-frame" :class="{ loading: qrLoading }">
        <img v-if="qrImage" :src="qrImage" alt="智慧场馆预约微信扫码二维码">
        <el-icon v-else-if="qrLoading" class="qr-loading"><Loading /></el-icon>
        <div v-else class="qr-error">二维码生成失败，请复制链接</div>
      </div>
      <strong>微信扫码进入</strong>
      <span>{{ launchMode === "desktop" ? "手机微信扫描二维码" : "也可以让另一台设备扫码" }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CopyDocument, InfoFilled, Loading, Promotion, Share } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import QRCode from "qrcode";
import { onMounted, ref } from "vue";
import { getNativeBridge } from "@/utils/nativeBridge";
import { copyText } from "@/utils/userGroup";
import {
  createVenueReservationShareData,
  openVenueReservationWithoutReferrer,
  detectVenueLaunchMode,
  isVenueIosDevice,
  VENUE_RESERVATION_URL,
  WECHAT_LAUNCH_URL,
} from "@/utils/venueReservation";

const venueUrl = VENUE_RESERVATION_URL;
const launchEnvironment = {
  userAgent: navigator.userAgent,
  maxTouchPoints: navigator.maxTouchPoints,
  viewportWidth: window.innerWidth,
};
const launchMode = detectVenueLaunchMode(launchEnvironment);
const isIosDevice = isVenueIosDevice(launchEnvironment);
const qrImage = ref("");
const qrLoading = ref(launchMode !== "wechat");
const launchAttempted = ref(false);

onMounted(async () => {
  if (launchMode === "wechat") return;

  try {
    qrImage.value = await QRCode.toDataURL(venueUrl, {
      width: 320,
      margin: 2,
      color: { dark: "#172033", light: "#ffffffff" },
    });
  } catch {
    qrImage.value = "";
  } finally {
    qrLoading.value = false;
  }
});

function openVenue() {
  openVenueReservationWithoutReferrer();
}

async function copyVenueLink() {
  return copyVenueLinkWithFeedback(true);
}

async function copyVenueLinkWithFeedback(showSuccess: boolean) {
  try {
    const bridge = getNativeBridge();
    const copiedByBridge = typeof bridge?.copyText === "function"
      && bridge.copyText(venueUrl) !== false;
    if (!copiedByBridge) await copyText(venueUrl);
    if (showSuccess) ElMessage.success("预约链接已复制，可发送到微信任意聊天后点开");
    return true;
  } catch {
    if (showSuccess) ElMessage.warning("复制失败，请长按下方链接复制");
    return false;
  }
}

async function tryOpenWechat() {
  const copied = await copyVenueLinkWithFeedback(false);
  launchAttempted.value = true;
  ElMessage.info(copied
    ? "预约链接已复制，正在尝试打开微信"
    : "正在尝试打开微信；如未打开，请手动复制预约链接");

  const bridge = getNativeBridge();
  if (typeof bridge?.openExternalUrl === "function") {
    bridge.openExternalUrl(WECHAT_LAUNCH_URL);
    return;
  }
  window.location.href = WECHAT_LAUNCH_URL;
}

async function shareVenueLink() {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        ...createVenueReservationShareData(),
      });
      return;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
    }
  }
  await tryOpenWechat();
}
</script>

<style scoped>
.venue-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  align-items: stretch;
}

.venue-guide,
.venue-qr-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
}

.venue-guide {
  padding: 24px;
}

.guide-kicker {
  margin-bottom: 8px;
  color: #0284c7;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.venue-guide h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 20px;
}

.venue-guide > p {
  max-width: 620px;
  margin: 10px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.8;
}

.venue-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.launch-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, #0284c7 9%, var(--cpu-card));
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.launch-tip .el-icon {
  flex: 0 0 auto;
  margin-top: 3px;
  color: #0284c7;
}

.venue-link-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--cpu-border-soft);
  font-size: 12px;
}

.venue-link-row span {
  color: var(--cpu-text-muted);
}

.venue-link-row a {
  width: fit-content;
  max-width: 100%;
  color: #0284c7;
  overflow-wrap: anywhere;
}

.venue-qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 22px;
  text-align: center;
}

.qr-frame {
  width: min(100%, 236px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: #fff;
}

.qr-frame img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-loading {
  color: #0284c7;
  font-size: 28px;
  animation: venue-spin 0.9s linear infinite;
}

.qr-error {
  padding: 18px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.venue-qr-card strong {
  margin-top: 14px;
  color: var(--cpu-text);
  font-size: 15px;
}

.venue-qr-card > span {
  margin-top: 5px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}

@keyframes venue-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .venue-panel {
    grid-template-columns: 1fr;
  }

  .venue-guide {
    padding: 20px 18px;
  }

  .venue-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .venue-actions :deep(.el-button) {
    width: 100%;
    margin: 0;
  }

  .venue-qr-card {
    padding: 20px;
  }

  .qr-frame {
    width: min(76vw, 248px);
  }
}
</style>
