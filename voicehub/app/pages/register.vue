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
        <ClientOnly>
          <RegisterForm />
        </ClientOnly>
      </div>
    </div>
    <SiteFooter />
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import RegisterForm from '~/components/Auth/RegisterForm.vue'
import logo from '~~/public/images/logo.svg'

const { siteTitle, initSiteConfig, logoUrl, schoolLogoHomeUrl } = useSiteConfig()

const brandLogoSrc = computed(() => {
  const url = logoUrl.value
  if (url && !url.endsWith('.ico')) return url
  return logo
})

onMounted(async () => {
  await initSiteConfig()
  if (typeof document !== 'undefined' && siteTitle.value) {
    document.title = `注册 | ${siteTitle.value}`
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
  max-width: 520px;
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
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
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
</style>
