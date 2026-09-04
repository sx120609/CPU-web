import { ref } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import type { NavigationGuard } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import type { FeatureKey } from "@/api/site";
import { isLikelyIosDevice } from "@/utils/clientInfo";
import { preloadScheduleBackgroundAsset } from "@/utils/scheduleBackgroundStorage";

const MainLayout = () => import("@/layouts/MainLayout.vue");
export const loadHomeView = () => import("@/views/Home.vue");
export const loadServicesView = () => import("@/views/services/Index.vue");
export const loadProfileView = () => import("@/views/profile/Index.vue");
export const loadJwxtView = () => import("@/views/jwxt/Index.vue");
export const loadScheduleView = async () => {
  const [view] = await Promise.all([
    import("@/views/Schedule.vue"),
    preloadScheduleBackgroundAsset().catch(() => null),
  ]);
  return view;
};

let primaryViewsPreload: Promise<unknown> | null = null;
export function preloadPrimaryViews() {
  if (!primaryViewsPreload) {
    primaryViewsPreload = Promise.allSettled([
      loadHomeView(),
      loadServicesView(),
      loadProfileView(),
    ]);
  }
  return primaryViewsPreload;
}

let educationViewsPreload: Promise<unknown> | null = null;
export function preloadEducationViews() {
  if (!educationViewsPreload) {
    educationViewsPreload = Promise.allSettled([loadJwxtView(), loadScheduleView()]);
  }
  return educationViewsPreload;
}

const CACHE_FIRST_EDUCATION_ROUTES = new Set(["jwxt", "schedule"]);
// MainLayout 的 out-in 页面淡出为 150ms。等旧页面退出后再改变滚动位置，
// 避免旧页面在切换到二级路由前先闪现回到顶部。
const ROUTE_LEAVE_SCROLL_DELAY_MS = 170;

function usesImmediateIosScroll() {
  return typeof navigator !== "undefined" && isLikelyIosDevice();
}

// iOS 的浏览器/原生壳已经为历史遍历提供手势反馈。只在站内向前导航时
// 播放网页入场动画，返回时让系统动画直接交接到最终页面。
export const iosRouteTransitionEnabled = ref(true);
let iosHistoryTraversalPending = false;
if (typeof window !== "undefined" && usesImmediateIosScroll()) {
  window.addEventListener("popstate", () => {
    iosHistoryTraversalPending = true;
  }, { capture: true });
}

/**
 * 受功能开关控制的路由名 → feature key。
 * 动态板块 / 帖子详情由服务端根据所属板块类型继续拦截，避免直接输入 URL 绕过。
 */
const FEATURE_GATED: Record<string, FeatureKey> = {
  forum: "forum",
  "forum-hot": "forum",
  "forum-latest": "forum",
  post: "forum",
  "edit-post": "forum",
  market: "market",
  coursereview: "coursereview",
  course: "coursereview",
};

const LEGACY_FILE_COLLECTION_SUBMIT_PREFIX = "/services/tools/file-collections/";
const BlankRouteView = { render: () => null };

function firstRouteValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function mobileForumFeedRedirect(channel?: "hot"): NavigationGuard {
  return (to) => {
    const mobile = typeof window !== "undefined" && (window.matchMedia?.("(max-width: 768px)").matches ?? window.innerWidth <= 768);
    if (!mobile) return true;
    const query = { ...to.query };
    if (channel) query.channel = channel;
    return { name: "forum", query };
  };
}

