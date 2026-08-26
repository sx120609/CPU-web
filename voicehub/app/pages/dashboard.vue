<template>
  <div class="admin-page">
    <ClientOnly>
      <div class="admin-layout" @touchend="handleTouchEnd" @touchstart="handleTouchStart">
        <!-- 左侧导航栏 -->
        <AdminSidebar
          :is-open="sidebarOpen"
          :active-tab="activeTab"
          :current-user="currentUser"
          :permissions="permissions"
          :site-title="siteTitle"
          @navigate="handleNavigate"
          @close="closeSidebar"
          @logout="handleLogout"
        />

        <!-- 移动端侧边栏遮罩 -->
        <div
          v-if="sidebarOpen"
          class="fixed inset-0 bg-[rgba(31,42,31,0.26)] backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300"
          @click="closeSidebar"
        />

        <!-- 主内容区域 -->
        <main
          class="admin-main flex-1 flex flex-col min-h-0 overflow-hidden lg:ml-64 relative bg-[#f6f8f2] text-[#1f2a1f]"
        >
          <header
            class="admin-header shrink-0 flex items-center justify-between px-4 md:px-8 border-b border-[#d5dfcd] bg-[#fbfdf8]/90 backdrop-blur-xl z-30"
          >
            <div class="flex items-center gap-3">
              <button
                class="lg:hidden p-2 text-[#526452] hover:bg-[#e8efe1] rounded-lg transition-colors"
                @click="toggleSidebar"
              >
                <Menu :size="20" />
              </button>
              <h1 class="text-xl font-bold tracking-tight">{{ getPageTitle() }}</h1>
            </div>
            <div class="flex items-center gap-4">
              <!-- 这里可以添加顶部操作按钮 -->
            </div>
          </header>

          <div
            ref="contentScroller"
            class="admin-content-scroll flex-1 min-h-0 custom-scrollbar p-4 md:p-8 overflow-y-auto"
            @scroll="handleContentScroll"
          >
            <!-- 移动端返回顶部按钮 -->
            <button
              v-if="showBackToTop"
              aria-label="返回顶部"
              class="admin-back-to-top fixed bottom-8 right-8 p-3 bg-[#2f7d4f] text-white rounded-full shadow-lg hover:bg-[#246a41] transition-all z-50"
              @click="scrollToTop"
            >
              <ChevronUp :size="24" />
            </button>

            <!-- 数据概览 -->
            <div
              v-if="activeTab === 'overview' && permissions.canAccessPage('overview')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <LazyAdminOverviewDashboard @navigate="handleNavigate" />
            </div>

            <!-- 歌曲管理 -->
            <div
              v-if="activeTab === 'songs' && permissions.canAccessPage('songs')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <LazyAdminSongManagement />
            </div>

            <!-- 排期管理 -->
            <div
              v-if="activeTab === 'schedule' && permissions.canAccessPage('schedule')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full"
            >
              <AdminScheduleManager />
            </div>

            <!-- 数据分析 -->
            <div
              v-if="activeTab === 'data-analysis' && permissions.canAccessPage('data-analysis')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <LazyAdminDataAnalysisPanel />
            </div>

            <!-- 消息管理 -->
            <div
              v-if="activeTab === 'notifications' && permissions.canAccessPage('notifications')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <LazyAdminNotificationSender />
            </div>

            <!-- 站点配置 -->
            <div
              v-if="activeTab === 'site-config' && permissions.canAccessPage('site-config')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <LazyAdminSiteConfigManager />
            </div>

            <!-- QQ 音乐配置 -->
            <div
              v-if="activeTab === 'qq-music' && permissions.canAccessPage('qq-music')"
              class="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <LazyAdminQQMusicManager />
            </div>

          </div>
        </main>
      </div>
    </ClientOnly>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { Menu, ChevronUp } from 'lucide-vue-next'
import { useAuth } from '~/composables/useAuth'
import { navigateToCpuWeb } from '~/utils/cpuWebNavigation'
import { usePermissions } from '~/composables/usePermissions'
import { useSiteConfig } from '~/composables/useSiteConfig'

