import { randomUUID } from "node:crypto";
import { config } from "../config";
import { withCache, setEphemeralValue, getEphemeralValue, touchEphemeralValue } from "./cache";
import { buildRedisKey } from "./redis";

const {
  cloudsearch,
  song_detail,
  song_url,
  song_url_v1,
} = require("NeteaseCloudMusicApi") as {
  cloudsearch: (input: Record<string, unknown>) => Promise<any>;
  song_detail: (input: Record<string, unknown>) => Promise<any>;
  song_url: (input: Record<string, unknown>) => Promise<any>;
  song_url_v1: (input: Record<string, unknown>) => Promise<any>;
};

export const RADIO_MUSIC_PROVIDER_KEYS = ["netease", "qq"] as const;
export const RADIO_MUSIC_SEARCH_MODES = ["all", ...RADIO_MUSIC_PROVIDER_KEYS] as const;

export type RadioMusicProvider = typeof RADIO_MUSIC_PROVIDER_KEYS[number];
export type RadioMusicSearchMode = typeof RADIO_MUSIC_SEARCH_MODES[number];
export type RadioMusicQuality = "jymaster" | "hires" | "lossless" | "exhigh" | "standard" | "aac";

export type RadioMusicSelection = {
  provider: RadioMusicProvider;
  trackId: string;
  mediaMid?: string | null;
  album?: string | null;
  cover?: string | null;
  duration?: number | null;
};

export type RadioMusicSearchItem = {
  provider: RadioMusicProvider;
  trackId: string;
  mediaMid?: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  fee: number;
  playable: boolean;
  _searchScore?: number;
};

export type RadioMusicRestriction = {
  provider: RadioMusicProvider;
  category: string;
  message: string;
  action: "login" | "upgrade" | "purchase" | "switch_source";
};

export type RadioMusicResolveResult = {
  provider: RadioMusicProvider;
  url: string | null;
  playable: boolean;
  trial: boolean;
  level?: string;
  quality?: string;
  requestedQuality: string;
  restriction?: RadioMusicRestriction | null;
  reason?: string;
  message?: string;
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const QQ_MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const QQ_SMARTBOX_URL = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg";
const QQ_HEADERS = {
  Referer: "https://y.qq.com/",
  "User-Agent": UA,
} as const;
const SEARCH_TTL_MS = 5 * 60_000;
const URL_TTL_MS = 45_000;
const STREAM_TOKEN_TTL_MS = 10 * 60_000;
const STREAM_TOKEN_PREFIX = buildRedisKey("radio", "music", "stream");

const NETEASE_QUALITY_CANDIDATES = [
  { level: "jymaster", br: 1_999_000, label: "超清母带" },
  { level: "hires", br: 1_999_000, label: "高清臻音" },
  { level: "lossless", br: 1_411_000, label: "无损" },
  { level: "exhigh", br: 999_000, label: "极高" },
  { level: "standard", br: 128_000, label: "标准" },
] as const;

const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: "RS01", ext: ".flac", level: "hires", label: "Hi-Res FLAC" },
  { prefix: "F000", ext: ".flac", level: "lossless", label: "无损 FLAC" },
  { prefix: "M800", ext: ".mp3", level: "exhigh", label: "320k MP3" },
  { prefix: "M500", ext: ".mp3", level: "standard", label: "128k MP3" },
  { prefix: "C400", ext: ".m4a", level: "aac", label: "AAC/M4A" },
] as const;

