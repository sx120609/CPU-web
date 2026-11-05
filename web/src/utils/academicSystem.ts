import { computed } from "vue";
import { useSiteStore } from "@/stores/site";

/**
 * 当前学校接的是外校教务（南医正方、南中医树维）。外校接了课表、成绩、考试、等级考试、学业完成情况和空教室；
 * 成绩单、毕业审核、重修、学籍、选课、课表检索、培养方案是药大教务独有的。
 */
export function isExternalAcademicSystem(kind: string | null | undefined) {
  return Boolean(kind) && kind !== "qiangzhi-jsxsd";
}

export function useExternalAcademic() {
  const site = useSiteStore();
  return computed(() => isExternalAcademicSystem(site.school?.academicSystem));
}

/** 外校教务原站入口（从统一认证换票进去）。 */
export const EXTERNAL_ACADEMIC_LINKS: Record<string, string> = {
  "zhengfang-v9": "https://jwpt.njmu.edu.cn/sso/jzlogin",
  "shuwei-eams": "https://jwgl.njucm.edu.cn/student/sso/login",
};
