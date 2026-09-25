<template>
  <aside v-if="visible" class="ios-app-recommendation" aria-labelledby="ios-app-recommendation-title">
    <img class="app-icon" src="/favicon.svg" alt="" width="40" height="40" />
    <div class="copy">
      <strong id="ios-app-recommendation-title">药大拾间 iOS 原生版已上线</strong>
      <p>App Store 免费下载，登录原有账号即可使用；当前版本也可继续使用。</p>
    </div>
    <a
      class="store-action"
      data-cpu-button="primary"
      :href="IOS_APP_STORE_URL"
      target="_blank"
      rel="noopener noreferrer"
      @click="rememberDismissal"
    >在 App Store 下载</a>
    <button
      class="close-action"
      type="button"
      data-cpu-button="icon"
      aria-label="关闭 iOS 下载推荐，7 天内不再提示"
      @click="dismiss"
    >
      <el-icon aria-hidden="true"><Close /></el-icon>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Close } from "@element-plus/icons-vue";
import { IOS_APP_STORE_URL, shouldRecommendIosApp } from "@/utils/clientInfo";

const DISMISSED_KEY = "cpu-ios-app-recommendation-dismissed-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const visible = ref(shouldRecommendIosApp() && !recentlyDismissed());

function recentlyDismissed() {
  try {
    const saved = Number(localStorage.getItem(DISMISSED_KEY));
    const elapsed = Date.now() - saved;
    return saved > 0 && elapsed >= 0 && elapsed < DISMISS_MS;
  } catch {
    return false;
  }
}

// Opening the store also counts as seen; the banner stays until the page changes so the tap never shifts layout.
function rememberDismissal() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* Storage may be unavailable. */ }
}

function dismiss() {
  visible.value = false;
  rememberDismissal();
}
</script>

<style scoped>
/* Inside the timetable the --schedule-* theme wins; elsewhere the site tokens apply. */
.ios-app-recommendation {
  --banner-accent: var(--schedule-accent, var(--cpu-button-primary));
  --banner-on-accent: var(--schedule-accent-contrast, var(--cpu-button-on-primary));
  --banner-text: var(--schedule-text, var(--cpu-text));
  --banner-text-secondary: var(--schedule-text-secondary, var(--cpu-text-secondary));
  box-sizing: border-box;
  display: grid;
  flex-shrink: 0;
  grid-template-columns: 40px minmax(0, 1fr) auto 44px;
  grid-template-areas: "icon copy action close";
  align-items: center;
  column-gap: 12px;
  width: 100%;
  max-width: var(--ios-app-recommendation-max-width, none);
  margin: 0 auto 12px;
  padding: 10px 6px 10px 12px;
  border: 1px solid var(--schedule-border, var(--cpu-border-soft));
  border-radius: 14px;
  background: var(--schedule-surface-bg, var(--cpu-card));
  box-shadow: var(--cpu-shadow-sm);
  color: var(--banner-text);
}
.app-icon { grid-area: icon; width: 40px; height: 40px; border-radius: 10px; }
.copy { grid-area: copy; min-width: 0; }
.copy strong { display: block; font-size: 14px; font-weight: 650; line-height: 1.4; }
.copy p { margin: 2px 0 0; color: var(--banner-text-secondary); font-size: 12px; line-height: 1.5; }
.store-action {
  --cpu-button-fill: var(--banner-accent);
  --cpu-button-ink: var(--banner-on-accent);
  --cpu-button-hover-fill: color-mix(in srgb, var(--banner-accent) 88%, var(--banner-text));
  --cpu-button-hover-ink: var(--banner-on-accent);
  grid-area: action;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}
.close-action {
  --cpu-button-ink: var(--banner-text-secondary);
  --cpu-button-hover-ink: var(--banner-text);
  grid-area: close;
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  font-size: 18px;
  cursor: pointer;
}
.store-action:focus-visible,
.close-action:focus-visible { outline: 2px solid var(--banner-accent); outline-offset: 2px; }

/* Phones: keep the dismiss control in the corner and move the store link under the copy. */
@media (max-width: 560px) {
  .ios-app-recommendation {
    grid-template-columns: 40px minmax(0, 1fr) 44px;
    grid-template-areas:
      "icon copy close"
      ". action action";
    align-items: start;
    row-gap: 8px;
    padding: 12px 4px 12px 12px;
  }
  .close-action { margin-top: -8px; }
  .store-action { justify-self: start; }
}
</style>
