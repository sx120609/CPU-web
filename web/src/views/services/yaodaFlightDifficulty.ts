export type YaodaFlightDifficulty = {
  speed: number;
  gapSize: number;
  spacing: number;
  gravity: number;
};

export type YaodaFlightPipeGeometry = Pick<YaodaFlightDifficulty, "gapSize" | "spacing">;

const PIPE_VARIATIONS: readonly YaodaFlightPipeGeometry[] = [
  { gapSize: 6, spacing: 7 },
  { gapSize: 2, spacing: -3 },
  { gapSize: -3, spacing: 8 },
  { gapSize: 8, spacing: 0 },
  { gapSize: 0, spacing: 10 },
  { gapSize: 3, spacing: -4 },
  { gapSize: -4, spacing: 6 },
  { gapSize: 5, spacing: 2 },
];

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
      speed: 150 + 12 * progress,
      gapSize: 168 - 12 * progress,
      spacing: 210 - 10 * progress,
      gravity: 1060 + 50 * progress,
    };
  }
  return { speed: 164, gapSize: 154, spacing: 198, gravity: 1120 };
}

export function flightSpeed(currentScore: number, elapsedSeconds: number): number {
  const difficulty = flightDifficulty(currentScore);
  const safeElapsed = Math.max(0, elapsedSeconds);
  const stageProgress = Math.min(Math.max(currentScore, 0), 15) / 15;
  const intensity = 0.018 + 0.017 * stageProgress;
  const wave = Math.sin(safeElapsed * 0.82) * 0.7 + Math.sin(safeElapsed * 0.37 + 0.8) * 0.3;
  return difficulty.speed * (1 + wave * intensity);
}

export function flightPipeGeometry(currentScore: number, pipeIndex: number): YaodaFlightPipeGeometry {
  const difficulty = flightDifficulty(currentScore);
  const variationIndex = Math.abs(Math.trunc(pipeIndex)) % PIPE_VARIATIONS.length;
  const variation = PIPE_VARIATIONS[variationIndex];
  return {
    gapSize: Math.max(150, difficulty.gapSize + variation.gapSize),
    spacing: Math.max(194, difficulty.spacing + variation.spacing),
  };
}