function normalizeCookieHeader(input: string | undefined) {
  return String(input ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function neteaseCookie() {
  return normalizeCookieHeader(config.radioNeteaseCookie);
}

function qqCookie() {
  return normalizeCookieHeader(config.radioQqCookie);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function optionalStringValue(input: unknown, max = 800) {
  const value = String(input ?? "").trim();
  if (!value) return null;
  return value.slice(0, max);
}

function optionalDurationValue(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.floor(value), 24 * 60 * 60 * 1000);
}

export function normalizeRadioMusicSelection(input: unknown): RadioMusicSelection | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const provider = row.provider === "qq" ? "qq" : row.provider === "netease" ? "netease" : null;
  const trackId = String(row.trackId ?? "").trim();
  if (!provider || !trackId) return null;
  return {
    provider,
    trackId,
    mediaMid: optionalStringValue(row.mediaMid, 120),
    album: optionalStringValue(row.album, 200),
    cover: optionalStringValue(row.cover, 1000),
    duration: optionalDurationValue(row.duration),
  };
}

export function serializeRadioMusicSelection(input: unknown) {
  const normalized = normalizeRadioMusicSelection(input);
  return JSON.stringify(normalized ?? {});
}

export function parseRadioMusicSelection(raw: unknown, fallbackProvider?: unknown, fallbackTrackId?: unknown) {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) parsed = {};
    else {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = {};
      }
    }
  }
  const normalized = normalizeRadioMusicSelection(parsed);
  if (normalized) return normalized;
  const provider = fallbackProvider === "qq" ? "qq" : fallbackProvider === "netease" ? "netease" : null;
  const trackId = String(fallbackTrackId ?? "").trim();
  if (!provider || !trackId) return null;
  return {
    provider,
    trackId,
    mediaMid: null,
    album: null,
    cover: null,
    duration: null,
  };
}

function sharedLoginState() {
  const qqState = qqSessionState();
  return {
    netease: Boolean(neteaseCookie()),
    qq: qqState.loggedIn,
  };
}

function streamTokenKey(token: string) {
  return `${STREAM_TOKEN_PREFIX}:${token}`;
}

type RadioMusicStreamPayload = {
  provider: RadioMusicProvider;
  url: string;
};

export async function issueRadioMusicStreamToken(payload: RadioMusicStreamPayload) {
  const token = randomUUID().replace(/-/g, "");
  await setEphemeralValue(streamTokenKey(token), JSON.stringify(payload), STREAM_TOKEN_TTL_MS);
  return token;
}

