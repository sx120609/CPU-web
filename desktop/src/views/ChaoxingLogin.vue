<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

const router = useRouter();
const loading = ref(false);
const form = reactive({ phone: "", password: "" });

async function submit() {
  if (!form.phone || !form.password) {
    ElMessage.warning("请输入手机号和密码");
    return;
  }
  loading.value = true;
  try {
    const r = await window.courseBot.chaoxingLogin(form.phone, form.password);
    if (r.ok) {
      ElMessage.success("学习通登录成功");
      router.replace("/courses");
    } else {
      ElMessage.error(r.error || "登录失败");
    }
  } catch (e) {
    ElMessage.error("登录请求失败：" + String(e));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="cx-login-page">
    <div class="cx-login-card">
      <h1 class="title">登录学习通</h1>
      <p class="subtitle">输入学习通/超星账号登录</p>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="手机号">
          <el-input
            v-model="form.phone"
            placeholder="学习通注册手机号"
            clearable
            maxlength="11"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="学习通密码"
            show-password
          />
        </el-form-item>
        <el-button
          type="primary"
          class="submit-btn"
          :loading="loading"
          @click="submit"
        >
          登录
        </el-button>
      </el-form>

      <p class="hint">
        使用学习通（超星）账号登录，非学校统一认证账号。
      </p>
    </div>
  </div>
</template>

<style scoped>
.cx-login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #f0f5ff 0%, #e8ecf4 100%);
  padding: 24px;
}
.cx-login-card {
  width: 100%;
  max-width: 340px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}
.title { font-size: 22px; font-weight: 600; color: #1d2129; text-align: center; }
.subtitle { font-size: 13px; color: #86909c; text-align: center; margin: 6px 0 24px; }
.submit-btn { width: 100%; margin-top: 8px; }
.hint { font-size: 12px; color: #c9cdd4; margin-top: 16px; line-height: 1.6; text-align: center; }
</style>
