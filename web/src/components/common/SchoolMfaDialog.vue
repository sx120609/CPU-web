<template>
  <!--
    学校统一认证的扫码二次验证（南医：新设备第一次登录时要求）。
    任何页面发起的学校登录都可能走到这一步，所以挂在 App 上；手机上确认后即完成登录。
  -->
  <el-dialog
    :model-value="auth.ssoNeedMfa"
    title="扫码验证"
    width="min(360px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    class="school-mfa-dialog"
    @open="onOpen"
    @closed="stopPolling"
    @update:model-value="(value: boolean) => { if (!value) cancel(); }"
  >
    <div class="mfa-body">
      <p class="mfa-lead">学校统一认证要求这台设备先扫码验证一次。用手机微信扫描下面的二维码，并在手机上确认。验证后这台设备会被记住。</p>
      <div class="mfa-qr" :class="{ 'is-dim': state !== 'waiting' }">
        <img v-if="auth.ssoMfaQr" :src="auth.ssoMfaQr" alt="学校统一认证二维码" />
        <div v-if="state === 'scanned'" class="mfa-qr-overlay">已扫描，请在手机上确认</div>
        <button v-else-if="state === 'expired'" type="button" class="mfa-qr-overlay is-action" :disabled="refreshing" @click="refresh">
          二维码已失效，点击刷新
        </button>
        <div v-else-if="state === 'done'" class="mfa-qr-overlay">验证通过，正在登录…</div>
      </div>
      <p v-if="message" class="mfa-message is-error" role="alert">{{ message }}</p>
      <div class="mfa-actions">
        <el-button text :loading="refreshing" :disabled="state === 'done'" @click="refresh">换一张</el-button>
        <el-button @click="cancel">取消</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { SCHOOL_MFA_VERIFIED_EVENT } from "@/utils/schoolMfa";

type QrState = "waiting" | "scanned" | "expired" | "done";

const auth = useAuthStore();
const state = ref<QrState>("waiting");
const message = ref("");
const refreshing = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

/** 接口报错时取服务端给的原因，而不是「Request failed with status code 400」。 */
function errorText(error: unknown, fallback: string) {
  const serverMessage = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof serverMessage === "string" && serverMessage) return serverMessage;
  return (error instanceof Error && error.message) || fallback;
}

function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(delay = 2000) {
  stopPolling();
  timer = setTimeout(() => void poll(), delay);
}

async function poll() {
  if (!auth.ssoNeedMfa || polling) return;
  polling = true;
  try {
    const result = await auth.ssoPollMfa();
    if (result === "done") {
      state.value = "done";
      ElMessage.success(`欢迎，${auth.user?.nickname || auth.user?.username || ""}`);
      window.dispatchEvent(new CustomEvent(SCHOOL_MFA_VERIFIED_EVENT));
      return;
    }
    if (result === "failed") {
      message.value = auth.ssoError || "验证失败，请重新登录";
      ElMessage.error(message.value);
      auth.cancelSsoMfa();
      return;
    }
    state.value = result;
    message.value = "";
    if (result !== "expired") schedule();
  } catch (error) {
    message.value = errorText(error, "暂时查不到扫码状态，正在重试");
    schedule(4000);
  } finally {
    polling = false;
  }
}

function onOpen() {
  state.value = "waiting";
  message.value = "";
  // 登录表单上那条「需要扫码验证」的提示由弹窗代替。
  auth.ssoError = "";
  schedule();
}

async function refresh() {
  refreshing.value = true;
  try {
    await auth.ssoRefreshMfaQr();
    state.value = "waiting";
    message.value = "";
    schedule();
  } catch (error) {
    message.value = errorText(error, "二维码刷新失败，请重新登录");
  } finally {
    refreshing.value = false;
  }
}

function cancel() {
  stopPolling();
  auth.cancelSsoMfa();
}

onBeforeUnmount(stopPolling);
</script>

<style scoped>
.mfa-body { display: flex; flex-direction: column; gap: 12px; }
.mfa-lead { margin: 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.6; }
.mfa-qr { position: relative; align-self: center; width: 200px; height: 200px; padding: 8px; border-radius: 10px; background: #fff; }
.mfa-qr img { display: block; width: 100%; height: 100%; object-fit: contain; }
.mfa-qr.is-dim img { opacity: 0.15; }
.mfa-qr-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px;
  border: 0; border-radius: 10px; background: transparent; color: #1f2329; font-size: 14px; font-weight: 600; text-align: center;
}
.mfa-qr-overlay.is-action { cursor: pointer; color: var(--el-color-primary); }
.mfa-message { margin: 0; font-size: 13px; }
.mfa-message.is-error { color: var(--el-color-danger); }
.mfa-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
