<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const router = useRouter();
const loading = ref(false);
const form = reactive({
  username: "",
  password: "",
  captcha: "",
});
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
  if (needCaptcha.value && !form.captcha) {
    ElMessage.warning("请输入验证码");
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
      ElMessage.success("登录成功");
      router.replace("/chaoxing-login");
    } else {
      ElMessage.error(r.error || "登录失败");
      // 密码错或验证码错 → 重新拉验证码
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

onMounted(beginLogin);
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="title">药大刷课助手</h1>
      <p class="subtitle">使用学校统一认证账号登录</p>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="学号">
          <el-input v-model="form.username" placeholder="请输入学号" clearable />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="学校统一认证密码" show-password />
        </el-form-item>
        <el-form-item v-if="needCaptcha" label="验证码">
          <div class="captcha-row">
            <el-input v-model="form.captcha" placeholder="验证码" />
            <img
              v-if="captchaImage"
              :src="captchaImage"
              class="captcha-img"
              title="点击刷新"
              @click="beginLogin"
            />
            <el-button v-else link @click="beginLogin">获取验证码</el-button>
          </div>
        </el-form-item>
        <el-button type="primary" class="submit-btn" :loading="loading" @click="submit">
          登录
        </el-button>
      </el-form>

      <p class="hint">
        登录即表示同意：本工具仅供辅助完成通识课视频观看，请遵守学校相关规定。
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #f5f7fa 0%, #e4ecf7 100%);
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 340px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}
.title { font-size: 22px; font-weight: 600; color: #1d2129; text-align: center; }
.subtitle { font-size: 13px; color: #86909c; text-align: center; margin: 6px 0 24px; }
.captcha-row { display: flex; gap: 8px; align-items: center; width: 100%; }
.captcha-img { height: 32px; width: 90px; cursor: pointer; border-radius: 4px; border: 1px solid #e5e6eb; }
.submit-btn { width: 100%; margin-top: 8px; }
.hint { font-size: 12px; color: #c9cdd4; margin-top: 16px; line-height: 1.6; text-align: center; }
</style>
