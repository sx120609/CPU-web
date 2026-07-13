<template>
  <div class="login-form">
    <div class="form-header">
      <h2>{{ isBindMode ? '绑定账号' : '欢迎回来' }}</h2>
      <p v-if="isBindMode">即将绑定 {{ providerName }} 账号: {{ providerUsername }}</p>
      <p v-else>使用 QQ 邮箱登录 VoiceHub</p>
    </div>

    <form :class="['auth-form', { 'has-error': !!error }]" @submit.prevent="handleLogin">
      <template v-if="isBindMode">
        <div class="form-group">
          <label for="username">账号</label>
          <div class="input-wrapper">
            <input
              id="username"
              v-model="username"
              :class="{ 'input-error': error }"
              placeholder="请输入账号"
              required
              type="text"
              @input="clearMessages"
            >
          </div>
        </div>

        <div class="form-group">
          <label for="password">密码</label>
          <div class="input-wrapper">
            <input
              id="password"
              v-model="password"
              :class="{ 'input-error': error }"
              :type="showPassword ? 'text' : 'password'"
              placeholder="请输入密码"
              required
              @input="clearMessages"
            >
            <button class="password-toggle" type="button" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="login-mode-switch" role="tablist" aria-label="登录方式">
          <button
            :class="['mode-btn', { active: loginMode === 'password' }]"
            type="button"
            @click="switchLoginMode('password')"
          >
            密码登录
          </button>
          <button
            :class="['mode-btn', { active: loginMode === 'code' }]"
            type="button"
            @click="switchLoginMode('code')"
          >
            邮箱验证码登录
          </button>
        </div>

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

        <div v-if="loginMode === 'password'" class="form-group">
          <label for="passwordLogin">密码</label>
          <div class="input-wrapper">
            <input
              id="passwordLogin"
              v-model="password"
              :class="{ 'input-error': error }"
              :type="showPassword ? 'text' : 'password'"
              placeholder="请输入密码"
              required
              @input="clearMessages"
            >
            <button class="password-toggle" type="button" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div v-else class="form-group">
          <label for="verificationCode">邮箱验证码</label>
          <div class="input-wrapper code-row">
            <input
              id="verificationCode"
              v-model="verificationCode"
              :class="{ 'input-error': error }"
              maxlength="6"
              placeholder="请输入6位验证码"
              required
              type="text"
              @input="clearMessages"
            >
            <button
              :disabled="sendingCode || resendCooldown > 0 || loading"
              class="send-code-btn"
              type="button"
              @click="handleSendCode"
            >
              {{ sendCodeButtonText }}
            </button>
          </div>
          <p class="form-tip">验证码 10 分钟内有效</p>
        </div>
      </template>

      <div v-if="info" class="info-container">
        <span class="info-message">{{ info }}</span>
      </div>

      <div v-if="error" class="error-container">
        <span class="error-message">{{ error }}</span>
      </div>

      <div v-if="showActivationResend && !isBindMode" class="activation-resend">
        <p class="form-tip">未收到激活邮件或链接已过期，可重新发送激活邮件</p>
        <button
          :disabled="resendingActivation || loading"
          class="resend-activation-btn"
          type="button"
          @click="handleResendActivation"
        >
          {{ resendingActivation ? '发送中...' : '重发激活邮件' }}
        </button>
      </div>

      <button :disabled="loading" class="submit-btn" type="submit">
        <svg v-if="loading" class="loading-spinner" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            fill="none"
            r="10"
            stroke="currentColor"
            stroke-dasharray="31.416"
            stroke-dashoffset="31.416"
            stroke-linecap="round"
            stroke-width="2"
          >
            <animate
              attributeName="stroke-dasharray"
              dur="2s"
              repeatCount="indefinite"
              values="0 31.416;15.708 15.708;0 31.416"
            />
            <animate
              attributeName="stroke-dashoffset"
              dur="2s"
              repeatCount="indefinite"
              values="0;-15.708;-31.416"
            />
          </circle>
        </svg>
        <span v-if="loading">{{ isBindMode ? '绑定中...' : '登录中...' }}</span>
        <span v-else>{{ submitText }}</span>
      </button>
    </form>

    <AuthOAuthButtons v-if="!isBindMode" />

    <div class="form-footer">
      <p class="help-text">不同VoiceHub平台的账号不互通</p>
      <p v-if="!isBindMode" class="help-text register-link">
        <NuxtLink to="/forgot-password">忘记密码？</NuxtLink>
      </p>
      <p v-if="!isBindMode" class="help-text register-link">
        没有账号？<NuxtLink to="/register">立即注册</NuxtLink>
      </p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { getProviderDisplayName } from '~/utils/oauth'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

