<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const router = useRouter();
const loading = ref(false);

let removeListener: (() => void) | null = null;

async function openLogin() {
  loading.value = true;
  try {
    await window.courseBot.chaoxingOpenLogin();
  } catch (e) {
    ElMessage.error("打开登录页失败：" + String(e));
    loading.value = false;
  }
}

onMounted(() => {
  removeListener = window.courseBot.onChaoxingLoginSuccess(() => {
    loading.value = false;
    ElMessage.success("学习通登录成功");
    router.replace("/courses");
  });
});

onUnmounted(() => {
  removeListener?.();
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

      <p class="welcome">绑定 <strong>学习通</strong> 账号</p>
      <p class="hint">点击下方按钮，在弹出的官方页面中登录学习通。支持手机号密码、短信验证码、扫码等所有官方登录方式。</p>

      <div class="action-area">
        <el-button type="primary" size="large" class="btn-submit" :loading="loading" @click="openLogin">
          {{ loading ? '等待登录中...' : '打开学习通登录' }}
        </el-button>
      </div>

      <el-alert type="info" :closable="false" show-icon class="info-tip">
        登录在学习通官方页面完成，本工具不接触你的学习通密码。
      </el-alert>
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
  margin: 0 0 20px;
  line-height: 1.6;
}

.action-area { margin-bottom: 16px; }

.btn-submit {
  width: 100%;
  letter-spacing: 2px;
  height: 44px;
  font-size: 15px;
  background: #148f7b;
  border-color: #148f7b;
}
.btn-submit:hover,
.btn-submit:focus {
  background: #0d6e5e;
  border-color: #0d6e5e;
}

.info-tip { font-size: 12px; }
</style>
