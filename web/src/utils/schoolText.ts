import { useSiteStore } from "@/stores/site";

/**
 * 写给药大的文字（小游戏名、「药大奶」「药大雷」这类说法）在外校显示成本校的简称。
 * 药大自己原样显示；游戏引擎、测试和调难度脚本里的名字不动，只在显示时换。
 */
export function schoolizeText(text: string, schoolId: string | undefined, shortName: string) {
  if (!schoolId || schoolId === "cpu" || !text) return text;
  return text.replaceAll("药大", shortName);
}

/**
 * 协议、隐私政策这类静态页（public/*.html）按学校显示：标了 data-school-only 的段落只留给对应学校，
 * 「药大拾间」「中国药科大学」换成本校品牌和校名。启动脚本 appearance-bootstrap.js 对独立打开的页面做同样的事。
 */
export function localizeSchoolDocument(root: ParentNode, school: { id?: string; brandName: string; schoolName: string }) {
  if (!school.id) return;
  for (const element of Array.from(root.querySelectorAll("[data-school-only]"))) {
    if (element.getAttribute("data-school-only") === school.id) element.removeAttribute("hidden");
    else element.remove();
  }
  if (school.id === "cpu") return;
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  if (!ownerDocument) return;
  const walker = ownerDocument.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue || "";
    if (!text.includes("药大拾间") && !text.includes("中国药科大学")) continue;
    node.nodeValue = text.replaceAll("药大拾间", school.brandName).replaceAll("中国药科大学", school.schoolName || "本校");
  }
}

/** 组件里用：返回一个按当前学校换名字的函数。 */
export function useSchoolText() {
  const site = useSiteStore();
  return (text: string) => schoolizeText(text, site.school?.id, site.schoolShortName);
}
