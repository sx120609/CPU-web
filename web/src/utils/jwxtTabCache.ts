import { jwxtScopedStorageKey } from "@/utils/jwxtCache";

export type JwxtDataTab = "schedule" | "grades" | "midterm" | "progress" | "pyfa";

export const JWXT_TAB_CACHE_TTL = 12 * 60 * 60 * 1000;
export const JWXT_TAB_CACHE_PREFIX = "cpu-jwxt-tab-cache-v6";

export interface JwxtTabCacheEnvelope<T = any> {
  savedAt: number;
  data: T;
}

export function jwxtTabCacheKey(tab: JwxtDataTab, identity: string) {
  return jwxtScopedStorageKey(JWXT_TAB_CACHE_PREFIX, identity, tab);
}

export function readJwxtTabCache<T = any>(tab: JwxtDataTab, identity: string): JwxtTabCacheEnvelope<T> | null {
  try {
    const key = jwxtTabCacheKey(tab, identity);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    return parsed as JwxtTabCacheEnvelope<T>;
  } catch {
    return null;
  }
}

export function readLatestJwxtTabCache<T = any>(tab: JwxtDataTab, identities: string[]) {
  const seen = new Set<string>();
  let latest: { identity: string; envelope: JwxtTabCacheEnvelope<T> } | null = null;
  for (const identity of identities) {
    const normalizedIdentity = String(identity || "").trim();
    if (!normalizedIdentity || seen.has(normalizedIdentity)) continue;
    seen.add(normalizedIdentity);
    const envelope = readJwxtTabCache<T>(tab, normalizedIdentity);
    if (!envelope?.data) continue;
    if (!latest || envelope.savedAt > latest.envelope.savedAt) {
      latest = { identity: normalizedIdentity, envelope };
    }
  }
  return latest;
}

export function writeJwxtTabCache<T = any>(tab: JwxtDataTab, identity: string, data: T) {
  try {
    const key = jwxtTabCacheKey(tab, identity);
    if (!key) return null;
    const envelope: JwxtTabCacheEnvelope = {
      savedAt: Date.now(),
      data: normalizeJwxtTabData(tab, data),
    };
    localStorage.setItem(key, JSON.stringify(envelope));
    return envelope;
  } catch {
    return null;
  }
}

export function isJwxtTabCacheStale(savedAt: number) {
  return !savedAt || Date.now() - savedAt > JWXT_TAB_CACHE_TTL;
}

export function normalizeJwxtTabData(tab: JwxtDataTab, data: any) {
  if (!["grades", "midterm"].includes(tab) || !data?.parsed?.list || !Array.isArray(data.parsed.list)) return data;
  const levelMap: Record<string, number> = {
    优秀: 4.5, 优: 4.5,
    良好: 3.5, 良: 3.5,
    中等: 2.5, 中: 2.5,
    及格: 1.5, 合格: 1.5, 通过: 1.5,
    不及格: 0, 不合格: 0, 不通过: 0, 未通过: 0,
  };
  const scoreToGpa = (score?: string) => {
    const raw = String(score ?? "").trim();
    if (!raw) return undefined;
    const level = raw.replace(/\s+/g, "");
    if (Object.prototype.hasOwnProperty.call(levelMap, level)) return levelMap[level];
    const scoreNum = parseFloat(raw);
    if (!Number.isFinite(scoreNum)) return undefined;
    if (scoreNum < 60) return 0;
    const gpa = (scoreNum - 50) / 10;
    return Math.min(5, Math.max(0, Math.round(gpa * 100) / 100));
  };
  return {
    ...data,
    parsed: {
      ...data.parsed,
      list: data.parsed.list.map((row: any) => {
        const gpa = typeof row.gpa === "number" ? row.gpa : Number(row.gpa);
        return Number.isFinite(gpa) ? { ...row, gpa } : { ...row, gpa: scoreToGpa(row.score) };
      }),
    },
  };
}
