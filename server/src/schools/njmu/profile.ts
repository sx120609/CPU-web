import { SCHOOL_MODULE_KEYS } from "../catalog";
import type { SchoolProfile } from "../registry";

/** 江宁校区作息（正方 kbcx/xskbcx_cxRjc 返回的 19 节）。教务接口取不到时用这一套。 */
const PERIODS: Array<[string, string]> = [
  ["08:00", "08:40"], ["08:50", "09:30"], ["09:40", "10:20"], ["10:30", "11:10"], ["11:20", "12:00"],
  ["12:10", "12:50"], ["14:00", "14:40"], ["14:50", "15:30"], ["15:40", "16:20"], ["16:30", "17:10"],
  ["17:20", "18:00"], ["18:10", "18:50"], ["19:00", "19:40"], ["19:50", "20:30"], ["20:40", "21:20"],
  ["21:30", "22:10"], ["22:20", "22:40"], ["22:50", "23:10"], ["23:10", "23:30"],
];

/**
 * 南京医科大学。名称、品牌名、是否开放以 School 表为准（首次启动写入时默认不开放，平台管理员在后台打开）；
 * 这里是要写代码的部分：教务驱动和统一认证。
 */
export const njmuSchool: SchoolProfile = {
  id: "njmu",
  name: "南京医科大学",
  shortName: "南医",
  brandName: "南医拾间",
  tagline: "",
  enabled: false,
  academicSystem: "zhengfang-v9",
  ssoLogin: true,
  hosts: {
    sso: "authserver.njmu.edu.cn",
    jwxt: "jwpt.njmu.edu.cn",
  },
  // 南医一天 15 节；作息接口多给的第 16–19 节只用来挂未排时间的学时（见 parser.ts 的 ZF_LAST_TEACHING_PERIOD）。
  defaultPeriods: PERIODS.slice(0, 15).map(([start, end], index) => ({ no: index + 1, name: `第${index + 1}节`, start, end })),
  academicViews: ["schedule", "grades", "levelExams", "exams", "progress", "freeRooms"],
  academicPortals: { undergraduate: "https://jwpt.njmu.edu.cn/sso/jzlogin" },
  clientApps: false,
  campuses: ["江宁校区", "五台校区"],
  publicLinks: [
    { name: "图书馆", icon: "course", url: "https://lib.njmu.edu.cn" },
    { name: "教务处", icon: "document", url: "https://jxglc.njmu.edu.cn" },
    { name: "学校官网", icon: "announcement", url: "https://www.njmu.edu.cn" },
  ],
  defaultModules: SCHOOL_MODULE_KEYS,
};
