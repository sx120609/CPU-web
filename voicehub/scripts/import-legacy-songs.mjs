#!/usr/bin/env node

import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

const GHOST_ROLE = 'GHOST'
const GHOST_USERNAME_PREFIX = '__legacy_voicehub_'

function parseArgs(argv) {
  const options = {
    apply: false,
    sourceUrl: process.env.LEGACY_DATABASE_URL || '',
    targetUrl: process.env.VOICEHUB_DATABASE_URL || process.env.DATABASE_URL || ''
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') {
      options.apply = true
    } else if (argument === '--source-url') {
      options.sourceUrl = argv[++index] || ''
    } else if (argument === '--target-url') {
      options.targetUrl = argv[++index] || ''
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw new Error(`未知参数：${argument}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`
导入旧 VoiceHub 的歌曲和历史关系。

默认只执行演练，不写入目标数据库。确认统计后追加 --apply。

用法：
  node scripts/import-legacy-songs.mjs \\
    --source-url postgresql:///voicehub_legacy \\
    --target-url postgresql:///cpu_web_voicehub [--apply]

也可通过 LEGACY_DATABASE_URL 和 VOICEHUB_DATABASE_URL 提供连接地址。
`)
}

function normalizePart(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN')
}

function semesterKey(value) {
  return normalizePart(value) || '<none>'
}

function platformSongKey(song) {
  const platform = normalizePart(song.musicPlatform)
  const musicId = normalizePart(song.musicId)
  if (!platform || !musicId) return null
  return `${semesterKey(song.semester)}\u0000${platform}\u0000${musicId}`
}

function titleArtistKey(song) {
  return [
    semesterKey(song.semester),
    normalizePart(song.title),
    normalizePart(song.artist)
  ].join('\u0000')
}

function ghostUsername(legacyUser) {
  const suffix = String(legacyUser.username || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${GHOST_USERNAME_PREFIX}${legacyUser.id}${suffix ? `_${suffix}` : ''}`
}

function addSongToIndexes(song, indexes) {
  const platformKey = platformSongKey(song)
  if (platformKey && !indexes.byPlatform.has(platformKey)) {
    indexes.byPlatform.set(platformKey, song)
  }

  const fallbackKey = titleArtistKey(song)
  const candidates = indexes.byTitleArtist.get(fallbackKey) || []
  candidates.push(song)
  indexes.byTitleArtist.set(fallbackKey, candidates)
}

function findMatchingSong(song, indexes) {
  const platformKey = platformSongKey(song)
  if (platformKey) {
    const exact = indexes.byPlatform.get(platformKey)
    if (exact) return exact
  }

  const candidates = indexes.byTitleArtist.get(titleArtistKey(song)) || []
  if (!platformKey) return candidates[0] || null

  // 旧记录有明确平台 ID 时，只回退匹配目标库中缺少平台 ID 的同名歌曲，
  // 避免把同名但不同版本的歌曲合并。
  return candidates.find((candidate) => !platformSongKey(candidate)) || null
}

function asTimestampKey(value) {
  if (!value) return '<none>'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function printSummary(mode, stats) {
  console.log(JSON.stringify({
    mode,
    source: stats.source,
    targetBefore: stats.targetBefore,
    inserted: stats.inserted,
    skipped: stats.skipped,
    targetAfter: stats.targetAfter
  }, null, 2))
}

class DryRunRollback extends Error {
  constructor(stats) {
    super('dry-run rollback')
    this.stats = stats
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (!options.sourceUrl || !options.targetUrl) {
    throw new Error('必须提供源数据库和目标数据库连接地址；使用 --help 查看示例')
  }
  if (options.sourceUrl === options.targetUrl) {
    throw new Error('源数据库与目标数据库不能相同')
  }

  const source = postgres(options.sourceUrl, { max: 1, prepare: false })
  const target = postgres(options.targetUrl, { max: 1, prepare: false })
  let finalStats

  try {
    const [
      legacyUsers,
      legacySongs,
      legacyVotes,
      legacySchedules,
      legacySemesters
    ] = await Promise.all([
      source`select * from "User" order by id`,
      source`select * from "Song" order by id`,
      source`select * from "Vote" order by id`,
      source`select * from "Schedule" order by id`,
      source`select * from "Semester" order by id`
    ])

    const ghostPassword = await bcrypt.hash(randomBytes(48).toString('base64url'), 12)

    try {
      finalStats = await target.begin(async (tx) => {
        const [
          targetUsers,
          targetSongs,
          targetVotes,
          targetSchedules,
          targetSemesters
        ] = await Promise.all([
          tx`select id, username, role from "User" order by id`,
          tx`select id, title, artist, semester, "musicPlatform", "musicId" from "Song" order by id`,
          tx`select "songId", "userId" from "Vote"`,
          tx`select "songId", "playDate", sequence from "Schedule"`,
          tx`select id, name from "Semester"`
        ])

        const stats = {
          source: {
            users: legacyUsers.length,
            songs: legacySongs.length,
            votes: legacyVotes.length,
            schedules: legacySchedules.length,
            semesters: legacySemesters.length
          },
          targetBefore: {
            visibleUsers: targetUsers.filter((user) => user.role !== GHOST_ROLE).length,
            ghostUsers: targetUsers.filter((user) => user.role === GHOST_ROLE).length,
            songs: targetSongs.length,
            votes: targetVotes.length,
            schedules: targetSchedules.length,
            semesters: targetSemesters.length
          },
          inserted: {
            ghostUsers: 0,
            songs: 0,
            votes: 0,
            schedules: 0,
            semesters: 0
          },
          skipped: {
            ghostUsers: 0,
            songs: 0,
            votes: 0,
            schedules: 0,
            semesters: 0,
            orphanSongs: 0,
            orphanVotes: 0,
            orphanSchedules: 0
          },
          targetAfter: {}
        }

        const ghostByUsername = new Map(
          targetUsers
            .filter((user) => user.role === GHOST_ROLE)
            .map((user) => [user.username, Number(user.id)])
        )
        const legacyUserIdMap = new Map()
        let simulatedUserId = -1

        for (const legacyUser of legacyUsers) {
          const username = ghostUsername(legacyUser)
          let targetUserId = ghostByUsername.get(username)
          if (targetUserId) {
            stats.skipped.ghostUsers += 1
          } else if (options.apply) {
            const inserted = await tx`
              insert into "User" (
                "createdAt", "updatedAt", username, name, grade, class, avatar,
                role, password, email, "emailVerified", "lastLogin", "lastLoginIp",
                "passwordChangedAt", "forcePasswordChange", "meowNickname",
                "meowBoundAt", status, "statusChangedAt", "statusChangedBy"
              ) values (
                ${legacyUser.createdAt || new Date()},
                ${legacyUser.updatedAt || legacyUser.createdAt || new Date()},
                ${username},
                ${legacyUser.name || legacyUser.username || `旧用户 ${legacyUser.id}`},
                ${legacyUser.grade || null},
                ${legacyUser.class || null},
                ${legacyUser.avatar || null},
                ${GHOST_ROLE},
                ${ghostPassword},
                ${null},
                ${false},
                ${null},
                ${null},
                ${new Date()},
                ${false},
                ${null},
                ${null},
                ${'withdrawn'},
                ${new Date()},
                ${null}
              )
              returning id
            `
            targetUserId = Number(inserted[0].id)
            ghostByUsername.set(username, targetUserId)
            stats.inserted.ghostUsers += 1
          } else {
            targetUserId = simulatedUserId--
            ghostByUsername.set(username, targetUserId)
            stats.inserted.ghostUsers += 1
          }
          legacyUserIdMap.set(Number(legacyUser.id), targetUserId)
        }

        const songIndexes = {
          byPlatform: new Map(),
          byTitleArtist: new Map()
        }
        for (const song of targetSongs) addSongToIndexes(song, songIndexes)

        const legacySongIdMap = new Map()
        let simulatedSongId = -1

        for (const legacySong of legacySongs) {
          const requesterId = legacyUserIdMap.get(Number(legacySong.requesterId))
          if (!requesterId) {
            stats.skipped.orphanSongs += 1
            continue
          }

          const match = findMatchingSong(legacySong, songIndexes)
          if (match) {
            legacySongIdMap.set(Number(legacySong.id), Number(match.id))
            stats.skipped.songs += 1
            continue
          }

          let targetSongId
          if (options.apply) {
            const inserted = await tx`
              insert into "Song" (
                "createdAt", "updatedAt", title, artist, "requesterId", played,
                "playedAt", semester, "preferredPlayTimeId", cover, "playUrl",
                "musicPlatform", "musicId", "hitRequestId"
              ) values (
                ${legacySong.createdAt || new Date()},
                ${legacySong.updatedAt || legacySong.createdAt || new Date()},
                ${legacySong.title},
                ${legacySong.artist},
                ${requesterId},
                ${Boolean(legacySong.played)},
                ${legacySong.playedAt || null},
                ${legacySong.semester || null},
                ${null},
                ${legacySong.cover || null},
                ${legacySong.playUrl || null},
                ${legacySong.musicPlatform || null},
                ${legacySong.musicId || null},
                ${null}
              )
              returning id
            `
            targetSongId = Number(inserted[0].id)
          } else {
            targetSongId = simulatedSongId--
          }

          const indexedSong = { ...legacySong, id: targetSongId }
          addSongToIndexes(indexedSong, songIndexes)
          legacySongIdMap.set(Number(legacySong.id), targetSongId)
          stats.inserted.songs += 1
        }

        const voteKeys = new Set(
          targetVotes.map((vote) => `${vote.songId}\u0000${vote.userId}`)
        )
        for (const legacyVote of legacyVotes) {
          const songId = legacySongIdMap.get(Number(legacyVote.songId))
          const userId = legacyUserIdMap.get(Number(legacyVote.userId))
          if (!songId || !userId) {
            stats.skipped.orphanVotes += 1
            continue
          }

          const key = `${songId}\u0000${userId}`
          if (voteKeys.has(key)) {
            stats.skipped.votes += 1
            continue
          }
          if (options.apply) {
            await tx`
              insert into "Vote" ("createdAt", "songId", "userId")
              values (${legacyVote.createdAt || new Date()}, ${songId}, ${userId})
            `
          }
          voteKeys.add(key)
          stats.inserted.votes += 1
        }

        const scheduleKeys = new Set(
          targetSchedules.map((schedule) => [
            schedule.songId,
            asTimestampKey(schedule.playDate),
            schedule.sequence
          ].join('\u0000'))
        )
        for (const legacySchedule of legacySchedules) {
          const songId = legacySongIdMap.get(Number(legacySchedule.songId))
          if (!songId) {
            stats.skipped.orphanSchedules += 1
            continue
          }

          const key = [
            songId,
            asTimestampKey(legacySchedule.playDate),
            legacySchedule.sequence
          ].join('\u0000')
          if (scheduleKeys.has(key)) {
            stats.skipped.schedules += 1
            continue
          }
          if (options.apply) {
            await tx`
              insert into "Schedule" (
                "createdAt", "updatedAt", "songId", "playDate", played,
                sequence, "playTimeId", "isDraft", "publishedAt"
              ) values (
                ${legacySchedule.createdAt || new Date()},
                ${legacySchedule.updatedAt || legacySchedule.createdAt || new Date()},
                ${songId},
                ${legacySchedule.playDate},
                ${Boolean(legacySchedule.played)},
                ${legacySchedule.sequence || 1},
                ${null},
                ${Boolean(legacySchedule.isDraft)},
                ${legacySchedule.publishedAt || null}
              )
            `
          }
          scheduleKeys.add(key)
          stats.inserted.schedules += 1
        }

        const semesterNames = new Set(targetSemesters.map((semester) => normalizePart(semester.name)))
        for (const legacySemester of legacySemesters) {
          const key = normalizePart(legacySemester.name)
          if (!key || semesterNames.has(key)) {
            stats.skipped.semesters += 1
            continue
          }
          if (options.apply) {
            await tx`
              insert into "Semester" (
                "createdAt", "updatedAt", name, "isActive"
              ) values (
                ${legacySemester.createdAt || new Date()},
                ${legacySemester.updatedAt || legacySemester.createdAt || new Date()},
                ${legacySemester.name},
                ${false}
              )
            `
          }
          semesterNames.add(key)
          stats.inserted.semesters += 1
        }

        stats.targetAfter = {
          visibleUsers: stats.targetBefore.visibleUsers,
          ghostUsers: stats.targetBefore.ghostUsers + stats.inserted.ghostUsers,
          songs: stats.targetBefore.songs + stats.inserted.songs,
          votes: stats.targetBefore.votes + stats.inserted.votes,
          schedules: stats.targetBefore.schedules + stats.inserted.schedules,
          semesters: stats.targetBefore.semesters + stats.inserted.semesters
        }

        if (!options.apply) throw new DryRunRollback(stats)

        for (const table of ['User', 'Song', 'Vote', 'Schedule', 'Semester']) {
          await tx.unsafe(`
            select setval(
              pg_get_serial_sequence('"${table}"', 'id'),
              coalesce((select max(id) from "${table}"), 1),
              (select max(id) is not null from "${table}")
            )
          `)
        }

        return stats
      })
    } catch (error) {
      if (error instanceof DryRunRollback) {
        finalStats = error.stats
      } else {
        throw error
      }
    }

    printSummary(options.apply ? 'apply' : 'dry-run', finalStats)
  } finally {
    await Promise.allSettled([source.end({ timeout: 5 }), target.end({ timeout: 5 })])
  }
}

main().catch((error) => {
  console.error(`[legacy-import] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
