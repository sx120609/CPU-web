<template>
  <div class="min-h-screen bg-[#f6f8f2] text-[#1f2a1f] pb-24">
    <!-- 顶部导航栏 -->
    <div
      class="sticky top-0 z-30 bg-[#fbfdf8]/90 backdrop-blur-xl border-b border-[#d6e1ce] px-4 py-4 mb-8"
    >
      <div class="max-w-[1200px] mx-auto flex items-center justify-between">
        <div class="flex items-center gap-4">
          <button
            class="p-2 hover:bg-[#e9f0e2] rounded-xl transition-all text-[#5c6c5c] hover:text-[#1f2a1f]"
            @click="goBack"
          >
            <ArrowLeft :size="20" />
          </button>
          <div>
            <h1 class="text-xl font-black text-[#1f2a1f] tracking-tight">账号管理</h1>
            <p class="text-[10px] text-[#6b7b6b] font-medium uppercase tracking-widest mt-0.5">
              Account Management
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="max-w-[1200px] mx-auto px-4">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <!-- 左侧：用户信息概览 (PC端占据 4/12) -->
        <div class="lg:col-span-4 space-y-6">
          <section :class="sectionClass" class="flex flex-col items-center text-center">
            <div class="relative group">
              <div
                class="w-32 h-32 rounded-full overflow-hidden bg-gradient-to-br from-[#2f7d4f] to-[#4ca874] flex items-center justify-center text-white text-4xl font-black shadow-2xl mb-6 group-hover:scale-105 transition-transform duration-500"
              >
                <img
                  v-if="auth.user.value?.avatar && !avatarError"
                  :src="auth.user.value.avatar"
                  class="w-full h-full object-cover"
                  @error="avatarError = true"
                >
                <span v-else>{{ userInitials }}</span>
              </div>
              <div
                class="absolute -bottom-1 -right-1 p-2 bg-[#f2f6ee] border border-[#d1dcc9] rounded-full text-[#2f7d4f] shadow-xl"
              >
                <User :size="16" />
              </div>
            </div>

            <input
              ref="avatarFileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="hidden"
              :disabled="uploadingAvatar"
              @change="handleAvatarFileChange"
            >
            <div class="mt-2 flex items-center gap-2">
              <button
                :disabled="uploadingAvatar || removingAvatar"
                class="px-4 py-2.5 bg-[#2f7d4f] hover:bg-[#246a41] text-white text-xs font-black rounded-xl transition-all active:scale-95 disabled:opacity-50"
                @click="triggerAvatarUpload"
              >
                {{ uploadingAvatar ? '上传中...' : auth.user.value?.avatar ? '更换头像' : '上传头像' }}
              </button>
              <button
                v-if="hasCustomAvatar"
                :disabled="uploadingAvatar || removingAvatar"
                class="px-4 py-2.5 bg-[#eef4e9] hover:bg-[#e1ebd8] text-[#4f614d] text-xs font-black rounded-xl border border-[#c8d7bd] transition-all active:scale-95 disabled:opacity-50"
                @click="removeAvatar"
              >
                {{ removingAvatar ? '移除中...' : '移除头像' }}
              </button>
            </div>
            <p class="text-[11px] text-[#6b7b6b] mt-2">
              支持 JPG / PNG / WEBP，最大 2MB
            </p>
            <p v-if="avatarUploadError" class="text-xs text-rose-600">
              {{ avatarUploadError }}
            </p>

            <div class="space-y-2">
              <h2 class="text-2xl font-black text-[#1f2a1f] tracking-tight">
                {{ auth.user.value?.name || auth.user.value?.username }}
              </h2>
              <p v-if="auth.user.value?.email" class="text-sm font-medium text-[#6b7b6b]">
                {{ auth.user.value?.email }}
              </p>
            </div>

            <div class="flex flex-wrap justify-center gap-2 mt-6">
              <span
                class="px-3 py-1 bg-[#2f7d4f]/12 border border-[#2f7d4f]/25 text-[#2f7d4f] text-[10px] font-black uppercase tracking-wider rounded-full"
              >
                {{ roleName }}
              </span>
              <span
                v-if="auth.user.value?.grade"
                class="px-3 py-1 bg-[#e7efe1] text-[#566656] text-[10px] font-black uppercase tracking-wider rounded-full"
              >
                {{ auth.user.value?.grade }}
              </span>
              <span
                v-if="auth.user.value?.class"
                class="px-3 py-1 bg-[#e7efe1] text-[#566656] text-[10px] font-black uppercase tracking-wider rounded-full"
              >
                {{ auth.user.value?.class }}
              </span>
            </div>
          </section>
        </div>

        <!-- 右侧：详细设置 (PC端占据 8/12) -->
        <div class="lg:col-span-8 space-y-8">
          <section :class="sectionClass">
            <div class="flex items-center gap-3 border-b border-[#d6e1ce] pb-5 mb-6">
              <div class="p-2.5 bg-[#2f7d4f]/12 rounded-xl">
                <Pencil :size="20" class="text-[#2f7d4f]" />
              </div>
              <div>
                <h2 class="text-base font-black text-[#1f2a1f]">显示昵称</h2>
                <p class="text-xs text-[#6b7b6b] mt-0.5">该昵称将用于首页投稿人等公开展示位置</p>
              </div>
            </div>

            <div class="max-w-md space-y-3">
              <input
                v-model="displayName"
                :disabled="savingDisplayName"
                maxlength="30"
                type="text"
                class="w-full bg-[#f7fbf4] border border-[#d1ddc9] rounded-xl px-4 py-3 text-sm text-[#1f2a1f] focus:outline-none focus:border-[#9eb996] transition-all disabled:opacity-60"
                placeholder="请输入显示昵称"
              >
              <p v-if="displayNameError" class="text-xs text-rose-600">
                {{ displayNameError }}
              </p>
              <button
                :disabled="savingDisplayName || !hasDisplayNameChanged"
                class="px-4 py-2.5 bg-[#2f7d4f] hover:bg-[#246a41] text-white text-xs font-black rounded-xl transition-all active:scale-95 disabled:opacity-50"
                @click="saveDisplayName"
              >
                {{ savingDisplayName ? '保存中...' : '保存昵称' }}
              </button>
            </div>
          </section>

          <!-- 第三方登录绑定 -->
          <section v-if="hasOAuthProviders" :class="sectionClass">
            <div class="flex items-center gap-3 border-b border-[#d6e1ce] pb-5 mb-6">
              <div class="p-2.5 bg-purple-500/10 rounded-xl">
                <LinkIcon :size="20" class="text-purple-500" />
              </div>
              <div>
                <h2 class="text-base font-black text-[#1f2a1f]">第三方账号绑定</h2>
                <p class="text-xs text-[#6b7b6b] mt-0.5">绑定社交账号以便更快捷地登录系统</p>
              </div>
            </div>
            <AuthOAuthBindingCard />
          </section>

          <!-- 修改密码 -->
          <section :class="sectionClass">
            <div class="flex items-center gap-3 border-b border-[#d6e1ce] pb-5 mb-6">
              <div class="p-2.5 bg-[#2f7d4f]/12 rounded-xl">
                <Lock :size="20" class="text-[#2f7d4f]" />
              </div>
              <div>
                <h2 class="text-base font-black text-[#1f2a1f]">修改密码</h2>
                <p class="text-xs text-[#6b7b6b] mt-0.5">为了您的账号安全，建议定期更换高强度密码</p>
              </div>
            </div>
            <div class="max-w-md">
              <AuthChangePasswordForm />
            </div>
          </section>

        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model:show="showRemoveAvatarConfirmDialog"
      title="移除头像"
      message="确定要移除当前自定义头像吗？移除后将回退为QQ头像（如有）或默认头像。"
      type="warning"
      confirm-text="确认移除"
      :loading="removingAvatar"
      @confirm="confirmRemoveAvatar"
      @cancel="closeRemoveAvatarConfirm"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { ArrowLeft, User, Link as LinkIcon, Lock, Pencil } from 'lucide-vue-next'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const { showToast } = useToast()
