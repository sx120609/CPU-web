import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { requireQQEmail } from '~~/server/utils/qq-email'

// 保留该导出以兼容历史接口调用，当前已切换为免验证码模式
const emailVerificationCodes = new Map<string, { code: string; userId: number; expiresAt: number }>()

export async function sendEmailVerificationCode(
  _userId: number,
  _email: string,
  _name?: string,
  _ipAddress?: string
) {
  throw createError({
    statusCode: 400,
    message: '当前系统已启用免验证码QQ邮箱绑定，无需发送验证码'
  })
}

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, message: '方法不被允许' })
  }

  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }

  const body = await readBody(event)
  const emailRaw = requireQQEmail(body?.email)

  // 确认邮箱未被其他用户占用
  const existing = await db.select().from(users).where(eq(users.email, emailRaw)).limit(1)
  if (existing.length > 0 && existing[0].id !== user.id) {
    throw createError({ statusCode: 400, message: '该邮箱已被其他用户绑定' })
  }

  // 写入/更新邮箱，直接标记为已验证（免确认邮件）
  await db.update(users).set({ email: emailRaw, emailVerified: true }).where(eq(users.id, user.id))
  emailVerificationCodes.delete(emailRaw)

  return { success: true, message: 'QQ邮箱绑定成功' }
})

export { emailVerificationCodes }