function mobileMarketBoardRedirect(to: Parameters<NavigationGuard>[0]) {
  const mobile = typeof window !== "undefined" && (window.matchMedia?.("(max-width: 768px)").matches ?? window.innerWidth <= 768);
  if (!mobile) return true;
  return { name: "forum", query: { ...to.query, channel: "market" } };
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    const position = savedPosition
      ? savedPosition
      : to.hash
        ? { el: to.hash, behavior: "smooth" as const }
        : { top: 0 };

    // 首次加载没有正在淡出的旧页面，可以立即定位。
    // iOS WebKit（Safari、主屏幕网页和原生壳）不对路由组件执行 out-in 淡出。
    // 立即滚动可确保新页面首帧就在正确位置，也不会牵动仍在离场的旧页面。
    if (!from.name || usesImmediateIosScroll()) return position;

    return new Promise((resolve) => {
      window.setTimeout(() => resolve(position), ROUTE_LEAVE_SCROLL_DELAY_MS);
    });
  },
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/Login.vue"), meta: { public: true, title: "登录" } },
    { path: "/register", name: "register", component: () => import("@/views/Register.vue"), meta: { public: true, title: "注册" } },
    {
      path: "/",
      component: MainLayout,
      redirect: "/home",
      children: [
        { path: "home", name: "home", component: loadHomeView, meta: { title: "首页", public: true } },
        { path: "forum", name: "forum", component: () => import("@/views/forum/Index.vue"), meta: { title: "论坛", public: true } },
        { path: "forum/hot", name: "forum-hot", component: () => import("@/views/forum/Feed.vue"), beforeEnter: mobileForumFeedRedirect("hot"), meta: { title: "热榜", public: true } },
        { path: "forum/latest", name: "forum-latest", component: () => import("@/views/forum/Feed.vue"), beforeEnter: mobileForumFeedRedirect(), meta: { title: "最新内容", public: true } },
        { path: "forum/b/market", name: "market", component: () => import("@/views/forum/Board.vue"), beforeEnter: mobileMarketBoardRedirect, meta: { title: "二手交流", public: true } },
        { path: "forum/b/:slug", name: "board", component: () => import("@/views/forum/Board.vue"), meta: { title: "板块", public: true } },
        { path: "forum/topic/:id", name: "topic", component: () => import("@/views/forum/Topic.vue"), meta: { title: "帖子", public: true } },
        { path: "post", name: "post", component: () => import("@/views/forum/Post.vue"), meta: { title: "发帖" } },
        { path: "post/:id/edit", name: "edit-post", component: () => import("@/views/forum/Post.vue"), meta: { title: "编辑帖子" } },
        { path: "market", redirect: { name: "market" } },
        { path: "market/publish", redirect: { path: "/post", query: { board: "market", kind: "sell" } } },
        { path: "market/item/:id/edit", redirect: { name: "market" } },
        { path: "market/item/:id", redirect: { name: "market" } },
        { path: "market/mine", redirect: { name: "market" } },
        { path: "market/seller", redirect: { name: "market" } },
        { path: "market/messages", redirect: { name: "market" } },
        { path: "lost-found", name: "lost-found", component: () => import("@/views/lostFound/Index.vue"), meta: { title: "失物招领", public: true } },
        { path: "coursereview", name: "coursereview", component: () => import("@/views/coursereview/Index.vue"), meta: { title: "课程点评", public: true } },
        { path: "coursereview/:id", name: "course", component: () => import("@/views/coursereview/Course.vue"), meta: { title: "课程", public: true } },
        { path: "services", name: "services", component: loadServicesView, meta: { title: "校园服务", public: true } },
        { path: "services/tools", name: "service-tools", component: () => import("@/views/services/Tools.vue"), meta: { title: "校园小工具", public: true } },
        { path: "services/tools/voicehub", name: "service-voicehub", component: () => import("@/views/services/VoiceHubLaunch.vue"), meta: { title: "药苑之声", public: true, fullWidthContent: true } },
        { path: "services/tools/manage", name: "service-tools-manage", component: () => import("@/views/services/ToolManage.vue"), meta: { title: "小工具管理" } },
        { path: "services/tools/qqbot-reminders", redirect: "/messages/qqbot-reminders" },
        { path: "services/tools/filestore", name: "service-filestore", component: () => import("@/views/services/FileStore.vue"), meta: { title: "文件收集", fullWidthContent: true } },
        { path: "services/tools/filestore/submit/:slug", name: "service-filestore-submit", component: () => import("@/views/services/FileStoreSubmit.vue"), meta: { title: "文件提交", public: true, fullWidthContent: true } },
        { path: "services/tools/filestore/status/:slug", name: "service-filestore-status", component: () => import("@/views/services/FileStoreStatus.vue"), meta: { title: "成功名单", public: true, fullWidthContent: true } },
        { path: "services/tools/filestore-beta", redirect: "/services/tools/filestore" },
        { path: "services/tools/filestore-beta/submit/:slug", redirect: (to) => ({ name: "service-filestore-submit", params: { slug: to.params.slug } }) },
        { path: "services/tools/filestore-beta/status/:slug", redirect: (to) => ({ name: "service-filestore-status", params: { slug: to.params.slug } }) },
        { path: "services/tools/:slug", name: "service-tool-detail", component: () => import("@/views/services/ToolDetail.vue"), meta: { title: "校园小工具", public: true } },
        { path: "services/tools/questionnaires/:slug", name: "questionnaire-fill", component: () => import("@/views/services/QuestionnaireFill.vue"), meta: { title: "填写问卷", public: true } },
        { path: "services/tools/grade-checks/:slug", name: "grade-check-lookup", component: () => import("@/views/services/GradeCheckLookup.vue"), meta: { title: "成绩核对" } },
        { path: "services/tools/file-collections/:slug", name: "file-collection-submit", component: BlankRouteView, meta: { title: "文件提交", public: true } },
        { path: "announcements", name: "announcements", component: () => import("@/views/announcements/Index.vue"), meta: { title: "校园公告", public: true } },
        { path: "jwxt", name: "jwxt", component: loadJwxtView, meta: { title: "教务数据", public: true } },
        { path: "schedule", name: "schedule", component: loadScheduleView, meta: { title: "课表", public: true, hideChrome: true } },
        { path: "download", name: "download", component: () => import("@/views/Download.vue"), meta: { title: "客户端下载", public: true } },
        { path: "downloads", redirect: "/download" },
        {
          path: "search",
          name: "search",
          component: () => import("@/views/search/Result.vue"),
          meta: { title: "拾间AI", public: true, fullHeightContent: true },
        },
        {
          path: "search/results",
          name: "site-search",
          component: () => import("@/views/search/SiteSearch.vue"),
          meta: { title: "站内搜索", public: true },
        },
        { path: "messages", name: "messages", component: () => import("@/views/messages/Index.vue"), meta: { title: "消息中心" } },
        { path: "messages/qqbot-reminders", name: "message-qqbot-reminders", component: () => import("@/views/services/QqBotReminders.vue"), meta: { title: "小工具提醒规则" } },
        { path: "profile", name: "profile", component: loadProfileView, meta: { title: "我的" } },
        { path: "profile/verification", name: "profile-verification", component: () => import("@/views/profile/Verification.vue"), meta: { title: "拾间认证" } },
        { path: "vip", name: "vip", component: () => import("@/views/profile/Vip.vue"), meta: { title: "VIP 中心" } },
        { path: "sponsor", name: "sponsor", component: () => import("@/views/profile/SponsorWall.vue"), meta: { title: "支持药大拾间", public: true } },
        { path: "sponsor-wall", redirect: "/sponsor" },
        { path: "u/:id", name: "user", component: () => import("@/views/profile/User.vue"), meta: { title: "用户", public: true } },
        { path: "admin", name: "admin", component: () => import("@/views/admin/Index.vue"), meta: { title: "管理后台", requireMod: true } },
      ],
    },
    { path: "/:pathMatch(.*)*", component: () => import("@/views/NotFound.vue"), meta: { public: true } },
  ],
});

