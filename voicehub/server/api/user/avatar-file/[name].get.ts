import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { promises as fs } from 'fs'
import path from 'path'

const AVATAR_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

const getAvatarStorageDirs = (): string[] => {
  const root = process.cwd()

  const envDir = process.env.AVATAR_UPLOAD_DIR?.trim()
  const resolvedEnvDir = envDir
    ? path.isAbsolute(envDir)
      ? envDir
      : path.join(root, envDir)
    : null

  const ordered = [
    resolvedEnvDir,
    path.join(root, 'storage', 'uploads', 'avatars'),
    path.join(root, '.output', 'public', 'uploads', 'avatars'),
    path.join(root, 'public', 'uploads', 'avatars')
  ].filter((item): item is string => Boolean(item))

  return [...new Set(ordered)]
}

const resolveContentType = (fileName: string): string => {
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''
  return CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream'
}

export default defineEventHandler(async (event) => {
  const rawName = getRouterParam(event, 'name')
  const fileName = Array.isArray(rawName) ? rawName[0] : rawName

  if (!fileName || !AVATAR_FILENAME_REGEX.test(fileName)) {
    throw createError({
      statusCode: 400,
      message: '头像文件名无效'
    })
  }

  const storageDirs = getAvatarStorageDirs()
  for (const dir of storageDirs) {
    const filePath = path.join(dir, fileName)
    try {
      await fs.access(filePath)
      const fileBuffer = await fs.readFile(filePath)
      setHeader(event, 'Content-Type', resolveContentType(fileName))
      setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=86400')
      setHeader(event, 'Content-Length', String(fileBuffer.length))
      return fileBuffer
    } catch {
      // continue to next directory
    }
  }

  throw createError({
    statusCode: 404,
    message: '头像文件不存在'
  })
})
