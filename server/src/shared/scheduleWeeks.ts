export interface CourseWeekLike {
  weeks?: string;
  weekList?: number[];
}

export function parseWeekText(text?: string | null): number[] {
  const source = normalizeWeekText(text);
  if (!source) return [];
  const out = new Set<number>();
  const clauses = source.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean);

  for (const clause of clauses.length ? clauses : [source]) {
    const kind = parseWeekKind(clause);
    const matches = [...clause.matchAll(/(\d{1,2})\s*(?:[-~至到]\s*(\d{1,2}))?/g)];
    for (const match of matches) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const min = Math.max(1, Math.min(start, end));
      const max = Math.min(64, Math.max(start, end));
      for (let i = min; i <= max; i++) {
        if (kind === "odd" && i % 2 === 0) continue;
        if (kind === "even" && i % 2 === 1) continue;
        out.add(i);
      }
    }
  }

  return [...out].sort((a, b) => a - b);
}

export function normalizedCourseWeekList(course: CourseWeekLike): number[] {
  const parsed = parseWeekText(course.weeks);
  if (parsed.length) return parsed;
  return Array.isArray(course.weekList)
    ? [...new Set(course.weekList.map(Number).filter((week) => Number.isFinite(week) && week > 0))]
      .sort((a, b) => a - b)
    : [];
}

export function courseMatchesWeek(course: CourseWeekLike, week: number) {
  if (!week) return true;
  const list = normalizedCourseWeekList(course);
  return list.length ? list.includes(week) : true;
}

function normalizeWeekText(text?: string | null) {
  return String(text ?? "")
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[－–—~～]/g, "-")
    .replace(/第/g, "")
    .replace(/\s+/g, "");
}

function parseWeekKind(text: string): "all" | "odd" | "even" {
  if (/单双周/.test(text)) return "all";
  if (/单周|\(单\)|[^双]单/.test(text)) return "odd";
  if (/双周|\(双\)|双/.test(text)) return "even";
  return "all";
}