const route = useRoute()
const router = useRouter()
const isBindMode = computed(() => route.query.action === 'bind')
const providerUsername = computed(() => route.query.username || '')
const providerName = computed(() => {
  const provider = (route.query.provider as string) || '第三方'
  return getProviderDisplayName(provider)
})

const username = ref('')
const password = ref('')
const showPassword = ref(false)

const emailPrefix = ref('')
const verificationCode = ref('')
const loginMode = ref<'password' | 'code'>('password')

const error = ref('')
const info = ref('')
const loading = ref(false)
const sendingCode = ref(false)
const resendCooldown = ref(0)
const showActivationResend = ref(false)
const resendingActivation = ref(false)
const pendingActivationEmail = ref('')

let cooldownTimer: ReturnType<typeof setInterval> | null = null

const qqNumberRegex = /^[1-9]\d{4,10}$/
const qqEmailRegex = /^[1-9]\d{4,10}@qq\.com$/

const auth = useAuth()

const normalizeQQPrefixInput = (value: string): string => value.trim().toLowerCase()
const normalizeAccountInput = (value: string): string => value.trim()

const clearMessages = () => {
  error.value = ''
  info.value = ''
}

onMounted(async () => {
  const activation = typeof route.query.activation === 'string' ? route.query.activation : ''
  if (!activation) {
    return
  }

  const activationMessageMap: Record<string, { type: 'info' | 'error'; message: string }> = {
    success: { type: 'info', message: '邮箱激活成功，请登录' },
    already: { type: 'info', message: '账号已激活，请直接登录' },
    expired: { type: 'error', message: '激活链接已过期，请重新发送激活链接' },
    invalid: { type: 'error', message: '激活链接无效，请重新获取' },
    blocked: { type: 'error', message: '账号当前不可用，请联系管理员处理' },
    server: { type: 'error', message: '激活过程中发生异常，请稍后重试或重新发送激活链接' }
  }

  const payload = activationMessageMap[activation]
  if (payload) {
    if (payload.type === 'info') {
      info.value = payload.message
      error.value = ''
    } else {
      error.value = payload.message
      info.value = ''
    }

    if (activation === 'expired' || activation === 'invalid' || activation === 'server') {
      showActivationResend.value = true
    }
  }

  const nextQuery = { ...route.query }
  delete nextQuery.activation
  await router.replace({ path: route.path, query: nextQuery })
})

const switchLoginMode = (mode: 'password' | 'code') => {
  loginMode.value = mode
  clearMessages()
}

const resolveAfterLoginPath = () => {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  if (redirect) {
    return redirect
  }
  return auth.isAdmin.value ? '/dashboard' : '/'
}

const stopCooldownTimer = () => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
}

const startCooldown = (seconds: number) => {
  stopCooldownTimer()
  resendCooldown.value = seconds
  cooldownTimer = setInterval(() => {
    if (resendCooldown.value <= 1) {
      resendCooldown.value = 0
      stopCooldownTimer()
      return
    }
    resendCooldown.value -= 1
  }, 1000)
}

onBeforeUnmount(() => {
  stopCooldownTimer()
})

const sendCodeButtonText = computed(() => {
  if (sendingCode.value) {
    return '发送中...'
  }
  if (resendCooldown.value > 0) {
    return `${resendCooldown.value}秒后重发`
  }
  return '发送验证码'
})

const submitText = computed(() => {
  if (isBindMode.value) {
    return '绑定并登录'
  }
  return loginMode.value === 'password' ? '密码登录' : '验证码登录'
})

const extractErrorMessage = (err: any, fallback: string) => {
  return extractDisplayErrorMessage(err, fallback)
}

const extractQQPrefixFromEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase()
  if (!qqEmailRegex.test(normalized)) {
    return ''
  }
  return normalized.slice(0, -'@qq.com'.length)
}

