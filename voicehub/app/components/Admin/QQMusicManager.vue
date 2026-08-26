<template>
  <div class="qq-music-manager">
    <!-- 页面标题 -->
    <div class="mb-8">
      <h2 class="text-2xl font-bold text-[#1f2a1f] mb-2">QQ 音乐配置</h2>
      <p class="text-sm text-[#6c7c6c]">
        登录 QQ 音乐绿钻账号，为点歌台提供高音质自有音源
      </p>
    </div>

    <!-- 登录状态卡片 -->
    <div class="bg-white rounded-xl border border-[#d5dfcd] p-6 mb-6">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2f7d4f]"></div>
      </div>

      <!-- 未登录状态 -->
      <div v-else-if="!loginStatus.isLoggedIn" class="text-center py-8">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-[#f8fbf5] rounded-full mb-4">
          <Music2 :size="32" class="text-[#2f7d4f]" />
        </div>
        <h3 class="text-lg font-bold text-[#1f2a1f] mb-2">未登录 QQ 音乐</h3>
        <p class="text-sm text-[#6c7c6c] mb-6">
          使用 QQ 音乐 APP 扫码登录，即可为点歌台提供高音质音源
        </p>
        <button
          class="px-6 py-2.5 bg-[#2f7d4f] text-white rounded-lg font-bold hover:bg-[#267042] transition-colors"
          @click="startQRLogin"
        >
          扫码登录
        </button>
      </div>

      <!-- 已登录状态 -->
      <div v-else class="space-y-4">
        <div class="flex items-start justify-between">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-12 h-12 bg-[#2f7d4f]/10 rounded-full flex items-center justify-center">
              <Music2 :size="24" class="text-[#2f7d4f]" />
            </div>
            <div>
              <h3 class="text-lg font-bold text-[#1f2a1f] mb-1">已登录 QQ 音乐</h3>
              <div class="space-y-1">
                <p class="text-sm text-[#6c7c6c]">
                  <span class="font-bold">会员状态：</span>
                  <span v-if="loginStatus.vipInfo?.hasVip" class="text-[#2f7d4f] font-bold">
                    {{ getVipTypeName(loginStatus.vipInfo.vipType) }}
                  </span>
                  <span v-else class="text-[#d1495b]">非会员</span>
                </p>
                <p v-if="loginStatus.vipInfo?.hasVip" class="text-sm text-[#6c7c6c]">
                  <span class="font-bold">到期时间：</span>
                  {{ formatExpireTime(loginStatus.vipInfo.expireTime) }}
                </p>
                <p class="text-sm text-[#6c7c6c]">
                  <span class="font-bold">可用音质：</span>
                  {{ getAvailableQualities(loginStatus.vipInfo?.vipType) }}
                </p>
              </div>
            </div>
          </div>
          <button
            class="px-4 py-2 text-sm text-[#d1495b] hover:bg-[#d1495b]/10 rounded-lg font-bold transition-colors"
            @click="logout"
          >
            退出登录
          </button>
        </div>

        <!-- VIP 提示 -->
        <div
          v-if="!loginStatus.vipInfo?.hasVip"
          class="bg-[#fff7ed] border border-[#fed7aa] rounded-lg p-4"
        >
          <p class="text-sm text-[#9a3412] font-bold">
            💡 提示：开通 QQ 音乐绿钻会员后，可为用户提供无损音质（FLAC）播放链接
          </p>
        </div>
      </div>
    </div>

    <!-- 使用说明 -->
    <div class="bg-[#f8fbf5] rounded-xl border border-[#d5dfcd] p-6">
      <h3 class="text-base font-bold text-[#1f2a1f] mb-4">使用说明</h3>
      <ul class="space-y-2 text-sm text-[#6c7c6c]">
        <li class="flex items-start gap-2">
          <span class="text-[#2f7d4f] font-bold">•</span>
          <span>登录后，点歌台将优先使用 QQ 音乐官方接口解析播放链接</span>
        </li>
        <li class="flex items-start gap-2">
          <span class="text-[#2f7d4f] font-bold">•</span>
          <span>绿钻会员可提供 FLAC 无损音质，非会员最高 320k MP3</span>
        </li>
        <li class="flex items-start gap-2">
          <span class="text-[#2f7d4f] font-bold">•</span>
          <span>解析失败时会自动回退到第三方音源（huibq、music.3e0.cn）</span>
        </li>
        <li class="flex items-start gap-2">
          <span class="text-[#2f7d4f] font-bold">•</span>
          <span>登录状态会保持 30 天，到期后需重新扫码</span>
        </li>
      </ul>
    </div>

    <!-- QR 登录弹窗 -->
    <Teleport to="body">
      <div
        v-if="showQRModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click.self="closeQRModal"
      >
        <div class="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
          <!-- 弹窗标题 -->
          <div class="text-center mb-6">
            <h3 class="text-xl font-bold text-[#1f2a1f] mb-2">扫码登录 QQ 音乐</h3>
            <p class="text-sm text-[#6c7c6c]">
              使用 QQ 音乐 APP 扫描下方二维码
            </p>
          </div>

          <!-- QR Code 区域 -->
          <div class="flex justify-center mb-6">
            <div v-if="qrLoading" class="w-64 h-64 bg-[#f8fbf5] rounded-xl flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2f7d4f]"></div>
            </div>
            <div v-else-if="qrError" class="w-64 h-64 bg-[#fee2e2] rounded-xl flex items-center justify-center p-6">
              <p class="text-sm text-[#991b1b] text-center font-bold">{{ qrError }}</p>
            </div>
            <div v-else-if="qrCodeUrl" class="relative">
              <img :src="qrCodeUrl" class="w-64 h-64 rounded-xl border-2 border-[#d5dfcd]" alt="QR Code">
              <!-- 过期遮罩 -->
              <div
                v-if="qrStatus === 'expired'"
                class="absolute inset-0 bg-black/70 rounded-xl flex items-center justify-center"
              >
                <div class="text-center">
                  <p class="text-white font-bold mb-3">二维码已过期</p>
                  <button
                    class="px-4 py-2 bg-white text-[#2f7d4f] rounded-lg font-bold hover:bg-[#f8fbf5] transition-colors"
                    @click="refreshQRCode"
                  >
                    刷新二维码
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 状态提示 -->
          <div class="text-center mb-6">
            <p class="text-sm font-bold" :class="getStatusColor(qrStatus)">
              {{ getStatusText(qrStatus) }}
            </p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex gap-3">
            <button
              class="flex-1 px-4 py-2.5 border border-[#d5dfcd] text-[#1f2a1f] rounded-lg font-bold hover:bg-[#f8fbf5] transition-colors"
              @click="closeQRModal"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Music2 } from 'lucide-vue-next'

// ============================================================================
// State
// ============================================================================

const loading = ref(true)
const loginStatus = ref({
  isLoggedIn: false,
  vipInfo: null
})

const showQRModal = ref(false)
const qrLoading = ref(false)
const qrError = ref('')
const qrCodeUrl = ref('')
const qrKey = ref('')
const qrStatus = ref('waiting') // waiting, scanned, success, expired

let pollInterval = null

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(async () => {
  await fetchLoginStatus()
})

onUnmounted(() => {
  stopPolling()
})

// ============================================================================
// API Functions
// ============================================================================

async function fetchLoginStatus() {
  loading.value = true
  try {
    const response = await fetch('/api/qq-music/login-status')
    const data = await response.json()
    loginStatus.value = data
  } catch (error) {
    console.error('Failed to fetch login status:', error)
  } finally {
    loading.value = false
  }
}

async function startQRLogin() {
  showQRModal.value = true
  qrLoading.value = true
  qrError.value = ''
  qrStatus.value = 'waiting'

  try {
    const response = await fetch('/api/qq-music/qr-login/generate', {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error('Failed to generate QR code')
    }

    const data = await response.json()
    qrCodeUrl.value = data.qrCodeUrl
    qrKey.value = data.qrKey

    // Start polling for status
    startPolling()
  } catch (error) {
    qrError.value = '二维码生成失败，请稍后重试'
    console.error('QR generation failed:', error)
  } finally {
    qrLoading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollInterval = setInterval(async () => {
    await checkQRStatus()
  }, 2000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function checkQRStatus() {
  try {
    const response = await fetch('/api/qq-music/qr-login/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrKey: qrKey.value })
    })

    if (!response.ok) return

    const data = await response.json()
    qrStatus.value = data.status

    if (data.status === 'success') {
      stopPolling()
      await fetchLoginStatus()
      setTimeout(() => {
        closeQRModal()
      }, 1500)
    } else if (data.status === 'expired') {
      stopPolling()
    }
  } catch (error) {
    console.error('Failed to check QR status:', error)
  }
}

async function refreshQRCode() {
  qrCodeUrl.value = ''
  qrKey.value = ''
  await startQRLogin()
}

async function logout() {
  if (!confirm('确定要退出登录吗？')) return

  try {
    await fetch('/api/qq-music/logout', { method: 'POST' })
    await fetchLoginStatus()
  } catch (error) {
    console.error('Logout failed:', error)
    alert('退出登录失败')
  }
}

function closeQRModal() {
  showQRModal.value = false
  stopPolling()
  qrCodeUrl.value = ''
  qrKey.value = ''
  qrStatus.value = 'waiting'
}

// ============================================================================
// Helper Functions
// ============================================================================

function getVipTypeName(vipType) {
  const vipTypeMap = {
    0: '非会员',
    4: '绿钻会员',
    8: '超级会员'
  }
  return vipTypeMap[vipType] || `会员 (${vipType})`
}

function formatExpireTime(timestamp) {
  if (!timestamp) return '未知'
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('zh-CN')
}

function getAvailableQualities(vipType) {
  if (vipType >= 4) return 'FLAC 24bit / FLAC / 320k / 128k'
  if (vipType > 0) return 'FLAC / 320k / 128k'
  return '320k / 128k'
}

function getStatusText(status) {
  const statusMap = {
    waiting: '请使用 QQ 音乐 APP 扫描二维码',
    scanned: '已扫描，请在手机上确认登录',
    success: '✓ 登录成功',
    expired: '二维码已过期'
  }
  return statusMap[status] || '等待扫码...'
}

function getStatusColor(status) {
  const colorMap = {
    waiting: 'text-[#6c7c6c]',
    scanned: 'text-[#2f7d4f]',
    success: 'text-[#2f7d4f]',
    expired: 'text-[#d1495b]'
  }
  return colorMap[status] || 'text-[#6c7c6c]'
}
</script>

<style scoped>
.qq-music-manager {
  max-width: 800px;
}
</style>
