export type YaodaFlightDifficulty = {
  speed: number;
  gapSize: number;
  spacing: number;
  gravity: number;
};

export function flightDifficulty(currentScore: number): YaodaFlightDifficulty {
  const stageScore = Math.max(0, currentScore);
  if (stageScore <= 2) {
    const progress = stageScore / 2;
    return {
      speed: 116 + 7 * progress,
      gapSize: 210 - 10 * progress,
      spacing: 242 - 8 * progress,
      gravity: 930 + 40 * progress,
    };
  }
  if (stageScore <= 6) {
    const progress = (stageScore - 3) / 3;
    return {
      speed: 128 + 10 * progress,
      gapSize: 194 - 12 * progress,
      spacing: 226 - 10 * progress,
      gravity: 990 + 45 * progress,
    };
  }
  if (stageScore <= 14) {
    const progress = (stageScore - 7) / 7;
    return {
      speed: 152 + 12 * progress,
      gapSize: 164 - 12 * progress,
      spacing: 207 - 12 * progress,
      gravity: 1070 + 50 * progress,
    };
  }
  return { speed: 172, gapSize: 146, spacing: 190, gravity: 1140 };
}
