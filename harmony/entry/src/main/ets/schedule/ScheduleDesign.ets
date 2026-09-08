import { mixScheduleColor, schedulePalette } from './ScheduleVisuals';

export interface HarmonyCourseColor {
  fill: string;
  accent: string;
  text: string;
}

const COURSE_ACCENTS: string[] = ['#3C806C', '#4E78AE', '#8B69A4', '#AB7942', '#AD6679', '#47828B'];
const COURSE_LIGHT: string[] = ['#E5F1EC', '#E8EFF9', '#F0EAF6', '#F6EDE2', '#F6E7EC', '#E4F0F2'];
const COURSE_DARK: string[] = ['#203B32', '#24354D', '#372C44', '#423526', '#442D35', '#243C40'];

export function harmonyCourseColor(name: string, theme: string, dark: boolean): HarmonyCourseColor {
  if (theme !== 'color-glass') {
    const palette = schedulePalette(theme);
    return {
      fill: dark ? mixScheduleColor(palette.courseBg, '#15181C', 0.18) : palette.courseBg,
      accent: dark ? mixScheduleColor(palette.accent, '#FFFFFF', 0.4) : palette.accentStrong,
      text: dark ? '#F3F5F7' : '#26332E'
    };
  }
  let hash = 0;
  const seed = name.trim().replace(/\s+/g, ' ');
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  const index = hash % COURSE_ACCENTS.length;
  return { fill: dark ? COURSE_DARK[index] : COURSE_LIGHT[index],
    accent: dark ? mixScheduleColor(COURSE_ACCENTS[index], '#FFFFFF', 0.52) : mixScheduleColor(COURSE_ACCENTS[index], '#17241D', 0.7),
    text: dark ? '#F3F5F7' : '#26332E' };
}
