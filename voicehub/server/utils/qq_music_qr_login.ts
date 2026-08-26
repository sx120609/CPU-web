import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { connect, type IConnackPacket, type IPublishPacket, type MqttClient } from 'mqtt'

type QrLoginStatus = 'waiting' | 'scanned' | 'success' | 'expired' | 'error'

interface QqMusicQrSession {
  key: string
  ownerId: string
  qrcodeId: string
  clientId: string
  status: QrLoginStatus
  expiresAt: number
  client?: MqttClient
  credentialCookie?: string
  error?: string
  completing?: boolean
  expiryTimer?: NodeJS.Timeout
}

interface CreateQrCodeResponse {
  code?: number
  req?: {
    code?: number
    data?: {
      qrcode?: string
      qrcodeID?: string
      expiresIn?: number
    }
  }
}

interface MobileLoginResponse {
  code?: number
  req?: {
    code?: number
    data?: {
      musicid?: number | string
      musickey?: string
    }
  }
}

interface MobileLoginPushPayload {
  cookies?: Record<string, { value?: unknown }>
}

const QQ_MUSIC_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_MUSIC_ANDROID_VERSION = 14090008
const QQ_MUSIC_USER_AGENT = `QQMusic ${QQ_MUSIC_ANDROID_VERSION}(android 12)`
const MQTT_BASE_PATH = '/ws/handshake'
const MQTT_CONNECT_TIMEOUT_MS = 10_000
const MQTT_MAX_REDIRECTS = 3
const DEFAULT_QR_EXPIRES_SECONDS = 15 * 60

const sessions = new Map<string, QqMusicQrSession>()
const sessionByOwner = new Map<string, string>()

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '未知错误')
  }
  return String(error || '未知错误')
}

export const requireQqMusicAdmin = (event: H3Event) => {
  const user = event.context.user as { id?: number | string; role?: string } | undefined
  if (!user?.id || !['ADMIN', 'SUPER_ADMIN'].includes(String(user.role))) {
    throw createError({ statusCode: 403, message: '需要广播站管理员权限' })
  }
  return { id: String(user.id) }
}

const stopSessionClient = (session: QqMusicQrSession) => {
  const client = session.client
  session.client = undefined
  if (client) {
    client.end(true)
  }
}

const expireSession = (session: QqMusicQrSession) => {
  if (session.status !== 'success') {
    session.status = 'expired'
  }
  stopSessionClient(session)
}

const removeSession = (session: QqMusicQrSession) => {
  stopSessionClient(session)
  if (session.expiryTimer) {
    clearTimeout(session.expiryTimer)
    session.expiryTimer = undefined
  }
  sessions.delete(session.key)
  if (sessionByOwner.get(session.ownerId) === session.key) {
    sessionByOwner.delete(session.ownerId)
  }
}

const replaceOwnerSession = (ownerId: string) => {
  const existingKey = sessionByOwner.get(ownerId)
  if (!existingKey) return
  const existing = sessions.get(existingKey)
  if (existing) removeSession(existing)
}

const createMobileQrCode = async () => {
  const payload = {
    comm: { ct: 23, cv: 0 },
    req: {
      module: 'music.login.LoginServer',
      method: 'CreateQRCode',
      param: {
        tmeAppID: 'qqmusic',
        ct: 11,
        cv: QQ_MUSIC_ANDROID_VERSION
      }
    }
  }

  const response = await fetch(QQ_MUSIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': QQ_MUSIC_USER_AGENT
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  })

  if (!response.ok) {
    throw new Error(`QQ 音乐二维码接口返回 HTTP ${response.status}`)
  }

  const result = await response.json() as CreateQrCodeResponse
  const data = result.req?.data
  if (result.code !== 0 || result.req?.code !== 0 || !data?.qrcode || !data.qrcodeID) {
    throw new Error(`QQ 音乐二维码接口返回异常（code=${result.req?.code ?? result.code ?? 'unknown'}）`)
  }

  return {
    qrcode: data.qrcode,
    qrcodeId: data.qrcodeID,
    expiresIn: Math.max(30, Number(data.expiresIn) || DEFAULT_QR_EXPIRES_SECONDS)
  }
}

