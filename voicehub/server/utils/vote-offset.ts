import { inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songVoteOffsets } from '~/drizzle/schema'

const isMissingVoteOffsetTableError = (error: unknown) => {
  const normalized = error as { code?: string; cause?: { code?: string }; message?: string }
  const message = String(normalized?.message || '').toLowerCase()
  return (
    normalized?.code === '42P01' ||
    normalized?.cause?.code === '42P01' ||
    message.includes('song_vote_offsets') ||
    message.includes('does not exist')
  )
}

const normalizeSongIds = (songIds: number[]) => {
  return Array.from(
    new Set(
      songIds
        .map((songId) => Number(songId))
        .filter((songId) => Number.isInteger(songId) && songId > 0)
    )
  )
}

export const applyVoteOffset = (baseCount: number, offset: number) => {
  const safeBase = Number.isFinite(baseCount) ? baseCount : 0
  const safeOffset = Number.isFinite(offset) ? offset : 0
  return Math.max(0, Math.trunc(safeBase + safeOffset))
}

export const fetchVoteOffsetMap = async (songIds: number[]) => {
  const normalizedSongIds = normalizeSongIds(songIds)
  const offsets = new Map<number, number>()
  if (normalizedSongIds.length === 0) {
    return offsets
  }

  try {
    const rows = await db
      .select({
        songId: songVoteOffsets.songId,
        voteOffset: songVoteOffsets.voteOffset
      })
      .from(songVoteOffsets)
      .where(inArray(songVoteOffsets.songId, normalizedSongIds))

    rows.forEach((row) => {
      offsets.set(row.songId, Number(row.voteOffset) || 0)
    })
  } catch (error) {
    if (isMissingVoteOffsetTableError(error)) {
      return offsets
    }
    throw error
  }

  return offsets
}

export const buildAdjustedVoteCountMap = async (
  songIds: number[],
  rawVoteCountMap: Map<number, number>
) => {
  const normalizedSongIds = normalizeSongIds(songIds)
  const adjustedVoteCountMap = new Map<number, number>()
  if (normalizedSongIds.length === 0) {
    return adjustedVoteCountMap
  }

  const offsetMap = await fetchVoteOffsetMap(normalizedSongIds)

  normalizedSongIds.forEach((songId) => {
    const rawCount = Number(rawVoteCountMap.get(songId) || 0)
    const offset = Number(offsetMap.get(songId) || 0)
    adjustedVoteCountMap.set(songId, applyVoteOffset(rawCount, offset))
  })

  return adjustedVoteCountMap
}
