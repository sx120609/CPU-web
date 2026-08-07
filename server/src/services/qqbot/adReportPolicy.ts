export function shouldNotifyQqBotAdReport(hitCount: number, threshold: number) {
  const normalizedHitCount = Math.max(0, Math.floor(Number(hitCount) || 0));
  const normalizedThreshold = Math.max(0, Math.floor(Number(threshold) || 0));
  return normalizedThreshold > 0
    && normalizedHitCount >= normalizedThreshold
    && normalizedHitCount % normalizedThreshold === 0;
}
