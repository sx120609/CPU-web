import { defineEventHandler } from 'h3'
import siteConfigHandler from '../site-config.get'
import songsHandler from '../songs/index.get'
import publicSchedulesHandler from '../songs/public.get'
import songCountHandler from '../songs/count.get'
import playTimesHandler from '../play-times/index'
import currentSemesterHandler from '../semesters/current.get'

const normalizeError = (error: any) => {
  if (!error) {
    return {
      message: 'Unknown error'
    }
  }

  return {
    message: error.statusMessage || error.message || 'Unknown error',
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : 500
  }
}

export default defineEventHandler(async (event) => {
  const [
    siteConfigResult,
    songsResult,
    publicSchedulesResult,
    songCountResult,
    playTimesResult,
    currentSemesterResult
  ] = await Promise.allSettled([
    siteConfigHandler(event),
    songsHandler(event),
    publicSchedulesHandler(event),
    songCountHandler(event),
    playTimesHandler(event),
    currentSemesterHandler(event)
  ])

  const errors: Array<{ section: string; message: string; statusCode?: number }> = []

  const readResult = (section: string, result: PromiseSettledResult<any>) => {
    if (result.status === 'fulfilled') {
      return result.value
    }

    const normalized = normalizeError(result.reason)
    errors.push({
      section,
      message: normalized.message,
      statusCode: normalized.statusCode
    })
    return null
  }

  return {
    success: true,
    partial: errors.length > 0,
    errors,
    data: {
      siteConfig: readResult('siteConfig', siteConfigResult),
      songs: readResult('songs', songsResult),
      publicSchedules: readResult('publicSchedules', publicSchedulesResult),
      songCount: readResult('songCount', songCountResult),
      playTimes: readResult('playTimes', playTimesResult),
      currentSemester: readResult('currentSemester', currentSemesterResult)
    }
  }
})
