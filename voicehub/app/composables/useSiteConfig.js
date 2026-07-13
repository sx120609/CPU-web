import { computed, readonly } from 'vue'
import { normalizeApiBase, normalizeAppBase, withApiBase } from '~/utils/baseUrl'

const SITE_CONFIG_CACHE_KEY = 'voicehub:site-config:v1'

const defaultSubmissionGuidelines = `1. 投稿时无需加入书名号
2. 除DJ外，其他类型歌曲均接收（包括小语种）
3. 禁止投递含有违规内容的歌曲
4. 点播的歌曲将由管理员进行审核
5. 审核通过后将安排在播放时段播出
6. 提交即表明我已阅读投稿须知并已知该歌曲有概率无法播出
7. 本系统仅提供音乐搜索和播放管理功能，不存储任何音乐文件。所有音乐内容均来自第三方音乐平台，版权归原平台及版权方所有。用户点歌时请确保遵守相关音乐平台的服务条款，尊重音乐作品版权。我们鼓励用户支持正版音乐，在官方平台购买和收听喜爱的音乐作品。
8. 最终解释权归广播站所有`

export const useSiteConfig = () => {
  // useState 会把 SSR 读取到的配置写入 Nuxt payload，避免客户端首帧
  // 重新从空 ref 开始而产生文字、Logo 的 hydration mismatch。
  const siteConfig = useState('voicehub-site-config', () => ({
    siteTitle: '',
    siteLogoUrl: '',
    schoolLogoHomeUrl: '',
    schoolLogoPrintUrl: '',
    siteDescription: '',
    submissionGuidelines: '',
    icpNumber: '',
    gonganNumber: '',
    enableRegistrationEmailVerification: false
  }))
  const isLoaded = useState('voicehub-site-config-loaded', () => false)
  const isLoading = useState('voicehub-site-config-loading', () => false)
  const runtimeConfig = useRuntimeConfig()
  const appBaseURL = normalizeAppBase(runtimeConfig.app?.baseURL)
  const apiBase = normalizeApiBase(runtimeConfig.public?.apiBase, runtimeConfig.app?.baseURL)

  const readSiteConfigCache = () => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(SITE_CONFIG_CACHE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  const withAppBasePath = (path) => {
    if (!path || typeof path !== 'string') return path
    if (!path.startsWith('/') || path.startsWith('//')) return path
    const appBasePrefix = appBaseURL === '/' ? '' : appBaseURL.slice(0, -1)
    if (appBasePrefix && path.startsWith(`${appBasePrefix}/`)) {
      return path
    }
    return `${appBasePrefix}${path}`
  }

  const writeSiteConfigCache = (data) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SITE_CONFIG_CACHE_KEY, JSON.stringify(data))
    } catch {
      // 忽略缓存写入异常（如隐私模式）
    }
  }

  const applySiteConfig = (data) => {
    if (!data || typeof data !== 'object') return false
    const normalizedData = { ...data }
    for (const key of ['siteLogoUrl', 'schoolLogoHomeUrl', 'schoolLogoPrintUrl']) {
      normalizedData[key] = withAppBasePath(normalizedData[key])
    }
    siteConfig.value = {
      ...siteConfig.value,
      ...normalizedData
    }
    isLoaded.value = true
    writeSiteConfigCache(siteConfig.value)
    return true
  }

  const buildDefaultSiteConfig = () => ({
    siteTitle: '药苑之声',
    siteLogoUrl: withAppBasePath('/images/logo.png'),
    schoolLogoHomeUrl: '',
    schoolLogoPrintUrl: '',
    siteDescription: '中国药科大学广播站点歌与播出平台',
    submissionGuidelines: defaultSubmissionGuidelines,
    icpNumber: '',
    gonganNumber: '',
    enableReplayRequests: false,
    enableRegistrationEmailVerification: false
  })

  // 获取站点配置
  const fetchSiteConfig = async () => {
    if (isLoading.value) return

    try {
      isLoading.value = true

      const response = await fetch(withApiBase('/api/site-config', apiBase))
      if (!response.ok) {
        throw new Error('获取站点配置失败')
      }

      const data = await response.json()
      applySiteConfig(data)
    } catch (error) {
      console.error('获取站点配置失败:', error)
      // 优先保留已有配置（可能来自SSR或本地缓存），避免瞬间回退为默认logo
      if (!isLoaded.value) {
        siteConfig.value = buildDefaultSiteConfig()
        isLoaded.value = true
      }
    } finally {
      isLoading.value = false
    }
  }

  // 计算属性
  const siteTitle = computed(() => siteConfig.value.siteTitle || '药苑之声')
  const logoUrl = computed(() => siteConfig.value.siteLogoUrl || withAppBasePath('/images/logo.png'))
  const schoolLogoHomeUrl = computed(() => siteConfig.value.schoolLogoHomeUrl || '')
  const schoolLogoPrintUrl = computed(() => siteConfig.value.schoolLogoPrintUrl || '')
  const description = computed(
    () => siteConfig.value.siteDescription || '中国药科大学广播站点歌与播出平台'
  )
  const guidelines = computed(
    () => siteConfig.value.submissionGuidelines || defaultSubmissionGuidelines
  )
  const icp = computed(() => siteConfig.value.icpNumber || '')
  const gonganNumber = computed(() => siteConfig.value.gonganNumber || '')
  const enableReplayRequests = computed(() => siteConfig.value.enableReplayRequests || false)
  const smtpEnabled = computed(() => !!siteConfig.value.smtpEnabled)
  const enableRegistrationEmailVerification = computed(
    () => !!siteConfig.value.enableRegistrationEmailVerification
  )

  // 初始化配置（仅在客户端执行）
  const initSiteConfig = async () => {
    if (typeof window !== 'undefined' && !isLoaded.value) {
      const cached = readSiteConfigCache()
      if (cached) {
        applySiteConfig(cached)
      }
      await fetchSiteConfig()
    }
  }

  // 刷新配置
  const refreshSiteConfig = async () => {
    isLoaded.value = false
    await fetchSiteConfig()
  }

  const hydrateSiteConfig = (data) => {
    return applySiteConfig(data)
  }

  return {
    siteConfig: readonly(siteConfig),
    isLoaded: readonly(isLoaded),
    isLoading: readonly(isLoading),
    siteTitle,
    logoUrl,
    schoolLogoHomeUrl,
    schoolLogoPrintUrl,
    description,
    guidelines,
    icp,
    gonganNumber,
    enableReplayRequests,
    smtpEnabled,
    enableRegistrationEmailVerification,
    fetchSiteConfig,
    initSiteConfig,
    refreshSiteConfig,
    hydrateSiteConfig
  }
}
