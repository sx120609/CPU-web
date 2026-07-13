<template>
  <div class="space-y-6">
    <form class="space-y-5" @submit.prevent="handleChangePassword">
      <div v-if="!isFirstLogin" class="space-y-2">
        <label
          for="current-password"
          class="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest ml-1"
          >当前密码</label
        >
        <div class="relative group">
          <div
            class="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] group-focus-within:text-[var(--primary)] transition-colors"
          >
            <Lock :size="18" />
          </div>
          <input
            id="current-password"
            v-model="currentPassword"
            :class="[
              inputClass,
              error
                ? 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.1)]'
                : 'border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:shadow-[var(--input-shadow-focus)]'
            ]"
            :type="showCurrentPassword ? 'text' : 'password'"
            placeholder="请输入当前密码"
            required
            @input="error = ''"
          >
          <button
            class="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
            type="button"
            @click="showCurrentPassword = !showCurrentPassword"
          >
            <Eye v-if="!showCurrentPassword" :size="18" />
            <EyeOff v-else :size="18" />
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <label
          for="new-password"
          class="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest ml-1"
          >新密码</label
        >
        <div class="relative group">
          <div
            class="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] group-focus-within:text-[var(--primary)] transition-colors"
          >
            <KeyRound :size="18" />
          </div>
          <input
            id="new-password"
            v-model="newPassword"
            :class="[
              inputClass,
              error
                ? 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.1)]'
                : 'border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:shadow-[var(--input-shadow-focus)]'
            ]"
            :type="showNewPassword ? 'text' : 'password'"
            placeholder="请输入新密码"
            required
            @input="
              error = '';
              validatePassword()
            "
          >
          <button
            class="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
            type="button"
            @click="showNewPassword = !showNewPassword"
          >
            <Eye v-if="!showNewPassword" :size="18" />
            <EyeOff v-else :size="18" />
          </button>
        </div>

        <!-- 密码强度指示器 -->
        <div v-if="newPassword" class="px-1 pt-1 space-y-2">
          <div class="h-1 w-full bg-[var(--bg-quaternary)] rounded-full overflow-hidden">
            <div
              class="h-full transition-all duration-500"
              :class="passwordStrength.colorClass"
              :style="{ width: passwordStrength.width }"
            />
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]"
              >密码强度</span
            >
            <span
              class="text-[10px] font-black uppercase tracking-widest"
              :class="passwordStrength.textColorClass"
            >
              {{ passwordStrength.text }}
            </span>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <label
          for="confirm-password"
          class="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest ml-1"
          >确认新密码</label
        >
        <div class="relative group">
          <div
            class="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] group-focus-within:text-[var(--primary)] transition-colors"
          >
            <CheckCircle2 :size="18" />
          </div>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            :class="[
              inputClass,
              error || (confirmPassword && newPassword !== confirmPassword)
                ? 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.1)]'
                : 'border-[var(--input-border)] focus:border-[var(--input-border-focus)] focus:shadow-[var(--input-shadow-focus)]'
            ]"
            :type="showConfirmPassword ? 'text' : 'password'"
            placeholder="请再次输入新密码"
            required
            @input="error = ''"
          >
          <button
            class="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
            type="button"
            @click="showConfirmPassword = !showConfirmPassword"
          >
            <Eye v-if="!showConfirmPassword" :size="18" />
            <EyeOff v-else :size="18" />
          </button>
        </div>

        <!-- 密码匹配提示 -->
        <div v-if="confirmPassword" class="px-1">
          <div
            v-if="newPassword !== confirmPassword"
            class="flex items-center gap-1.5 text-rose-500"
          >
            <XCircle :size="12" />
            <span class="text-[10px] font-bold">密码不匹配</span>
          </div>
          <div v-else class="flex items-center gap-1.5 text-emerald-500">
            <CheckCircle2 :size="12" />
            <span class="text-[10px] font-bold">密码匹配</span>
          </div>
        </div>
      </div>

      <!-- 状态消息 -->
      <div
        v-if="error"
        class="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3"
      >
        <AlertCircle :size="16" class="text-rose-500 shrink-0" />
        <span class="text-xs text-rose-500 font-medium">{{ error }}</span>
      </div>

      <div
        v-if="success"
        class="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3"
      >
        <CheckCircle2 :size="16" class="text-emerald-500 shrink-0" />
        <span class="text-xs text-emerald-500 font-medium">{{ success }}</span>
      </div>

      <button
        :disabled="loading || !isFormValid"
        class="w-full flex items-center justify-center gap-2 py-3 bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-black rounded-xl shadow-[var(--shadow-md)] border border-[var(--btn-primary-border)] transition-all active:scale-[0.98] disabled:opacity-50"
        type="submit"
      >
        <Loader2 v-if="loading" :size="18" class="animate-spin" />
        <span>{{ loading ? '处理中...' : isFirstLogin ? '设置初始密码' : '确认修改密码' }}</span>
      </button>
    </form>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2
} from 'lucide-vue-next'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

