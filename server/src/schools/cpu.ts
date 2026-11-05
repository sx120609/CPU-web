import { SCHOOL_MODULE_KEYS } from "./catalog";
import type { SchoolProfile } from "./registry";

export const cpuSchool: SchoolProfile = {
  id: "cpu",
  name: "中国药科大学",
  shortName: "药大",
  brandName: "药大拾间",
  tagline: "CPU 校园互助服务",
  enabled: true,
  academicSystem: "qiangzhi-jsxsd",
  ssoLogin: true,
  hosts: {
    sso: "id.cpu.edu.cn",
    jwxt: "jsxsd.cpu.edu.cn",
    graduate: "ygl.cpu.edu.cn",
    ecert: "dzpzstu.cpu.edu.cn",
    portal: "i.cpu.edu.cn",
  },
  defaultPeriods: [
    { no: 1, name: "第1节", start: "08:00", end: "08:45" },
    { no: 2, name: "第2节", start: "08:55", end: "09:40" },
    { no: 3, name: "第3节", start: "09:55", end: "10:40" },
    { no: 4, name: "第4节", start: "10:50", end: "11:35" },
    { no: 5, name: "第5节", start: "13:30", end: "14:15" },
    { no: 6, name: "第6节", start: "14:25", end: "15:10" },
    { no: 7, name: "第7节", start: "15:25", end: "16:10" },
    { no: 8, name: "第8节", start: "16:20", end: "17:05" },
    { no: 9, name: "第9节", start: "18:30", end: "19:15" },
    { no: 10, name: "第10节", start: "19:25", end: "20:10" },
    { no: 11, name: "第11节", start: "20:20", end: "21:05" },
    { no: 12, name: "第12节", start: "21:15", end: "22:00" },
  ],
  // 药大教务的考试接口各学期都是空的，不列考试安排。
  academicViews: [
    "schedule", "grades", "levelExams", "transcript", "progress", "graduationAudit", "retake", "studentStatus",
    "pyfa", "selection", "freeRooms", "timetableSearch",
  ],
  academicPortals: {
    undergraduate: "https://jwxt.cpu.edu.cn/jsxsd/sso.jsp",
    graduate: "http://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk",
  },
  clientApps: true,
  campuses: ["江宁校区", "玄武门校区"],
  userGroup: { qq: "704825850", joinUrl: "https://qm.qq.com/q/oVRbeagLXq" },
  publicLinks: [
    { name: "图书馆", icon: "course", url: "http://lib.cpu.edu.cn" },
    { name: "馆藏检索", icon: "search", url: "http://opac.cpu.edu.cn" },
    { name: "融合门户", icon: "school", url: "https://i.cpu.edu.cn" },
    { name: "教务处", icon: "document", url: "http://jwc.cpu.edu.cn" },
    { name: "校园新闻", icon: "announcement", url: "http://news.cpu.edu.cn" },
    { name: "就业平台", icon: "work", url: "https://cpu.91job.org.cn/sub-station/home/10316" },
  ],
  defaultModules: SCHOOL_MODULE_KEYS,
};
