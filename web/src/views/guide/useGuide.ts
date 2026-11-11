import { computed, onMounted, ref } from "vue";
import { toolsApi, type ToolMeta } from "@/api/tools";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import {
  hidesClientDownloads,
  hidesNativeCommerce,
  isAndroidNextApp,
  isHarmonyNativeApp,
  isIosNativeApp,
  shouldHideHarmonyAssistant,
  shouldHideNativeMiniGames,
} from "@/utils/clientInfo";
import { schoolizeText } from "@/utils/schoolText";
import { guideChapters, guideGroups } from "./chapters";
import type { GuideChapter, GuideLink, GuideNeeds, GuideTopic } from "./types";

export interface GuideSearchHit {
  chapter: GuideChapter;
  topic: GuideTopic | null;
}

// 教程只列当前这位同学用得上的内容：本校没开的功能、后台关掉的入口、
// 这个客户端里按上架规则不出现的东西，整章或整条不显示。
export function useGuide() {
  const site = useSiteStore();
  const auth = useAuthStore();
  const hiddenTools = ref(new Set<string>());

  onMounted(async () => {
    if (!site.loaded) void site.fetch();
    try {
      const metas: ToolMeta[] = await toolsApi.tools({ suppressErrorMessage: true });
      hiddenTools.value = new Set(metas.filter((item) => item.isVisible === false).map((item) => item.code));
    } catch {
      /* 拿不到工具配置时按学校档案显示 */
    }
  });

  /** 上架的 iOS、鸿蒙 App 里只讲自己这个客户端。 */
  function clientAllowed(client: NonNullable<GuideNeeds["client"]>) {
    if (!site.clientAppsAvailable) return false;
    if (client === "any") return true;
    // NEXT 是邀请制的测试版，只在它自己里面讲。
    if (client === "next") return isAndroidNextApp();
    if (isHarmonyNativeApp()) return client === "harmony";
    if (isIosNativeApp()) return client === "ios";
    return true;
  }

  function shelfAllowed(shelf: NonNullable<GuideNeeds["shelf"]>) {
    const username = auth.user?.username;
    if (shelf === "forum") return !auth.forumHidden;
    if (shelf === "miniGames") return !shouldHideNativeMiniGames(auth.isLoggedIn, username);
    if (shelf === "assistant") return !shouldHideHarmonyAssistant(auth.isLoggedIn, username);
    if (shelf === "downloads") return !hidesClientDownloads();
    return !hidesNativeCommerce();
  }

  function allowed(needs: GuideNeeds | undefined) {
    if (!needs) return true;
    if (needs.path && !site.pathEnabled(needs.path)) return false;
    if (needs.tool && (!site.toolEnabled(needs.tool) || hiddenTools.value.has(needs.tool))) return false;
    if (needs.feature && !site.features[needs.feature]) return false;
    if (needs.client && !clientAllowed(needs.client)) return false;
    if (needs.shelf && !shelfAllowed(needs.shelf)) return false;
    return true;
  }

  /** 教程按默认学校的叫法写；别的学校换成本校的品牌名和简称。 */
  function text(value: string) {
    if (site.isDefaultSchool || !value) return value;
    return schoolizeText(value.replaceAll("药大拾间", site.brandName), false, site.schoolShortName);
  }

  function localizeLink(link: GuideLink | undefined) {
    return link ? { ...link, label: text(link.label) } : undefined;
  }

  const chapters = computed<GuideChapter[]>(() => guideChapters
    .filter((chapter) => allowed(chapter.needs))
    .map((chapter) => ({
      ...chapter,
      title: text(chapter.title),
      summary: text(chapter.summary),
      intro: chapter.intro?.map(text),
      entry: localizeLink(chapter.entry),
      topics: chapter.topics.filter((topic) => allowed(topic.needs)).map((topic) => ({
        ...topic,
        title: text(topic.title),
        body: topic.body?.map(text),
        steps: topic.steps?.map(text),
        tips: topic.tips?.map(text),
        link: localizeLink(topic.link),
      })),
    }))
    .filter((chapter) => chapter.topics.length > 0));

  const groups = computed(() => guideGroups
    .map((title) => ({ title, chapters: chapters.value.filter((chapter) => chapter.group === title) }))
    .filter((group) => group.chapters.length > 0));

  /** 站点信息到之前功能开关都按关着算，这时还不能断定某一章不存在。 */
  const settled = computed(() => site.loaded);

  function search(keyword: string): GuideSearchHit[] {
    const words = keyword.trim().toLowerCase().split(/\s+/u).filter(Boolean);
    if (!words.length) return [];
    const matches = (parts: Array<string | undefined>) => {
      const haystack = parts.filter(Boolean).join("\n").toLowerCase();
      return words.every((word) => haystack.includes(word));
    };
    const hits: GuideSearchHit[] = [];
    for (const chapter of chapters.value) {
      if (matches([chapter.title, chapter.summary, ...(chapter.keywords ?? [])])) hits.push({ chapter, topic: null });
      for (const topic of chapter.topics) {
        if (matches([topic.title, ...(topic.body ?? []), ...(topic.steps ?? []), ...(topic.tips ?? [])])) hits.push({ chapter, topic });
      }
    }
    return hits;
  }

  return { chapters, groups, settled, search };
}
