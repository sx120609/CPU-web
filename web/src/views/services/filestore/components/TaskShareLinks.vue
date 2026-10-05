<template>
  <section v-if="detail" class="fs-share" aria-label="分享链接">
    <div v-for="link in links" :key="link.kind" class="fs-share-row">
      <span class="fs-share-tile" :style="{ '--tone': link.tone }" aria-hidden="true"><el-icon><component :is="link.icon" /></el-icon></span>
      <div class="fs-share-copy">
        <b>{{ link.label }}</b>
        <a :href="link.url" target="_blank" rel="noopener">{{ link.url }}</a>
      </div>
      <el-button :icon="CopyDocument" :aria-label="`复制${link.label}`" @click="copyLink(link.kind)">{{ compact ? "" : "复制" }}</el-button>
    </div>
    <p class="fs-share-note">提交者不需要账号；成功名单只展示已提交记录和文件名，不公开文件内容。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CopyDocument, List, Upload } from "@element-plus/icons-vue";
import { useInjectedFilestoreWorkspace } from "../workspace";

defineProps<{ compact?: boolean }>();
const { detail, submitUrl, statusUrl, copyLink } = useInjectedFilestoreWorkspace();
const links = computed(() => [
  { kind: "submit" as const, label: "提交链接", url: submitUrl.value, icon: Upload, tone: "#0f766e" },
  { kind: "status" as const, label: "成功名单", url: statusUrl.value, icon: List, tone: "#2563eb" },
]);
</script>

<style scoped>
.fs-share {
  --fs-tile-fill: 11%;
  --fs-tile-ink: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 14px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.fs-share-row { display: flex; align-items: center; gap: 11px; padding: 6px 0; }
.fs-share-row + .fs-share-row { border-top: 1px solid var(--cpu-border-soft); }
.fs-share-tile {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--tone) var(--fs-tile-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone) var(--fs-tile-ink), var(--cpu-text));
  font-size: 17px;
}
.fs-share-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.fs-share-copy b { font-size: 13px; font-weight: 650; }
.fs-share-copy a { overflow: hidden; color: var(--cpu-text-secondary); font-family: var(--cpu-font-mono); font-size: 12px; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.fs-share-copy a:hover { color: var(--cpu-primary); text-decoration: underline; }
.fs-share-row .el-button { flex: 0 0 auto; margin: 0; }
.fs-share-note { margin: 4px 0 0; color: var(--cpu-text-muted); font-size: 11px; line-height: 1.6; }
:global(html[data-theme="dark"] .fs-share) { --fs-tile-fill: 20%; --fs-tile-ink: 46%; }
</style>
