<template>
  <!--
    在当前页面恢复教务授权，不用跳去教务页。
    先用本机保存的账号静默恢复；只有学校要验证码或本机没保存账号时才让用户填。
  -->
  <el-dialog
    v-model="open"
    title="恢复教务授权"
    width="min(400px, calc(100vw - 24px))"
    align-center
    append-to-body
    class="jwxt-reauth-dialog"
    :class="dialogClass"
    :style="pageStyle"
    @open="onOpen"
  >
    <div v-if="stage === 'restoring'" class="reauth-restoring" role="status">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>正在用本机保存的账号恢复授权…</p>
    </div>

    <form v-else class="reauth-form" @submit.prevent="submit">
      <p class="reauth-lead">{{ leadText }}</p>

      <template v-if="stage === 'manual'">
        <label class="reauth-field">
          <span>学号或工号</span>
          <el-input v-model="form.username" autocomplete="username" :disabled="busy" />
        </label>
        <label class="reauth-field">
          <span>统一认证密码</span>
          <el-input v-model="form.password" type="password" show-password autocomplete="current-password" :disabled="busy" />
        </label>
      </template>
      <p v-else class="reauth-account">账号 {{ savedUsername }}</p>

      <div v-if="jwxt.needCaptcha && jwxt.captchaImage" class="reauth-captcha">
        <label class="reauth-field">
          <span>验证码</span>
          <el-input v-model="form.captcha" autocomplete="off" maxlength="8" :disabled="busy" />
        </label>
        <button type="button" class="captcha-image" :disabled="busy" aria-label="换一张验证码" @click="refreshCaptcha">
          <img :src="jwxt.captchaImage" alt="验证码" />
        </button>
      </div>

      <el-checkbox v-if="stage === 'manual'" v-model="remember" class="reauth-remember">
        保存到本浏览器，授权过期时自动恢复
      </el-checkbox>

      <p v-if="jwxt.error" class="reauth-error" role="alert">{{ jwxt.error }}</p>

      <div class="reauth-actions">
        <button v-if="stage === 'saved'" type="button" class="link-button" :disabled="busy" @click="useOtherAccount">换个账号</button>
        <el-button data-cpu-button-theme="schedule" type="primary" native-type="submit" :loading="busy" :disabled="!canSubmit">恢复授权</el-button>
      </div>
    </form>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { Loading } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { loadCreds } from "@/utils/credCrypto";

const props = defineProps<{
  modelValue: boolean;
  pageStyle?: Record<string, string>;
  dialogClass?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; restored: [] }>();

const auth = useAuthStore();
const jwxt = useJwxtStore();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

/** restoring：正在静默恢复；saved：用保存的账号补验证码；manual：手动输入账号密码。 */
const stage = ref<"restoring" | "saved" | "manual">("restoring");
const busy = ref(false);
const remember = ref(true);
const savedUsername = ref("");
const form = reactive({ username: "", password: "", captcha: "" });
let session = 0;

const leadText = computed(() => {
  if (stage.value === "saved") return "学校这次要求输入验证码，填好就能用保存的账号恢复。";
  return jwxt.rememberSaved
    ? "保存的账号没能自动恢复，请重新输入学校统一认证的账号密码。"
    : "学校的登录已过期，输入统一认证的账号密码即可恢复，课表会自动刷新。";
});

const canSubmit = computed(() => {
  if (busy.value) return false;
  if (jwxt.needCaptcha && !form.captcha.trim()) return false;
  if (stage.value === "manual") return Boolean(form.username.trim() && form.password);
  return true;
});

function finish() {
  emit("restored");
  open.value = false;
}

async function onOpen() {
  const token = ++session;
  form.password = "";
  form.captcha = "";
  form.username = auth.user?.username || "";
  stage.value = "restoring";
  const saved = jwxt.rememberSaved ? await loadCreds().catch(() => null) : null;
  if (token !== session) return;
  savedUsername.value = saved?.username || "";
  if (saved) {
    // 用户主动点了恢复，不受“刚失败过先别试”的退避限制。
    const restored = await jwxt.recoverSession(undefined, { force: true });
    if (token !== session) return;
    if (restored) return finish();
    if (jwxt.needCaptcha) {
      stage.value = "saved";
      return;
    }
  }
  stage.value = "manual";
  await jwxt.beginLogin({ silent: true }).catch(() => undefined);
}

async function refreshCaptcha() {
  form.captcha = "";
  await jwxt.beginLogin({ silent: true }).catch(() => undefined);
}

function useOtherAccount() {
  stage.value = "manual";
  form.captcha = "";
  void jwxt.beginLogin({ silent: true }).catch(() => undefined);
}

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  try {
    let ok = false;
    if (stage.value === "saved") {
      const saved = await loadCreds().catch(() => null);
      if (!saved) {
        stage.value = "manual";
        return;
      }
      ok = await jwxt.submitLogin(saved.username, saved.password, form.captcha.trim() || undefined, true, { silent: true });
    } else {
      ok = await jwxt.submitLogin(form.username.trim(), form.password, form.captcha.trim() || undefined, remember.value, { silent: true });
    }
    form.password = "";
    form.captcha = "";
    if (ok) finish();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.reauth-restoring { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px 0; color: var(--el-text-color-secondary); font-size: var(--cpu-fs-s); }
.reauth-restoring .el-icon { font-size: 22px; }
.reauth-restoring p { margin: 0; }
.reauth-form { display: flex; flex-direction: column; gap: 12px; }
.reauth-lead { margin: 0; color: var(--el-text-color-regular); font-size: var(--cpu-fs-s); line-height: 1.6; }
.reauth-account { margin: 0; color: var(--el-text-color-primary); font-size: var(--cpu-fs-s); font-weight: 600; }
.reauth-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--el-text-color-secondary); font-size: var(--cpu-fs-xs); }
.reauth-captcha { display: flex; align-items: flex-end; gap: 8px; }
.reauth-captcha .reauth-field { flex: 1; }
.captcha-image { flex: 0 0 auto; height: 40px; padding: 0; border: 1px solid var(--el-border-color); border-radius: var(--cpu-radius-m); background: #fff; cursor: pointer; overflow: hidden; }
.captcha-image img { display: block; height: 100%; }
.reauth-remember { height: auto; white-space: normal; }
.reauth-error { margin: 0; color: var(--el-color-danger); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.reauth-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.link-button { margin-right: auto; padding: 4px 0; border: 0; background: transparent; color: var(--el-color-primary); font: inherit; font-size: var(--cpu-fs-xs); cursor: pointer; }
.link-button:disabled { cursor: default; opacity: 0.6; }
.link-button:focus-visible, .captcha-image:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
@media (pointer: coarse) {
  .link-button { min-height: 44px; }
  .captcha-image { height: 44px; }
}
</style>