export async function readRadioMusicStreamPayload(token: string) {
  const raw = await getEphemeralValue(streamTokenKey(token));
  if (!raw) return null;
  await touchEphemeralValue(streamTokenKey(token), STREAM_TOKEN_TTL_MS).catch(() => undefined);
  try {
    const parsed = JSON.parse(raw) as RadioMusicStreamPayload;
    if (!parsed?.url || !parsed?.provider) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildRadioMusicStreamPath(token: string) {
  return `/api/radio/music/stream/${encodeURIComponent(token)}`;
}

function playbackRestriction(
  provider: RadioMusicProvider,
  category: string,
  message: string,
  action: RadioMusicRestriction["action"],
) {
  return { provider, category, message, action };
}

function normalizeQualityPreference(value: unknown): RadioMusicQuality {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["jymaster", "master", "studio", "svip"].includes(raw)) return "jymaster";
  if (["hires", "hi-res", "highres", "zhenyin", "spatial"].includes(raw)) return "hires";
  if (["lossless", "flac", "sq"].includes(raw)) return "lossless";
  if (["exhigh", "high", "320", "320k", "hq"].includes(raw)) return "exhigh";
  if (["aac", "m4a"].includes(raw)) return "aac";
  return "standard";
}

function qualityCandidatesFrom<T extends { level: string }>(target: unknown, candidates: readonly T[]) {
  const normalized = normalizeQualityPreference(target);
  let start = candidates.findIndex((item) => item.level === normalized);
  if (start < 0) start = 0;
  return candidates.slice(start);
}

function parseJSONText(text: string) {
  const raw = String(text ?? "").trim();
  const normalized = raw.replace(/^callback\(([\s\S]*)\);?$/, "$1");
  return JSON.parse(normalized);
}

async function requestText(targetUrl: string, init?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? config.radioMusicTimeoutMs);
  try {
    const response = await fetch(targetUrl, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`) as Error & { statusCode?: number; body?: string };
      error.statusCode = response.status;
      error.body = text;
      throw error;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function qqAlbumCover(albumMid: unknown, size = 300) {
  const value = String(albumMid ?? "").trim();
  if (!value) return "";
  return `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${value}.jpg?max_age=2592000`;
}

function parseCookieString(cookieText: string) {
  const out: Record<string, string> = {};
  for (const part of String(cookieText || "").split(";")) {
    const raw = part.trim();
    if (!raw) continue;
    const index = raw.indexOf("=");
    if (index <= 0) continue;
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function qqCookieObject() {
  return parseCookieString(qqCookie());
}

function normalizeQQUin(raw: unknown) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || digits;
}

function qqCookieUin(obj = qqCookieObject()) {
  const raw = Number(obj.login_type) === 2 ? (obj.wxuin || obj.uin || obj.p_uin) : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin);
  return normalizeQQUin(raw);
}

function qqCookieMusicKey(obj = qqCookieObject()) {
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey
    || obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || "";
}

function qqCookiePlaybackKey(obj = qqCookieObject()) {
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || "";
}

function qqSessionState() {
  const obj = qqCookieObject();
  const uin = qqCookieUin(obj);
  return {
    loggedIn: Boolean(uin && qqCookieMusicKey(obj)),
    hasPlaybackKey: Boolean(uin && qqCookiePlaybackKey(obj)),
  };
}

async function qqMusicRequest(payload: Record<string, unknown>, options?: { cookie?: boolean }) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    ...QQ_HEADERS,
    "Content-Type": "application/json;charset=UTF-8",
  };
  if (options?.cookie && qqCookie()) headers.Cookie = qqCookie();
  const text = await requestText(QQ_MUSICU_URL, {
    method: "POST",
    headers,
    body,
  });
  return parseJSONText(text);
}

async function qqGetJSON(targetUrl: string, params: Record<string, unknown>, options?: { cookie?: boolean; headers?: Record<string, string> }) {
  const url = new URL(targetUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    ...QQ_HEADERS,
    ...(options?.headers ?? {}),
  };
  if (options?.cookie !== false && qqCookie()) headers.Cookie = qqCookie();
  const text = await requestText(url.toString(), { headers });
  return parseJSONText(text);
}

function mapSongRecord(song: any): RadioMusicSearchItem {
  const artists = Array.isArray(song?.ar) ? song.ar : Array.isArray(song?.artists) ? song.artists : [];
  const album = song?.al || song?.album || {};
  return {
    provider: "netease",
    trackId: String(song?.id ?? "").trim(),
    name: String(song?.name ?? "").trim(),
    artist: artists.map((item: any) => String(item?.name ?? "").trim()).filter(Boolean).join(" / "),
    album: String(album?.name ?? "").trim(),
    cover: String(album?.picUrl ?? album?.coverUrl ?? "").trim(),
    duration: clampInt(Number(song?.dt ?? song?.duration ?? 0), 0, 24 * 60 * 60 * 1000),
    fee: Number(song?.fee ?? 0) || 0,
    playable: true,
  };
}

function mapQQSmartSong(item: any): RadioMusicSearchItem {
  const mid = String(item?.mid ?? item?.songmid ?? item?.id ?? "").trim();
  return {
    provider: "qq",
    trackId: mid,
    name: String(item?.name ?? item?.title ?? "").trim(),
    artist: String(item?.singer ?? "").trim(),
    album: "",
    cover: "",
    duration: 0,
    fee: 0,
    playable: false,
  };
}

function mapQQTrack(track: any, fallback?: Partial<RadioMusicSearchItem>): RadioMusicSearchItem {
  const album = track?.album || {};
  const singers = Array.isArray(track?.singer) ? track.singer : [];
  const mid = String(track?.mid ?? fallback?.trackId ?? "").trim();
  return {
    provider: "qq",
    trackId: mid,
    mediaMid: String(track?.file?.media_mid ?? fallback?.mediaMid ?? "").trim() || undefined,
    name: String(track?.name ?? track?.title ?? fallback?.name ?? "").trim(),
    artist: singers.map((item: any) => String(item?.name ?? item?.title ?? "").trim()).filter(Boolean).join(" / ") || String(fallback?.artist ?? "").trim(),
    album: String(album?.name ?? album?.title ?? fallback?.album ?? "").trim(),
    cover: qqAlbumCover(album?.mid ?? album?.pmid ?? "", 300) || String(fallback?.cover ?? "").trim(),
    duration: clampInt(Number(track?.interval ?? 0) * 1000, 0, 24 * 60 * 60 * 1000),
    fee: track?.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  };
}

async function searchNeteaseSongs(query: string, limit: number) {
  const result = await cloudsearch({
    keywords: query,
    limit,
    cookie: neteaseCookie() || undefined,
  });
  const songs = Array.isArray(result?.body?.result?.songs) ? result.body.result.songs : [];
  let mapped = songs.map(mapSongRecord).filter((item: RadioMusicSearchItem) => item.trackId && item.name);
  const missingCoverIds = mapped
    .filter((item: RadioMusicSearchItem) => !item.cover)
    .map((item: RadioMusicSearchItem) => item.trackId);
  if (missingCoverIds.length) {
    try {
      const detail = await song_detail({
        ids: missingCoverIds.join(","),
        cookie: neteaseCookie() || undefined,
      });
      const rows = Array.isArray(detail?.body?.songs) ? detail.body.songs : [];
      const coverById = new Map<string, string>();
      for (const row of rows) {
        const key = String(row?.id ?? "").trim();
        const value = String(row?.al?.picUrl ?? row?.album?.picUrl ?? "").trim();
        if (key && value) coverById.set(key, value);
      }
      mapped = mapped.map((item: RadioMusicSearchItem) => item.cover ? item : {
        ...item,
        cover: coverById.get(item.trackId) ?? "",
      });
    } catch {
      // ignore cover backfill failure
    }
  }
  return mapped;
}

async function qqSmartboxSearch(query: string, limit: number) {
  const url = new URL(QQ_SMARTBOX_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", query);
  url.searchParams.set("g_tk", "5381");
  url.searchParams.set("loginUin", "0");
  url.searchParams.set("hostUin", "0");
  url.searchParams.set("inCharset", "utf8");
  url.searchParams.set("outCharset", "utf-8");
  url.searchParams.set("notice", "0");
  url.searchParams.set("platform", "yqq.json");
  url.searchParams.set("needNewCode", "0");
  const text = await requestText(url.toString(), { headers: QQ_HEADERS });
  const json = parseJSONText(text);
  const items = Array.isArray(json?.data?.song?.itemlist) ? json.data.song.itemlist : [];
  return items.slice(0, clampInt(limit, 1, 10)).map(mapQQSmartSong);
}

async function qqSongDetail(trackId: string, fallback: RadioMusicSearchItem) {
  if (!trackId) return fallback;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: "music.pf_song_detail_svr",
      method: "get_song_detail_yqq",
      param: { song_mid: trackId },
    },
  });
  return mapQQTrack(json?.songinfo?.data?.track_info, fallback);
}

async function searchQqSongs(query: string, limit: number) {
  const base = await qqSmartboxSearch(query, Math.min(limit, 10));
  const detailed = await Promise.all(base.map(async (item: RadioMusicSearchItem) => {
    try {
      return await qqSongDetail(item.trackId, item);
    } catch {
      return item;
    }
  }));
  const seen = new Set<string>();
  return detailed.filter((item: RadioMusicSearchItem) => {
    const key = `${item.provider}:${item.trackId}`;
    if (!item.trackId || !item.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function songProviderKey(song: Pick<RadioMusicSearchItem, "provider">) {
  return song.provider === "qq" ? "qq" : "netease";
}

function simpleSearchNorm(text: unknown) {
  return String(text ?? "").toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .replace(/[\s·・,，。.!！?？'"“”‘’|\-_/]+/g, "");
}

function searchIntentPrefersQQ(query: string) {
  return /(^|\s)qq($|\s)|qq音乐|qq音樂|周杰伦|周杰倫|jay\s*chou|jay/i.test(query);
}

function searchMentionsKnownArtist(query: string, artist: string) {
  const rawQuery = String(query ?? "").toLowerCase();
  const rawArtist = String(artist ?? "").toLowerCase();
  if (!rawArtist) return false;
  if (/周杰伦|周杰倫|jay\s*chou/.test(rawQuery) && /周杰伦|周杰倫|jay\s*chou/.test(rawArtist)) return true;
  const queryNorm = simpleSearchNorm(query);
  const artistNorm = simpleSearchNorm(artist);
  return Boolean(artistNorm && artistNorm.length >= 2 && queryNorm.includes(artistNorm));
}

function searchLooksLikeDerivative(text: string) {
  return /(翻唱|cover|伴奏|instrumental|remix|片段|demo|女声|男声|karaoke|抖音版|dj版|合唱版|改编版|tribute|made\s*famous\s*by)/i.test(text);
}

function scoreSongSearchResult(song: RadioMusicSearchItem, query: string, sourceIndex: number) {
  const queryNorm = simpleSearchNorm(query);
  const nameNorm = simpleSearchNorm(song.name);
  const artistNorm = simpleSearchNorm(song.artist);
  const albumNorm = simpleSearchNorm(song.album);
  const raw = `${song.name} ${song.artist} ${song.album}`.toLowerCase();
  const queryAsksDerivative = /(live|现场|翻唱|cover|伴奏|instrumental|remix|dj|片段|demo|女声|男声|karaoke)/i.test(query);
  let score = 0;
  if (nameNorm === queryNorm) score += 90;
  else if (nameNorm.startsWith(queryNorm)) score += 55;
  else if (nameNorm.includes(queryNorm)) score += 32;
  if (nameNorm && queryNorm && queryNorm.includes(nameNorm)) score += nameNorm.length >= 2 ? 68 : 18;
  if (searchMentionsKnownArtist(query, song.artist)) score += 96;
  else if (artistNorm && queryNorm.includes(artistNorm)) score += 64;
  if (albumNorm && queryNorm && (albumNorm.includes(queryNorm) || queryNorm.includes(albumNorm))) score += 8;
  if (songProviderKey(song) === "qq") score += searchIntentPrefersQQ(query) ? 48 : 4;
  if (!song.playable) score -= 12;
  if (!queryAsksDerivative) {
    if (searchLooksLikeDerivative(raw)) score -= 96;
    if (/(live|现场)/i.test(raw)) score -= 42;
  }
  score -= sourceIndex * 0.75;
  return score;
}

function mergeSongSearchResults(neteaseSongs: RadioMusicSearchItem[], qqSongs: RadioMusicSearchItem[], limit: number, query: string) {
  const out: RadioMusicSearchItem[] = [];
  const seen = new Set<string>();
  const push = (song: RadioMusicSearchItem, index: number) => {
    if (!song?.trackId || !song?.name) return;
    const key = `${song.provider}:${song.trackId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ...song,
      _searchScore: scoreSongSearchResult(song, query, index),
    });
  };
  neteaseSongs.forEach((song, index) => push(song, index));
  qqSongs.forEach((song, index) => push(song, index));
  return out
    .sort((left, right) => (right._searchScore ?? 0) - (left._searchScore ?? 0))
    .slice(0, limit)
    .map(({ _searchScore, ...item }) => item);
}