router.beforeEach(async (to) => {
  if (usesImmediateIosScroll()) {
    iosRouteTransitionEnabled.value = !iosHistoryTraversalPending;
    iosHistoryTraversalPending = false;
  }
  const auth = useAuthStore();
  const site = useSiteStore();
  if (to.meta.title) document.title = `${to.meta.title} · 药大拾间`;
  if (import.meta.env.DEV && to.name === "profile-verification" && to.query.preview === "organization-verification") {
    return true;
  }
  // 课表和教务页必须先渲染本地缓存；站内会话探测放到后台，不能阻塞路由首屏。
  if (to.name && CACHE_FIRST_EDUCATION_ROUTES.has(String(to.name))) {
    if (!auth.ready) void auth.fetchMe({ probe: true });
    return true;
  }
  // HttpOnly Cookie 无法由前端直接读取；首次导航静默探测一次真实会话。
  // 游客的 401 不提示、不跳转，避免公开页面被错误抢到登录页。
  if (!auth.ready) await auth.fetchMe({ probe: true });
  if (
    auth.user?.role === "voicehub_admin"
    || (
      auth.user?.role === "user"
      && auth.user?.voiceHubRole === "admin"
      && !auth.user?.lostFoundRole
    )
  ) {
    window.location.replace("/voicehub/dashboard");
    return false;
  }
  const requestedManageTool = firstRouteValue(to.query.tool);
  if (to.name === "service-tools-manage" && requestedManageTool === "file_collect") {
    return { name: "service-filestore" };
  }

  if (to.fullPath.startsWith(LEGACY_FILE_COLLECTION_SUBMIT_PREFIX)) {
    const target = to.fullPath.slice(LEGACY_FILE_COLLECTION_SUBMIT_PREFIX.length);
    window.location.replace(`/services/tools/filestore/submit/${target}`);
    return false;
  }

  // 功能开关 gate：admin / mod 不受限（便于在关闭期间巡查）
  const featureName = to.name ? FEATURE_GATED[String(to.name)] : undefined;
  if (featureName && !site.loaded) await site.fetch();
  if (featureName && !site.features[featureName]) {
    if (auth.token && !auth.user) await auth.fetchMe();
    const isStaff = auth.user?.role === "admin" || auth.user?.role === "mod";
    if (!isStaff) {
      ElMessage.info("该功能当前不可用");
      return { name: "home" };
    }
  }

  // 公开页：游客也能看
  if (to.meta.public) {
    if (auth.token && !auth.user) void auth.fetchMe();
    return true;
  }
  // 需登录
  if (!auth.token) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (!auth.user) {
    await auth.fetchMe();
    if (!auth.user) return { name: "login", query: { redirect: to.fullPath } };
  }
  // 管理后台：主站管理人员、模块超级管理员，以及失物招领管理员可进对应分区。
  if (to.meta.requireMod) {
    if (!auth.canAccessModuleAdmin) {
      return { name: "home" };
    }
  }
  return true;
});
