import nodemailer from 'nodemailer'
import { db } from '~/drizzle/db'
import { emailTemplates, systemSettings, users } from '~/drizzle/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getSiteTitle } from '~~/server/utils/siteUtils'
import { formatIPForEmail } from '~~/server/utils/ip-utils'
import { assertMailSendAllowed } from '~~/server/utils/mail-risk-control'

const parseTimeoutEnv = (name: string, fallback: number) => {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1000) return fallback
  return Math.floor(parsed)
}

const SMTP_CONNECTION_TIMEOUT = parseTimeoutEnv('SMTP_CONNECTION_TIMEOUT_MS', 8000)
const SMTP_GREETING_TIMEOUT = parseTimeoutEnv('SMTP_GREETING_TIMEOUT_MS', 8000)
const SMTP_SOCKET_TIMEOUT = parseTimeoutEnv('SMTP_SOCKET_TIMEOUT_MS', 15000)
const SMTP_DNS_TIMEOUT = parseTimeoutEnv('SMTP_DNS_TIMEOUT_MS', 8000)
const SMTP_SEND_RETRY_DELAY_MS = parseTimeoutEnv('SMTP_SEND_RETRY_DELAY_MS', 300)
const SITE_TITLE_CACHE_TTL_MS = parseTimeoutEnv('SMTP_SITE_TITLE_CACHE_TTL_MS', 300000)
const SITE_TITLE_LOOKUP_TIMEOUT_MS = parseTimeoutEnv('SMTP_SITE_TITLE_LOOKUP_TIMEOUT_MS', 1500)
const SMTP_DEBUG_RESPONSE = process.env.SMTP_DEBUG_RESPONSE === '1'

export const formatSmtpErrorDetail = (error: any): string => {
  const message = error?.message || '未知错误'
  const metaParts: string[] = []

  if (error?.code) metaParts.push(`code=${error.code}`)
  if (error?.responseCode) metaParts.push(`responseCode=${error.responseCode}`)
  if (error?.command) metaParts.push(`command=${error.command}`)

  let detail = message
  if (metaParts.length > 0) {
    detail += ` (${metaParts.join(', ')})`
  }

  if (/timeout|ETIMEDOUT|ESOCKET|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(detail)) {
    detail +=
      '。这通常是应用容器到 SMTP 服务器的网络或 TLS 握手问题，请在容器内检查 587 端口与 STARTTLS。'
  }

  return detail
}

export const buildSmtpTransporterConfig = (smtpConfig: {
  host: string
  port?: number
  secure?: boolean
  auth?: any
}) => {
  const host = smtpConfig.host
  const port = Number(smtpConfig.port) || 587

  const transporterConfig: any = {
    host,
    port,
    secure: Boolean(smtpConfig.secure),
    auth: smtpConfig.auth,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT,
    greetingTimeout: SMTP_GREETING_TIMEOUT,
    socketTimeout: SMTP_SOCKET_TIMEOUT,
    dnsTimeout: SMTP_DNS_TIMEOUT
  }

  // 按标准端口自动规范加密策略，避免 587 被错误配置为隐式 TLS 导致超时
  if (port === 587) {
    transporterConfig.secure = false
    transporterConfig.requireTLS = true
    transporterConfig.tls = {
      minVersion: 'TLSv1.2',
      servername: host,
      rejectUnauthorized: false
    }
  } else if (port === 465) {
    transporterConfig.secure = true
    transporterConfig.tls = {
      minVersion: 'TLSv1.2',
      servername: host,
      rejectUnauthorized: false
    }
  } else if (port === 25) {
    transporterConfig.secure = false
    transporterConfig.tls = {
      servername: host,
      rejectUnauthorized: false
    }
  } else if (!transporterConfig.secure) {
    transporterConfig.tls = {
      servername: host,
      rejectUnauthorized: false
    }
  }

  return transporterConfig
}

/**
 * SMTP邮件服务
 */
