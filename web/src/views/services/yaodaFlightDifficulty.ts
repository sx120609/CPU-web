export const NJU_FLIGHT_PHYSICS = {
  worldWidth: 420,
  worldHeight: 680,
  groundY: 610,
  playerX: 90,
  playerRadius: 24,
  gravity: 980,
  flapImpulse: -370,
  pipeSpeed: 180,
  pipeSpawnX: 430,
  pipeSpawnIntervalSeconds: 1.7,
  pipeWidth: 68,
  pipeGapMin: 150,
  pipeGapRange: 30,
  pipeVerticalPadding: 60,
  scoreLineX: 66,
} as const;

export type NjuFlightPipeGeometry = {
  gapY: number;
  gapSize: number;
};

function unitInterval(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function njuFlightPipeGeometry(gapRandom: number, positionRandom: number): NjuFlightPipeGeometry {
  const gapSize = NJU_FLIGHT_PHYSICS.pipeGapMin
    + unitInterval(gapRandom) * NJU_FLIGHT_PHYSICS.pipeGapRange;
  const maxTopHeight = NJU_FLIGHT_PHYSICS.groundY
    - gapSize
    - NJU_FLIGHT_PHYSICS.pipeVerticalPadding;
  const topHeight = NJU_FLIGHT_PHYSICS.pipeVerticalPadding
    + unitInterval(positionRandom) * (maxTopHeight - NJU_FLIGHT_PHYSICS.pipeVerticalPadding);
  return { gapY: topHeight + gapSize / 2, gapSize };
}

export function njuCircleIntersectsRect(
  circleX: number,
  circleY: number,
  radius: number,
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
) {
  const nearestX = Math.max(rectX, Math.min(circleX, rectX + rectWidth));
  const nearestY = Math.max(rectY, Math.min(circleY, rectY + rectHeight));
  const deltaX = circleX - nearestX;
  const deltaY = circleY - nearestY;
  const collisionRadius = radius - 3;
  return deltaX * deltaX + deltaY * deltaY < collisionRadius * collisionRadius;
}
