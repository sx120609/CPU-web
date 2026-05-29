import { createRouter, createWebHistory } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import type { FeatureKey } from "@/api/site";

const MainLayout = () => import("@/layouts/MainLayout.vue");

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

const COMMUNITY_ACCESS_GATED = new Set([
  "forum-hot",
  "forum-latest",
  "market",
  "coursereview",
  "course",
  "post",
  "edit-post",
]);

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    // 浏览器前进/后退：恢复历史滚动位置
    if (savedPosition) return savedPosition;
    // 锚点
    if (to.hash) return { el: to.hash, behavior: "smooth" };
    // 其他情况：回顶
    return { top: 0 };
  },
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/Login.vue"), meta: { public: true, title: "登录" } },
    { path: "/register", name: "register", component: () => import("@/views/Register.vue"), meta: { public: true, title: "注册" } },
    { path: "/schedule", name: "schedule", component: () => import("@/views/Schedule.vue"), meta: { public: true, title: "课表" } },
    {
      path: "/",
      component: MainLayout,
      redirect: "/home",
      children: [
        { path: "home", name: "home", component: () => import("@/views/Home.vue"), meta: { title: "首页", public: true } },
        { path: "forum", name: "forum", component: () => import("@/views/forum/Index.vue"), meta: { title: "论坛", public: true } },
        { path: "forum/hot", name: "forum-hot", component: () => import("@/views/forum/Feed.vue"), meta: { title: "热榜", public: true } },
        { path: "forum/latest", name: "forum-latest", component: () => import("@/views/forum/Feed.vue"), meta: { title: "最新内容", public: true } },
        { path: "forum/b/:slug", name: "board", component: () => import("@/views/forum/Board.vue"), meta: { title: "板块", public: true } },
        { path: "forum/topic/:id", name: "topic", component: () => import("@/views/forum/Topic.vue"), meta: { title: "帖子", public: true } },
        { path: "post", name: "post", component: () => import("@/views/forum/Post.vue"), meta: { title: "发帖" } },
        { path: "post/:id/edit", name: "edit-post", component: () => import("@/views/forum/Post.vue"), meta: { title: "编辑帖子" } },
        { path: "market", name: "market", component: () => import("@/views/market/Index.vue"), meta: { title: "二手市场", public: true } },
        { path: "coursereview", name: "coursereview", component: () => import("@/views/coursereview/Index.vue"), meta: { title: "课程点评", public: true } },
        { path: "coursereview/:id", name: "course", component: () => import("@/views/coursereview/Course.vue"), meta: { title: "课程", public: true } },
        { path: "services", name: "services", component: () => import("@/views/services/Index.vue"), meta: { title: "校园服务", public: true } },
        { path: "services/tools", name: "service-tools", component: () => import("@/views/services/Tools.vue"), meta: { title: "校园小工具", public: true } },
        { path: "services/tools/manage", name: "service-tools-manage", component: () => import("@/views/services/ToolManage.vue"), meta: { title: "小工具管理" } },
        { path: "services/tools/:slug", name: "service-tool-detail", component: () => import("@/views/services/ToolDetail.vue"), meta: { title: "校园小工具", public: true } },
        { path: "services/tools/questionnaires/:slug", name: "questionnaire-fill", component: () => import("@/views/services/QuestionnaireFill.vue"), meta: { title: "填写问卷", public: true } },
        { path: "services/tools/grade-checks/:slug", name: "grade-check-lookup", component: () => import("@/views/services/GradeCheckLookup.vue"), meta: { title: "成绩核对" } },
        { path: "services/tools/file-collections/:slug", name: "file-collection-submit", component: () => import("@/views/services/FileCollectionSubmit.vue"), meta: { title: "文件提交", public: true } },
        { path: "announcements", name: "announcements", component: () => import("@/views/announcements/Index.vue"), meta: { title: "校园公告", public: true } },
        { path: "jwxt", name: "jwxt", component: () => import("@/views/jwxt/Index.vue"), meta: { title: "教务数据", public: true } },
        { path: "schedule", name: "schedule", component: () => import("@/views/Schedule.vue"), meta: { title: "课表", public: true, hideChrome: true } },
        { path: "search", name: "search", component: () => import("@/views/search/Result.vue"), meta: { title: "搜索结果", public: true } },
        { path: "messages", name: "messages", component: () => import("@/views/messages/Index.vue"), meta: { title: "消息中心" } },
        { path: "profile", name: "profile", component: () => import("@/views/profile/Index.vue"), meta: { title: "我的" } },
        { path: "sponsor-wall", name: "sponsor-wall", component: () => import("@/views/profile/SponsorWall.vue"), meta: { title: "鸣谢墙", public: true } },
        { path: "u/:id", name: "user", component: () => import("@/views/profile/User.vue"), meta: { title: "用户", public: true } },
        { path: "admin", name: "admin", component: () => import("@/views/admin/Index.vue"), meta: { title: "管理后台", requireMod: true } },
      ],
    },
    { path: "/:pathMatch(.*)*", component: () => import("@/views/NotFound.vue"), meta: { public: true } },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const site = useSiteStore();
  if (to.meta.title) document.title = `${to.meta.title} · 药大垎坊`;

  // 功能开关 gate：admin / mod 不受限（便于在关闭期间巡查）
  const featureName = to.name ? FEATURE_GATED[String(to.name)] : undefined;
  if (featureName && !site.loaded) await site.fetch();
  if (featureName && !site.features[featureName]) {
    const isStaff = auth.user?.role === "admin" || auth.user?.role === "mod";
    if (!isStaff) {
      ElMessage.info("该功能当前不可用");
      return { name: "home" };
    }
  }

  if (to.name && COMMUNITY_ACCESS_GATED.has(String(to.name))) {
    if (auth.token && !auth.user) await auth.fetchMe();
    if (!auth.canAccessForum) {
      return { name: "forum", query: { redirect: to.fullPath } };
    }
  }

  // 公开页：游客也能看
  if (to.meta.public) {
    if (auth.token && !auth.user) auth.fetchMe();
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
  // 管理后台：仅 mod / admin 可进
  if (to.meta.requireMod) {
    if (auth.user?.role !== "admin" && auth.user?.role !== "mod") {
      return { name: "home" };
    }
  }
  return true;
});
