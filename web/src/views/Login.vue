<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-nav">
        <el-button text class="nav-btn" @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回首页
        </el-button>
      </div>

      <div class="brand">
        <div class="brand-logo">药</div>
        <div>
          <h1>药大拾间</h1>
          <p>中国药科大学 · 校园互助与服务平台</p>
        </div>
      </div>

      <p class="welcome">使用 <strong>学校统一认证</strong> 登录</p>
      <p class="hint">{{ loginHint }}</p>

      <el-alert type="warning" :closable="false" show-icon class="safety">
        学号 / 工号仅用于识别身份并关联账号；勾选保持登录后，<b>学校密码会加密保存在当前浏览器</b>，验证码不会保存。
      </el-alert>

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
            <button
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
        <el-form-item>
          <el-button type="primary" native-type="submit" class="btn-submit" :loading="auth.ssoLoading" :disabled="captchaRefreshing">
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <PrivacyPolicyNotice />

      <!-- 站内独立账号：新生 / 毕业生 / 站务 / 管理员 -->
      <details class="dev-fallback">
        <summary>🔑 其他方式登录</summary>
        <div class="dev-tip">
          适用于暂时无法使用统一认证的账号，例如新生、毕业生或站务账号。
        </div>
        <el-form size="default" class="dev-form" autocomplete="on" @submit.prevent="onDevSubmit">
          <el-input v-model="dev.username" name="username" autocomplete="username" placeholder="用户名" :disabled="dev.loading" />
          <el-input v-model="dev.password" name="password" type="password" show-password autocomplete="current-password" placeholder="密码" :disabled="dev.loading" />
          <el-button native-type="submit" :loading="dev.loading" :disabled="dev.loading">登录</el-button>
        </el-form>
        <div v-if="isDev" class="dev-accounts">
          <button type="button" @click="fillDev('alice', '123456')">alice / 123456</button>
          <button type="button" @click="fillDev('bob', '123456')">bob / 123456</button>
          <button type="button" @click="fillDev('carol', '123456')">carol / 123456</button>
          <button type="button" @click="fillDev('admin', 'admin123')">admin / admin123</button>
        </div>
      </details>

      <div class="alt-actions">
        <button type="button" @click="goHome">暂不登录，继续浏览</button>
        <span>·</span>
        <span class="muted-note">多数同学可直接使用统一认证登录</span>
      </div>
    </div>

    <FreshmanAccountNotice v-model="freshmanNoticeVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { User, Lock, Refresh, ArrowLeft } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { loadCreds, hasCreds } from "@/utils/credCrypto";
import { isOAuthAuthorizationRedirect, resolveLoginRedirect } from "@/utils/redirect";
import { shouldShowFreshmanNotice } from "@/utils/freshmanNotice";
import FreshmanAccountNotice from "@/components/common/FreshmanAccountNotice.vue";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const site = useSiteStore();
const formRef = ref<FormInstance>();
const remember = ref(true);
const isDev = computed(() => import.meta.env.DEV);
const captchaRefreshing = ref(false);
const freshmanNoticeVisible = ref(false);

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
  freshmanNoticeVisible.value = shouldShowFreshmanNotice();
  // 准备 CAS 登录页（拿 lt/execution + 验证码）
  // 失败时显式回显，避免移动端用户看到一个能填但提交失败的表单
  try {
    await auth.ssoBegin();
  } catch (e: any) {
    auth.ssoError = "统一认证暂时不可用，请稍后再试。若你无法使用统一认证，可展开下方“其他方式登录”。";
  }
  // "刚主动退出"标记：本次进入 /login 不自动登录，标记一次性消耗掉；
  // 关闭浏览器（sessionStorage 失效）后下次再访问就会照常自动登录。
  let justLoggedOut = false;
  try {
    justLoggedOut = sessionStorage.getItem("cpu-just-logged-out") === "1";
    if (justLoggedOut) sessionStorage.removeItem("cpu-just-logged-out");
  } catch { /* ignore */ }
  if (!justLoggedOut && hasCreds() && !auth.ssoError) {
    const creds = await loadCreds().catch(() => null);
    if (creds && !auth.ssoNeedCaptcha) {
      ElMessage.info("正在尝试自动登录…");
      const ok = await auth.tryAutoSsoLogin();
      if (ok) {
        ElMessage.success(`欢迎，${auth.user?.nickname || creds.username}`);
        finishLoginRedirect();
      }
    }
  }
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
.auth-wrap {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at top right, rgba(20, 184, 166, 0.16), transparent 34%),
    linear-gradient(135deg, var(--cpu-bg), var(--cpu-surface));
  padding: 20px;
}

.auth-card {
  width: 440px;
  max-width: 100%;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  padding: 32px 36px 24px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.1);
}

.auth-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: -12px -10px 18px;
}

.nav-btn {
  min-height: 34px;
  padding: 0 10px;
  color: var(--cpu-primary);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.brand-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #168776, #0f6557);
  color: #e8a317;
  display: grid;
  place-items: center;
  font-family: serif;
  font-size: 24px;
  font-weight: 700;
}

.brand h1 { margin: 0; font-size: 20px; color: #168776; }
.brand p { margin: 2px 0 0; font-size: 12px; color: var(--cpu-text-secondary); }

.welcome { font-size: 18px; color: var(--cpu-text); margin: 6px 0 4px; font-weight: 600; }
.welcome strong { color: var(--cpu-primary); }
.hint { font-size: 13px; color: var(--cpu-text-secondary); margin: 0 0 14px; line-height: 1.6; }
.identity-picker { margin-bottom: 14px; }

.safety { margin-bottom: 14px; font-size: 12px; }
.safety b { color: #b45309; }

.btn-submit { width: 100%; letter-spacing: 4px; }

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-img-button {
  height: 38px;
  min-width: 112px;
  border: 1px solid var(--cpu-border);
  border-radius: 5px;
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
  margin-top: 18px;
  padding: 10px 14px;
  background: var(--cpu-surface-subtle);
  border-radius: 8px;
  border: 1px dashed var(--cpu-border);
}
.dev-fallback summary {
  cursor: pointer;
  font-size: 12px;
  color: #9ca3af;
  user-select: none;
}
.dev-tip { font-size: 11px; color: #b45309; margin: 8px 0; }
.dev-form { display: flex; gap: 6px; flex-direction: column; margin-top: 8px; }
.dev-accounts {
  font-size: 11px;
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
  border-radius: 4px;
}

.alt-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
  color: #cbd5e1;
  font-size: 12px;
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
  color: #9ca3af;
}

@media (max-width: 640px) {
  .auth-wrap {
    min-height: 100dvh;
    align-items: start;
    padding: calc(18px + var(--cpu-safe-area-inset-top, 0px)) 12px 18px;
  }

  .auth-card {
    width: 100%;
    border-radius: 14px;
    padding: 22px 18px 18px;
  }

  .brand {
    margin-bottom: 16px;
  }

  .auth-nav {
    margin: -8px -8px 16px;
  }

  .brand-logo {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    font-size: 22px;
  }

  .welcome {
    font-size: 17px;
  }

  .vcode-row {
    gap: 6px;
  }

  .vcode-img {
    max-width: 108px;
  }

}
</style>
