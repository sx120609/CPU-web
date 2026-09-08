import { SCHEDULE_PALETTES, SchedulePalette } from './SchedulePalettes';

export interface ScheduleCourseTone { top: string; bottom: string; border: string; text: string; }

export function schedulePalette(key: string): SchedulePalette {
  return SCHEDULE_PALETTES.find((item: SchedulePalette) => item.key === key) ?? SCHEDULE_PALETTES[8];
}

function byte(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
}

export function mixScheduleColor(first: string, second: string, weight: number): string {
  let result = '#';
  for (let index = 1; index < 7; index += 2) {
    result += byte(parseInt(first.substring(index, index + 2), 16) * weight +
      parseInt(second.substring(index, index + 2), 16) * (1 - weight));
  }
  return result;
}

function hsla(hue: number, saturation: number, lightness: number, alpha: number = 1): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number): number => {
    const k = (offset + hue / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return '#' + byte(alpha * 255) + byte(channel(0)) + byte(channel(8)) + byte(channel(4));
}

export function scheduleCourseTone(name: string, key: string, dark: boolean): ScheduleCourseTone {
  const palette = schedulePalette(key);
  if (key !== 'color-glass') {
    const background = dark ? mixScheduleColor(palette.courseBg, '#101c19', 0.32) : palette.courseBg;
    return { top: background, bottom: background,
      border: dark ? mixScheduleColor(palette.courseBorder, '#ffffff', 0.72) : palette.courseBorder,
      text: dark ? mixScheduleColor(palette.courseText, '#ffffff', 0.22) : palette.courseText };
  }
  // Match getColorGlassCourseTone, including its normalization and unsigned hash.
  let hash = 0;
  const seed = name.trim().replace(/\s+/g, ' ');
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  const hue = hash % 360;
  const saturation = 58 + ((hash >>> 8) % 18);
  if (dark) return {
    top: hsla(hue, Math.min(82, saturation + 4), 34, 0.84),
    bottom: hsla(hue, Math.min(82, saturation + 4), 24, 0.88),
    border: hsla(hue, Math.min(86, saturation + 8), 72, 0.72), text: '#f8fffd'
  };
  const background = hsla(hue, saturation, 89 + ((hash >>> 16) % 5), 0.86);
  return { top: background, bottom: background,
    border: hsla(hue, Math.min(82, saturation + 8), 48 + ((hash >>> 20) % 10), 0.48),
    text: hsla(hue, Math.min(76, saturation + 4), 25 + ((hash >>> 24) % 8)) };
}
