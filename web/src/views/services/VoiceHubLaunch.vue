<template>
  <main class="voicehub-launch" aria-live="polite">
    <img :src="voiceHubLogo" alt="药苑之声" @load="handleLogoReady" @error="handleLogoReady">
    <h1>正在进入药苑之声</h1>
    <p>点歌、排期、投票与播放管理功能正在载入。</p>
    <el-button type="primary" @click="openVoiceHub">立即进入</el-button>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

const voiceHubLogo = "/voicehub/images/logo.png";
const logoDisplayMs = 420;
const fallbackRedirectMs = 2500;
let redirectTimer: number | undefined;
let fallbackTimer: number | undefined;
let redirectScheduled = false;

function openVoiceHub() {
  if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
  if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
  window.location.assign("/voicehub/");
}

function handleLogoReady() {
  if (redirectScheduled) return;
  redirectScheduled = true;
  // 从图片真正完成加载后开始计时，确保至少渲染一小段时间。
  redirectTimer = window.setTimeout(openVoiceHub, logoDisplayMs);
}

onMounted(() => {
  fallbackTimer = window.setTimeout(openVoiceHub, fallbackRedirectMs);

  // 缓存中的图片可能在组件挂载前已经完成 load，主动确认一次。
  const image = document.querySelector<HTMLImageElement>(".voicehub-launch img");
  if (image?.complete) handleLogoReady();
});

onBeforeUnmount(() => {
  if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
  if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
});
</script>

<style scoped>
.voicehub-launch {
  min-height: min(70vh, 680px);
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--cpu-text-primary);
}

.voicehub-launch img {
  width: 116px;
  height: 116px;
  object-fit: contain;
}

.voicehub-launch h1,
.voicehub-launch p {
  margin: 0;
}

.voicehub-launch p {
  color: var(--cpu-text-secondary);
}
</style>