// 组件属性
const props = defineProps({
  isFirstLogin: {
    type: Boolean,
    default: false
  }
})

const auth = useAuth()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

// 样式类
const inputClass =
  'w-full bg-[var(--input-bg)] border rounded-xl pl-11 pr-11 py-3 text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:outline-none transition-all'

// 密码显示状态
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)

// 密码强度计算
const passwordStrength = computed(() => {
  const password = newPassword.value
  if (!password) return { width: '0%', colorClass: '', textColorClass: '', text: '' }

  let score = 0

  if (password.length >= 8) score += 25
  if (/[A-Z]/.test(password)) score += 25
  if (/[a-z]/.test(password)) score += 25
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 25

  if (score < 50) {
    return {
      width: `${score || 10}%`,
      colorClass: 'bg-rose-500',
      textColorClass: 'text-rose-500',
      text: '弱'
    }
  } else if (score < 75) {
    return {
      width: `${score}%`,
      colorClass: 'bg-amber-500',
      textColorClass: 'text-amber-500',
      text: '中等'
    }
  } else if (score < 100) {
    return {
      width: `${score}%`,
      colorClass: 'bg-blue-500',
      textColorClass: 'text-blue-500',
      text: '强'
    }
  } else {
    return {
      width: '100%',
      colorClass: 'bg-emerald-500',
      textColorClass: 'text-emerald-500',
      text: '极强'
    }
  }
})

// 表单验证
const isFormValid = computed(() => {
  if (props.isFirstLogin) {
    return (
      newPassword.value &&
      confirmPassword.value &&
      newPassword.value === confirmPassword.value &&
      newPassword.value.length >= 8
    )
  } else {
    return (
      currentPassword.value &&
      newPassword.value &&
      confirmPassword.value &&
      newPassword.value === confirmPassword.value &&
      newPassword.value.length >= 8
    )
  }
})

const validatePassword = () => {
  if (newPassword.value && newPassword.value.length < 8) {
    error.value = '密码长度至少为8位'
  } else {
    error.value = ''
  }
}

const handleChangePassword = async () => {
  if (newPassword.value !== confirmPassword.value) {
    error.value = '新密码和确认密码不匹配'
    return
  }

  if (newPassword.value.length < 8) {
    error.value = '新密码长度至少为8位'
    return
  }

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (props.isFirstLogin) {
      await auth.setInitialPassword(newPassword.value)
      success.value = '密码设置成功！正在跳转...'

      // 清空表单
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''

      // 密码设置完成后跳转
      setTimeout(async () => {
        // 更新用户状态
        await auth.refreshUser()

        if (auth.isAdmin.value) {
          await navigateTo('/dashboard')
        } else {
          await navigateTo('/')
        }
      }, 2000)
    } else {
      await auth.changePassword(currentPassword.value, newPassword.value)
      success.value = '密码修改成功！请重新登录'

      // 清空表单
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''

      // 密码修改后立即清理本地会话，避免旧 token 触发 401 连锁错误
      auth.invalidateSessionLocally()
      setTimeout(() => {
        void navigateTo('/login')
      }, 1500)
    }
  } catch (err) {
    error.value = extractDisplayErrorMessage(err, '操作失败，请重试')
  } finally {
    loading.value = false
  }
}
</script>