const buildCredentialCookie = (musicid: string, musickey: string) => {
  if (/[;\r\n]/.test(musicid) || /[;\r\n]/.test(musickey)) {
    throw new Error('QQ 音乐返回了无效登录凭据')
  }
  return [
    `uin=${musicid}`,
    `qqmusic_uin=${musicid}`,
    `musicid=${musicid}`,
    `qqmusic_key=${musickey}`,
    `qm_keyst=${musickey}`
  ].join('; ')
}

const finishMobileLogin = async (qrcodeId: string, musicid: string, token: string) => {
  const payload = {
    comm: {
      ct: 11,
      cv: QQ_MUSIC_ANDROID_VERSION,
      v: QQ_MUSIC_ANDROID_VERSION,
      tmeAppID: 'qqmusic',
      tmeLoginType: 6
    },
    req: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: {
        musicid: Number(musicid),
        qrCodeID: qrcodeId,
        token
      }
    }
  }

  const response = await fetch(QQ_MUSIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': QQ_MUSIC_USER_AGENT
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  })

  if (!response.ok) {
    throw new Error(`QQ 音乐登录接口返回 HTTP ${response.status}`)
  }

  const result = await response.json() as MobileLoginResponse
  const data = result.req?.data
  if (result.code !== 0 || result.req?.code !== 0 || !data?.musicid || !data.musickey) {
    throw new Error(`QQ 音乐登录接口返回异常（code=${result.req?.code ?? result.code ?? 'unknown'}）`)
  }

  return buildCredentialCookie(String(data.musicid), data.musickey)
}

const getUserProperty = (packet: IPublishPacket, key: string) => {
  const value = packet.properties?.userProperties?.[key]
  return Array.isArray(value) ? value[0] : value
}

const handleMqttMessage = async (
  session: QqMusicQrSession,
  payloadBuffer: Buffer,
  packet: IPublishPacket
) => {
  if (session.status === 'success' || session.status === 'expired') return

  const eventType = getUserProperty(packet, 'type')
  let payload: MobileLoginPushPayload | null = null
  try {
    payload = JSON.parse(payloadBuffer.toString('utf8')) as MobileLoginPushPayload
  } catch {
    payload = null
  }

  if (eventType === 'scanned') {
    session.status = 'scanned'
    return
  }
  if (eventType === 'canceled' || eventType === 'timeout') {
    session.status = 'expired'
    session.error = eventType === 'canceled' ? '已在手机上取消登录' : '二维码已过期'
    stopSessionClient(session)
    return
  }
  if (eventType === 'loginFailed') {
    session.status = 'error'
    session.error = 'QQ 音乐登录失败，请刷新二维码重试'
    stopSessionClient(session)
    return
  }
  if (eventType !== 'cookies' || session.completing) return

  const cookies = payload?.cookies
  const musicid = cookies?.qqmusic_uin?.value
  const token = cookies?.qqmusic_key?.value
  if (!musicid || !token) {
    session.status = 'error'
    session.error = 'QQ 音乐未返回完整登录凭据'
    stopSessionClient(session)
    return
  }

  session.completing = true
  session.status = 'scanned'
  try {
    session.credentialCookie = await finishMobileLogin(session.qrcodeId, String(musicid), String(token))
    session.status = 'success'
  } catch (error) {
    session.status = 'error'
    session.error = getErrorMessage(error)
  } finally {
    session.completing = false
    stopSessionClient(session)
  }
}

const buildRedirectPath = (currentPath: string, serverReference: string) => {
  const parts = currentPath.replace(/\/+$/, '').split('/')
  if (parts.at(-1)?.includes(':')) {
    parts[parts.length - 1] = serverReference
    return parts.join('/')
  }
  return `${currentPath.replace(/\/+$/, '')}/${serverReference}`
}

