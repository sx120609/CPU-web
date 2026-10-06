<template>
  <AuthShell title="使用学校统一认证登录" :subtitle="loginHint" @home="goHome">
      <p class="auth-notice">
        <el-icon aria-hidden="true"><InfoFilled /></el-icon>
        <span>学号 / 工号仅用于识别身份并关联账号；勾选保持登录后，<b>学校密码会加密保存在当前浏览器</b>，验证码不会保存。</span>
      </p>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        class="form"
        autocomplete="on"
        @submit.prevent="onSubmit"
      >
        <el-form-item prop="username">
          <el-input v-model="form.username" name="username" autocomplete="username" placeholder="学号 / 工号" :disabled="auth.ssoLoading || captchaRefreshing">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" name="password" type="password" show-password autocomplete="current-password" placeholder="密码" :disabled="auth.ssoLoading || captchaRefreshing">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="auth.ssoNeedCaptcha" prop="captcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入验证码" maxlength="8" style="flex:1" :disabled="auth.ssoLoading || captchaRefreshing" />
            <button data-cpu-button="media"
              v-if="auth.ssoCaptchaImage"
              type="button"
              class="vcode-img-button"
              :disabled="auth.ssoLoading || captchaRefreshing"
              aria-label="刷新验证码"
              title="刷新验证码"
              @click="reloadCaptcha"
            >
              <img :src="auth.ssoCaptchaImage" alt="captcha" class="vcode-img" loading="lazy" decoding="async" fetchpriority="low" />
            </button>
            <el-button text :loading="captchaRefreshing" :disabled="auth.ssoLoading" @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="auth.ssoError">
          <el-alert :title="auth.ssoError" type="error" :closable="false" show-icon />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="remember">保持登录状态并保存到本浏览器</el-checkbox>
        </el-form-item>
        <PrivacyConsent v-model="privacyAccepted" :disabled="auth.ssoLoading" />
        <el-form-item>
          <el-button type="primary" native-type="submit" class="btn-submit" :loading="auth.ssoLoading" :disabled="captchaRefreshing || !privacyAccepted">
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 站内独立账号：新生 / 毕业生 / 站务 / 管理员 -->
      <details class="dev-fallback">
        <summary><AppIcon name="key" /> 其他方式登录</summary>
        <div class="dev-tip">
          适用于暂时无法使用统一认证的账号，例如新生、毕业生或站务账号。
        </div>
        <el-form size="default" class="dev-form" autocomplete="on" @submit.prevent="onDevSubmit">
          <el-input v-model="dev.username" name="username" autocomplete="username" placeholder="用户名" :disabled="dev.loading" />
          <el-input v-model="dev.password" name="password" type="password" show-password autocomplete="current-password" placeholder="密码" :disabled="dev.loading" />
          <PrivacyConsent v-model="privacyAccepted" :disabled="dev.loading" />
          <el-button native-type="submit" :loading="dev.loading" :disabled="dev.loading || !privacyAccepted">登录</el-button>
        </el-form>
        <div v-if="isDev" class="dev-accounts cpu-button-row">
          <button data-cpu-button="action" type="button" @click="fillDev('alice', '123456')">alice / 123456</button>
          <button data-cpu-button="action" type="button" @click="fillDev('bob', '123456')">bob / 123456</button>
          <button data-cpu-button="action" type="button" @click="fillDev('carol', '123456')">carol / 123456</button>
          <button data-cpu-button="action" type="button" @click="fillDev('admin', 'admin123')">admin / admin123</button>
        </div>
      </details>

      <div class="alt-actions">
        <button data-cpu-button="text" type="button" @click="goHome">暂不登录，继续浏览</button>
        <span>·</span>
        <span class="muted-note">多数同学可直接使用统一认证登录</span>
      </div>
  </AuthShell>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { InfoFilled, Lock, Refresh, User } from "@element-plus/icons-vue";
import AuthShell from "@/components/common/AuthShell.vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { loadCreds } from "@/utils/credCrypto";
import { isOAuthAuthorizationRedirect, isServerHandledRedirect, resolveLoginRedirect } from "@/utils/redirect";
import PrivacyConsent from "@/components/common/PrivacyConsent.vue";
import AppIcon from "@/components/common/AppIcon.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const site = useSiteStore();
const formRef = ref<FormInstance>();
const privacyAccepted = ref(false);
const remember = ref(false);
const isDev = computed(() => import.meta.env.DEV);
const captchaRefreshing = ref(false);

const form = reactive({ username: "", password: "", captcha: "" });
const rules: FormRules = {
  username: [{ required: true, message: "请输入学号 / 工号" }],
  password: [{ required: true, message: "请输入密码" }],
};

const dev = reactive({ username: "", password: "", loading: false });

const loginHint = computed(() => {
  const uses: string[] = [];
  if (site.features.forum) uses.push("发帖");
  if (site.features.coursereview) uses.push("课评");
  uses.push("消息通知");
  return `完成统一认证后会自动创建站内账号，可用于${uses.join("、")}。教务数据会在登录后自动识别你可用的本科生 / 研究生入口。`;
});

