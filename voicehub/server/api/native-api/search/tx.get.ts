import { createTxSearchBody, txRequest } from '../../../utils/native_tx'
import { decodeName, formatPlayTime, sizeFormate } from '../../../utils/native_common'

const getErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return
  }

  const typedError = error as { code?: unknown; cause?: unknown }
  if (typeof typedError.code === 'string') {
    return typedError.code
  }

  return getErrorCode(typedError.cause)
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const str = query.str as string
  const page = parseInt((query.page as string) || '1')
  const limit = parseInt((query.limit as string) || '50') // 腾讯接口默认每页 50 条

  if (!str) {
    throw createError({ statusCode: 400, message: 'Missing search query' })
  }

  const body = createTxSearchBody(str, page, limit)
  const txApiUrl = process.env.TX_API_URL || 'https://u.y.qq.com/cgi-bin/musicu.fcg'

  try {
    const result: any = await txRequest(txApiUrl, body)

    if (result.code !== 0 || result.req?.code !== 0) {
      console.warn('TX search returned non-zero code', {
        code: result.code,
        reqCode: result.req?.code
      })
      return {
        list: [],
        total: 0,
        page,
        limit,
        source: 'tx'
      }
    }

    const rawList = result.req.data.body.item_song || []

    const list = []
    for (const item of rawList) {
      if (!item.file?.media_mid) continue

      const types = []
      const _types: any = {}
      const file = item.file

      if (file.size_128mp3 != 0) {
        const size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = { size }
      }
      if (file.size_320mp3 !== 0) {
        const size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = { size }
      }
      if (file.size_flac !== 0) {
        const size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = { size }
      }
      if (file.size_hires !== 0) {
        const size = sizeFormate(file.size_hires)
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = { size }
      }

      let albumId = ''
      let albumName = ''
      if (item.album) {
        albumName = item.album.name
        albumId = item.album.mid
      }

      const singerName = item.singer ? item.singer.map((s: any) => s.name).join('、') : ''

      list.push({
        singer: decodeName(singerName),
        name: decodeName(item.name + (item.title_extra ?? '')),
        albumName: decodeName(albumName),
        albumId,
        source: 'tx',
        interval: formatPlayTime(item.interval),
        duration: item.interval,
        songId: item.id,
        albumMid: item.album?.mid ?? '',
        strMediaMid: item.file.media_mid,
        songmid: item.mid,
        img:
          albumId === '' || albumId === '空'
            ? item.singer?.length
              ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
              : ''
            : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        types,
        _types,
        typeUrl: {}
      })
    }

    return {
      list,
      total: result.req.data.meta.estimate_sum,
      page,
      limit,
      source: 'tx'
    }
  } catch (err: unknown) {
    const errorCode = getErrorCode(err)
    console.error('TX search failed:', { code: errorCode, message: getErrorMessage(err) })

    return {
      list: [],
      total: 0,
      page,
      limit,
      source: 'tx'
    }
  }
})
