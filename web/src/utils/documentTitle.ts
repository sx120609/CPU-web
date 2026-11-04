import { watch } from "vue";
import { useRoute } from "vue-router";

// 与服务端 server/src/services/seo.ts 的标题格式一致：搜索引擎渲染页面后看到的标题和首屏 HTML 相同。
// 默认学校的品牌；学校信息拉到后换成当前学校的品牌名。
let siteName = "药大拾间";
let homeTitle = "药大拾间 · 中国药科大学校园互助与服务平台";
let lastTitle: string | null = null;
/** 外校时把页面名里写给药大的说法（「药大人能飞」）换成本校简称；默认学校为空。 */
let localShortName = "";

function localizeTitle(title: string) {
  return localShortName ? title.replaceAll("药大", localShortName) : title;
}

export function setDocumentTitle(title?: string | null) {
  lastTitle = localizeTitle(String(title || "").trim()) || null;
  document.title = lastTitle ? `${lastTitle} · ${siteName}` : homeTitle;
}

/** 当前学校的品牌名（例如「南医拾间」），给导出文件名、分享文案这类不在组件里的地方用。 */
export function currentBrandName() {
  return siteName;
}

/** 当前学校的品牌名和学校全称，用来拼页面标题；换学校后当前页的标题立即跟着变。 */
export function setDocumentBrand(brandName: string, schoolName: string, shortName = "", isDefaultSchool = true) {
  siteName = brandName;
  localShortName = isDefaultSchool ? "" : shortName;
  homeTitle = `${brandName} · ${schoolName}校园互助与服务平台`;
  if (typeof document !== "undefined") document.title = lastTitle ? `${lastTitle} · ${siteName}` : homeTitle;
}

/** 详情页（帖子、板块、作品）数据到了以后用内容自己的名字做标题；只在本页路由时生效，缓存的页面不会改别人的标题。 */
export function useDocumentTitle(source: () => string | null | undefined) {
  const route = useRoute();
  const ownRoute = route.name;
  watch([source, () => route.name], ([title, name]) => {
    if (name !== ownRoute) return;
    const text = String(title || "").trim();
    if (text) setDocumentTitle(text);
  }, { immediate: true });
}