export class SmtpService {
  private static instance: SmtpService
  public transporter: nodemailer.Transporter | null = null
  public smtpConfig: any = null
  private initPromise: Promise<boolean> | null = null
  private lastSiteTitle = ''
  private lastSiteTitleAt = 0
  /** 基础邮件模板结构 */
  private baseTemplate = `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; background: #f9f9f9; padding: 20px;">
      <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin: 0;">{{fromName}}</h1>
          <p style="color: #666; margin: 5px 0 0 0;">{{headerSubtitle}}</p>
        </div>
        
        {{#if title}}
        <h2 style="color: #333; margin-bottom: 20px;">{{title}}</h2>
        {{/if}}
        
        <div style="color: #555; line-height: 1.6; margin-bottom: 30px;">
          {{contentBlock}}
        </div>
        
        {{#if actionUrl}}
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{actionUrl}}" style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">{{actionText}}</a>
        </div>
        {{/if}}
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="color: #666; font-size: 12px; text-align: center;">
          此邮件由系统自动发送，请勿回复。<br>
          如有疑问，请联系管理员。{{#if ipAddress}}<br><br>This email was requested from: <span style="font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; color: #333; text-decoration: none; pointer-events: none;">{{ipAddress}}</span>{{/if}}
        </p>
      </div>
    </div>
  `

  /** 内容块模板 */
  private contentBlocks: Record<string, string> = {
    verification: `
      <p>您好，{{name}}！</p>
      <p>您正在验证邮箱：<strong>{{email}}</strong></p>
      <p>请在{{expiresInMinutes}}分钟内输入以下验证码完成验证：</p>
      <div style="text-align: center; margin: 20px 0;">
        <h2 style="letter-spacing: 4px; color: #007bff; background: #f8f9fa; padding: 15px; border-radius: 4px; display: inline-block;">{{code}}</h2>
      </div>
      <p style="color:#888">若非本人操作，请忽略本邮件。</p>
    `,
    verificationLink: `
      <p>您好，{{name}}！</p>
      <p>您正在激活账号：<strong>{{email}}</strong></p>
      <p>请点击下方按钮完成账号激活，链接有效期 <strong>{{expiresInDays}} 天</strong>。</p>
      <p style="color:#888; word-break: break-all;">若按钮无法点击，请复制此链接到浏览器打开：{{activationUrl}}</p>
      <p style="color:#888">若非本人操作，请忽略本邮件。</p>
    `,
    passwordResetLink: `
      <p>您好，{{name}}！</p>
      <p>您正在重置账号密码：<strong>{{email}}</strong></p>
      <p>请点击下方按钮设置新密码，链接有效期 <strong>{{expiresInMinutes}} 分钟</strong>。</p>
      <p style="color:#888; word-break: break-all;">若按钮无法点击，请复制此链接到浏览器打开：{{resetUrl}}</p>
      <p style="color:#888">若非本人操作，请忽略本邮件。</p>
    `,
    generic: `
      <div style="white-space: pre-wrap;">{{message}}</div>
    `,
    songSelected: `
      <p>您投稿的歌曲《{{songTitle}}》已被安排播放。</p>
      <p>播放日期：<strong>{{playDate}}</strong></p>
      {{#if playTimeName}}
      <p>播出时段：<strong>{{playTimeName}}</strong>{{#if playTimeRange}}（{{playTimeRange}}）{{/if}}</p>
      {{/if}}
      {{#if message}}
      <p style="color: #555; white-space: pre-wrap;">{{message}}</p>
      {{/if}}
    `,
    songPlayed: `
      <p>您投稿的歌曲《{{songTitle}}》已播放。</p>
      {{#if message}}
      <p style="color: #555; white-space: pre-wrap;">{{message}}</p>
      {{/if}}
    `,
    songVoted: `
      <p>您投稿的歌曲《{{songTitle}}》获得了新的投票。</p>
      <p>当前共有 <strong>{{votesCount}}</strong> 个投票。</p>
      {{#if message}}
      <p style="color: #555; white-space: pre-wrap;">{{message}}</p>
      {{/if}}
    `
  }

