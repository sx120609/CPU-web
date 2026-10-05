<template>
  <el-dialog v-model="qrVisible" title="提交二维码" width="360px" class="fs-qr-dialog" modal-class="cpu-overlay-above-native-bar" append-to-body align-center>
    <div class="fs-qr">
      <img v-if="qrImageUrl" :src="qrImageUrl" alt="提交二维码" width="220" height="220">
      <b>{{ detail?.title }}</b>
      <p>扫码即可打开提交页，提交者不需要登录。</p>
      <code>{{ submitUrl }}</code>
    </div>
    <template #footer>
      <el-button @click="qrVisible = false">关闭</el-button>
      <el-button type="primary" :icon="CopyDocument" @click="copyLink('submit')">复制链接</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { CopyDocument } from "@element-plus/icons-vue";
import { useInjectedFilestoreWorkspace } from "../workspace";

const { qrVisible, qrImageUrl, detail, submitUrl, copyLink } = useInjectedFilestoreWorkspace();
</script>

<style scoped>
.fs-qr { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.fs-qr img { width: 220px; height: 220px; margin-bottom: 6px; padding: 8px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: #fff; }
.fs-qr b { font-size: 15px; font-weight: 700; }
.fs-qr p { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; }
.fs-qr code {
  max-width: 100%;
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-family: var(--cpu-font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}
</style>
