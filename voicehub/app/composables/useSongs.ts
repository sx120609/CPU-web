import { computed } from 'vue'
import { useAuth } from './useAuth'
import { getGlobalDedup } from './useRequestDedup'
import type { PlayTime, Schedule, Song } from '~/types'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

export const useSongs = () => {
  const { isAuthenticated, user, getAuthConfig, isAdmin, initAuth } = useAuth()
  const dedup = getGlobalDedup()
  const songs = useState<Song[]>('songs-store:songs', () => [])
  const publicSchedules = useState<Schedule[]>('songs-store:public-schedules', () => [])
  const publicSongs = useState<Song[]>('songs-store:public-songs', () => [])
  const loading = useState('songs-store:loading', () => false)
  const error = useState('songs-store:error', () => '')
  const notification = useState('songs-store:notification', () => ({
    show: false,
    message: '',
    type: ''
  }))
  const similarSongFound = useState<Song | null>('songs-store:similar-song-found', () => null)
  const playTimes = useState<PlayTime[]>('songs-store:play-times', () => [])
  const playTimeEnabled = useState('songs-store:play-time-enabled', () => false)
  const songCount = useState('songs-store:song-count', () => 0)

  const applyPlayTimesResponse = (response: any) => {
    playTimeEnabled.value = !!response?.enabled

    if (response?.playTimes && Array.isArray(response.playTimes)) {
      playTimes.value = response.playTimes.map((pt: any) => ({
        id: pt.id,
        name: pt.name,
        startTime: pt.startTime || undefined,
        endTime: pt.endTime || undefined,
        enabled: pt.enabled,
        description: pt.description || undefined
      }))
      return
    }

    playTimes.value = []
  }

  const applySongsResponse = (response: any) => {
    if (response && response.success && response.data && Array.isArray(response.data.songs)) {
      songs.value = response.data.songs as Song[]
      return true
    }

    songs.value = []
    console.warn('API返回的数据格式不正确:', response)
    return false
  }

  const processPublicSchedules = (data: any[]) => {
    return data.map((schedule: any) => {
      // 处理歌曲属性
      if (schedule.song && schedule.song.played === undefined) {
        schedule.song.played = false
      }

      // 处理播放时间属性
      let processedPlayTime = null
      if (schedule.playTime) {
        processedPlayTime = {
          ...schedule.playTime,
          startTime: schedule.playTime.startTime || undefined,
          endTime: schedule.playTime.endTime || undefined
        }
      }

      // 返回符合Schedule类型的对象
      return {
        ...schedule,
        playTime: processedPlayTime
      } as Schedule
    })
  }

  const applyPublicSchedules = (data: any[]) => {
    const processedData = processPublicSchedules(Array.isArray(data) ? data : [])
    publicSchedules.value = processedData
    publicSongs.value = extractSongsFromSchedules(processedData)
  }

  // 显示通知
  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    // 使用全局通知
    if (window.$showNotification) {
      window.$showNotification(message, type)
    } else {
      // 备用方案
      notification.value = {
        show: true,
        message,
        type
      }

      // 3秒后自动关闭
      setTimeout(() => {
        notification.value.show = false
      }, 3000)
    }
  }

  const resolveErrorMessage = (err: any, fallback: string) => {
    return extractDisplayErrorMessage(err, fallback)
  }

  const findSongById = (songId: number) => {
    return songs.value.find((s: any) => Number(s?.id) === Number(songId))
  }

  type VoteAction = 'vote' | 'unvote'

  interface VotePayload {
    songId: number
    action: VoteAction
  }

  const normalizeSongId = (value: any): number | null => {
    const songId = Number(value)
    if (!Number.isInteger(songId) || songId <= 0) {
      return null
    }
    return songId
  }

  const resolveVotePayload = (
    payload: number | { id?: number; songId?: number; unvote?: boolean; action?: string }
  ): VotePayload | null => {
    const normalizedSongId =
      typeof payload === 'number'
        ? normalizeSongId(payload)
        : normalizeSongId(payload?.songId ?? payload?.id)
    if (!normalizedSongId) {
      return null
    }

    const action: VoteAction =
      typeof payload === 'object' &&
      (payload?.action === 'unvote' || payload?.unvote === true || payload?.action === 'cancel')
        ? 'unvote'
        : 'vote'

    return {
      songId: normalizedSongId,
      action
    }
  }

  const applyVoteState = (songId: number, voted: boolean, voteCount: number | null = null) => {
    const targetSong: any = findSongById(songId)
    if (!targetSong) return

    targetSong.voted = voted
    if (voteCount !== null && Number.isInteger(voteCount) && voteCount >= 0) {
      targetSong.voteCount = voteCount
      return
    }

    const currentCount = Math.max(0, Number(targetSong.voteCount || 0))
    targetSong.voteCount = voted ? currentCount + 1 : Math.max(0, currentCount - 1)
  }

  const applyReplayState = (
    songId: number,
    replayRequested: boolean,
    replayRequestStatus: string | null = null,
    replayRequestCount: number | null = null
  ) => {
    const targetSong: any = findSongById(songId)
    if (!targetSong) return

    targetSong.replayRequested = replayRequested
    targetSong.replayRequestStatus = replayRequestStatus || undefined
    targetSong.replayRequestCooldownRemaining = 0

    if (replayRequestCount !== null && Number.isInteger(replayRequestCount) && replayRequestCount >= 0) {
      targetSong.replayRequestCount = replayRequestCount
    } else {
      const currentCount = Math.max(0, Number(targetSong.replayRequestCount || 0))
      targetSong.replayRequestCount = replayRequested ? Math.max(1, currentCount + 1) : Math.max(0, currentCount - 1)
    }

    targetSong.isReplay = Number(targetSong.replayRequestCount || 0) > 0

    if (!replayRequested && Array.isArray(targetSong.replayRequesters) && user.value?.id) {
      const currentUserId = Number(user.value.id)
      targetSong.replayRequesters = targetSong.replayRequesters.filter(
        (requester: any) => Number(requester?.id) !== currentUserId
      )
    }
  }

  // 防止同一首歌在短时间内重复触发并发操作导致状态抖动
  const votePendingSongIds = new Set<number>()
  const replayPendingSongIds = new Set<number>()

  // 获取播放时段列表
  const fetchPlayTimes = async () => {
    loading.value = true
    error.value = ''

    try {
      const response = await $fetch('/api/play-times')
      applyPlayTimesResponse(response)

      return response
    } catch (err: any) {
      error.value = extractDisplayErrorMessage(err, '获取播放时段失败')
      return { enabled: false, playTimes: [] }
    } finally {
      loading.value = false
    }
  }

  // 获取歌曲列表
  const fetchSongs = async (
    silent = false,
    semester?: string,
    forceRefresh = false,
    bypassCache = false
  ) => {
    if (!silent) {
      loading.value = true
    }
    error.value = ''

    try {
      const requestParams: Record<string, any> = {}
      if (semester) {
        requestParams.semester = semester
      }
      if (bypassCache) {
        requestParams.bypassCache = 1
      }
      // forceRefresh 需要绕过去重，避免复用旧的 pending 请求导致界面状态滞后
      if (forceRefresh) {
        requestParams.refreshKey = Date.now()
      }

      const response = await dedup.dedupedRequest(
        'songs',
        async () => {
          // 构建URL参数
          const params = new URLSearchParams()
          if (semester) {
            params.append('semester', semester)
          }
          // 只有当 bypassCache 为 true 时才添加 bypass_cache 参数
          if (bypassCache) {
            params.append('bypass_cache', 'true')
          }
          const url = `/api/songs${params.toString() ? '?' + params.toString() : ''}`

          // API请求
          return await $fetch(url, {
            ...getAuthConfig()
          })
        },
        Object.keys(requestParams).length > 0 ? requestParams : undefined
      )

      applySongsResponse(response)
    } catch (err: any) {
      error.value = extractDisplayErrorMessage(err, '获取歌曲列表失败')
    } finally {
      if (!silent) {
        loading.value = false
      }
    }
  }

  // 静默刷新歌曲列表 - 不显示加载状态
  const refreshSongsSilent = async () => {
    return fetchSongs(true)
  }

  // 从排期数据中提取歌曲信息
  const extractSongsFromSchedules = (schedules: Schedule[]): Song[] => {
    const songsMap = new Map<string, Song>()

    schedules.forEach((schedule) => {
      if (schedule.song) {
        const songId = String(schedule.song.id)
        if (!songsMap.has(songId)) {
          // 将排期中的歌曲信息转换为完整的Song对象
          const completeSong: Song = {
            id: schedule.song.id,
            title: schedule.song.title,
            artist: schedule.song.artist,
            requester: schedule.song.requester,
            requesterGrade: schedule.song.requesterGrade || null,
            requesterClass: schedule.song.requesterClass || null,
            requesterId: 0, // 默认值，公共API不提供这个信息
            voteCount: schedule.song.voteCount,
            played: schedule.song.played || false,
            playedAt: schedule.song.playedAt || null,
            semester: schedule.song.semester || null,
            requestedAt: schedule.song.requestedAt || new Date().toISOString(),
            cover: schedule.song.cover || null,
            musicPlatform: schedule.song.musicPlatform || null,
            musicId: schedule.song.musicId || null
          }
          songsMap.set(songId, completeSong)
        }
      }
    })

    return Array.from(songsMap.values())
  }

  // 获取公共排期（无需登录）
  const fetchPublicSchedules = async (
    silent = false,
    semester?: string,
    forceRefresh = false,
    bypassCache = false
  ) => {
    if (!silent) {
      loading.value = true
    }
    error.value = ''

    try {
      const requestParams = semester ? { semester } : undefined

      const data = await dedup.dedupedRequest(
        'public-schedules',
        async () => {
          // 构建URL参数
          const params = new URLSearchParams()
          if (semester) {
            params.append('semester', semester)
          }
          // 只有当 bypassCache 为 true 时才添加 bypass_cache 参数
          if (bypassCache) {
            params.append('bypass_cache', 'true')
          }
          const url = `/api/songs/public${params.toString() ? '?' + params.toString() : ''}`

          const response = await $fetch(url, {
            ...getAuthConfig()
          })
          return response
        },
        requestParams
      )

      applyPublicSchedules(data)
    } catch (err: any) {
      error.value = extractDisplayErrorMessage(err, '获取排期失败')
    } finally {
      if (!silent) {
        loading.value = false
      }
    }
  }

  // 静默刷新公共排期 - 不显示加载状态
  const refreshSchedulesSilent = async () => {
    return fetchPublicSchedules(true)
  }

  // 字符串相似度计算（编辑距离）
  const calculateSimilarity = (str1: string, str2: string): number => {
    const len1 = str1.length
    const len2 = str2.length

    if (len1 === 0) return len2
    if (len2 === 0) return len1

    const matrix = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(null))

    for (let i = 0; i <= len1; i++) matrix[i][0] = i
    for (let j = 0; j <= len2; j++) matrix[0][j] = j

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // 删除
          matrix[i][j - 1] + 1, // 插入
          matrix[i - 1][j - 1] + cost // 替换
        )
      }
    }

    const maxLen = Math.max(len1, len2)
    return (maxLen - matrix[len1][len2]) / maxLen
  }

  // 标准化字符串（去除标点符号、空格，转换为小写）
  const normalizeString = (str: string): string => {
    return str
      .toLowerCase()
      .replace(/[\s\-_\(\)\[\]【】（）「」『』《》〈〉""''""''、，。！？：；～·]/g, '')
      .replace(/[&＆]/g, 'and')
      .replace(/[feat\.?|ft\.?]/gi, '')
      .trim()
  }

  // 获取当前学期名称（从数据库）
  const getCurrentSemesterName = async () => {
    try {
      const response = await fetch('/api/semesters/current')
      if (!response.ok) {
        throw new Error('获取当前学期失败')
      }
      const data = await response.json()
      return data?.name || null
    } catch (error) {
      console.error('获取当前学期失败:', error)
      return null
    }
  }

  // 检查相似歌曲
  const checkSimilarSongs = async (title: string, artist: string): Promise<Song[]> => {
    similarSongFound.value = null

    const normalizedTitle = normalizeString(title)
    const normalizedArtist = normalizeString(artist)

    // 获取当前学期名称
    const currentSemesterName = await getCurrentSemesterName()

    // 1. 检查完全相同的歌曲（标准化后）
    const exactSongs = songs.value.filter((song) => {
      const songTitle = normalizeString(song.title)
      const songArtist = normalizeString(song.artist)
      const titleMatch = songTitle === normalizedTitle && songArtist === normalizedArtist

      // 如果有当前学期信息，只检查当前学期的歌曲
      if (currentSemesterName) {
        return titleMatch && song.semester === currentSemesterName
      }

      // 如果没有学期信息，检查所有歌曲（向后兼容）
      return titleMatch
    })

    if (exactSongs.length > 0) {
      return exactSongs
    }

    // 2. 检查高度相似的歌曲
    const similarSongs: Array<{ song: Song; similarity: number }> = []

    songs.value.forEach((song) => {
      // 如果有当前学期信息，只检查当前学期的歌曲
      if (currentSemesterName && song.semester !== currentSemesterName) {
        return
      }

      const songTitle = normalizeString(song.title)
      const songArtist = normalizeString(song.artist)

      // 计算标题相似度
      const titleSimilarity = calculateSimilarity(normalizedTitle, songTitle)

      // 计算艺术家相似度
      const artistSimilarity = calculateSimilarity(normalizedArtist, songArtist)

      // 检查是否为高度相似
      const isHighlySimilar =
        // 标题完全相同，艺术家高度相似
        (titleSimilarity >= 0.95 && artistSimilarity >= 0.8) ||
        // 标题高度相似，艺术家完全相同
        (titleSimilarity >= 0.8 && artistSimilarity >= 0.95) ||
        // 标题和艺术家都高度相似
        (titleSimilarity >= 0.85 && artistSimilarity >= 0.85) ||
        // 标题包含关系且艺术家相似
        ((songTitle.includes(normalizedTitle) || normalizedTitle.includes(songTitle)) &&
          artistSimilarity >= 0.8 &&
          Math.abs(songTitle.length - normalizedTitle.length) <= 3)

      if (isHighlySimilar) {
        const overallSimilarity = titleSimilarity * 0.7 + artistSimilarity * 0.3
        similarSongs.push({ song, similarity: overallSimilarity })
      }
    })

    // 3. 按相似度排序并返回
    if (similarSongs.length > 0) {
      const sortedSimilar = similarSongs
        .sort((a, b) => b.similarity - a.similarity)
        .map((item) => item.song)

      similarSongFound.value = sortedSimilar[0] // 保持兼容性
      return sortedSimilar
    }

    // 4. 如果没有高度相似的，检查可能的相似歌曲（降低阈值）
    const possibleSimilar: Array<{ song: Song; similarity: number }> = []

    songs.value.forEach((song) => {
      // 如果有当前学期信息，只检查当前学期的歌曲
      if (currentSemesterName && song.semester !== currentSemesterName) {
        return
      }

      const songTitle = normalizeString(song.title)
      const songArtist = normalizeString(song.artist)

      const titleSimilarity = calculateSimilarity(normalizedTitle, songTitle)
      const artistSimilarity = calculateSimilarity(normalizedArtist, songArtist)

      // 检查可能相似的条件（更宽松）
      const isPossiblySimilar =
        // 标题相似度较高
        (titleSimilarity >= 0.7 && artistSimilarity >= 0.6) ||
        // 标题包含关系
        ((songTitle.includes(normalizedTitle) || normalizedTitle.includes(songTitle)) &&
          artistSimilarity >= 0.5 &&
          normalizedTitle.length >= 3)

      if (isPossiblySimilar) {
        const overallSimilarity = titleSimilarity * 0.7 + artistSimilarity * 0.3
        possibleSimilar.push({ song, similarity: overallSimilarity })
      }
    })

    if (possibleSimilar.length > 0) {
      const sortedPossible = possibleSimilar
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3) // 最多返回3个可能相似的歌曲
        .map((item) => item.song)

      similarSongFound.value = sortedPossible[0] // 保持兼容性
      return sortedPossible
    }

    return []
  }

  // 请求歌曲
  const requestSong = async (songData: {
    title: string
    artist: string
    preferredPlayTimeId?: number | null
    cover?: string | null
    musicPlatform?: string | null
    musicId?: string | null
  }) => {
    if (!isAuthenticated.value) {
      showNotification('需要登录才能点歌', 'error')
      return null
    }

    loading.value = true
    error.value = ''

    try {
      // 使用认证配置
      const authConfig = getAuthConfig()

      const data = await $fetch('/api/songs/request', {
        method: 'POST',
        body: songData,
        ...authConfig
      })

      // 更新歌曲列表
      await fetchSongs()

      return data
    } catch (err: any) {
      const errorMsg = extractDisplayErrorMessage(err, '点歌失败')
      // 如果是重复投稿错误，只显示通知而不设置全局错误
      if (errorMsg.includes('已经在列表中') || errorMsg.includes('不能重复投稿')) {
        showNotification(errorMsg, 'info')
      } else {
        error.value = errorMsg
        showNotification(errorMsg, 'error')
      }
      return null
    } finally {
      loading.value = false
    }
  }

  // 投票/取消投票
  const voteSong = async (
    payload: number | { id?: number; songId?: number; unvote?: boolean; action?: string }
  ) => {
    if (!isAuthenticated.value) {
      await initAuth()
    }

    if (!isAuthenticated.value) {
      showNotification('需要登录才能投票', 'error')
      return null
    }

    const votePayload = resolveVotePayload(payload)
    if (!votePayload) {
      showNotification('歌曲ID无效，无法进行投票操作', 'error')
      return null
    }

    const { songId, action } = votePayload
    const isUnvote = action === 'unvote'
    if (votePendingSongIds.has(songId)) {
      return null
    }
    votePendingSongIds.add(songId)

    const targetSong: any = findSongById(songId)
    const previousVoted = !!targetSong?.voted
    const previousVoteCount = Math.max(0, Number(targetSong?.voteCount || 0))

    error.value = ''

    try {
      // 乐观更新，提升按钮切换反馈速度
      applyVoteState(songId, !isUnvote)

      const authConfig = getAuthConfig()
      const data: any = await $fetch('/api/songs/vote', {
        method: 'POST',
        body: {
          songId,
          action
        },
        ...authConfig
      })

      const voteData = data?.data || {}
      const voted = typeof voteData.voted === 'boolean' ? voteData.voted : !isUnvote
      const voteCountRaw = Number(voteData.voteCount)
      const voteCount = Number.isInteger(voteCountRaw) && voteCountRaw >= 0 ? voteCountRaw : null
      const changed = voteData.changed !== false

      applyVoteState(songId, voted, voteCount)

      const message = data?.message || (voted ? '投票成功' : '取消投票成功')
      showNotification(message, changed ? 'success' : 'info')
      return data
    } catch (err: any) {
      const errorMsg = resolveErrorMessage(err, '投票失败')
      // 请求失败时回滚本地状态
      if (targetSong) {
        targetSong.voted = previousVoted
        targetSong.voteCount = previousVoteCount
      }

      console.warn('[Vote] 请求失败', { songId, action, message: errorMsg })
      error.value = errorMsg
      showNotification(errorMsg, 'error')
      return null
    } finally {
      votePendingSongIds.delete(songId)
    }
  }

  // 撤回歌曲（只能撤回自己的投稿）
  const withdrawSong = async (songId: number) => {
    if (!isAuthenticated.value) {
      showNotification('需要登录才能撤回歌曲', 'error')
      return null
    }

    loading.value = true
    error.value = ''

    try {
      // 查找歌曲信息用于通知
      const targetSong = songs.value.find((s) => s.id === songId)
      const songTitle = targetSong ? targetSong.title : '歌曲'

      // 使用认证配置
      const authConfig = getAuthConfig()

      const data = await $fetch('/api/songs/withdraw', {
        method: 'POST',
        body: { songId },
        ...authConfig
      })

      // 更新歌曲列表
      await fetchSongs()

      // 显示成功通知
      const message = data.quotaReturned
        ? `已成功撤回《${songTitle}》的投稿，投稿配额已返还`
        : `已成功撤回《${songTitle}》的投稿`

      showNotification(message, 'success')
      return data
    } catch (err: any) {
      const errorMsg = extractDisplayErrorMessage(err, '撤回歌曲失败')
      error.value = errorMsg
      showNotification(errorMsg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  // 删除歌曲（管理员专用）
  const deleteSong = async (songId: number) => {
    if (!isAuthenticated.value) {
      showNotification('需要登录才能删除歌曲', 'error')
      return null
    }

    loading.value = true
    error.value = ''

    try {
      // 使用认证配置
      const authConfig = getAuthConfig()

      const data = await $fetch('/api/admin/songs/delete', {
        method: 'POST',
        body: { songId },
        ...authConfig
      })

      // 更新歌曲列表
      await fetchSongs()

      showNotification('歌曲已成功删除！', 'success')
      return data
    } catch (err: any) {
      const errorMsg = extractDisplayErrorMessage(err, '删除歌曲失败')
      error.value = errorMsg
      showNotification(errorMsg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  // 标记歌曲为已播放（管理员专用）
  const markPlayed = async (songId: number) => {
    if (!isAuthenticated.value) {
      showNotification('需要登录才能标记歌曲', 'error')
      return null
    }

    loading.value = true
    error.value = ''

    try {
      // 使用认证配置
      const authConfig = getAuthConfig()

      const data = await $fetch('/api/admin/songs/mark-played', {
        method: 'POST',
        body: { songId },
        ...authConfig
      })

      // 更新歌曲列表
      await fetchSongs()

      showNotification('歌曲已成功标记为已播放！', 'success')
      return data
    } catch (err: any) {
      const errorMsg = extractDisplayErrorMessage(err, '标记歌曲失败')
      error.value = errorMsg
      showNotification(errorMsg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  // 撤回歌曲已播放状态（管理员专用）
  const unmarkPlayed = async (songId: number) => {
    if (!isAuthenticated.value) {
      showNotification('需要登录才能撤回歌曲已播放状态', 'error')
      return null
    }

    loading.value = true
    error.value = ''

    try {
      // 使用认证配置
      const authConfig = getAuthConfig()

      const data = await $fetch('/api/admin/songs/mark-played', {
        method: 'POST',
        body: { songId, unmark: true },
        ...authConfig
      })

      // 更新歌曲列表
      await fetchSongs()

      showNotification('歌曲已成功撤回已播放状态！', 'success')
      return data
    } catch (err: any) {
      const errorMsg = extractDisplayErrorMessage(err, '撤回歌曲已播放状态失败')
      error.value = errorMsg
      showNotification(errorMsg, 'error')
      return null
    } finally {
      loading.value = false
    }
  }

  // 申请重播
  const requestReplay = async (songId: number) => {
    if (!isAuthenticated.value) {
      await initAuth()
    }

    if (!isAuthenticated.value) {
      showNotification('需要登录才能申请重播', 'error')
      return null
    }

    const normalizedSongId = normalizeSongId(songId)
    if (!normalizedSongId) {
      showNotification('歌曲ID无效，无法申请重播', 'error')
      return null
    }
    if (replayPendingSongIds.has(normalizedSongId)) {
      return null
    }
    replayPendingSongIds.add(normalizedSongId)

    const targetSong: any = findSongById(normalizedSongId)
    const previousState = targetSong
      ? {
          replayRequested: !!targetSong.replayRequested,
          replayRequestStatus: targetSong.replayRequestStatus,
          replayRequestCount: Math.max(0, Number(targetSong.replayRequestCount || 0)),
          isReplay: !!targetSong.isReplay
        }
      : null

    error.value = ''

    try {
      // 乐观更新，让“申请重播/撤回申请”按钮立即切换
      applyReplayState(normalizedSongId, true, 'PENDING')

      const authConfig = getAuthConfig()
      const data: any = await $fetch('/api/songs/replay', {
        method: 'POST',
        body: {
          songId: normalizedSongId,
          action: 'request'
        },
        ...authConfig
      })

      const replayData = data?.data || {}
      const changed = replayData.changed !== false
      const replayCountRaw = Number(replayData.replayRequestCount)
      const replayCount =
        Number.isInteger(replayCountRaw) && replayCountRaw >= 0 ? replayCountRaw : null
      const replayRequested = replayData.replayRequested !== false
      const replayStatus = replayData.replayRequestStatus || (replayRequested ? 'PENDING' : null)

      applyReplayState(normalizedSongId, replayRequested, replayStatus, replayCount)

      showNotification(data?.message || '申请重播成功', changed ? 'success' : 'info')
      return data
    } catch (err: any) {
      const errorMsg = resolveErrorMessage(err, '申请重播失败')
      if (targetSong && previousState) {
        targetSong.replayRequested = previousState.replayRequested
        targetSong.replayRequestStatus = previousState.replayRequestStatus
        targetSong.replayRequestCount = previousState.replayRequestCount
        targetSong.isReplay = previousState.isReplay
      }
      showNotification(errorMsg, 'error')
      return null
    } finally {
      replayPendingSongIds.delete(normalizedSongId)
    }
  }

  /**
   * 撤回重播申请
   * @param songId 歌曲ID
   */
  const withdrawReplay = async (songId: number) => {
    if (!isAuthenticated.value) {
      await initAuth()
    }

    if (!isAuthenticated.value) {
      showNotification('需要登录才能取消重播申请', 'error')
      return null
    }

    const normalizedSongId = normalizeSongId(songId)
    if (!normalizedSongId) {
      showNotification('歌曲ID无效，无法取消重播申请', 'error')
      return null
    }
    if (replayPendingSongIds.has(normalizedSongId)) {
      return null
    }
    replayPendingSongIds.add(normalizedSongId)

    const targetSong: any = findSongById(normalizedSongId)
    const previousState = targetSong
      ? {
          replayRequested: !!targetSong.replayRequested,
          replayRequestStatus: targetSong.replayRequestStatus,
          replayRequestCount: Math.max(0, Number(targetSong.replayRequestCount || 0)),
          isReplay: !!targetSong.isReplay
        }
      : null

    error.value = ''

    try {
      applyReplayState(normalizedSongId, false, null)

      const authConfig = getAuthConfig()
      const data: any = await $fetch('/api/songs/replay', {
        method: 'POST',
        body: {
          songId: normalizedSongId,
          action: 'cancel'
        },
        ...authConfig
      })

      const replayData = data?.data || {}
      const changed = replayData.changed !== false
      const replayCountRaw = Number(replayData.replayRequestCount)
      const replayCount =
        Number.isInteger(replayCountRaw) && replayCountRaw >= 0 ? replayCountRaw : null

      applyReplayState(normalizedSongId, false, null, replayCount)

      showNotification(data?.message || '已取消重播申请', changed ? 'success' : 'info')
      return data
    } catch (err: any) {
      const errorMsg = resolveErrorMessage(err, '取消重播申请失败')
      if (targetSong && previousState) {
        targetSong.replayRequested = previousState.replayRequested
        targetSong.replayRequestStatus = previousState.replayRequestStatus
        targetSong.replayRequestCount = previousState.replayRequestCount
        targetSong.isReplay = previousState.isReplay
      }
      showNotification(errorMsg, 'error')
      return null
    } finally {
      replayPendingSongIds.delete(normalizedSongId)
    }
  }

  // 按热度排序的歌曲
  const songsByPopularity = computed(() => {
    return [...songs.value].sort((a, b) => b.voteCount - a.voteCount)
  })

  // 按创建时间排序的歌曲
  const songsByDate = computed(() => {
    return [...songs.value].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  })

  // 已播放的歌曲
  const playedSongs = computed(() => {
    return songs.value.filter((song) => song.played)
  })

  // 未播放的歌曲
  const unplayedSongs = computed(() => {
    return songs.value.filter((song) => !song.played)
  })

  // 我的投稿歌曲
  const mySongs = computed(() => {
    if (!user.value) return []
    return songs.value.filter((song) => song.requesterId === user.value?.id)
  })

  // 我的重播申请歌曲
  const myReplaySongs = computed(() => {
    if (!user.value) return []
    return songs.value.filter(
      (song) => song.replayRequested || (song as any).replayRequestStatus === 'PENDING'
    )
  })

  // 所有可见的歌曲（登录用户看到的 + 公共歌曲）
  const visibleSongs = computed(() => {
    if (songs.value && songs.value.length > 0) {
      return songs.value
    } else {
      return publicSongs.value
    }
  })

  // 根据播放时间段过滤歌曲排期
  const filterSchedulesByPlayTime = (schedules: Schedule[], playTimeId: number | null) => {
    if (playTimeId === null) {
      return schedules.filter((s) => s.playTimeId === null)
    }
    return schedules.filter((s) => s.playTimeId === playTimeId)
  }

  // 获取播放时间名称
  const getPlayTimeName = (playTimeId: number | null) => {
    if (playTimeId === null) {
      return '未指定时段'
    }

    const foundTime = playTimes.value.find((pt) => pt.id === playTimeId)
    return foundTime ? foundTime.name : '未知时段'
  }

  // 格式化播放时间显示
  const formatPlayTimeDisplay = (playTime: PlayTime | null) => {
    if (!playTime) {
      return '全天'
    }

    let displayText = playTime.name

    // 如果有开始和结束时间，添加时间信息
    if (playTime.startTime && playTime.endTime) {
      displayText += ` (${playTime.startTime}-${playTime.endTime})`
    }
    // 如果只有开始时间
    else if (playTime.startTime) {
      displayText += ` (${playTime.startTime}起)`
    }
    // 如果只有结束时间
    else if (playTime.endTime) {
      displayText += ` (至${playTime.endTime})`
    }

    return displayText
  }

  // 获取歌曲总数（缓存版本）
  const fetchSongCount = async (forceRefresh = false) => {
    try {
      const response = await dedup.dedupedRequest('song-count', async () => {
        const response = await $fetch('/api/songs/count')
        return response
      })

      // 正确解析API返回的数据结构
      if (response && typeof response.count === 'number') {
        songCount.value = response.count
        return response.count
      } else {
        console.warn('歌曲总数API返回的数据格式不正确:', response)
        songCount.value = 0
        return 0
      }
    } catch (err: any) {
      console.error('获取歌曲总数失败:', err)
      return 0
    }
  }

  const hydrateFromBootstrap = (bootstrapData: any) => {
    if (!bootstrapData || typeof bootstrapData !== 'object') {
      return false
    }

    if (bootstrapData.playTimes) {
      applyPlayTimesResponse(bootstrapData.playTimes)
    }

    if (bootstrapData.songs) {
      applySongsResponse(bootstrapData.songs)
    }

    if (Array.isArray(bootstrapData.publicSchedules)) {
      applyPublicSchedules(bootstrapData.publicSchedules)
    }

    if (
      bootstrapData.songCount &&
      typeof bootstrapData.songCount === 'object' &&
      typeof bootstrapData.songCount.count === 'number'
    ) {
      songCount.value = bootstrapData.songCount.count
    }

    return true
  }

  // 初始化加载
  const initialize = async () => {
    await fetchPlayTimes()
    if (isAuthenticated.value) {
      await fetchSongs()
    } else {
      await fetchPublicSchedules()
    }
  }

  return {
    songs,
    publicSongs,
    publicSchedules,
    visibleSongs,
    songCount,
    loading,
    error,
    notification,
    similarSongFound,
    playTimes,
    playTimeEnabled,
    showNotification,
    fetchSongs,
    fetchPublicSchedules,
    fetchPlayTimes,
    fetchSongCount,
    hydrateFromBootstrap,
    refreshSongsSilent,
    refreshSchedulesSilent,
    checkSimilarSongs,
    requestSong,
    voteSong,
    withdrawSong,
    deleteSong,
    markPlayed,
    unmarkPlayed,
    requestReplay,
    withdrawReplay,
    filterSchedulesByPlayTime,
    getPlayTimeName,
    formatPlayTimeDisplay,
    extractSongsFromSchedules,
    initialize,
    songsByPopularity,
    songsByDate,
    playedSongs,
    unplayedSongs,
    mySongs,
    myReplaySongs
  }
}