  /** 模板配置 */
  private builtinTemplates: Record<
    string,
    {
      name: string
      subject: string
      contentType: string
      headerSubtitle: string
      actionText?: string
    }
  > = {
    'verification.code': {
      name: '邮箱验证码',
      subject: '邮箱验证码 | {{siteTitle}}',
      contentType: 'verification',
      headerSubtitle: '邮箱验证'
    },
    'verification.link': {
      name: '账号激活链接',
      subject: '账号激活链接 | {{siteTitle}}',
      contentType: 'verificationLink',
      headerSubtitle: '账号激活',
      actionText: '立即激活账号'
    },
    'password.reset.link': {
      name: '密码重置链接',
      subject: '密码重置链接 | {{siteTitle}}',
      contentType: 'passwordResetLink',
      headerSubtitle: '找回密码',
      actionText: '重置密码'
    },
    'notification.generic': {
      name: '通用通知',
      subject: '{{title}} | {{siteTitle}}通知推送',
      contentType: 'generic',
      headerSubtitle: '通知推送',
      actionText: '查看详情'
    },
    'notification.songSelected': {
      name: '歌曲被选中',
      subject: '收到新选中 | {{siteTitle}}通知推送',
      contentType: 'songSelected',
      headerSubtitle: '通知推送'
    },
    'notification.songPlayed': {
      name: '歌曲已播放',
      subject: '歌曲已播放 | {{siteTitle}}通知推送',
      contentType: 'songPlayed',
      headerSubtitle: '通知推送'
    },
    'notification.songVoted': {
      name: '收到新投票',
      subject: '收到新投票 | {{siteTitle}}通知推送',
      contentType: 'songVoted',
      headerSubtitle: '通知推送'
    }
  }

  private constructor() {}

  static getInstance(): SmtpService {
    if (!SmtpService.instance) {
      SmtpService.instance = new SmtpService()
      // 首次创建实例时，尝试初始化SMTP配置（异步执行，不阻塞）
      SmtpService.instance.initializeSmtpConfig().catch((error) => {
        console.log('SmtpService实例创建时初始化配置失败:', error.message)
      })
    }
    return SmtpService.instance
  }

  // 暴露内置模板（只读）
  getBuiltinTemplates(): Record<string, { name: string; subject: string; html: string }> {
    const templates: Record<string, { name: string; subject: string; html: string }> = {}

    for (const [key, config] of Object.entries(this.builtinTemplates)) {
      const contentBlock = this.contentBlocks[config.contentType] || ''
      const html = this.renderString(this.baseTemplate, {
        contentBlock,
        headerSubtitle: config.headerSubtitle,
        actionText: config.actionText || '查看详情'
      })

      templates[key] = {
        name: config.name,
        subject: config.subject,
        html
      }
    }

    return templates
  }