const connectMqttSession = (
  session: QqMusicQrSession,
  path = MQTT_BASE_PATH,
  redirectCount = 0
): Promise<void> => {
  return new Promise((resolve, reject) => {
    let settled = false
    let redirecting = false
    const client = connect(`wss://mu.y.qq.com${path}`, {
      protocolVersion: 5,
      clientId: session.clientId,
      clean: true,
      keepalive: 45,
      reconnectPeriod: 0,
      connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
      properties: {
        authenticationMethod: 'pass',
        userProperties: {
          tmeAppID: 'qqmusic',
          business: 'management',
          hashTag: session.qrcodeId,
          clientTag: 'management.user',
          userID: session.qrcodeId
        }
      },
      wsOptions: {
        headers: {
          Origin: 'https://y.qq.com',
          Referer: 'https://y.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    })

    session.client = client

    const connectTimer = setTimeout(() => {
      if (settled || redirecting) return
      settled = true
      stopSessionClient(session)
      reject(new Error('连接 QQ 音乐扫码服务超时'))
    }, MQTT_CONNECT_TIMEOUT_MS + 1_000)
    connectTimer.unref?.()

    const fail = (error: unknown) => {
      if (settled || redirecting) return
      settled = true
      clearTimeout(connectTimer)
      stopSessionClient(session)
      reject(error instanceof Error ? error : new Error(getErrorMessage(error)))
    }

    client.on('packetreceive', (packet) => {
      if (packet.cmd !== 'connack') return
      const connack = packet as IConnackPacket
      const serverReference = connack.properties?.serverReference
      if (
        [0x9c, 0x9d].includes(connack.reasonCode)
        && serverReference
        && redirectCount < MQTT_MAX_REDIRECTS
        && !redirecting
      ) {
        redirecting = true
        clearTimeout(connectTimer)
        session.client = undefined
        client.end(true)
        void connectMqttSession(
          session,
          buildRedirectPath(path, serverReference),
          redirectCount + 1
        ).then(resolve, reject)
      }
    })

    client.once('connect', () => {
      const topic = `management.qrcode_login/${session.qrcodeId}`
      client.subscribe(topic, {
        qos: 0,
        properties: {
          userProperties: {
            authorization: 'tmelogin',
            pubsub: 'unicast'
          }
        }
      }, (error) => {
        if (error) {
          fail(error)
          return
        }
        if (settled || redirecting) return
        settled = true
        clearTimeout(connectTimer)
        resolve()
      })
    })

    client.on('message', (_topic, payload, packet) => {
      void handleMqttMessage(session, payload, packet)
    })

    client.on('error', (error) => {
      if (!settled) {
        fail(error)
        return
      }
      if (!redirecting && session.client === client && session.status !== 'success') {
        session.status = 'error'
        session.error = `QQ 音乐扫码连接中断：${getErrorMessage(error)}`
        stopSessionClient(session)
      }
    })

    client.on('close', () => {
      if (!settled || redirecting || session.client !== client) return
      if (!['success', 'expired', 'error'].includes(session.status)) {
        session.status = 'error'
        session.error = 'QQ 音乐扫码连接已断开，请刷新二维码重试'
      }
    })
  })
}

export const createQqMusicQrSession = async (ownerId: string) => {
  replaceOwnerSession(ownerId)
  const qr = await createMobileQrCode()
  const now = Date.now()
  const session: QqMusicQrSession = {
    key: randomUUID(),
    ownerId,
    qrcodeId: qr.qrcodeId,
    clientId: `${now}${Math.floor(1000 + Math.random() * 9000)}`,
    status: 'waiting',
    expiresAt: now + qr.expiresIn * 1000
  }

  sessions.set(session.key, session)
  sessionByOwner.set(ownerId, session.key)

  try {
    await connectMqttSession(session)
  } catch (error) {
    removeSession(session)
    throw error
  }

  session.expiryTimer = setTimeout(() => expireSession(session), qr.expiresIn * 1000)
  session.expiryTimer.unref?.()

  return {
    qrKey: session.key,
    qrCodeUrl: qr.qrcode,
    expiresIn: qr.expiresIn
  }
}

export const getQqMusicQrSession = (ownerId: string, key: string) => {
  const session = sessions.get(key)
  if (!session || session.ownerId !== ownerId) {
    throw createError({ statusCode: 404, message: '扫码会话不存在或已失效' })
  }

  if (Date.now() >= session.expiresAt && session.status !== 'success') {
    expireSession(session)
  }

  return {
    status: session.status,
    credentialCookie: session.credentialCookie,
    error: session.error
  }
}

export const closeQqMusicQrSession = (ownerId: string) => {
  const key = sessionByOwner.get(ownerId)
  if (!key) return
  const session = sessions.get(key)
  if (session) removeSession(session)
}
