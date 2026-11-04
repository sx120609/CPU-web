import { computed } from "vue";
import { useSiteStore } from "@/stores/site";

/**
 * 当前学校的教务是正方（南医）。正方接了课表、成绩、考试、等级考试、学业体检和空教室；
 * 成绩单、毕业审核、重修、学籍、选课、课表检索、培养方案是药大教务独有的。
 */
export function useZhengfangAcademic() {
  const site = useSiteStore();
  return computed(() => site.school?.academicSystem === "zhengfang-v9");
}
