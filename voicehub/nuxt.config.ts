import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import glsl from 'vite-plugin-glsl'
import { fileURLToPath } from 'url'

const normalizeBaseURL = (baseURL: string) => {
  const withLeadingSlash = baseURL.startsWith('/') ? baseURL : `/${baseURL}`
  const normalized = withLeadingSlash.replace(/\/{2,}/g, '/')
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

const appBaseURL = normalizeBaseURL(process.env.NUXT_APP_BASE_URL || '/voicehub/')
const appBasePrefix = appBaseURL === '/' ? '' : appBaseURL.slice(0, -1)
const defaultApiBase = `${appBasePrefix}/api`
const apiBase = (process.env.NUXT_PUBLIC_API_BASE || defaultApiBase).replace(/\/+$/, '')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-01-30',
  future: {
    compatibilityVersion: 4
  },
  srcDir: 'app',
  serverDir: fileURLToPath(new URL('./server', import.meta.url)),
  dir: {
    public: fileURLToPath(new URL('./public', import.meta.url))
  },
  devtools: { enabled: true },
  devServer: {
    host: '0.0.0.0', // 允许局域网访问
    port: 3000
  },
  modules: [
    '@nuxtjs/tailwindcss',
    ...(process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event?.includes('lint')
      ? ['@nuxt/eslint']
      : [])
  ],

  // 引入全局CSS
  css: [
    '~/assets/css/variables.css',
    '~/assets/css/components.css',
    '~/assets/css/main.css',
    '~/assets/css/transitions.css',
    '~/assets/css/mobile-admin.css',
    '~/assets/css/print-fix.css',
    '~/assets/css/sf-pro-icons.css'
  ],

  // 配置运行时配置
  runtimeConfig: {
    // 服务器私有键（不会暴露到客户端）
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    // Redis配置（可选）
    redisUrl: process.env.REDIS_URL || '',
    // 公共键（会暴露到客户端）
    public: {
      apiBase,
      oauth: {
        github: !!process.env.GITHUB_CLIENT_ID,
        casdoor: !!process.env.CASDOOR_CLIENT_ID,
        google: !!process.env.GOOGLE_CLIENT_ID
      },
      siteTitle: process.env.NUXT_PUBLIC_SITE_TITLE || '药苑之声',
      siteLogo: process.env.NUXT_PUBLIC_SITE_LOGO || '',
      siteDescription:
        process.env.NUXT_PUBLIC_SITE_DESCRIPTION || '中国药科大学广播站点歌与播出平台',
      isNetlify: process.env.NETLIFY === 'true'
    }
  },

  // 配置环境变量
  app: {
    baseURL: appBaseURL,
    pageTransition: { name: 'page', mode: 'out-in' },
    layoutTransition: { name: 'layout', mode: 'out-in' },
    head: {
      title: process.env.NUXT_PUBLIC_SITE_TITLE || '药苑之声',
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
        },
        {
          name: 'description',
          content:
            process.env.NUXT_PUBLIC_SITE_DESCRIPTION || '中国药科大学广播站点歌与播出平台'
        },
        // 移动端优化
        { name: 'theme-color', content: '#111111' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: '药苑之声' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'format-detection', content: 'telephone=no' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: `${appBaseURL}favicon.ico` }
      ]
    }
  },

  features: {
    inlineStyles: true
  },

  // TypeScript配置
  typescript: {
    strict: true
  },

  // 服务器端配置
  nitro: {
    preset: process.env.VERCEL
      ? 'vercel'
      : process.env.NETLIFY
        ? 'netlify'
        : process.env.NITRO_PRESET || 'node-server',
    // 增强错误处理和稳定性
    experimental: {
      wasm: true,
      asyncContext: true
    },
    timing: true,
    // 增加请求超时时间
    routeRules: {
      // 对公共只读接口启用短时缓存，降低高并发下的网关压力
      '/api/site-config': {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      '/api/system/location': {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=600',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      '/api/songs/public': {
        headers: {
          'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      '/api/schedules/public': {
        headers: {
          'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      '/api/songs/count': {
        headers: {
          'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      '/api/play-times': {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      '/api/semesters/current': {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1200',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      // 默认禁用所有其他 API 路由缓存（上方公共只读接口已单独放开）
      '/api/**': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff'
        }
      },
      // 静态资源文件缓存配置
      '/_nuxt/**': {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      },
      '/assets/**': {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      },
      '/favicon.ico': {
        headers: {
          'Cache-Control': 'public, max-age=86400'
        }
      },
      // 图片、CSS、JS等静态资源缓存
      '/**/*.{png,jpg,jpeg,gif,webp,svg,ico}': {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      },
      '/**/*.{css,js}': {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      },
      // 认证相关页面不缓存
      '/login': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      },
      '/dashboard': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      },
      '/change-password': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      },
      '/auth/**': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      },
      '/notification-settings': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      }
    },
    // 根据部署环境调整配置
    ...(process.env.VERCEL
      ? {
          // Vercel 环境：使用标准配置
        }
      : process.env.NETLIFY
        ? {
            // Netlify 环境：确保 Drizzle 正确打包
            experimental: {
              wasm: true
            }
          }
        : {
            // 其他环境：使用标准配置
          })
  },

  // Vite 配置
  vite: {
    resolve: {
      alias: [
        {
          find: '@applemusic-like-lyrics/core/style.css',
          replacement: fileURLToPath(
            new URL('./vendor/amll-core/src/styles/index.css', import.meta.url)
          )
        },
        {
          find: '@applemusic-like-lyrics/core',
          replacement: fileURLToPath(new URL('./vendor/amll-core/src/index.ts', import.meta.url))
        }
      ]
    },
    plugins: [wasm(), topLevelAwait(), glsl()],
    optimizeDeps: {
      include: ['drizzle-orm'],
      exclude: ['@applemusic-like-lyrics/vue', '@applemusic-like-lyrics/lyric']
    },
    // 添加 WASM 支持配置
    assetsInclude: ['**/*.wasm'],
    // SSR配置
    ssr: {
      noExternal: process.env.NETLIFY
        ? ['drizzle-orm', 'postgres']
        : process.env.VERCEL
          ? []
          : ['drizzle-orm', 'postgres']
    }
  }
})
