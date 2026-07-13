import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { emailVerificationCodes } from './send-code.post'
import { requireQQEmail } from '~~/server/utils/qq-email'

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== 'POST') {
    throw createError({ statusCode: 405, message: '方法不被允许' })
  }

  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权访问' })
  }

  const body = await readBody(event)
  const email = requireQQEmail(body?.email)

  const currentUser = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  if (!currentUser[0]) {
    throw createError({ statusCode: 404, message: '用户不存在' })
  }
  if ((currentUser[0].email || '').toLowerCase() !== email) {
    throw createError({ statusCode: 400, message: '邮箱不匹配，请先绑定当前QQ邮箱' })
  }

  // 验证通过：设置邮箱为已验证
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id))

  emailVerificationCodes.delete(email)

  return { success: true, message: 'QQ邮箱已验证' }
})