  /**
   * 初始化SMTP配置
   */
  async initializeSmtpConfig(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = (async () => {
      try {
        const settingsResult = await db.select().from(systemSettings).limit(1)
        const settings = settingsResult[0]

        if (!settings || !settings.smtpEnabled || !settings.smtpHost) {
          this.smtpConfig = null
          this.transporter = null
          return false
        }

        const nextConfig = {
          host: settings.smtpHost,
          port: settings.smtpPort || 587,
          secure: settings.smtpSecure || false,
          auth:
            settings.smtpUsername && settings.smtpPassword
              ? {
                  user: settings.smtpUsername,
                  pass: settings.smtpPassword
                }
              : undefined,
          fromEmail: settings.smtpFromEmail || settings.smtpUsername,
          fromName: settings.smtpFromName || '校园广播站'
        }

        const prevSignature = this.smtpConfig ? JSON.stringify(this.smtpConfig) : ''
        const nextSignature = JSON.stringify(nextConfig)
        const configChanged = prevSignature !== nextSignature

        if (!this.transporter || configChanged) {
          this.smtpConfig = nextConfig
          this.transporter = nodemailer.createTransport(buildSmtpTransporterConfig(this.smtpConfig))
        } else {
          // 配置未变化时，刷新内存配置，避免 fromName 等信息滞后
          this.smtpConfig = nextConfig
        }

        return true
      } catch (error) {
        console.error('初始化SMTP配置失败:', error instanceof Error ? error.message : '未知错误')
        this.smtpConfig = null
        this.transporter = null
        return false
      }
    })()

    try {
      return await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  /**
   * 发送邮件
   */
  async sendMail(
    to: string,
    subject: string,
    htmlContent: string,
    textContent?: string,
    ipAddress?: string
  ): Promise<boolean> {
    // 全局发信风控（频率/内容/收件人策略）
    assertMailSendAllowed({
      to,
      subject,
      htmlContent,
      ipAddress
    })

    // 确保配置已初始化
    if (!(await this.ensureInitialized())) {
      throw new Error('SMTP配置未初始化或无效')
    }

    // 如果提供了IP地址，在邮件内容中添加IP信息
    let finalHtml = htmlContent
    if (ipAddress) {
      const formattedIP = formatIPForEmail(ipAddress)
      // 在邮件末尾添加IP信息
      finalHtml = htmlContent.replace(
        /(<p[^>]*style="[^"]*text-align: center[^"]*"[^>]*>.*?此邮件由系统自动发送，请勿回复。.*?<\/p>)/s,
        `$1`.replace(
          '此邮件由系统自动发送，请勿回复。',
          `此邮件由系统自动发送，请勿回复。<br><br>This email was requested from: ${formattedIP}`
        )
      )
    }

    const mailOptions = {
      from: {
        name: this.smtpConfig.fromName,
        address: this.smtpConfig.fromEmail
      },
      to,
      subject,
      html: finalHtml,
      text: textContent || finalHtml.replace(/<[^>]*>/g, '') // 简单的HTML转文本
    }

    try {
      const result = await this.transporter!.sendMail(mailOptions)
      console.log(`邮件发送成功: ${result.messageId}`)
      return true
    } catch (error: any) {
      // 自动重试机制：如果是因为发件人地址不匹配导致的553/501错误，尝试使用认证用户作为发件人
      if (
        (error.responseCode === 553 || error.responseCode === 501) &&
        this.smtpConfig.auth?.user
      ) {
        console.warn(
          `SMTP发件人地址不匹配 (${error.responseCode})，正在尝试使用认证用户重试发送...`
        )
        try {
          // 这里可以安全地使用 mailOptions，因为它在 try 块外部定义
          const retryMailOptions = {
            ...mailOptions,
            from: {
              ...mailOptions.from,
              address: this.smtpConfig.auth.user
            }
          }
          const result = await this.transporter!.sendMail(retryMailOptions)
          console.log(`重试发送成功: ${result.messageId}`)
          return true
        } catch (retryError) {
          console.error('重试发送失败:', retryError)
          throw error // 如果重试也失败，抛出原始错误
        }
      }

      const transientErrorPattern =
        /ETIMEDOUT|ESOCKET|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|Connection (?:closed|terminated|timeout)/i
      if (transientErrorPattern.test(error?.message || '') || transientErrorPattern.test(error?.code || '')) {
        console.warn('SMTP连接异常，尝试重建连接后重试发送...')
        try {
          // 强制重建 transporter
          this.transporter = null
          const reinitialized = await this.initializeSmtpConfig()
          if (reinitialized) {
            await new Promise((resolve) => setTimeout(resolve, SMTP_SEND_RETRY_DELAY_MS))
            const result = await this.transporter!.sendMail(mailOptions)
            console.log(`重建连接后发送成功: ${result.messageId}`)
            return true
          }
        } catch (retryError) {
          console.error('SMTP重建连接后重试失败:', retryError)
        }
      }

      console.error('发送邮件失败:', error)
      throw error
    }
  }

  /**
   * 渲染模板：优先使用自定义模板，否则回退到内置模板
   */
  async renderTemplate(
    key: string,
    data: Record<string, any>
  ): Promise<{ subject: string; html: string }> {
    const builtin = this.builtinTemplates[key]
    let subject = builtin?.subject || ''
    let html = ''

    try {
      const rows = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.key, key))
        .limit(1)
      const custom = rows[0]
      if (custom) {
        subject = custom.subject
        html = custom.html
      }
    } catch (e) {
      // 忽略读取失败，走内置
    }

    let mergedData: Record<string, any>

    // 如果没有自定义模板，使用内置模板系统
    if (!html && builtin) {
      mergedData = await this.prepareTemplateData(data)
      const contentBlock = this.renderString(
        this.contentBlocks[builtin.contentType] || '',
        mergedData
      )
      const templateData = {
        ...mergedData,
        contentBlock,
        headerSubtitle: builtin.headerSubtitle,
        actionText: builtin.actionText || '查看详情'
      }
      html = this.renderString(this.baseTemplate, templateData)
    } else {
      mergedData = await this.prepareTemplateData(data)
      html = this.renderString(html, mergedData)
    }

    return {
      subject: this.renderString(subject, mergedData),
      html
    }
  }

