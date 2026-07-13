type QQDisplayProfile = {
  name?: string
  avatar?: string
}

const QQ_NUMBER_REGEX = /^[1-9]\d{4,10}$/

const normalizeQQNumber = (value?: string | null): string | null => {
  if (!value) {
    return null
  }
  const normalized = value.trim()
  return QQ_NUMBER_REGEX.test(normalized) ? normalized : null
}

const extractQQNumberFromEmail = (email?: string | null): string | null => {
  if (!email) {
    return null
  }

  const normalized = email.trim().toLowerCase()
  if (!normalized.endsWith('@qq.com')) {
    return null
  }

  return normalizeQQNumber(normalized.slice(0, -'@qq.com'.length))
}

const getQQNumberFromAccount = (username?: string | null, email?: string | null): string | null => {
  return normalizeQQNumber(username) || extractQQNumberFromEmail(email)
}

export const getQQAvatarUrl = (qqNumber: string): string =>
  `https://q.qlogo.cn/headimg_dl?dst_uin=${qqNumber}&spec=640&img_type=jpg`

export const resolveQQDisplayProfile = async (
  username?: string | null,
  email?: string | null
): Promise<QQDisplayProfile | null> => {
  const qqNumber = getQQNumberFromAccount(username, email)
  if (!qqNumber) {
    return null
  }

  return {
    avatar: getQQAvatarUrl(qqNumber)
  }
}
