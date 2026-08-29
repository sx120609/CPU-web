<template>
  <el-dialog
    v-model="visible"
    class="legacy-domain-dialog"
    width="min(720px, calc(100vw - 32px))"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :destroy-on-close="false"
    append-to-body
    align-center
  >
    <div class="migration-heading">
      <span class="migration-mark" aria-hidden="true">↗</span>
      <div>
        <div class="migration-kicker">旧入口迁移提醒</div>
        <h2>请更新入口或客户端</h2>
      </div>
      <span v-if="audienceLabel" class="audience-pill">{{ audienceLabel }}</span>
    </div>

    <p class="migration-intro">
      你当前仍在通过 <code>cpu.lizmt.cn</code> 访问。请改用
      <strong>cputime.cn</strong>，并按设备完成一次更新；账号和站内数据不受影响。
    </p>

    <div v-if="activeInstruction" class="migration-steps" aria-label="当前设备更新方法">
      <article
        class="migration-step"
        :class="`is-${activeInstruction.id}`"
      >
        <span class="platform-badge" :class="`is-${activeInstruction.id}`" aria-hidden="true">{{ activeInstruction.badge }}</span>
        <div>
          <div class="step-title-row">
            <h3>{{ activeInstruction.title }}</h3>
            <span class="current-tag">当前设备</span>
          </div>
          <p>{{ activeInstruction.description }}</p>
        </div>
      </article>
    </div>

    <div v-else class="migration-generic">
      <h3>请先切换到新域名</h3>
      <p>
        暂时无法准确识别当前客户端。请先前往 <strong>cputime.cn</strong>；若你通过客户端或主屏幕图标使用本站，请在对应客户端的更新入口升级，或用系统浏览器重新创建入口。
      </p>
    </div>

    <p v-if="audience === 'ios'" class="migration-note">
      iPhone / iPad 上分享按钮的位置会随系统版本变化，请认准“方框上箭头”图标。确认新图标能正常打开后，再删除旧图标。
    </p>

    <template #footer>
      <div class="migration-actions">
        <el-button size="large" @click="remindTomorrow">稍后提醒</el-button>
        <el-button type="primary" size="large" @click="openPrimarySite">
          前往 cputime.cn
          <span aria-hidden="true">→</span>
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  detectClientPlatform,
  isAndroidNativeApp,
  isDesktopNativeApp,
  isLikelyAndroidDevice,
  isLikelyIosDevice,
} from "@/utils/clientInfo";
import {
  buildPrimarySiteUrl,
  LEGACY_DOMAIN_NOTICE_SNOOZE_MS,
  LEGACY_DOMAIN_NOTICE_STORAGE_KEY,
  type MigrationAudience,
  resolveMigrationAudience,
  shouldShowLegacyDomainNotice,
} from "@/utils/domainMigration";

type MigrationInstruction = {
  id: Exclude<MigrationAudience, "other">;
  badge: string;
  title: string;
  description: string;
};

const instructions: MigrationInstruction[] = [
  {
    id: "android",
    badge: "A",
    title: "安卓客户端",
    description: "进入“课表” → 点右上角“更多” → 选择“客户端更新”或“检查客户端更新”，按提示升级到最新版。",
  },
  {
    id: "ios",
    badge: "iOS",
    title: "iPhone / iPad",
    description: "用 Safari 打开 https://cputime.cn → 点底部或顶部的“分享”按钮 → 选择“添加到主屏幕”并确认添加，再从新图标进入。",
  },
  {
    id: "desktop",
    badge: "PC",
    title: "桌面客户端",
    description: "进入“小工具” → 滑到页面底部 → 点击“检查客户端更新”或“更新”，按提示完成更新。",
  },
];

const visible = ref(false);
const audience = ref<MigrationAudience>("other");

const audienceLabel = computed(() => {
  if (audience.value === "android") return "检测到安卓设备";
  if (audience.value === "ios") return "检测到 iPhone / iPad";
  if (audience.value === "desktop") return "检测到桌面客户端";
  return "暂未识别设备";
});

const activeInstruction = computed(() => instructions.find((item) => item.id === audience.value) ?? null);

function detectAudience(): MigrationAudience {
  const detectedClient = detectClientPlatform();
  return resolveMigrationAudience({
    androidNative: detectedClient === "android" || isAndroidNativeApp(),
    desktopNative: detectedClient === "desktop" || isDesktopNativeApp(),
    iosDevice: detectedClient === "ios" || isLikelyIosDevice(),
    androidDevice: isLikelyAndroidDevice(),
  });
}