const config = useRuntimeConfig()

const hasOAuthProviders = computed(() => {
  return config.public.oauth.github || config.public.oauth.casdoor || config.public.oauth.google
})

const avatarError = ref(false)
const avatarFileInput = ref(null)
const uploadingAvatar = ref(false)
const removingAvatar = ref(false)
const showRemoveAvatarConfirmDialog = ref(false)
const avatarUploadError = ref('')
const displayName = ref('')
const originalDisplayName = ref('')
const savingDisplayName = ref(false)
const displayNameError = ref('')
const MAX_AVATAR_SIZE = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// 监听用户头像变化，重置错误状态
watch(
  () => auth.user.value?.avatar,
  () => {
    avatarError.value = false
  }
)

const syncDisplayNameFromAuth = () => {
  const fallbackName = auth.user.value?.name || auth.user.value?.username || ''
  displayName.value = fallbackName
  originalDisplayName.value = fallbackName
}

watch(
  () => auth.user.value?.name,
  () => {
    if (!savingDisplayName.value) {
      syncDisplayNameFromAuth()
    }
  },
  { immediate: true }
)

const hasDisplayNameChanged = computed(() => {
  return displayName.value.trim() !== originalDisplayName.value.trim()
})

const hasCustomAvatar = computed(() => {
  const avatar = auth.user.value?.avatar
  if (typeof avatar !== 'string') return false
  return avatar.includes('/uploads/avatars/') || avatar.includes('/api/user/avatar-file/')
})

// 处理来自 OAuth 回调的消息
onMounted(async () => {
  if (!auth.user.value) {
    await auth.initAuth()
  }
  syncDisplayNameFromAuth()

  if (route.query.message) {
    showToast(route.query.message, 'success')
    router.replace({ query: { ...route.query, message: undefined, error: undefined } })
  }
  if (route.query.error) {
    showToast(route.query.error, 'error')
    router.replace({ query: { ...route.query, message: undefined, error: undefined } })
  }
})

