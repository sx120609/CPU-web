<template>
  <el-dialog v-model="open" title="关注服务号" width="360" modal-class="cpu-overlay-above-native-bar" append-to-body>
    <div class="wechat-follow">
      <img src="/wechat-service-qrcode.png" alt="拾小间服务号二维码" width="168" height="168" />
      <b>拾小间</b>
      <p>在微信搜索服务号 ID“cputimecn”或名称“拾小间”并关注，可接收已开启的站内通知，并从服务号菜单进入课表与教务。</p>
    </div>
    <template #footer>
      <el-button type="primary" @click="copyServiceId">复制 ID：cputimecn</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { copyText } from "@/utils/userGroup";

const open = defineModel<boolean>({ default: false });

async function copyServiceId() {
  await copyText("cputimecn");
  ElMessage.success("已复制服务号 ID：cputimecn");
}
</script>

<style scoped>
.wechat-follow { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.wechat-follow img { border-radius: var(--cpu-radius-m); background: #fff; }
.wechat-follow b { color: var(--cpu-text); font-size: var(--cpu-fs-l); font-weight: 600; }
.wechat-follow p { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; }
</style>