  /**
   * 渲染并发送模板
   */
  async renderAndSend(
    to: string,
    key: string,
    data: Record<string, any>,
    ipAddress?: string
  ): Promise<boolean> {
    try {
      // 确保配置已初始化
      if (!(await this.ensureInitialized())) {
        return false
      }

      // 格式化IP地址用于模板渲染（统一处理）
      const formattedIP = ipAddress ? formatIPForEmail(ipAddress) : undefined
      const templateData = { ...data, ipAddress: formattedIP }

      const { subject, html } = await this.renderTemplate(key, templateData)
      if (!subject || !html) {
        // 若模板缺失，退回到简单包装（传入已格式化的IP）
        const mergedData = await this.prepareTemplateData(templateData)
        const fallbackHtml = this.generateEmailTemplate(
          data.title || '通知',
          data.message || '',
          data.actionUrl,
          formattedIP
        )
        const fallbackSubject = `${data.title || '通知'} | ${mergedData.siteTitle}通知推送`
        return await this.sendMail(to, fallbackSubject, fallbackHtml, undefined, ipAddress)
      }
      return await this.sendMail(to, subject, html, undefined, ipAddress)
    } catch (error) {
      console.error('渲染并发送邮件失败:', error)
      return false
    }
  }

  /**
   * 测试SMTP连接
   */
  async testConnection(): Promise<{ success: boolean; message: string; detail?: string }> {
    if (!this.transporter) {
      try {
        const initialized = await this.initializeSmtpConfig()
        if (!initialized) {
          return { success: false, message: 'SMTP配置无效或未启用' }
        }
      } catch (error) {
        return {
          success: false,
          message: '初始化SMTP配置失败',
          detail: SMTP_DEBUG_RESPONSE ? (error instanceof Error ? error.message : '未知错误') : undefined
        }
      }
    }

    try {
      await this.transporter!.verify()
      return { success: true, message: 'SMTP连接测试成功' }
    } catch (error) {
      return {
        success: false,
        message: 'SMTP连接测试失败',
        detail: SMTP_DEBUG_RESPONSE ? formatSmtpErrorDetail(error) : undefined
      }
    }
  }

  /**
   * 发送测试邮件
   */
  async sendTestEmail(
    to: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string; detail?: string }> {
    try {
      const formattedIP = ipAddress ? formatIPForEmail(ipAddress) : undefined
      const templateData = await this.prepareTemplateData({ ipAddress: formattedIP })
      const subject = `测试邮件 | ${templateData.siteTitle}通知推送`
      const htmlContent = this.generateEmailTemplate(
        '测试邮件',
        '这是一封来自校园广播站系统的测试邮件。<br>如果您收到这封邮件，说明SMTP配置已经正确设置。',
        undefined,
        formattedIP
      )

      const success = await this.sendMail(to, subject, htmlContent, undefined, ipAddress)
      return {
        success,
        message: success ? '测试邮件发送成功' : '测试邮件发送失败'
      }
    } catch (error) {
      return {
        success: false,
        message: '测试邮件发送失败',
        detail: SMTP_DEBUG_RESPONSE ? formatSmtpErrorDetail(error) : undefined
      }
    }
  }