const parseActivationError = (err: any): { isActivationError: boolean; email: string } => {
  const payload = err?.data?.data ?? err?.data ?? {}
  const code = typeof payload?.code === 'string' ? payload.code : ''
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const message = extractErrorMessage(err, '')
  const isActivationError = code === 'ACCOUNT_NOT_ACTIVATED' || /未激活|激活链接/.test(message)
  return { isActivationError, email }
}

const resolveActivationResendTarget = (): { email: string } | { qqNumber: string } | null => {
  const prefix = normalizeQQPrefixInput(emailPrefix.value)
  if (qqNumberRegex.test(prefix)) {
    return { qqNumber: prefix }
  }

  const email = pendingActivationEmail.value.trim().toLowerCase()
  if (qqEmailRegex.test(email)) {
    return { email }
  }

  return null
}

const handleResendActivation = async () => {
  if (resendingActivation.value || loading.value) {
    return
  }

  const target = resolveActivationResendTarget()
  if (!target) {
    error.value = '请先输入QQ邮箱前缀后再重发激活邮件'
    return
  }

  resendingActivation.value = true
  error.value = ''
  info.value = ''

  try {
    const response: any = await $fetch('/api/auth/register/resend-code', {
      method: 'POST',
      body: target
    })

    info.value = response?.message || '激活邮件已发送，请查收邮箱'
  } catch (err: any) {
    error.value = extractErrorMessage(err, '重发激活邮件失败，请稍后重试')
  } finally {
    resendingActivation.value = false
  }
}

const handleSendCode = async () => {
  if (isBindMode.value || sendingCode.value || loading.value || resendCooldown.value > 0) {
    return
  }

  const qqNumber = normalizeQQPrefixInput(emailPrefix.value)
  if (!qqNumberRegex.test(qqNumber)) {
    error.value = '请输入正确的QQ邮箱前缀'
    return
  }

  clearMessages()
  sendingCode.value = true

  try {
    const response: any = await $fetch('/api/auth/email-login/send-code', {
      method: 'POST',
      body: {
        qqNumber
      }
    })

    info.value = response?.message || '验证码已发送，请查收邮箱'
    startCooldown(Number(response?.resendCooldownSeconds) || 60)
  } catch (err: any) {
    error.value = extractErrorMessage(err, '发送验证码失败，请稍后重试')
  } finally {
    sendingCode.value = false
  }
}