onMounted(async () => {
  if (auth.isLoggedIn) {
    finishLoginRedirect();
    return;
  }
  // 读取浏览器中加密保存的学校凭据并回填表单，但不自动提交。
  // 这样退出后仍能看到已保存的账号密码，同时避免后台重试把新生账号锁定。
  const savedCreds = await loadCreds().catch(() => null);
  if (savedCreds) {
    form.username = savedCreds.username;
    form.password = savedCreds.password;
    remember.value = true;
  }
  // 准备 CAS 登录页（拿 lt/execution + 验证码）
  // 失败时显式回显，避免移动端用户看到一个能填但提交失败的表单
  try {
    await auth.ssoBegin();
  } catch (e: any) {
    auth.ssoError = "统一认证暂时不可用，请稍后再试。若你无法使用统一认证，可展开下方“其他方式登录”。";
  }
  // 登录页只准备统一认证表单，不自动提交已保存的学校凭据。
});

async function reloadCaptcha() {
  if (auth.ssoLoading || captchaRefreshing.value) return;
  captchaRefreshing.value = true;
  try {
    await auth.ssoBegin();
  } catch {
    auth.ssoError = "统一认证暂时不可用，请稍后再试";
  } finally {
    captchaRefreshing.value = false;
  }
  form.captcha = "";
}

function redirectTarget() {
  return resolveLoginRedirect(route.query.redirect, auth.user);
}

function finishLoginRedirect() {
  const target = redirectTarget();
  if (isOAuthAuthorizationRedirect(target)) {
    window.location.replace(target);
    return;
  }
  // QQ Bot administrator report links are server-rendered action pages. A
  // client-side route change would fall through to the Vue 404 page after
  // login instead of returning to the signed report link.
  if (isServerHandledRedirect(target)) {
    window.location.replace(target);
    return;
  }
  // /voicehub is a separately mounted Nuxt application, not a Vue Router
  // route. Hand it back to the browser so login never flashes the main
  // site's 404 page or falls through to /home.
  if (target === "/voicehub" || target.startsWith("/voicehub/")) {
    window.location.replace(target);
    return;
  }
  void router.replace(target);
}

function goHome() {
  router.replace("/home");
}

async function onSubmit() {
  if (!privacyAccepted.value) {
    ElMessage.warning("请先阅读并主动勾选同意隐私政策和用户协议");
    return;
  }
  if (auth.ssoLoading || captchaRefreshing.value) return;
  try { await formRef.value?.validate(); } catch { return; }
  if (auth.ssoNeedCaptcha && !form.captcha) {
    ElMessage.warning("请输入验证码");
    return;
  }
  if (!auth.ssoNeedCaptcha) {
    try {
      await auth.ssoBegin();
    } catch {
      return;
    }
    if (auth.ssoNeedCaptcha) {
      form.captcha = "";
      ElMessage.info("统一认证要求补充验证码，请输入后继续");
      return;
    }
  }
  const ok = await auth.ssoLogin(form.username, form.password, form.captcha || undefined, remember.value);
  if (ok) {
    ElMessage.success(`欢迎，${auth.user?.nickname || form.username}`);
    finishLoginRedirect();
  } else if (auth.ssoNeedCaptcha) {
    form.captcha = "";
  }
}

function fillDev(u: string, p: string) {
  dev.username = u;
  dev.password = p;
}

async function onDevSubmit() {
  if (!privacyAccepted.value) {
    ElMessage.warning("请先阅读并主动勾选同意隐私政策和用户协议");
    return;
  }
  if (dev.loading) return;
  if (!dev.username || !dev.password) {
    ElMessage.warning("请填写账号和密码");
    return;
  }
  dev.loading = true;
  try {
    await auth.login(dev.username, dev.password);
    ElMessage.success(`欢迎，${auth.user?.nickname}`);
    finishLoginRedirect();
  } catch { /* 拦截器已提示 */ }
  finally { dev.loading = false; }
}
</script>

<style scoped lang="scss">
.auth-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-accent-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.65;
}
.auth-notice .el-icon { flex: 0 0 auto; margin-top: 2px; color: var(--cpu-gold); font-size: var(--cpu-fs-m); }
.auth-notice b { color: var(--cpu-accent); font-weight: 500; }

.btn-submit { width: 100%; letter-spacing: 4px; }

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-img-button {
  height: 38px;
  min-width: 112px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-card);
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
}

.vcode-img {
  height: 36px;
  max-width: 112px;
  object-fit: contain;
  display: block;
}

.vcode-img-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.vcode-img-button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.dev-fallback {
  margin-top: 16px;
  padding: 0 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
}
.dev-fallback summary {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 6px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  cursor: pointer;
  user-select: none;
}
.dev-fallback[open] { padding-bottom: 14px; }
.dev-tip { margin: 0 0 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.dev-form { display: flex; gap: 6px; flex-direction: column; margin-top: 8px; }
.dev-accounts {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-primary);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.dev-accounts button {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--cpu-primary);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.dev-accounts button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
  border-radius: var(--cpu-radius-s);
}

.alt-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}

.alt-actions button {
  border: none;
  background: none;
  padding: 0;
  color: var(--cpu-primary);
  font: inherit;
  cursor: pointer;
}

.alt-actions .muted-note {
  color: var(--cpu-text-muted);
}

@media (max-width: 640px) {
  .vcode-row {
    gap: 6px;
  }

  .vcode-img {
    max-width: 108px;
  }
}
</style>