function classifyNeteasePlaybackRestriction(lastData: any, loggedIn: boolean): RadioMusicRestriction {
  const fee = Number(lastData?.fee ?? 0);
  const code = Number(lastData?.code ?? 0);
  const freeTrial = lastData?.freeTrialInfo;
  if (!loggedIn) {
    if (freeTrial) return playbackRestriction("netease", "trial_only", "网易云当前只能返回试听片段，完整播放通常需要登录或更高权限。", "login");
    return playbackRestriction("netease", "login_required", "网易云没有返回完整播放地址，通常需要登录后再试。", "login");
  }
  if (freeTrial) return playbackRestriction("netease", "trial_only", "网易云当前只能返回试听片段，完整播放通常需要会员或购买权限。", "upgrade");
  if (fee === 1) return playbackRestriction("netease", "vip_required", "网易云歌曲需要 VIP 权限。", "upgrade");
  if (fee === 4 || fee === 8) return playbackRestriction("netease", "paid_required", "网易云歌曲需要单曲或专辑购买权限。", "purchase");
  if (code === 404 || code === 403) return playbackRestriction("netease", "copyright_unavailable", "网易云当前没有返回可播放地址，可能是版权限制。", "switch_source");
  return playbackRestriction("netease", "url_unavailable", "网易云没有返回可播放地址，可以换一个搜索结果再试。", "switch_source");
}