// 使用站点配置
const { siteTitle, initSiteConfig } = useSiteConfig()

// 导入组件

// 页面元数据
definePageMeta({
  layout: false
})

useHead({
  htmlAttrs: { class: 'voicehub-admin-viewport' },
  bodyAttrs: { class: 'voicehub-admin-viewport' }
})

// 响应式数据
const activeTab = ref('overview')
const currentUser = ref(null)
const sidebarOpen = ref(false)
const showBackToTop = ref(false)
const contentScroller = ref(null)
const beforeNavigateHooks = ref([])

// 提供注册导航拦截钩子的方法
const registerBeforeNavigate = (hook) => {
  beforeNavigateHooks.value.push(hook)
  return () => {
    const index = beforeNavigateHooks.value.indexOf(hook)
    if (index > -1) {
      beforeNavigateHooks.value.splice(index, 1)
    }
  }
}
provide('registerBeforeNavigate', registerBeforeNavigate)

// 服务
let auth = null
const permissions = usePermissions()

// 方法
const getPageTitle = () => {
  const titles = {
    overview: '数据概览',
    songs: '歌曲管理',
    schedule: '排期管理',
    notifications: '主站通知',
    'site-config': '站点配置',
    'qq-music': 'QQ 音乐配置'
  }
  return titles[activeTab.value] || '管理后台'
}

// 动态页面标题
const dynamicTitle = computed(() => {
  const currentPageTitle = getPageTitle()
  if (siteTitle && siteTitle.value) {
    return `${currentPageTitle} | ${siteTitle.value}`
  }
  return `${currentPageTitle} | 校园广播站点歌系统`
})

// 监听activeTab变化，更新页面标题
watch(
  activeTab,
  () => {
    if (typeof document !== 'undefined') {
      document.title = dynamicTitle.value
    }
  },
  { immediate: true }
)

// 监听siteTitle变化，更新页面标题
watch(
  () => siteTitle?.value,
  () => {
    if (typeof document !== 'undefined') {
      document.title = dynamicTitle.value
    }
  }
)

const handleLogout = async () => {
  window.location.assign('/')
}

// 导航方法
const handleNavigate = async (tab) => {
  if (tab === 'module-permissions') {
    navigateToCpuWeb('module-permissions')
    return
  }

  if (activeTab.value === tab) return

  // 检查是否有拦截
  for (const hook of beforeNavigateHooks.value) {
    if (!(await hook(tab))) return
  }

  activeTab.value = tab
  showBackToTop.value = false
  await nextTick()
  contentScroller.value?.scrollTo({ top: 0 })
  // 移动端点击导航后关闭侧边栏
  if (window.innerWidth <= 768) {
    closeSidebar()
  }
}

// 侧边栏控制方法
const toggleSidebar = () => {
  sidebarOpen.value = !sidebarOpen.value
}

const closeSidebar = () => {
  sidebarOpen.value = false
}

// 监听窗口大小变化，大屏幕时自动关闭移动端侧边栏
const handleResize = () => {
  if (window.innerWidth > 768) {
    sidebarOpen.value = false
  }
}

// 返回顶部功能
const scrollToTop = () => {
  contentScroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

// 监听滚动事件
const handleContentScroll = (event) => {
  showBackToTop.value = event.currentTarget.scrollTop > 300
}

// 触摸手势支持
let touchStartX = 0
let touchStartY = 0
let touchEndX = 0
let touchEndY = 0

const handleTouchStart = (e) => {
  touchStartX = e.changedTouches[0].screenX
  touchStartY = e.changedTouches[0].screenY
}

const handleTouchEnd = (e) => {
  touchEndX = e.changedTouches[0].screenX
  touchEndY = e.changedTouches[0].screenY
  handleSwipe()
}

const handleSwipe = () => {
  const deltaX = touchEndX - touchStartX
  const deltaY = touchEndY - touchStartY
  const minSwipeDistance = 50

  // 只在移动端处理滑动手势
  if (window.innerWidth > 768) return

  // 水平滑动距离大于垂直滑动距离，且超过最小滑动距离
  if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
    if (deltaX > 0 && touchStartX < 50) {
      // 从左边缘向右滑动，打开侧边栏
      sidebarOpen.value = true
    } else if (deltaX < 0 && sidebarOpen.value) {
      // 向左滑动，关闭侧边栏
      sidebarOpen.value = false
    }
  }
}

