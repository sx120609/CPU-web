<template>
  <div class="forgot-form">
    <div class="form-header">
      <h2>{{ isResetMode ? '重置密码' : '忘记密码' }}</h2>
      <p v-if="isResetMode">请设置新密码，完成后使用新密码登录</p>
      <p v-else>输入 QQ 邮箱后，我们会发送重置链接到你的邮箱</p>
    </div>

    <form :class="['auth-form', { 'has-error': !!error }]" @submit.prevent="handleSubmit">
      <template v-if="!isResetMode">
        <div class="form-group">
          <label for="emailPrefix">邮箱</label>
          <div class="input-wrapper email-split">
            <input
              id="emailPrefix"
              v-model="emailPrefix"
              :class="{ 'input-error': error }"
              placeholder="请输入邮箱前缀"
              required
              type="text"
              @input="clearMessages"
            >
            <select class="email-domain-select" disabled>
              <option value="@qq.com">@qq.com</option>
            </select>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="form-group">
          <label for="newPassword">新密码</label>
          <div class="input-wrapper">
            <input
              id="newPassword"
              v-model="password"
              :class="{ 'input-error': error }"
              :type="showPassword ? 'text' : 'password'"
              placeholder="至少6位"
              required
              @input="clearMessages"
            >
            <button class="password-toggle" type="button" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label for="confirmPassword">确认新密码</label>
          <div class="input-wrapper">
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              :class="{ 'input-error': error }"
              :type="showConfirmPassword ? 'text' : 'password'"
              placeholder="请再次输入新密码"
              required
              @input="clearMessages"
            >
            <button
              class="password-toggle"
              type="button"
              @click="showConfirmPassword = !showConfirmPassword"
            >
              {{ showConfirmPassword ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>
      </template>

      <div v-if="info" class="info-container">
        <span class="info-message">{{ info }}</span>
      </div>

      <div v-if="error" class="error-container">
        <span class="error-message">{{ error }}</span>
      </div>

      <button :disabled="loading" class="submit-btn" type="submit">
        <span v-if="loading">{{ isResetMode ? '提交中...' : '发送中...' }}</span>
        <span v-else>{{ isResetMode ? '重置密码' : '发送重置链接' }}</span>
      </button>
    </form>

    <div class="form-footer">
      <p class="help-text"><NuxtLink to="/login">返回登录</NuxtLink></p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

const route = useRoute()
const token = computed(() =>
  typeof route.query.token === 'string' ? route.query.token.trim() : ''
)
const isResetMode = computed(() => !!token.value)

const qqNumberRegex = /^[1-9]\d{4,10}$/

const emailPrefix = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const loading = ref(false)
const info = ref('')
const error = ref('')

const clearMessages = () => {
  info.value = ''
  error.value = ''
}

const handleSendLink = async () => {
  const qqNumber = emailPrefix.value.trim().toLowerCase()
  if (!qqNumberRegex.test(qqNumber)) {
    error.value = '请输入正确的QQ邮箱前缀'
    return
  }

  loading.value = true
  clearMessages()

  try {
    const response: any = await $fetch('/api/auth/forgot-password/send-link', {
      method: 'POST',
      body: { qqNumber }
    })
    info.value = response?.message || '如果账号存在，重置链接已发送到邮箱'
  } catch (err: any) {
    error.value = extractDisplayErrorMessage(err, '发送失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const handleResetPassword = async () => {
  if (!password.value || password.value.length < 6) {
    error.value = '新密码长度不能少于6位'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  clearMessages()

  try {
    await $fetch('/api/auth/forgot-password/reset', {
      method: 'POST',
      body: {
        token: token.value,
        password: password.value
      }
    })

    info.value = '密码重置成功，2秒后跳转到登录页'
    setTimeout(() => navigateTo('/login'), 2000)
  } catch (err: any) {
    error.value = extractDisplayErrorMessage(err, '重置失败，请重试')
  } finally {
    loading.value = false
  }
}

const handleSubmit = async () => {
  if (isResetMode.value) {
    await handleResetPassword()
    return
  }

  await handleSendLink()
}
</script>

<style scoped>
.forgot-form {
  width: 100%;
  max-width: 420px;
}

.form-header {
  text-align: center;
  margin-bottom: 24px;
}

.form-header h2 {
  color: var(--text-primary);
  font-size: 28px;
  margin: 0 0 8px;
  font-weight: 700;
}

.form-header p {
  color: var(--text-secondary);
  margin: 0;
  font-size: 14px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.input-wrapper {
  position: relative;
}

.email-split {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-wrapper input {
  width: 100%;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 14px;
  transition: border-color 0.2s;
}

.email-domain-select {
  flex-shrink: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-secondary);
  border-radius: 10px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  appearance: none;
}

.input-wrapper input:focus {
  outline: none;
  border-color: var(--accent-primary, #4f8cff);
}

.input-wrapper input.input-error {
  border-color: #ef4444;
}

.password-toggle {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}

.info-container {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 10px;
  padding: 10px 12px;
}

.info-message {
  color: #60a5fa;
  font-size: 13px;
}

.error-container {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  padding: 10px 12px;
}

.error-message {
  color: #ef4444;
  font-size: 13px;
}

.submit-btn {
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}

.submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.form-footer {
  margin-top: 18px;
  text-align: center;
}

.help-text {
  font-size: 13px;
  color: var(--text-secondary);
}

.help-text a {
  color: #60a5fa;
  text-decoration: none;
  font-weight: 600;
}

.help-text a:hover {
  text-decoration: underline;
}
</style>
