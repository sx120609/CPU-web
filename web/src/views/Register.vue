<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-nav">
        <el-button text class="nav-btn" @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回首页
        </el-button>
        <el-button text class="nav-btn" @click="goLogin">直接登录</el-button>
      </div>

      <div class="brand">
        <div class="brand-logo">药</div>
        <div>
          <h1>注册药大拾间</h1>
          <p>暂不开放公开注册</p>
        </div>
      </div>

      <!-- 生产模式：公开注册已关闭 -->
      <template v-if="!isDev">
        <el-alert type="info" :closable="false" show-icon class="closed-tip">
          <div style="line-height:1.7">
            <p style="margin:0 0 6px"><b>公开注册已关闭。</b></p>
            <p style="margin:0">
              药大学生请在 <button type="button" class="inline-link" @click="goLogin">登录页</button> 使用<b>学校统一认证</b>登录，首次登录会自动创建账号。<br>
              暂时无法使用统一认证的账号，可联系站务协助处理。
            </p>
          </div>
        </el-alert>
        <div class="alt" style="margin-top:18px">
          <button type="button" @click="goLogin">去登录页</button>
        </div>
        <PrivacyPolicyNotice />
      </template>

      <!-- 开发模式：保留旧的注册表单便于自测 -->
      <template v-else>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" label-position="top" @keyup.enter="submit">
          <el-form-item label="用户名（登录用）" prop="username">
            <el-input v-model="form.username" placeholder="3-20 位英文/数字/下划线" :disabled="loading" />
          </el-form-item>
          <el-form-item label="昵称（显示用）" prop="nickname">
            <el-input v-model="form.nickname" placeholder="支持中文" maxlength="20" show-word-limit :disabled="loading" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" :disabled="loading" />
          </el-form-item>
          <el-form-item label="院系（选填）">
            <el-input v-model="form.college" placeholder="例如 药学院" maxlength="40" :disabled="loading" />
          </el-form-item>
          <el-form-item label="入学年份（选填）">
            <el-input-number v-model="form.enrollYear" :min="2010" :max="2030" :step="1" style="width:100%" :disabled="loading" />
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="agree" :disabled="loading">我已阅读并同意 <button type="button" class="inline-link" @click.stop="showTerms = true">用户协议</button></el-checkbox>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" class="btn-submit" :loading="loading" :disabled="loading || !agree" @click="submit">注 册</el-button>
          </el-form-item>
        </el-form>

        <div class="alt">
          已有账号？<button type="button" @click="goLogin">直接登录</button>
        </div>
        <PrivacyPolicyNotice />
      </template>
    </div>

    <el-dialog v-model="showTerms" title="药大拾间 用户协议" width="500">
      <p>药大拾间是面向校内同学的交流与服务平台。</p>
      <p>注册即表示你同意：</p>
      <ol>
        <li>不发布违法、违规、人身攻击内容</li>
        <li>所有发帖与回复内容版权归发布者本人</li>
        <li>学号 / 工号会用于创建或关联站内账号；统一认证页勾选保持登录后，会在当前浏览器加密保存账号密码</li>
        <li>站方有权根据情节删除违规内容、封禁账号</li>
        <li>请自行判断信息内容，重要事项以学校正式通知为准</li>
      </ol>
      <template #footer>
        <el-button type="primary" @click="agree = true; showTerms = false">我同意</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { resolveSafeRedirect } from "@/utils/redirect";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const agree = ref(false);
const showTerms = ref(false);
const isDev = computed(() => import.meta.env.DEV);

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

onMounted(() => {
  if (auth.isLoggedIn) router.replace(redirectTarget());
});

function redirectTarget() {
  return resolveSafeRedirect(route.query.redirect);
}

function goHome() {
  router.replace("/home");
}

function goLogin() {
  router.push({ name: "login", query: route.query.redirect ? { redirect: redirectTarget() } : undefined });
}

async function submit() {
  if (loading.value) return;
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
    router.replace(redirectTarget());
  } catch { /* 拦截器已提示 */ }
  finally { loading.value = false; }
}
</script>

<style scoped lang="scss">
.auth-wrap {
  min-height: 100vh;
  min-height: 100dvh;
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

.btn-submit { width: 100%; letter-spacing: 4px; }

.inline-link {
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  padding: 0;
  font: inherit;
  cursor: pointer;
  vertical-align: baseline;
}

.inline-link:hover,
.inline-link:focus-visible {
  text-decoration: underline;
}

.alt {
  text-align: center;
  font-size: 13px;
  color: #6b7280;
  margin-top: 8px;
  button {
    border: none;
    background: none;
    padding: 0;
    color: var(--cpu-primary);
    font: inherit;
    cursor: pointer;
    margin-left: 4px;
  }
}

ol { padding-left: 20px; line-height: 1.8; color: #4b5563; font-size: 13px; }
.closed-tip { font-size: 13px; line-height: 1.6; }
.closed-tip a { color: var(--cpu-primary); text-decoration: underline; }

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
}
</style>
