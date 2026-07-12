export interface SchoolCalendarTerm {
  name: string;
  weeks: number;
  start: string;
  end: string;
  tone: "teaching" | "holiday" | "exam";
}

export interface SchoolCalendarEvent {
  title: string;
  date: string;
  endDate?: string;
  description?: string;
  tone?: "primary" | "warning" | "danger" | "muted";
}

export const cpuSchoolCalendar = {
  title: "中国药科大学校历",
  academicYear: "2026-2027学年",
  publishedAt: "2026-06-13",
  sourcePage: "https://jwc.cpu.edu.cn/ae/d6/c867a241366/page.htm",
  sourceList: "https://jwc.cpu.edu.cn/867/list.htm",
  officialPdf: "https://jwc.cpu.edu.cn/_upload/article/files/0d/92/1286158f46079183e10cc7969157/e8dc990c-0cb6-452b-a29b-71815512857f.pdf",
  terms: [
    {
      name: "上学期",
      weeks: 20,
      start: "2026-08-31",
      end: "2027-01-17",
      tone: "teaching",
    },
    {
      name: "寒假",
      weeks: 5,
      start: "2027-01-18",
      end: "2027-02-21",
      tone: "holiday",
    },
    {
      name: "下学期",
      weeks: 19,
      start: "2027-02-22",
      end: "2027-07-04",
      tone: "teaching",
    },
    {
      name: "暑假",
      weeks: 7,
      start: "2027-07-05",
      end: "2027-08-22",
      tone: "holiday",
    },
  ] satisfies SchoolCalendarTerm[],
  events: [
    {
      title: "二、三、四年级上课",
      date: "2026-08-31",
      tone: "primary",
    },
    {
      title: "新生报到",
      date: "2026-09-03",
      tone: "warning",
    },
    {
      title: "新生军训",
      date: "2026-09-05",
      endDate: "2026-09-24",
      description: "新生上课前集中军训",
      tone: "warning",
    },
    {
      title: "新生上课",
      date: "2026-09-28",
      tone: "primary",
    },
    {
      title: "校运动会",
      date: "2026-10-23",
      endDate: "2026-10-24",
      description: "第8周星期五、星期六",
      tone: "danger",
    },
    {
      title: "春节",
      date: "2027-02-06",
      tone: "danger",
    },
    {
      title: "下学期开学",
      date: "2027-02-22",
      tone: "primary",
    },
  ] satisfies SchoolCalendarEvent[],
};
