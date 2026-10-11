// 药苑之声（VoiceHub）取景用的示例数据。歌名、歌手和歌词都是为宣传片原创的，不涉及真实曲目。
import { NOW } from "./mock-data.mjs";

const pad = (n) => String(n).padStart(2, "0");
const shanghaiDate = (offsetDays) => {
  const d = new Date(NOW.getTime() + 8 * 3600_000 + offsetDays * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const cn = (iso) => new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

const SEMESTER = "2026学年第一学期";
const ME = 101;
const PLAY_TIMES = [
  { id: 1, name: "午间广播", startTime: "12:10", endTime: "12:40", enabled: true, description: null },
  { id: 2, name: "晚间广播", startTime: "21:30", endTime: "22:00", enabled: true, description: null },
];
// id, 歌名, 歌手, 投稿人, 热度, 状态, 排期日偏移, 时段, 顺序, 评论数
const ROWS = [
  [1, "夏日来信", "拾音乐队", "匿名同学", 126, "scheduled", 0, 1, 1, 18],
  [2, "银杏大道", "林间", "阿树", 98, "scheduled", 0, 1, 2, 9],
  [3, "晚自习后的风", "南苑", "Momo", 87, "scheduled", 0, 2, 1, 6],
  [4, "第七周", "早八合唱团", "一只猫", 64, "played", -1, 2, 1, 4],
  [5, "图书馆三楼", "小胶囊", "小林", 52, "pending", null, null, null, 3],
  [6, "实验楼的灯", "夜归人", "林同学", 41, "pending", null, null, null, 2],
  [7, "江宁的云", "白衬衫", "清风徐来", 37, "pending", null, null, null, 1],
  [8, "下课铃", "四点半", "胶囊小姐", 29, "pending", null, null, null, 0],
];
export const COVER_COLORS = [
  ["#f6a04d", "#e2557a"], ["#f2c94c", "#5aa469"], ["#4f7cff", "#7b4dd8"], ["#2bb3a0", "#17406b"],
  ["#ff8a65", "#ffd166"], ["#3a3a6e", "#9b5de5"], ["#8ecae6", "#219ebc"], ["#ef476f", "#ffd6a5"],
];
const LYRICS = ["把风装进信封里", "寄给明天的自己", "银杏落在第七周", "我们都在慢慢长大", "下课铃响起的时候", "想把这首歌唱给你"];

export function voicehubFixtures() {
  const songs = ROWS.map(([id, title, artist, requester, voteCount, state, off, , , commentCount]) => {
    const createdAt = new Date(NOW.getTime() - (10 - id) * 86_400_000).toISOString();
    const scheduled = state !== "pending";
    return {
      id, title, artist, requester, requesterId: id === 6 ? ME : 200 + id, collaborators: [], voteCount,
      played: state === "played", playedAt: state === "played" ? new Date(NOW.getTime() - 86_400_000).toISOString() : null,
      semester: SEMESTER, createdAt, updatedAt: createdAt, requestedAt: cn(createdAt), scheduled,
      cover: `/voicehub/__mock/covers/${id}.jpg`, musicPlatform: "netease", musicId: String(900000 + id),
      playUrl: "/voicehub/__mock/audio/demo.wav", requesterGrade: null, requesterClass: null,
      replayRequested: false, replayRequestCount: 0, isReplay: false, replayRequesters: [], commentCount,
      ...(scheduled ? { scheduleDate: cn(`${shanghaiDate(off)}T00:00:00+08:00`), schedulePlayed: state === "played" } : {}),
      voted: id === 2 || id === 5, preferredPlayTimeId: null,
    };
  });
  const schedules = ROWS.filter((r) => r[5] !== "pending").map(([id, , , , , state, off, playTimeId, sequence]) => {
    const s = songs.find((x) => x.id === id);
    return {
      id: 100 + id, playDate: shanghaiDate(off), sequence, played: state === "played", playTimeId, playTime: PLAY_TIMES.find((p) => p.id === playTimeId),
      song: {
        id, title: s.title, artist: s.artist, requester: s.requester, requesterGrade: null, requesterClass: null, collaborators: [],
        voteCount: s.voteCount, played: s.played, cover: s.cover, musicPlatform: "netease", musicId: s.musicId, playUrl: s.playUrl,
        semester: SEMESTER, requestedAt: s.requestedAt, replayRequestCount: 0, replayRequesters: [], isReplay: false,
      },
    };
  });
  const siteConfig = {
    siteTitle: "药苑之声", siteLogoUrl: "/images/logo.png", schoolLogoHomeUrl: "", schoolLogoPrintUrl: "",
    siteDescription: "校园广播站点歌与播出平台", submissionGuidelines: "", icpNumber: "", gonganNumber: "",
    enablePlayTimeSelection: true, enableSubmissionLimit: false, dailySubmissionLimit: null, weeklySubmissionLimit: null,
    monthlySubmissionLimit: null, showBlacklistKeywords: false, hideStudentInfo: true, enableReplayRequests: true,
    enableRequestTimeLimitation: false, forceBlockAllRequests: false, smtpEnabled: false, enableRegistrationEmailVerification: false,
  };
  const playTimes = { enabled: true, playTimes: PLAY_TIMES };
  const songsResponse = { success: true, data: { songs, total: songs.length } };
  const semester = { id: 3, name: SEMESTER, isActive: true };
  const lrc = LYRICS.map((t, i) => `[00:${pad(1 + i * 4)}.00]${t}`).join("\n");
  const yrc = LYRICS.map((t, i) => {
    const start = 1000 + i * 4000;
    const chars = [...t];
    const each = Math.floor(3600 / chars.length);
    return `[${start},3600]` + chars.map((ch, j) => `(${start + j * each},${each},0)${ch}`).join("");
  }).join("\n");
  const routes = {
    "/api/auth/verify": {
      user: { id: ME, username: "2024100123", name: "小药丸", grade: "2024级", class: "药学院", avatar: null, email: null, role: "USER",
        forcePasswordChange: false, requirePasswordChange: false, passwordChangedAt: null, has2FA: false, cpuWebUserId: 1024 },
      valid: true, source: "cpu-web",
    },
    "/api/bootstrap/home": { success: true, partial: false, errors: [], data: { siteConfig, songs: songsResponse, publicSchedules: schedules, songCount: { count: songs.length }, playTimes, currentSemester: semester } },
    "/api/site-config": siteConfig,
    "/api/songs": songsResponse,
    "/api/songs/public": schedules,
    "/api/songs/count": { count: songs.length },
    "/api/play-times": playTimes,
    "/api/semesters/current": semester,
    "/api/songs/comments/counts": { success: true, data: { counts: Object.fromEntries(songs.map((s) => [s.id, s.commentCount])) } },
    "/api/songs/comments/list": { success: true, data: { comments: [], total: 0 } },
    "/api/songs/review-status": { enabled: false, reviews: [] },
    "/api/songs/submission-status": { limitEnabled: false, submissionClosed: false, timeLimitationEnabled: false, currentTimePeriod: null },
    "/api/api-enhanced/netease/lyric": { code: 200, lrc: { lyric: lrc }, tlyric: { lyric: "" } },
    "/api/api-enhanced/netease/lyric/new": { code: 200, yrc: { lyric: yrc } },
  };
  return { routes };
}