function readSnoozeUntil() {
  try {
    return localStorage.getItem(LEGACY_DOMAIN_NOTICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function remindTomorrow() {
  try {
    localStorage.setItem(
      LEGACY_DOMAIN_NOTICE_STORAGE_KEY,
      String(Date.now() + LEGACY_DOMAIN_NOTICE_SNOOZE_MS),
    );
  } catch {
    // 存储不可用时仍允许关闭；下次进入旧域名会再次提醒。
  }
  visible.value = false;
}

function openPrimarySite() {
  window.location.replace(buildPrimarySiteUrl(window.location));
}

onMounted(() => {
  const isDevPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("previewLegacyDomainNotice") === "1";
  if (!isDevPreview && !shouldShowLegacyDomainNotice(window.location.hostname, readSnoozeUntil())) return;
  audience.value = detectAudience();
  visible.value = true;
});
</script>

<style scoped>
:global(.legacy-domain-dialog.el-dialog) {
  margin: 16px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 22%, var(--el-border-color-light));
  border-radius: 22px;
  box-shadow: 0 24px 80px rgb(6 24 44 / 26%);
}

:global(.legacy-domain-dialog .el-dialog__header) {
  display: none;
}

:global(.legacy-domain-dialog .el-dialog__body) {
  padding: 28px 30px 12px;
}

:global(.legacy-domain-dialog .el-dialog__footer) {
  padding: 12px 30px 26px;
}

.migration-heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.migration-mark {
  display: grid;
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(145deg, #119c83, #087864);
  font-size: 25px;
  font-weight: 800;
  box-shadow: 0 10px 24px rgb(17 156 131 / 24%);
}

.migration-kicker {
  margin-bottom: 3px;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.migration-heading h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 24px;
  line-height: 1.25;
}

.audience-pill {
  margin-left: auto;
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.migration-intro {
  margin: 18px 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
  line-height: 1.75;
}

.migration-intro code {
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  font-family: inherit;
  font-weight: 700;
}

.migration-steps {
  display: grid;
  gap: 10px;
}

.migration-step {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 13px;
  align-items: start;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  border-color: color-mix(in srgb, var(--el-color-primary) 48%, var(--el-border-color));
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--el-bg-color));
  box-shadow: 0 8px 24px rgb(17 156 131 / 9%);
}

.platform-badge {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 13px;
  color: #087864;
  background: #dff5ee;
  font-size: 14px;
  font-weight: 900;
}

.platform-badge.is-ios {
  color: #364152;
  background: #e9edf2;
}

.platform-badge.is-desktop {
  color: #1769aa;
  background: #dceefd;
}

.step-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-title-row h3 {
  margin: 1px 0 5px;
  color: var(--el-text-color-primary);
  font-size: 15px;
  line-height: 1.35;
}

.current-tag {
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 11px;
  font-weight: 700;
}

.migration-step p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.7;
}

.migration-generic {
  padding: 16px 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-fill-color-light);
}

.migration-generic h3 {
  margin: 0 0 7px;
  color: var(--el-text-color-primary);
  font-size: 15px;
}

.migration-generic p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.7;
}

.migration-note {
  margin: 12px 2px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.migration-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.migration-actions .el-button {
  min-width: 132px;
  border-radius: 12px;
  font-weight: 700;
}

.migration-actions .el-button span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

@media (max-width: 600px) {
  :global(.legacy-domain-dialog.el-dialog) {
    width: calc(100vw - 20px) !important;
    max-height: calc(100dvh - 20px);
    margin: 10px;
    border-radius: 18px;
  }

  :global(.legacy-domain-dialog .el-dialog__body) {
    max-height: calc(100dvh - 102px);
    overflow-y: auto;
    padding: 22px 18px 8px;
  }

  :global(.legacy-domain-dialog .el-dialog__footer) {
    padding: 10px 18px 18px;
  }

  .migration-heading {
    align-items: flex-start;
  }

  .migration-mark {
    width: 42px;
    height: 42px;
    border-radius: 13px;
  }

  .migration-heading h2 {
    font-size: 20px;
  }

  .audience-pill {
    display: none;
  }

  .migration-intro {
    margin: 14px 0;
    line-height: 1.65;
  }

  .migration-step {
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 11px;
    padding: 12px;
  }

  .platform-badge {
    width: 36px;
    height: 36px;
    border-radius: 11px;
    font-size: 12px;
  }

  .migration-actions {
    display: grid;
    grid-template-columns: 1fr 1.35fr;
    gap: 8px;
  }

  .migration-actions .el-button {
    width: 100%;
    min-width: 0;
    margin: 0;
    padding-inline: 10px;
  }
}
</style>
