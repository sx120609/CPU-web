<template>
  <div class="auth-layout">
    <div class="auth-container">
      <div class="form-section">
        <div class="form-header">
          <div class="logo-row">
            <img :src="brandLogoSrc" alt="Brand Logo" class="brand-logo-center" >
            <div v-if="schoolLogoHomeUrl && schoolLogoHomeUrl.trim()" class="logo-divider" />
            <img
              v-if="schoolLogoHomeUrl && schoolLogoHomeUrl.trim()"
              :src="schoolLogoHomeUrl"
              alt="学校Logo"
              class="school-logo"
            >
          </div>
          <h1 class="form-title">{{ siteTitle ? siteTitle + ' | VoiceHub' : 'VoiceHub' }}</h1>
          <div class="header-divider" />
        </div>

        <div class="change-password-panel">
          <h2>{{ isFirstLogin ? '欢迎使用 VoiceHub' : '账号安全' }}</h2>
          <p>{{ isFirstLogin ? '为了保障您的账号安全，请设置一个新的密码' : '定期更新密码有助于保护您的账号安全' }}</p>

          <div class="security-tips">
            <h3>密码安全建议</h3>
            <div class="tip-list">
              <div class="tip-item">
                <svg class="tip-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polyline points="20,6 9,17 4,12" />
                </svg>
                <span>至少8个字符</span>
              </div>
              <div class="tip-item">
                <svg class="tip-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polyline points="20,6 9,17 4,12" />
                </svg>
                <span>包含大小写字母</span>
              </div>
              <div class="tip-item">
                <svg class="tip-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <polyline points="20,6 9,17 4,12" />
                </svg>
                <span>包含数字和特殊字符</span>
              </div>
            </div>
          </div>
        </div>

        <ClientOnly>
          <ChangePasswordForm :is-first-login="isFirstLogin" />
        </ClientOnly>

        <div class="form-footer">
          <NuxtLink class="back-link" to="/">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="15,18 9,12 15,6" />
            </svg>
            返回主页
          </NuxtLink>
        </div>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup>
import ChangePasswordForm from '~/components/Auth/ChangePasswordForm.vue'
import { computed, ref } from 'vue'
import logo from '~~/public/images/logo.svg'

// 使用站点配置
const { siteTitle, initSiteConfig, logoUrl, schoolLogoHomeUrl } = useSiteConfig()
const brandLogoSrc = computed(() => {
  const url = logoUrl.value
  if (url && !url.endsWith('.ico')) return url
  return logo
})

const auth = useAuth()
const router = useRouter()
const isFirstLogin = ref(false)

// 未登录用户重定向到登录页
onMounted(async () => {
  // 初始化站点配置
  await initSiteConfig()

  if (typeof document !== 'undefined' && siteTitle.value) {
    document.title = `修改密码 | ${siteTitle.value}`
  }

  if (!auth.isAuthenticated.value && import.meta.client) {
    router.push('/login')
    return
  }

  // 检查是否需要修改密码（用于显示不同的UI提示）
  if (import.meta.client) {
    const userJson = localStorage.getItem('user')
    if (userJson) {
      const user = JSON.parse(userJson)
      isFirstLogin.value = user.forcePasswordChange === true || !user.passwordChangedAt
    }
  }
})
</script>

<style scoped>
.auth-layout {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 20px;
  --brand-logo-size: clamp(48px, 8vw, 96px);
  --school-logo-size: clamp(96px, 16vw, 160px);
  --logo-gap: clamp(12px, 2vw, 24px);
  --divider-height: clamp(32px, 10vw, 96px);
  --content-footer-gap: clamp(16px, 4vh, 40px);
}

.auth-container {
  width: 100%;
  max-width: 620px;
  background: var(--bg-secondary);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border-primary);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  margin: auto 0;
  margin-bottom: var(--content-footer-gap);
}

.form-section {
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
}

.form-header {
  text-align: center;
  margin-bottom: 20px;
}

.logo-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--logo-gap);
  margin-bottom: 12px;
}

.logo-divider {
  width: 1px;
  height: var(--divider-height);
  background: var(--border-secondary);
}

.brand-logo-center {
  width: var(--brand-logo-size);
  height: var(--brand-logo-size);
  margin: 0;
  object-fit: contain;
  max-width: 100%;
  max-height: 100%;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
}

.school-logo {
  width: var(--school-logo-size);
  height: var(--school-logo-size);
  margin: 0;
  object-fit: contain;
  max-width: 100%;
  max-height: 100%;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
}

.form-title {
  font-size: 24px;
  font-weight: var(--font-bold);
  margin: 0;
  color: var(--text-primary);
}

.header-divider {
  height: 1px;
  background: var(--border-secondary);
  margin: 14px auto 0;
  width: 100%;
}

.change-password-panel {
  background: linear-gradient(145deg, #f4f8f1 0%, #eef4ea 100%);
  border: 1px solid var(--border-secondary);
  border-radius: 14px;
  padding: 18px;
  margin-bottom: 18px;
}

.change-password-panel h2 {
  margin: 0;
  font-size: 20px;
  color: var(--text-primary);
  font-weight: var(--font-bold);
}

.change-password-panel p {
  margin: 8px 0 16px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.security-tips h3 {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 0 0 20px 0;
}

.tip-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tip-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
}

.tip-icon {
  width: 16px;
  height: 16px;
  color: var(--success);
  flex-shrink: 0;
}

.tip-item span {
  font-size: 14px;
  color: var(--text-primary);
}

.form-footer {
  margin-top: 32px;
  text-align: center;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--btn-secondary-bg);
  border: 1px solid var(--btn-secondary-border);
  border-radius: 8px;
  color: var(--btn-secondary-text);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.back-link:hover {
  background: var(--btn-secondary-hover);
  border-color: var(--border-tertiary);
}

.back-link svg {
  width: 16px;
  height: 16px;
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .form-section {
    padding: 40px 30px;
  }

  .auth-container { max-width: 560px; }
}

@media (max-width: 768px) {
  .auth-layout {
    padding: 10px;
  }

  .auth-container {
    border-radius: 16px;
    min-height: auto;
  }

  .form-section {
    padding: 30px 20px;
  }

  .tip-list {
    gap: 8px;
  }

  .tip-item {
    padding: 8px 12px;
  }
}
</style>
