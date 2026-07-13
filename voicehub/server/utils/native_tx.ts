export const txHeaders = {
  'User-Agent': 'QQMusic 14090508(android 12)'
}

const TX_REQUEST_TIMEOUT_MS = 8000
const TX_MAX_RETRIES_PER_HOST = 2
const TX_RETRY_BASE_DELAY_MS = 250
const TX_RETRYABLE_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT'
])

const txEnvHosts = (process.env.TX_API_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

const TX_FALLBACK_HOSTS = Array.from(new Set([...txEnvHosts, 'u.y.qq.com', 'u6.y.qq.com', 'u1.y.qq.com']))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getTxErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return
  }

  const typedError = error as { code?: unknown; cause?: unknown }
  if (typeof typedError.code === 'string') {
    return typedError.code
  }

  return getTxErrorCode(typedError.cause)
}

const getTxErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return String(error)
  }
  const typedError = error as { message?: unknown }
  return typeof typedError.message === 'string' ? typedError.message : String(error)
}

const isRetryableTxError = (error: unknown) => {
  const code = getTxErrorCode(error)
  return Boolean(code && TX_RETRYABLE_ERROR_CODES.has(code))
}

const buildTxCandidateUrls = (url: string) => {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('y.qq.com')) {
      return [url]
    }

    const candidates = [url]
    for (const host of TX_FALLBACK_HOSTS) {
      const next = new URL(parsed.toString())
      next.hostname = host
      candidates.push(next.toString())
    }
    return Array.from(new Set(candidates))
  } catch {
    return [url]
  }
}

export const createTxSearchBody = (str: string, page: number, limit: number) => {
  return {
    comm: {
      ct: '11',
      cv: '14090508',
      v: '14090508',
      tmeAppID: 'qqmusic',
      phonetype: 'EBG-AN10',
      deviceScore: '553.47',
      devicelevel: '50',
      newdevicelevel: '20',
      rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
      os_ver: '12',
      OpenUDID: '0',
      OpenUDID2: '0',
      QIMEI36: '0',
      udid: '0',
      chid: '0',
      aid: '0',
      oaid: '0',
      taid: '0',
      tid: '0',
      wid: '0',
      uid: '0',
      sid: '0',
      modeSwitch: '6',
      teenMode: '0',
      ui_mode: '2',
      nettype: '1020',
      v4ip: ''
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 0,
        query: str,
        page_num: page,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: 0,
        sem: 0
      }
    }
  }
}

export const txRequest = async (url: string, body: Record<string, unknown>) => {
  const candidateUrls = buildTxCandidateUrls(url)
  let lastError: unknown

  for (const candidateUrl of candidateUrls) {
    for (let attempt = 0; attempt <= TX_MAX_RETRIES_PER_HOST; attempt++) {
      try {
        const response = await $fetch(candidateUrl, {
          method: 'POST',
          headers: txHeaders,
          body,
          responseType: 'json',
          timeout: TX_REQUEST_TIMEOUT_MS
        })
        return response
      } catch (error: unknown) {
        lastError = error

        if (!isRetryableTxError(error)) {
          throw error
        }

        if (attempt < TX_MAX_RETRIES_PER_HOST) {
          await sleep(TX_RETRY_BASE_DELAY_MS * (attempt + 1))
        }
      }
    }
  }

  console.error('TX Request Error:', {
    url,
    attemptedUrls: candidateUrls,
    code: getTxErrorCode(lastError),
    message: getTxErrorMessage(lastError)
  })

  throw lastError
}
