import { SCHOOL_MODULE_KEYS } from "../catalog";
import type { SchoolProfile } from "../registry";

/** 仙林校区作息（树维课表布局「仙林课表布局」的 12 节）。教务接口取不到时用这一套。 */
const PERIODS: Array<[string, string]> = [
  ["08:20", "09:00"], ["09:10", "09:50"], ["10:00", "10:40"], ["10:50", "11:30"], ["11:40", "12:20"],
  ["14:00", "14:40"], ["14:50", "15:30"], ["15:40", "16:20"], ["16:30", "17:10"],
  ["18:30", "19:10"], ["19:20", "20:00"], ["20:10", "20:50"],
];

/**
 * 南京中医药大学。名称、品牌名、是否开放以 School 表为准（首次启动写入时默认不开放，平台管理员在后台打开）；
 * 这里是要写代码的部分：教务驱动和统一认证。
 */
export const njucmSchool: SchoolProfile = {
  id: "njucm",
  name: "南京中医药大学",
  shortName: "南中医",
  brandName: "南中医拾间",
  tagline: "",
  enabled: false,
  academicSystem: "shuwei-eams",
  ssoLogin: true,
  hosts: {
    sso: "ids.njucm.edu.cn",
    jwxt: "jwgl.njucm.edu.cn",
  },
  defaultPeriods: PERIODS.map(([start, end], index) => ({ no: index + 1, name: `第${index + 1}节`, start, end })),
  academicViews: ["schedule", "grades", "levelExams", "exams", "progress", "freeRooms"],
  academicPortals: { undergraduate: "https://jwgl.njucm.edu.cn/student/sso/login" },
  clientApps: false,
  campuses: ["仙林校区", "汉中门校区"],
  publicLinks: [
    { name: "教务处", icon: "document", url: "https://jwc.njucm.edu.cn" },
    { name: "学校官网", icon: "school", url: "https://www.njucm.edu.cn" },
    { name: "新闻网", icon: "announcement", url: "https://xyw.njucm.edu.cn" },
  ],
  defaultModules: SCHOOL_MODULE_KEYS,
};
