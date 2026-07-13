import {
  SmtpService,
  buildSmtpTransporterConfig
} from '~~/server/services/smtpService'
import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'

const resolveSmtpPassword = async (password: string | null | undefined) => {
  if (password && password !== '****************') {
    return password
  }

  const settingsResult = await db
    .select({
      smtpPassword: systemSettings.smtpPassword
    })
    .from(systemSettings)
    .limit(1)

  return settingsResult[0]?.smtpPassword || null
}

const SMTP_DEBUG_RESPONSE = process.env.SMTP_DEBUG_RESPONSE === '1'

export default defineEventHandler(async (event) => {
  // 检查请求方法
  if (getMethod(event) !== 'POST') {
    throw createError({
      statusCode: 405,
      message: '方法不被允许'
    })
  }

  // 检查用户认证和权限
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权访问'
    })
  }

  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '只有管理员才能测试SMTP连接'
    })
  }

  try {
    const body = await readBody(event)

    // 验证配置
    if (!body.smtpEnabled) {
      return {
        success: false,
        message: 'SMTP服务未启用'
      }
    }

    if (!body.smtpHost || !body.smtpUsername) {
      return {
        success: false,
        message: '请填写完整的SMTP配置信息'
      }
    }

    // 创建临时的SMTP服务实例进行测试
    const smtpService = SmtpService.getInstance()

    // 临时设置配置进行测试
    const originalConfig = smtpService.smtpConfig
    const originalTransporter = smtpService.transporter

    try {
      // 如果密码是掩码，则使用原始配置中的密码
      const testPassword = await resolveSmtpPassword(body.smtpPassword)
      if (!testPassword) {
        return {
          success: false,
          message: '未检测到SMTP密码，请重新输入授权码后保存配置'
        }
      }

      // 设置测试配置
      smtpService.smtpConfig = {
        host: body.smtpHost,
        port: body.smtpPort || 587,
        secure: body.smtpSecure || false,
        auth: {
          user: body.smtpUsername,
          pass: testPassword
        },
        fromEmail: body.smtpFromEmail || body.smtpUsername,
        fromName: body.smtpFromName || '校园广播站'
      }

      // 创建测试transporter
      const nodemailer = await import('nodemailer')
      const transporterConfig = buildSmtpTransporterConfig(smtpService.smtpConfig)
      smtpService.transporter = nodemailer.default.createTransport(transporterConfig)

      // 测试连接
      const result = await smtpService.testConnection()

      return result
    } finally {
      // 恢复原始配置
      smtpService.smtpConfig = originalConfig
      smtpService.transporter = originalTransporter
    }
  } catch (error) {
    console.error('测试SMTP连接失败:', error)
    const response: { success: boolean; message: string; detail?: string } = {
      success: false,
      message: '测试连接失败，请检查配置后重试'
    }
    if (SMTP_DEBUG_RESPONSE && error instanceof Error) {
      response.detail = error.message
    }
    return response
  }
})