const handleDocumentDoubleClick = () => {
  if (window.innerWidth <= 768 && sidebarOpen.value) {
    closeSidebar()
  }
}

// 生命周期
onMounted(async () => {
  // 初始化站点配置
  await initSiteConfig()

  // 初始化服务
  auth = useAuth()

  // 检查认证状态（plugin已经初始化过了）

  if (!auth.isAuthenticated.value) {
    navigateToCpuWeb('login', '/voicehub/dashboard')
    return
  }

  // 检查用户是否有访问后台的权限
  if (!permissions.canAccessAdmin.value) {
    await navigateTo('/')
    return
  }

  currentUser.value = auth.user.value

  // 设置默认页面
  const userPages = permissions.getUserPages.value
  if (userPages.length > 0 && !userPages.includes(activeTab.value)) {
    activeTab.value = userPages[0]
  }

  // 设置初始页面标题
  if (typeof document !== 'undefined') {
    document.title = dynamicTitle.value
  }

  // 添加窗口大小监听器
  window.addEventListener('resize', handleResize)

  // 添加双击关闭侧边栏事件
  document.addEventListener('dblclick', handleDocumentDoubleClick)
})

// 组件卸载时清理事件监听器
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('dblclick', handleDocumentDoubleClick)
})
</script>

<style scoped>
.admin-page {
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.admin-layout {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f6f8f2;
  color: #1f2a1f;
  position: relative;
}

.admin-main {
  height: 100%;
}

.admin-header {
  min-height: 4rem;
}

.admin-content-scroll {
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}

/*
 * 管理中心只允许内容区滚动。若 Nuxt 外层保留 100vh 页面滚动，
 * 移动端地址栏收放时会多出一小段外层滚动，并让内部内容的底部不可达。
 */
:global(html.voicehub-admin-viewport),
:global(body.voicehub-admin-viewport),
:global(body.voicehub-admin-viewport #__nuxt),
:global(body.voicehub-admin-viewport .app),
:global(body.voicehub-admin-viewport .main-content) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
}

@media (max-width: 1023px) {
  .admin-header {
    min-height: calc(4rem + env(safe-area-inset-top, 0px));
    padding-top: env(safe-area-inset-top, 0px);
  }

  .admin-content-scroll {
    padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  }

  .admin-back-to-top {
    right: max(1rem, env(safe-area-inset-right, 0px));
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  }
}

/* 自定义滚动条样式 */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: #edf3e7;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #c3d0ba;
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #b2c2a8;
}

/* 后台统一浅色校园风（覆盖子组件中的深色 Tailwind 类） */
.admin-layout :deep([class*='bg-zinc-950']) {
  background-color: #f3f8ef !important;
}

.admin-layout :deep([class*='bg-zinc-900']) {
  background-color: #ffffff !important;
}

.admin-layout :deep([class*='bg-zinc-800']) {
  background-color: #eaf1e4 !important;
}

.admin-layout :deep([class*='border-zinc-900']),
.admin-layout :deep([class*='border-zinc-800']),
.admin-layout :deep([class*='border-zinc-700']) {
  border-color: #cfdbc7 !important;
}

.admin-layout :deep(.text-zinc-100),
.admin-layout :deep(.text-zinc-200) {
  color: #1f2a1f !important;
}

.admin-layout :deep(.text-zinc-300),
.admin-layout :deep(.text-zinc-400) {
  color: #475947 !important;
}

.admin-layout :deep(.text-zinc-500),
.admin-layout :deep(.text-zinc-600) {
  color: #6b7b6b !important;
}

.admin-layout :deep(.shadow-black\/20),
.admin-layout :deep(.shadow-black\/40),
.admin-layout :deep(.shadow-2xl) {
  box-shadow: 0 18px 30px rgba(43, 61, 43, 0.12) !important;
}
</style>
