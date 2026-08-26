import crypto from 'crypto'

interface QRLoginResponse {
  code: number
  ts: number
  start_ts: number
  data: {
    qrcode_key: string
    qrcode_url: string
  }
}

export default defineEventHandler(async (event) => {
  try {
    // Generate QR login request
    const payload = {
      comm: {
        g_tk: 5,
        format: 'json',
        ct: 24,
        cv: 0
      },
      req: {
        module: 'QRLogin.QRCodeLogin',
        method: 'GetQRCode',
        param: {}
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

    const data: QRLoginResponse = await response.json()

    if (data.code !== 0 || !data.data?.qrcode_key || !data.data?.qrcode_url) {
      throw new Error('Failed to generate QR code')
    }

    return {
      success: true,
      qrKey: data.data.qrcode_key,
      qrCodeUrl: data.data.qrcode_url
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to generate QR code'
    })
  }
})
