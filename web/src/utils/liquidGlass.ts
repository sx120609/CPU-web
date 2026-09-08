// Adapted from compose-miuix-ui/miuix (Apache-2.0), afedba04ab8855cdd207be81d5282de5d604325c.
// Copyright 2026, compose-miuix-ui contributors. See public/licenses/miuix/NOTICE.txt.

export interface SpringState { value: number; velocity: number }

export function stepSpring(state: SpringState, target: number, dt: number, stiffness: number, damping: number): SpringState {
  const omega = Math.sqrt(stiffness);
  const offset = state.value - target;
  if (damping === 1) {
    const decay = Math.exp(-omega * dt);
    const slope = state.velocity + omega * offset;
    return {
      value: target + (offset + slope * dt) * decay,
      velocity: (state.velocity - omega * slope * dt) * decay,
    };
  }
  const damped = omega * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * omega * dt);
  const a = offset;
  const b = (state.velocity + damping * omega * offset) / damped;
  const cos = Math.cos(damped * dt);
  const sin = Math.sin(damped * dt);
  return {
    value: target + decay * (a * cos + b * sin),
    velocity: decay * ((b * damped - damping * omega * a) * cos - (a * damped + damping * omega * b) * sin),
  };
}

// Miuix Lens.kt: circleMap + rounded-rectangle SDF gradient, sampling inward at the rim.
export function lensOffset(x: number, y: number, width: number, height: number, rim: number, amount: number, depth = false) {
  const halfX = width / 2;
  const halfY = height / 2;
  const radius = Math.min(halfX, halfY);
  const px = x - halfX;
  const py = y - halfY;
  const qx = Math.abs(px) - halfX + radius;
  const qy = Math.abs(py) - halfY + radius;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const length = Math.hypot(ox, oy);
  const sd = length - radius + Math.min(Math.max(qx, qy), 0);
  if (rim <= 0 || -sd >= rim) return { x: 0, y: 0 };
  let gx = length ? Math.sign(px) * ox / length : 0;
  let gy = length ? Math.sign(py) * oy / length : Math.sign(py);
  if (depth) {
    const centerLength = Math.hypot(px, py) || 1;
    gx += px / centerLength;
    gy += py / centerLength;
  }
  const gradientLength = Math.hypot(gx, gy) || 1;
  const t = Math.max(0, Math.min(1, 1 + Math.min(sd, 0) / rim));
  const distance = -(1 - Math.sqrt(1 - t * t)) * amount;
  return { x: distance * gx / gradientLength, y: distance * gy / gradientLength };
}

export function createLensMap(width: number, height: number, rim: number, amount: number, depth = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = lensOffset(x + 0.5, y + 0.5, width, height, rim, amount, depth);
      const i = (y * width + x) * 4;
      pixels.data[i] = 127.5 + offset.x / 48 * 255;
      pixels.data[i + 1] = 127.5 + offset.y / 48 * 255;
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}
