import { createError, defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'

export default defineEventHandler(async (event) => {
  const authUser = event.context.user

  if (!authUser) {
    throw createError({
      statusCode: 401,
      message: '需要登录后才能访问'
    })
  }

  const userResult = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: users.role
    })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1)

  const user = userResult[0]
  if (!user) {
    throw createError({
      statusCode: 404,
      message: '用户不存在'
    })
  }

  return {
    success: true,
    data: {
      id: user.id,
      username: user.username,
      displayName: user.name || user.username,
      email: user.email || '',
      role: user.role
    }
  }
})
