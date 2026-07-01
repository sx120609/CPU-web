<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const router = useRouter();
const loading = ref(false);
const remember = ref(true);
const form = reactive({ username: "", password: "", captcha: "" });
const pendingId = ref("");
const captchaImage = ref("");
const needCaptcha = ref(false);

async function beginLogin() {
  loading.value = true;
  try {
    const r = await window.courseBot.ssoBegin();
    pendingId.value = r.pendingId;
    needCaptcha.value = r.needCaptcha;
    captchaImage.value = r.captchaImage || "";
  } catch (e) {
    ElMessage.error("获取登录凭据失败：" + String(e));
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.username || !form.password) {
    ElMessage.warning("请输入学号和密码");
    return;
  }
  loading.value = true;
  try {
    const r = await window.courseBot.ssoLogin({
      pendingId: pendingId.value,
      username: form.username,
      password: form.password,
      captcha: form.captcha || undefined,
    });
    if (r.ok) {
      if (remember.value) {
        await window.courseBot.saveCredentials("sso", {
          username: form.username,
          password: form.password,
        });
      }
      ElMessage.success("登录成功");
      router.replace("/chaoxing-login");
    } else {
      ElMessage.error(r.error || "登录失败");
      form.captcha = "";
      await beginLogin();
    }
  } catch (e) {
    ElMessage.error("登录请求失败：" + String(e));
    await beginLogin();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  const saved = await window.courseBot.loadCredentials("sso");
  if (saved?.username) {
    form.username = saved.username;
    form.password = saved.password || "";
  }
  await beginLogin();
});
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-nav">
        <button class="nav-btn" @click="router.replace('/welcome')">
          &larr; 返回
        </button>
      </div>

      <div class="brand">
        <div class="brand-logo">药</div>
        <div>
          <h1>药大拾间</h1>
          <p>中国药科大学 · 校园互助与服务平台</p>
        </div>
      </div>

      <p class="welcome">使用 <strong>学校统一认证</strong> 登录</p>
      <p class="hint">仅用于验证身份和分配 AI 答题额度，视频刷课功能免费。</p>

      <el-alert type="warning" :closable="false" show-icon class="safety">
        学号仅用于识别身份，<b>密码和验证码不会保存到服务器</b>
      </el-alert>

      <el-form size="large" class="form" @submit.prevent="submit" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="学号 / 工号" clearable :disabled="loading">
            <template #prefix><span class="input-icon">👤</span></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" show-password :disabled="loading">
            <template #prefix><span class="input-icon">🔒</span></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="needCaptcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入验证码" maxlength="8" style="flex:1" :disabled="loading" />
            <button
              v-if="captchaImage"
              type="button"
              class="vcode-img-button"
              :disabled="loading"
              title="刷新验证码"
              @click="beginLogin"
            >
              <img :src="captchaImage" alt="captcha" class="vcode-img" />
            </button>
            <button v-else type="button" class="refresh-btn" @click="beginLogin">刷新</button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="remember">记住登录信息（仅保存在当前设备）</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="btn-submit" :loading="loading" @click="submit">
            登 录
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  height: 100%;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #f4f6f8, #e0f2ef);
  padding: 20px;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 36px 24px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.1);
}

.auth-nav {
  display: flex;
  margin: -12px -10px 18px;
}

.nav-btn {
  min-height: 34px;
  padding: 0 10px;
  color: #148f7b;
  background: none;
  border: none;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.nav-btn:hover { opacity: 0.8; }

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
  flex-shrink: 0;
}

.brand h1 {
  margin: 0;
  font-size: 20px;
  color: #168776;
}
.brand p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #6b7280;
}

.welcome {
  font-size: 18px;
  color: #111827;
  margin: 6px 0 4px;
  font-weight: 600;
}
.welcome strong { color: #148f7b; }

.hint {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 14px;
  line-height: 1.6;
}

.safety { margin-bottom: 14px; font-size: 12px; }
.safety b { color: #b45309; }

.form { margin-top: 4px; }

.input-icon { font-size: 14px; line-height: 1; }

.btn-submit {
  width: 100%;
  letter-spacing: 4px;
  background: #148f7b;
  border-color: #148f7b;
}
.btn-submit:hover,
.btn-submit:focus {
  background: #0d6e5e;
  border-color: #0d6e5e;
}

.vcode-row {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.vcode-img-button {
  height: 38px;
  min-width: 112px;
  border: 1px solid #e5e7eb;
  border-radius: 5px;
  background: #fff;
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
}
.vcode-img-button:disabled { cursor: not-allowed; opacity: 0.62; }
.vcode-img {
  height: 36px;
  max-width: 112px;
  object-fit: contain;
  display: block;
}

.refresh-btn {
  border: 1px solid #e5e7eb;
  border-radius: 5px;
  background: #fff;
  padding: 6px 12px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  color: #148f7b;
}
.refresh-btn:hover { background: #f9fafb; }
</style>
