import { SCHOOL_MODULE_KEYS } from "./catalog";
import type { SchoolProfile } from "./registry";

export const cpuSchool: SchoolProfile = {
  id: "cpu",
  name: "中国药科大学",
  shortName: "药大",
  brandName: "药大拾间",
  academicSystem: "qiangzhi-jsxsd",
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
  defaultModules: SCHOOL_MODULE_KEYS,
};