// 样式类常量
const sectionClass = 'bg-[#ffffff] border border-[#d6e1ce] rounded-3xl p-6 md:p-8 shadow-2xl'

const userInitials = computed(() => {
  const name = auth.user.value?.name || auth.user.value?.username || 'U'
  return name.charAt(0).toUpperCase()
})

const roleName = computed(() => {
  const role = auth.user.value?.role
  const map = {
    ADMIN: '管理员',
    SUPER_ADMIN: '超级管理员',
    SONG_ADMIN: '审歌员',
    USER: '普通用户'
  }
  return map[role] || role
})

const goBack = () => {
  router.back()
}

const triggerAvatarUpload = () => {
  avatarUploadError.value = ''
  avatarFileInput.value?.click()
}

const resetAvatarInput = () => {
  if (avatarFileInput.value) {
    avatarFileInput.value.value = ''
  }
}

const handleAvatarFileChange = async (event) => {
  const input = event?.target
  const file = input?.files?.[0]

  if (!file) {
    return
  }

  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    const message = '仅支持 JPG / PNG / WEBP 格式图片'
    avatarUploadError.value = message
    showToast(message, 'error')
    resetAvatarInput()
    return
  }

  if (file.size > MAX_AVATAR_SIZE) {
    const message = '头像大小不能超过 2MB'
    avatarUploadError.value = message
    showToast(message, 'error')
    resetAvatarInput()
    return
  }

  try {
    uploadingAvatar.value = true
    avatarUploadError.value = ''

    const formData = new FormData()
    formData.append('avatar', file)

    const response = await $fetch('/api/user/avatar', {
      method: 'POST',
      body: formData
    })

    if (!response?.success || !response?.data?.avatar) {
      throw new Error(response?.message || '头像上传失败')
    }

    if (auth.user.value) {
      auth.user.value.avatar = response.data.avatar
    }
    avatarError.value = false
    showToast(response.message || '头像上传成功', 'success')

    auth.refreshUser().catch((refreshError) => {
      console.warn('刷新用户信息失败（已忽略）:', refreshError)
    })
  } catch (error) {
    const message = extractDisplayErrorMessage(error, '头像上传失败')
    avatarUploadError.value = message
    showToast(message, 'error')
  } finally {
    uploadingAvatar.value = false
    resetAvatarInput()
  }
}

const removeAvatar = async () => {
  if (!hasCustomAvatar.value || removingAvatar.value) {
    return
  }

  showRemoveAvatarConfirmDialog.value = true
}

const closeRemoveAvatarConfirm = () => {
  if (!removingAvatar.value) {
    showRemoveAvatarConfirmDialog.value = false
  }
}

const confirmRemoveAvatar = async () => {
  if (removingAvatar.value) {
    return
  }

  try {
    removingAvatar.value = true
    avatarUploadError.value = ''

    const response = await $fetch('/api/user/avatar', {
      method: 'DELETE'
    })

    if (!response?.success) {
      throw new Error(response?.message || '移除头像失败')
    }

    if (auth.user.value) {
      auth.user.value.avatar = response?.data?.avatar || null
    }
    avatarError.value = false
    showToast(response.message || '头像已移除', 'success')
    showRemoveAvatarConfirmDialog.value = false

    auth.refreshUser().catch((refreshError) => {
      console.warn('刷新用户信息失败（已忽略）:', refreshError)
    })
  } catch (error) {
    const message = extractDisplayErrorMessage(error, '移除头像失败')
    avatarUploadError.value = message
    showToast(message, 'error')
  } finally {
    removingAvatar.value = false
  }
}

const saveDisplayName = async () => {
  const normalizedDisplayName = displayName.value.trim()

  if (!normalizedDisplayName) {
    displayNameError.value = '显示昵称不能为空'
    return
  }

  if (normalizedDisplayName.length > 30) {
    displayNameError.value = '显示昵称不能超过30个字符'
    return
  }

  try {
    savingDisplayName.value = true
    displayNameError.value = ''

    const response = await $fetch('/api/user/profile', {
      method: 'POST',
      body: {
        displayName: normalizedDisplayName
      }
    })

    if (!response?.success) {
      throw new Error(response?.message || '保存昵称失败')
    }

    if (auth.user.value) {
      auth.user.value.name = normalizedDisplayName
    }
    originalDisplayName.value = normalizedDisplayName
    showToast(response?.message || '显示昵称保存成功', 'success')

    // 刷新失败不影响保存结果，避免前端误报“保存失败”
    auth.refreshUser().catch((refreshError) => {
      console.warn('刷新用户信息失败（已忽略）:', refreshError)
    })
  } catch (error) {
    const message = extractDisplayErrorMessage(error, '保存昵称失败')
    displayNameError.value = message
    showToast(message, 'error')
  } finally {
    savingDisplayName.value = false
  }
}
</script>