  /**
   * 生成邮件HTML模板
   */
  generateEmailTemplate(
    title: string,
    content: string,
    actionUrl?: string,
    formattedIP?: string
  ): string {
    return `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; background: #f9f9f9; padding: 20px;">
        <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin: 0;">${this.smtpConfig?.fromName || '校园广播站'}</h1>
            <p style="color: #666; margin: 5px 0 0 0;">通知推送</p>
          </div>
          
          <h2 style="color: #333; margin-bottom: 20px;">${title}</h2>
          
          <div style="color: #555; line-height: 1.6; margin-bottom: 30px;">
            ${content}
          </div>
          
          ${
            actionUrl
              ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${actionUrl}" style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">查看详情</a>
            </div>
          `
              : ''
          }
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #666; font-size: 12px; text-align: center;">
            此邮件由系统自动发送，请勿回复。<br>
            如有疑问，请联系管理员。${formattedIP ? `<br><br>This email was requested from: <span style="font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; color: #333; text-decoration: none; pointer-events: none;">${formattedIP}</span>` : ''}
          </p>
        </div>
      </div>
    `
  }

  /**
   * 确保SMTP配置已初始化
   */
  private async ensureInitialized(): Promise<boolean> {
    if (!this.transporter) {
      return await this.initializeSmtpConfig()
    }
    return true
  }

  /**
   * 基本占位符渲染：用 {{var}} 替换，支持 {{#if var}}...{{/if}} 嵌套条件
   */
  private renderString(tpl: string, data: Record<string, any>): string {
    // 递归处理嵌套的 if 块
    const processIfBlocks = (template: string): string => {
      let hasChanges = true
      let result = template

      while (hasChanges) {
        hasChanges = false
        // 从最内层开始处理，匹配不包含嵌套{{#if}}的if块
        result = result.replace(
          /\{\{#if\s+([a-zA-Z0-9_\.]+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g,
          (match, key, inner) => {
            const v = key
              .split('.')
              .reduce((acc: any, k: string) => (acc ? acc[k] : undefined), data)
            hasChanges = true
            return v ? inner : ''
          }
        )
      }

      return result
    }

    // 处理所有if块
    tpl = processIfBlocks(tpl)

    // 处理变量
    tpl = tpl.replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_, key) => {
      const v = key.split('.').reduce((acc: any, k: string) => (acc ? acc[k] : undefined), data)
      return v == null ? '' : String(v)
    })

    return tpl
  }

  /**
   * 准备模板渲染数据
   */
  private async prepareTemplateData(data: Record<string, any>): Promise<Record<string, any>> {
    const now = Date.now()
    if (!this.lastSiteTitle || now - this.lastSiteTitleAt > SITE_TITLE_CACHE_TTL_MS) {
      let timeoutHandle: NodeJS.Timeout | null = null
      try {
        const lookupPromise = getSiteTitle().catch(() => '')
        const timeoutPromise = new Promise<string>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(''), SITE_TITLE_LOOKUP_TIMEOUT_MS)
        })
        const lookedUpTitle = await Promise.race([lookupPromise, timeoutPromise])
        if (lookedUpTitle) {
          this.lastSiteTitle = lookedUpTitle
          this.lastSiteTitleAt = now
        }
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
      }
    }
    const siteTitle = this.lastSiteTitle || 'VoiceHub'
    return { fromName: this.smtpConfig?.fromName || '校园广播站', siteTitle, ...data }
  }
}

/**
 * 发送邮件通知给用户
 */
export async function sendEmailNotificationToUser(
  userId: number,
  notificationTitle: string,
  notificationMessage: string,
  url?: string,
  templateKey?: string,
  templateData?: Record<string, any>,
  ipAddress?: string
): Promise<boolean> {
  try {
    const smtpService = SmtpService.getInstance()

    // 获取用户信息
    const userResult = await db
      .select({
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const user = userResult[0]

    // 仅检查用户是否有邮箱且已验证
    if (!user?.email || !user.emailVerified) {
      return false
    }

    // 使用指定模板，否则回退通用模板
    if (templateKey) {
      return await smtpService.renderAndSend(user.email, templateKey, templateData || {}, ipAddress)
    }
    return await smtpService.renderAndSend(
      user.email,
      'notification.generic',
      {
        title: notificationTitle,
        message: notificationMessage,
        actionUrl: url
      },
      ipAddress
    )
  } catch (error) {
    console.error('发送邮件通知失败:', error)
    return false
  }
}

/**
 * 批量发送邮件通知
 */
export async function sendBatchEmailNotifications(
  userIds: number[],
  notificationTitle: string,
  notificationMessage: string,
  url?: string,
  ipAddress?: string
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  const smtpService = SmtpService.getInstance()

  // 获取有邮箱且已验证的用户
  const usersWithEmail = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email
    })
    .from(users)
    .where(and(eq(users.emailVerified, true), isNotNull(users.email)))

  // 并发发送邮件（限制并发数）
  const batchSize = 5
  const targetUsers = usersWithEmail.filter((user) => userIds.includes(user.id))

  for (let i = 0; i < targetUsers.length; i += batchSize) {
    const batch = targetUsers.slice(i, i + batchSize)
    const promises = batch.map(async (user) => {
      // 确保 email 不为 null
      if (!user.email) {
        return false
      }
      const emailSuccess = await smtpService.renderAndSend(
        user.email,
        'notification.generic',
        {
          title: notificationTitle,
          message: notificationMessage,
          actionUrl: url
        },
        ipAddress
      )
      return emailSuccess
    })

    const results = await Promise.allSettled(promises)
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        success++
      } else {
        failed++
      }
    })
  }

  return { success, failed }
}