const handleLogin = async () => {
  loading.value = true
  clearMessages()
  showActivationResend.value = false

  try {
    if (isBindMode.value) {
      if (!username.value || !password.value) {
        error.value = '请填写完整的登录信息'
        return
      }

      await $fetch('/api/auth/bind', {
        method: 'POST',
        body: {
          username: username.value,
          password: password.value
        }
      })

      await auth.initAuth()
      await navigateTo('/')
      return
    }

    if (loginMode.value === 'password') {
      const account = normalizeAccountInput(emailPrefix.value)
      if (!account) {
        error.value = '请输入账号或邮箱前缀'
        return
      }

      if (!password.value) {
        error.value = '请输入密码'
        return
      }

      await auth.login(account, password.value)

      await navigateTo(resolveAfterLoginPath())
      return
    }

    const qqNumber = normalizeQQPrefixInput(emailPrefix.value)
    if (!qqNumberRegex.test(qqNumber)) {
      error.value = '验证码登录仅支持QQ邮箱前缀'
      return
    }

    if (!/^\d{6}$/.test(verificationCode.value.trim())) {
      error.value = '请输入6位数字验证码'
      return
    }

    await $fetch('/api/auth/email-login/verify', {
      method: 'POST',
      body: {
        qqNumber,
        code: verificationCode.value.trim()
      }
    })

    await auth.initAuth()
    await navigateTo(resolveAfterLoginPath())
  } catch (err: any) {
    error.value = extractErrorMessage(err, isBindMode.value ? '绑定失败，请检查账号密码' : '登录失败，请重试')
    const activationError = parseActivationError(err)
    if (!isBindMode.value && activationError.isActivationError) {
      showActivationResend.value = true
      if (activationError.email) {
        pendingActivationEmail.value = activationError.email
        const qqPrefix = extractQQPrefixFromEmail(activationError.email)
        if (qqPrefix && !normalizeQQPrefixInput(emailPrefix.value)) {
          emailPrefix.value = qqPrefix
        }
      }
    }
    if (loginMode.value === 'password' && (error.value.includes('密码') || error.value.includes('错误'))) {
      password.value = ''
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-form {
  width: 100%;
  max-width: 420px;
  animation: fadeInUp 0.4s ease both;
}

@keyframes fadeInUp {
  0% {
    opacity: 0;
    transform: translateY(10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.form-header {
  text-align: center;
  margin-bottom: 28px;
}

.form-header h2 {
  font-size: 28px;
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0 0 8px;
}

.form-header p {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-form.has-error {
  animation: shake 0.4s ease;
}

@keyframes shake {
  0% {
    transform: translateX(0);
  }
  15% {
    transform: translateX(-6px);
  }
  30% {
    transform: translateX(6px);
  }
  45% {
    transform: translateX(-4px);
  }
  60% {
    transform: translateX(4px);
  }
  75% {
    transform: translateX(-2px);
  }
  90% {
    transform: translateX(2px);
  }
  100% {
    transform: translateX(0);
  }
}

.login-mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mode-btn {
  height: 38px;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-lg);
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: var(--font-medium);
  cursor: pointer;
}

.mode-btn.active {
  border-color: var(--btn-primary-border);
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 13px;
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.input-wrapper {
  position: relative;
}

.input-wrapper input {
  width: 100%;
  padding: 12px 14px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-lg);
  color: var(--input-text);
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-wrapper input::placeholder {
  color: var(--input-placeholder);
}

.input-wrapper input:focus {
  outline: none;
  border-color: var(--input-border-focus);
  box-shadow: var(--input-shadow-focus);
}

.input-wrapper input.input-error {
  border-color: var(--error);
  box-shadow: 0 0 0 3px var(--error-light);
}

.email-split {
  display: flex;
  align-items: center;
  gap: 8px;
}

.email-domain-select {
  flex-shrink: 0;
  padding: 10px 12px;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-lg);
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  appearance: none;
}

.code-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.send-code-btn {
  flex-shrink: 0;
  min-width: 120px;
  height: 40px;
  border: 1px solid var(--btn-primary-border);
  border-radius: var(--radius-lg);
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 13px;
  font-weight: var(--font-semibold);
  cursor: pointer;
  padding: 0 10px;
}

.send-code-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.form-tip {
  margin: 0;
  font-size: 12px;
  color: var(--text-quaternary);
}

.activation-resend {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding-top: 2px;
}

.activation-resend .form-tip {
  white-space: nowrap;
}

.resend-activation-btn {
  align-self: center;
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--btn-secondary-border);
  border-radius: var(--radius-lg);
  background: var(--btn-secondary-bg);
  color: var(--btn-secondary-text);
  font-size: 13px;
  font-weight: var(--font-medium);
  cursor: pointer;
}

.resend-activation-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
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
  border-radius: var(--radius-lg);
  padding: 10px 12px;
}

.info-message {
  color: #60a5fa;
  font-size: 13px;
}

.error-container {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--error-light);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-lg);
  color: var(--error);
}

.error-message {
  font-size: 13px;
  font-weight: var(--font-medium);
}

.submit-btn {
  width: 100%;
  padding: 13px;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border: 1px solid var(--btn-primary-border);
  border-radius: var(--radius-lg);
  font-size: 15px;
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: background var(--transition-normal), box-shadow var(--transition-normal), transform var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.submit-btn:hover:not(:disabled) {
  background: var(--btn-primary-hover);
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.loading-spinner {
  width: 20px;
  height: 20px;
}

.form-footer {
  margin-top: 20px;
  text-align: center;
}

.help-text {
  font-size: 12px;
  color: var(--text-quaternary);
  margin: 0;
  line-height: 1.5;
}

.register-link {
  margin-top: 6px;
}

.register-link a {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
}

.register-link a:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .form-header h2 {
    font-size: 24px;
  }

  .form-header p {
    font-size: 13px;
  }

  .login-mode-switch {
    grid-template-columns: 1fr;
  }

  .code-row {
    flex-direction: column;
    align-items: stretch;
  }

  .send-code-btn {
    width: 100%;
    min-width: 0;
  }
}
</style>
