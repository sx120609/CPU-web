interface QRCheckResponse {
  code: number
  ts: number
  data: {
    status: number // 0: waiting, 1: scanned, 2: confirmed, 3: expired
    cookies?: string
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const qrKey = body?.qrKey

  if (!qrKey) {
    throw createError({
      statusCode: 400,
      message: 'Missing qrKey parameter'
    })
  }

  try {
    const payload = {
      comm: {
        g_tk: 5,
        format: 'json',
        ct: 24,
        cv: 0
      },
      req: {
        module: 'QRLogin.QRCodeLogin',
        method: 'CheckQRCodeStatus',
        param: {
          qrcode_key: qrKey
        }
      }
    }

    const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data: QRCheckResponse = await response.json()

    // Parse status
    const statusMap: Record<number, string> = {
      0: 'waiting',
      1: 'scanned',
      2: 'success',
      3: 'expired'
    }

    const status = statusMap[data.data?.status ?? 0] || 'waiting'

    // If login successful, store cookies
    if (status === 'success' && data.data?.cookies) {
      setCookie(event, 'qq_music_session', data.data.cookies, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 // 30 days
      })
    }

    return {
      status,
      success: status === 'success'
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to check QR status'
    })
  }
})
