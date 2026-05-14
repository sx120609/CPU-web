<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-nav">
        <el-button text class="nav-btn" @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回首页
        </el-button>
        <el-button text class="nav-btn" @click="goRegister">注册账号</el-button>
      </div>

      <div class="brand">
        <div class="brand-logo">药</div>
        <div>
          <h1>药大垎坊</h1>
          <p>中国药科大学 · 民间学生论坛</p>
        </div>
      </div>

      <p class="welcome">使用 <strong>学校账号</strong> 登录</p>
      <p class="hint">通过统一身份认证验证你是真正的药大学生 · 论坛账号自动创建</p>

      <el-alert type="warning" :closable="false" show-icon class="safety">
        账号密码<b>仅在登录瞬间</b>经我们后端转发到学校 SSO，永远不写数据库
      </el-alert>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        class="form"
        @keyup.enter="onSubmit"
      >
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="学号">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="密码">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="auth.ssoNeedCaptcha" prop="captcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入验证码" maxlength="8" style="flex:1" />
            <img v-if="auth.ssoCaptchaImage" :src="auth.ssoCaptchaImage" alt="captcha" class="vcode-img" @click="reloadCaptcha" />
            <el-button text @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="auth.ssoError">
          <el-alert :title="auth.ssoError" type="error" :closable="false" show-icon />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="remember">记住此账号（本地加密保存，下次自动登录）</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="btn-submit" :loading="auth.ssoLoading" @click="onSubmit">
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 站内独立账号：新生 / 毕业生 / 站务 / 管理员 -->
      <details class="dev-fallback">
        <summary>🔑 其他登录</summary>
        <div class="dev-tip">
          主要供走不了统一身份认证的账号使用：新生（学号还没下发）、毕业生（统认证已失效）、站务 / 管理员等。使用站内独立用户名 + 密码。
        </div>
        <el-form size="default" class="dev-form" @keyup.enter="onDevSubmit">
          <el-input v-model="dev.username" placeholder="用户名" />
          <el-input v-model="dev.password" type="password" show-password placeholder="密码" />
          <el-button :loading="dev.loading" @click="onDevSubmit">登录</el-button>
        </el-form>
        <div v-if="isDev" class="dev-accounts">
          <span @click="fillDev('alice', '123456')">alice / 123456</span>
          <span @click="fillDev('bob', '123456')">bob / 123456</span>
          <span @click="fillDev('carol', '123456')">carol / 123456</span>
          <span @click="fillDev('admin', 'admin123')">admin / admin123</span>
        </div>
      </details>

      <div class="alt-actions">
        <button type="button" @click="goHome">暂不登录，继续浏览</button>
        <span>·</span>
        <button type="button" @click="goRegister">没有账号？去注册</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { User, Lock, Refresh, ArrowLeft } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { loadCreds, hasCreds } from "@/utils/credCrypto";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const remember = ref(true);
const isDev = computed(() => import.meta.env.DEV);

const form = reactive({ username: "", password: "", captcha: "" });
const rules: FormRules = {
  username: [{ required: true, message: "请输入学号" }],
  password: [{ required: true, message: "请输入密码" }],
};

const dev = reactive({ username: "", password: "", loading: false });

onMounted(async () => {
  if (auth.isLoggedIn) {
    router.replace(redirectTarget());
    return;
  }
  // 准备 CAS 登录页（拿 lt/execution + 验证码）
  await auth.ssoBegin().catch(() => undefined);
  // "刚主动退出"标记：本次进入 /login 不自动登录，标记一次性消耗掉；
  // 关闭浏览器（sessionStorage 失效）后下次再访问就会照常自动登录。
  let justLoggedOut = false;
  try {
    justLoggedOut = sessionStorage.getItem("cpu-just-logged-out") === "1";
    if (justLoggedOut) sessionStorage.removeItem("cpu-just-logged-out");
  } catch { /* ignore */ }
  // 若本地保存了凭据 → 静默自动登录
  if (!justLoggedOut && hasCreds()) {
    const creds = await loadCreds().catch(() => null);
    if (creds && !auth.ssoNeedCaptcha) {
      ElMessage.info("尝试自动登录…");
      const ok = await auth.ssoLogin(creds.username, creds.password, undefined, true);
      if (ok) {
        ElMessage.success(`欢迎，${auth.user?.nickname || creds.username}`);
        router.replace(redirectTarget());
      }
    }
  }
});

async function reloadCaptcha() {
  await auth.ssoBegin().catch(() => undefined);
  form.captcha = "";
}

function redirectTarget() {
  const redirect = route.query.redirect;
  if (typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")) {
    return redirect;
  }
  return "/home";
}

function goHome() {
  router.replace("/home");
}

function goRegister() {
  router.push({ name: "register", query: route.query.redirect ? { redirect: redirectTarget() } : undefined });
}

async function onSubmit() {
  try { await formRef.value?.validate(); } catch { return; }
  if (auth.ssoNeedCaptcha && !form.captcha) {
    ElMessage.warning("请输入验证码");
    return;
  }
  const ok = await auth.ssoLogin(form.username, form.password, form.captcha || undefined, remember.value);
  form.password = ""; // 凭据送出后立刻清空
  if (ok) {
    ElMessage.success(`欢迎，${auth.user?.nickname || form.username}`);
    router.replace(redirectTarget());
  } else if (auth.ssoNeedCaptcha) {
    form.captcha = "";
  }
}

function fillDev(u: string, p: string) {
  dev.username = u;
  dev.password = p;
}

async function onDevSubmit() {
  if (!dev.username || !dev.password) {
    ElMessage.warning("请填写演示账号");
    return;
  }
  dev.loading = true;
  try {
    await auth.login(dev.username, dev.password);
    ElMessage.success(`欢迎，${auth.user?.nickname}`);
    router.replace(redirectTarget());
  } catch { /* 拦截器已提示 */ }
  finally { dev.loading = false; }
}
</script>

<style scoped lang="scss">
.auth-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #f4f6f8, #e0f2ef);
  padding: 20px;
}

.auth-card {
  width: 440px;
  max-width: 100%;
  background: #fff;
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
.brand p { margin: 2px 0 0; font-size: 12px; color: #6b7280; }

.welcome { font-size: 18px; color: #111827; margin: 6px 0 4px; font-weight: 600; }
.welcome strong { color: var(--cpu-primary); }
.hint { font-size: 13px; color: #6b7280; margin: 0 0 14px; line-height: 1.6; }

.safety { margin-bottom: 14px; font-size: 12px; }
.safety b { color: #b45309; }

.btn-submit { width: 100%; letter-spacing: 4px; }

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-img {
  height: 36px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
}

.dev-fallback {
  margin-top: 18px;
  padding: 10px 14px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px dashed #e5e7eb;
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
.dev-accounts span { cursor: pointer; text-decoration: underline; }

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

@media (max-width: 640px) {
  .auth-wrap {
    min-height: 100dvh;
    align-items: start;
    padding: calc(18px + env(safe-area-inset-top)) 12px 18px;
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