function classifyQQPlaybackRestriction(info: any): RadioMusicRestriction {
  const session = qqSessionState();
  const rawMessage = String(info?.msg ?? info?.tips ?? info?.errmsg ?? info?.message ?? "").trim();
  const code = Number(info?.result ?? info?.code ?? info?.errtype ?? 0);
  const lower = rawMessage.toLowerCase();
  if (!session.loggedIn) {
    return playbackRestriction("qq", "login_required", "QQ 音乐通常需要共享登录态后才能稳定返回播放地址。", "login");
  }
  if (!session.hasPlaybackKey && code === 104003) {
    return playbackRestriction("qq", "login_required", "QQ 音乐当前只有登录态，没有拿到播放授权。", "login");
  }
  if (code === 104003) {
    return playbackRestriction("qq", "copyright_unavailable", "QQ 音乐没有为当前歌曲返回播放地址，常见于版权或会员限制。", "switch_source");
  }
  if (/vip|会员|付费|购买|数字专辑|pay/.test(lower)) {
    return playbackRestriction("qq", "paid_required", "QQ 音乐歌曲需要会员或购买权限。", "upgrade");
  }
  if (code && code !== 0) {
    return playbackRestriction("qq", "copyright_unavailable", rawMessage || "QQ 音乐当前不可播。", "switch_source");
  }
  return playbackRestriction("qq", "url_unavailable", "QQ 音乐没有返回可播放地址，可以换一个搜索结果再试。", "switch_source");
}

