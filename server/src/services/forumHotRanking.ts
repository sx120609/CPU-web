const HOUR_MS = 60 * 60 * 1000;

export const HOT_TOPIC_PRIMARY_WINDOW_MS = 24 * HOUR_MS;
export const HOT_TOPIC_FALLBACK_WINDOW_MS = 72 * HOUR_MS;
export const HOT_TOPIC_SCORE_HALF_LIFE_MS = 12 * HOUR_MS;

type HotTopicCandidate = {
  id?: number;
  createdAt: Date | string;
  likeCount?: number | null;
  replyCount?: number | null;
  viewCount?: number | null;
};

function publishedAtMs(topic: HotTopicCandidate) {
  const value = new Date(topic.createdAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function hotTopicPublicationTier(topic: HotTopicCandidate, nowMs = Date.now()) {
  const ageMs = Math.max(0, nowMs - publishedAtMs(topic));
  if (ageMs <= HOT_TOPIC_PRIMARY_WINDOW_MS) return 0;
  if (ageMs <= HOT_TOPIC_FALLBACK_WINDOW_MS) return 1;
  return 2;
}

export function computeHotScore(topic: HotTopicCandidate, nowMs = Date.now()) {
  const raw = (topic.likeCount ?? 0) * 5
    + (topic.replyCount ?? 0) * 3
    + (topic.viewCount ?? 0) * 0.03;
  const ageMs = Math.max(0, nowMs - publishedAtMs(topic));
  const freshness = 2 ** (-ageMs / HOT_TOPIC_SCORE_HALF_LIFE_MS);
  return raw * freshness;
}

export function rankHotTopics<T extends HotTopicCandidate>(topics: T[], size: number, nowMs = Date.now()) {
  return topics
    .filter((topic) => hotTopicPublicationTier(topic, nowMs) < 2)
    .sort((a, b) => {
      const tierDifference = hotTopicPublicationTier(a, nowMs) - hotTopicPublicationTier(b, nowMs);
      if (tierDifference) return tierDifference;
      const scoreDifference = computeHotScore(b, nowMs) - computeHotScore(a, nowMs);
      if (scoreDifference) return scoreDifference;
      const publishedDifference = publishedAtMs(b) - publishedAtMs(a);
      if (publishedDifference) return publishedDifference;
      return Number(b.id ?? 0) - Number(a.id ?? 0);
    })
    .slice(0, Math.max(0, size));
}
