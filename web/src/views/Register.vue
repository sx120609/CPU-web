<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="brand">
        <div class="brand-logo">药</div>
        <div>
          <h1>注册药大垎坊</h1>
          <p>本站独立账号 · 不会接触你的学校账号</p>
        </div>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" label-position="top" @keyup.enter="submit">
        <el-form-item label="用户名（登录用）" prop="username">
          <el-input v-model="form.username" placeholder="3-20 位英文/数字/下划线" />
        </el-form-item>
        <el-form-item label="昵称（显示用）" prop="nickname">
          <el-input v-model="form.nickname" placeholder="支持中文" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="院系（选填）">
          <el-input v-model="form.college" placeholder="例如 药学院" maxlength="40" />
        </el-form-item>
        <el-form-item label="入学年份（选填）">
          <el-input-number v-model="form.enrollYear" :min="2010" :max="2030" :step="1" style="width:100%" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="agree">我已阅读并同意 <a href="javascript:" @click.prevent="showTerms = true">用户协议</a></el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="btn-submit" :loading="loading" :disabled="!agree" @click="submit">注 册</el-button>
        </el-form-item>
      </el-form>

      <div class="alt">
        已有账号？<router-link to="/login">直接登录</router-link>
      </div>
    </div>

    <el-dialog v-model="showTerms" title="药大垎坊 用户协议" width="500">
      <p>本站为中国药科大学学生自发聚合站，<b>与学校官方无关</b>。</p>
      <p>注册即表示你同意：</p>
      <ol>
        <li>不发布违法、违规、人身攻击内容</li>
        <li>所有发帖与回复内容版权归发布者本人</li>
        <li>本站不收集、不存储任何学校账号或密码</li>
        <li>站方有权根据情节删除违规内容、封禁账号</li>
        <li>本站功能仅供学习交流参考，不构成任何官方意见</li>
      </ol>
      <template #footer>
        <el-button type="primary" @click="agree = true; showTerms = false">我同意</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const agree = ref(false);
const showTerms = ref(false);

const form = reactive({
  username: "", password: "", nickname: "",
  college: "", enrollYear: undefined as number | undefined,
});

const rules: FormRules = {
  username: [
    { required: true, message: "请输入用户名" },
    { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: "3-20 位英文/数字/下划线" },
  ],
  nickname: [{ required: true, message: "请输入昵称" }],
  password: [
    { required: true, message: "请输入密码" },
    { min: 6, message: "至少 6 位" },
  ],
};

async function submit() {
  try { await formRef.value?.validate(); } catch { return; }
  if (!agree.value) { ElMessage.warning("请先同意用户协议"); return; }
  loading.value = true;
  try {
    await auth.register({
      username: form.username,
      password: form.password,
      nickname: form.nickname,
      college: form.college || undefined,
      enrollYear: form.enrollYear,
    });
    ElMessage.success(`欢迎，${auth.user?.nickname}！注册成功`);
    router.push("/home");
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
  width: 460px;
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

.btn-submit { width: 100%; letter-spacing: 4px; }

.alt {
  text-align: center;
  font-size: 13px;
  color: #6b7280;
  margin-top: 8px;
  a { color: var(--cpu-primary); margin-left: 4px; }
}

ol { padding-left: 20px; line-height: 1.8; color: #4b5563; font-size: 13px; }
</style>
