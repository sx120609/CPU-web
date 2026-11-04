import { useSiteStore } from "@/stores/site";

/**
 * 写给药大的文字（小游戏名、「药大奶」「药大雷」这类说法）在外校显示成本校的简称。
 * 药大自己原样显示；游戏引擎、测试和调难度脚本里的名字不动，只在显示时换。
 */
export function schoolizeText(text: string, schoolId: string | undefined, shortName: string) {
  if (!schoolId || schoolId === "cpu" || !text) return text;
  return text.replaceAll("药大", shortName);
}

/** 组件里用：返回一个按当前学校换名字的函数。 */
export function useSchoolText() {
  const site = useSiteStore();
  return (text: string) => schoolizeText(text, site.school?.id, site.schoolShortName);
}
