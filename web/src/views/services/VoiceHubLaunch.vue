<template>
  <main class="voicehub-launch" aria-live="polite">
    <img :src="voiceHubLogo" alt="药苑之声" >
    <h1>正在进入药苑之声</h1>
    <p>点歌、排期、投票与播放管理功能正在载入。</p>
    <el-button type="primary" @click="openVoiceHub">立即进入</el-button>
  </main>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

const voiceHubLogo = "/voicehub/images/logo.png";

function openVoiceHub() {
  window.location.assign("/voicehub/");
}

onMounted(openVoiceHub);
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
