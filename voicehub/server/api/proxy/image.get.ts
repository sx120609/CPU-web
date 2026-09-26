import {
  OutboundRequestError,
  assertSafeOutboundUrl,
  safeFetch,
  type SafeFetchResponse
} from '~~/server/utils/safe-fetch'

// 图片大小上限，超出即中止读取
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// 重试函数
const fetchWithRetry = async (
  url: string,
  options: any,
  maxRetries = 3
): Promise<SafeFetchResponse> => {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`尝试获取图片 (${attempt}/${maxRetries}): ${url}`)

      // 10秒内需收到响应头；目标地址与每次重定向都会校验，禁止访问内网
      const response = await safeFetch(url, {
        ...options,
        timeoutMs: 10000,
        bodyTimeoutMs: 30000,
        maxBytes: MAX_IMAGE_BYTES
      })

      if (response.ok) {
        console.log(`图片获取成功 (尝试 ${attempt})`)
        return response
      } else {
        response.discard()
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error: any) {
      lastError = error
      console.warn(`图片获取失败 (尝试 ${attempt}/${maxRetries}):`, error.message)

      // 地址被拒绝属于确定性错误，无需重试
      if (error instanceof OutboundRequestError) {
        throw error
      }

      // 如果不是最后一次尝试，等待一段时间后重试
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // 指数退避，最大5秒
        console.log(`等待 ${delay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const imageUrl = query.url as string
  const quality = query.quality as string

  if (!imageUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing image URL parameter'
    })
  }

  try {
    // 验证URL是否为有效的图片URL（仅 http/https，拒绝内网地址）
    const url = assertSafeOutboundUrl(imageUrl)

    // 确定 Referer
    let referer = url.origin
    // 针对 Bilibili 图片的特殊处理
    if (url.hostname.includes('hdslb.com') || url.hostname.includes('bilibili.com')) {
      referer = 'https://www.bilibili.com/'
    }

    // 优化的请求头
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      Referer: referer
    }

    // 使用重试机制获取图片
    const response = await fetchWithRetry(imageUrl, { headers })

    // 检查内容类型
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.startsWith('image/')) {
      response.discard()
      throw new Error('Response is not an image')
    }

    // 获取图片数据（超过大小上限会中止）
    const imageBuffer = await response.buffer()

    // 设置响应头
    setHeader(event, 'Content-Type', contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=3600') // 缓存1小时
    setHeader(event, 'Access-Control-Allow-Origin', '*')
    setHeader(event, 'Access-Control-Allow-Methods', 'GET, OPTIONS')
    setHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')

    console.log(`图片代理成功: ${imageUrl}, 大小: ${imageBuffer.byteLength} bytes`)
    return new Uint8Array(imageBuffer)
  } catch (error: any) {
    console.error('Image proxy error:', {
      url: imageUrl,
      error: error.message,
      code: error.code,
      cause: error.cause
    })

    // 地址不合法、指向内网或图片过大
    if (error instanceof OutboundRequestError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message
      })
    }

    // 提供更详细的错误信息
    let errorMessage = 'Failed to fetch image'
    if (error.code === 'ECONNRESET') {
      errorMessage = '网络连接被重置，请稍后重试'
    } else if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
      errorMessage = '请求超时，请检查网络连接'
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = '无法解析域名，请检查URL是否正确'
    } else if (error.message.includes('HTTP')) {
      errorMessage = `服务器返回错误: ${error.message}`
    }

    throw createError({
      statusCode: 500,
      statusMessage: `${errorMessage}: ${error.message}`
    })
  }
})