async function resolveNeteaseSongUrl(trackId: string, qualityPreference: unknown): Promise<RadioMusicResolveResult> {
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES);
  let trialFallback: RadioMusicResolveResult | null = null;
  let lastData: any = null;
  for (const quality of qualities) {
    try {
      let result: any;
      try {
        result = await song_url_v1({ id: trackId, level: quality.level, cookie: neteaseCookie() || undefined });
      } catch {
        result = await song_url({ id: trackId, br: quality.br, cookie: neteaseCookie() || undefined });
      }
      const row = result?.body?.data?.[0];
      if (row) lastData = row;
      const url = String(row?.url ?? "").trim();
      const freeTrial = row?.freeTrialInfo;
      if (url && !freeTrial) {
        return {
          provider: "netease",
          url,
          playable: true,
          trial: false,
          level: quality.level,
          quality: quality.label,
          requestedQuality,
        };
      }
      if (url && freeTrial && !trialFallback) {
        trialFallback = {
          provider: "netease",
          url,
          playable: true,
          trial: true,
          level: quality.level,
          quality: quality.label,
          requestedQuality,
          restriction: classifyNeteasePlaybackRestriction(row, Boolean(neteaseCookie())),
          reason: "trial_only",
          message: "当前仅能返回试听片段。",
        };
      }
    } catch {
      // continue with lower quality
    }
  }
  if (trialFallback) return trialFallback;
  const restriction = classifyNeteasePlaybackRestriction(lastData, Boolean(neteaseCookie()));
  return {
    provider: "netease",
    url: null,
    playable: false,
    trial: false,
    requestedQuality,
    restriction,
    reason: restriction.category,
    message: restriction.message,
  };
}

async function resolveQQSongUrl(trackId: string, mediaMid: string | null | undefined, qualityPreference: unknown): Promise<RadioMusicResolveResult> {
  const songmid = String(trackId ?? "").trim();
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj) || "0";
  const musicKey = qqCookieMusicKey(cookieObj);
  const fileMediaMid = String(mediaMid ?? "").trim();
  const mediaIds = [fileMediaMid, songmid].filter(Boolean);
  const fileCandidates = mediaIds.flatMap((mediaId) =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map((item) => ({ ...item, mediaId, filename: `${item.prefix}${mediaId}${item.ext}` })),
  );
  const param: Record<string, unknown> = {
    guid: String(10_000_000 + Math.floor(Math.random() * 90_000_000)),
    songmid: (fileCandidates.length ? fileCandidates : [{ filename: "" }]).map(() => songmid),
    songtype: (fileCandidates.length ? fileCandidates : [{ filename: "" }]).map(() => 0),
    uin,
    loginflag: 1,
    platform: "20",
  };
  if (fileCandidates.length) param.filename = fileCandidates.map((item) => item.filename);
  const comm: Record<string, unknown> = { uin, format: "json", ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  const json = await qqMusicRequest({
    comm,
    req_0: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param,
    },
  }, { cookie: true });
  const data = json?.req_0?.data;
  const infos = Array.isArray(data?.midurlinfo) ? data.midurlinfo : [];
  const info = infos.find((item: any) => item?.purl) || infos[0];
  const purl = String(info?.purl ?? "").trim();
  if (purl) {
    const base = String(data?.sip?.[0] ?? "https://ws.stream.qqmusic.qq.com/").trim();
    const fileMeta = fileCandidates.find((item) => item.filename === info?.filename);
    return {
      provider: "qq",
      url: `${base}${purl}`,
      playable: true,
      trial: false,
      level: fileMeta?.level ?? String(info?.filename ?? ""),
      quality: fileMeta?.label ?? String(info?.filename ?? ""),
      requestedQuality,
    };
  }
  const restriction = classifyQQPlaybackRestriction(info);
  return {
    provider: "qq",
    url: null,
    playable: false,
    trial: false,
    requestedQuality,
    restriction,
    reason: restriction.category,
    message: restriction.message,
  };
}

