/**
 * 可脱敏的用户/参与者接口
 */
export interface MaskableUser {
  id?: number | string
  name?: string
  displayName?: string
  grade?: string | null
  class?: string | null
  [key: string]: any
}

/**
 * 可脱敏的歌曲信息接口
 */
export interface MaskableSong {
  requester?: string
  requesterGrade?: string | null
  requesterClass?: string | null
  collaborators?: MaskableUser[]
  replayRequesters?: MaskableUser[]
  [key: string]: any
}

/**
 * 对单个参与者（联合投稿人、重播申请人）进行脱敏
 * @param user 参与者对象
 */
export function maskUserInfo(user: MaskableUser) {
  // 按新需求保留昵称展示，仅隐藏班级信息
  user.grade = null
  user.class = null
}

/**
 * 对单首歌曲的投稿相关信息进行脱敏
 * @param song 歌曲对象
 */
export function maskSongInfo(song: MaskableSong) {
  // 保留主投稿人昵称，仅隐藏年级和班级
  if (song.requesterGrade !== undefined) song.requesterGrade = null
  if (song.requesterClass !== undefined) song.requesterClass = null
  
  // 批量脱敏联合投稿人
  if (song.collaborators && Array.isArray(song.collaborators)) {
    song.collaborators.forEach(maskUserInfo)
  }
  
  // 批量脱敏重播申请人
  if (song.replayRequesters && Array.isArray(song.replayRequesters)) {
    song.replayRequesters.forEach(maskUserInfo)
  }
}

/**
 * 批量脱敏歌曲列表（通常用于 index.get.ts）
 * @param songs 歌曲列表
 */
export function maskSongsInfo(songs: MaskableSong[]) {
  songs.forEach(maskSongInfo)
}

/**
 * 公共排期项接口
 */
export interface PublicScheduleItem {
  song?: MaskableSong
  [key: string]: any
}

/**
 * 批量脱敏公共排期数据（通常用于 public.get.ts）
 * @param data 排期数据列表
 */
export function maskPublicScheduleData(data: PublicScheduleItem[]) {
  data.forEach(item => {
    if (item.song) {
      maskSongInfo(item.song)
    }
  })
}
