<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="brand">
        <div class="brand-logo">药</div>
        <div>
          <h1>药大垎坊</h1>
          <p>中国药科大学 · 民间学生论坛</p>
        </div>
      </div>

      <p class="welcome">登录</p>
      <p class="hint">使用 <strong>本站独立账号</strong> 登录（与学校账号无关）</p>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="submit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="密码">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="btn-submit" :loading="loading" @click="submit">登 录</el-button>
        </el-form-item>
      </el-form>

      <div class="alt">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>

      <el-divider>测试账号</el-divider>
      <div class="accounts">
        <div class="acc" @click="fill('alice','123456')">
          <span class="acc-name">alice</span><span class="acc-pwd">123456</span><span class="acc-tag">本科生</span>
        </div>
        <div class="acc" @click="fill('bob','123456')">
          <span class="acc-name">bob</span><span class="acc-pwd">123456</span><span class="acc-tag">研究生</span>
        </div>
        <div class="acc" @click="fill('carol','123456')">
          <span class="acc-name">carol</span><span class="acc-pwd">123456</span><span class="acc-tag">新生</span>
        </div>
        <div class="acc" @click="fill('admin','admin123')">
          <span class="acc-name">admin</span><span class="acc-pwd">admin123</span><span class="acc-tag">管理员</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { User, Lock } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: "", password: "" });
const rules: FormRules = {
  username: [{ required: true, message: "请输入用户名" }],
  password: [{ required: true, message: "请输入密码" }],
};

function fill(u: string, p: string) {
  form.username = u; form.password = p;
}

async function submit() {
  try { await formRef.value?.validate(); } catch { return; }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    ElMessage.success(`欢迎，${auth.user?.nickname}`);
    router.push((route.query.redirect as string) || "/home");
  } catch { /* 拦截器已提示 */ }
  finally { loading.value = false; }
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
  width: 420px;
  max-width: 100%;
  background: #fff;
  border-radius: 16px;
  padding: 32px 36px 24px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.1);
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
.hint { font-size: 13px; color: #6b7280; margin: 0 0 16px; }
.hint strong { color: #92400e; }

.btn-submit { width: 100%; letter-spacing: 4px; }

.alt {
  text-align: center;
  font-size: 13px;
  color: #6b7280;
  margin-top: 4px;
  a { color: var(--cpu-primary); margin-left: 4px; }
}

.accounts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.acc {
  cursor: pointer;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  transition: background 0.15s;
}
.acc:hover { background: #f0fdf4; border-color: #168776; }
.acc-name { font-weight: 600; color: #168776; }
.acc-pwd { color: #6b7280; }
.acc-tag { margin-left: auto; font-size: 11px; color: #9ca3af; }
</style>
