import { watch } from "vue";
import { useRoute } from "vue-router";

// 与服务端 server/src/services/seo.ts 的标题格式一致：搜索引擎渲染页面后看到的标题和首屏 HTML 相同。
export const SITE_NAME = "药大拾间";
export const SITE_HOME_TITLE = "药大拾间 · 中国药科大学校园互助与服务平台";

export function setDocumentTitle(title?: string | null) {
  const text = String(title || "").trim();
  document.title = text ? `${text} · ${SITE_NAME}` : SITE_HOME_TITLE;
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