export async function searchRadioMusic(query: string, mode: RadioMusicSearchMode, limit: number) {
  const keyword = String(query ?? "").trim();
  const providerMode = RADIO_MUSIC_SEARCH_MODES.includes(mode) ? mode : "all";
  const cappedLimit = clampInt(limit, 1, 18);
  if (!keyword) {
    return {
      query: "",
      providerMode,
      sharedLogin: sharedLoginState(),
      results: [] as RadioMusicSearchItem[],
    };
  }
  return withCache("radio-music", ["search", providerMode, keyword, cappedLimit], SEARCH_TTL_MS, async () => {
    if (providerMode === "netease") {
      return {
        query: keyword,
        providerMode,
        sharedLogin: sharedLoginState(),
        results: await searchNeteaseSongs(keyword, cappedLimit),
      };
    }
    if (providerMode === "qq") {
      return {
        query: keyword,
        providerMode,
        sharedLogin: sharedLoginState(),
        results: await searchQqSongs(keyword, cappedLimit),
      };
    }
    const [neteaseResult, qqResult] = await Promise.allSettled([
      searchNeteaseSongs(keyword, Math.min(14, cappedLimit)),
      searchQqSongs(keyword, Math.min(12, cappedLimit)),
    ]);
    const neteaseSongs = neteaseResult.status === "fulfilled" ? neteaseResult.value : [];
    const qqSongs = qqResult.status === "fulfilled" ? qqResult.value : [];
    if (!neteaseSongs.length && !qqSongs.length) {
      if (neteaseResult.status === "rejected") throw neteaseResult.reason;
      if (qqResult.status === "rejected") throw qqResult.reason;
    }
    return {
      query: keyword,
      providerMode,
      sharedLogin: sharedLoginState(),
      results: mergeSongSearchResults(neteaseSongs, qqSongs, cappedLimit, keyword),
    };
  });
}

export async function resolveRadioMusicUrl(input: {
  provider: RadioMusicProvider;
  trackId: string;
  mediaMid?: string | null;
  quality?: string;
}) {
  const provider = input.provider === "qq" ? "qq" : "netease";
  const trackId = String(input.trackId ?? "").trim();
  const mediaMid = String(input.mediaMid ?? "").trim();
  const quality = normalizeQualityPreference(input.quality);
  return withCache("radio-music", ["resolve", provider, trackId, mediaMid || "_", quality], URL_TTL_MS, async () => {
    if (provider === "qq") return resolveQQSongUrl(trackId, mediaMid, quality);
    return resolveNeteaseSongUrl(trackId, quality);
  });
}

export function audioProxyHeadersFor(audioUrl: string, range?: string | string[]) {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://music.163.com/",
  };
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host.includes("qq.com") || host.includes("qpic.cn")) headers.Referer = "https://y.qq.com/";
  } catch {
    // ignore url parse failure
  }
  const rangeHeader = Array.isArray(range) ? range[0] : range;
  if (rangeHeader) headers.Range = rangeHeader;
  return headers;
}

export function audioContentTypeForUrl(audioUrl: string, upstreamType?: string | null) {
  let pathname = "";
  try {
    pathname = new URL(audioUrl).pathname.toLowerCase();
  } catch {
    pathname = "";
  }
  if (/\.flac$/.test(pathname)) return "audio/flac";
  if (/\.mp3$/.test(pathname)) return "audio/mpeg";
  if (/\.(m4a|mp4)$/.test(pathname)) return "audio/mp4";
  if (/\.ogg$/.test(pathname)) return "audio/ogg";
  if (/\.wav$/.test(pathname)) return "audio/wav";
  return upstreamType || "audio/mpeg";
}
