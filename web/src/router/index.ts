import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const MainLayout = () => import("@/layouts/MainLayout.vue");

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
    {
      path: "/",
      component: MainLayout,
      redirect: "/home",
      children: [
        { path: "home", name: "home", component: () => import("@/views/Home.vue"), meta: { title: "首页", public: true } },
        { path: "forum", name: "forum", component: () => import("@/views/forum/Index.vue"), meta: { title: "论坛", public: true } },
        { path: "forum/b/:slug", name: "board", component: () => import("@/views/forum/Board.vue"), meta: { title: "板块", public: true } },
        { path: "forum/topic/:id", name: "topic", component: () => import("@/views/forum/Topic.vue"), meta: { title: "帖子", public: true } },
        { path: "post", name: "post", component: () => import("@/views/forum/Post.vue"), meta: { title: "发帖" } },
        { path: "post/:id/edit", name: "edit-post", component: () => import("@/views/forum/Post.vue"), meta: { title: "编辑帖子" } },
        { path: "market", name: "market", component: () => import("@/views/market/Index.vue"), meta: { title: "二手市场", public: true } },
        { path: "coursereview", name: "coursereview", component: () => import("@/views/coursereview/Index.vue"), meta: { title: "课程点评", public: true } },
        { path: "coursereview/:id", name: "course", component: () => import("@/views/coursereview/Course.vue"), meta: { title: "课程", public: true } },
        { path: "services", name: "services", component: () => import("@/views/services/Index.vue"), meta: { title: "服务导航", public: true } },
        { path: "jwxt", name: "jwxt", component: () => import("@/views/jwxt/Index.vue"), meta: { title: "教务直连", public: true } },
        { path: "search", name: "search", component: () => import("@/views/search/Result.vue"), meta: { title: "搜索结果", public: true } },
        { path: "messages", name: "messages", component: () => import("@/views/messages/Index.vue"), meta: { title: "消息中心" } },
        { path: "profile", name: "profile", component: () => import("@/views/profile/Index.vue"), meta: { title: "我的" } },
        { path: "u/:id", name: "user", component: () => import("@/views/profile/User.vue"), meta: { title: "用户", public: true } },
        { path: "admin", name: "admin", component: () => import("@/views/admin/Index.vue"), meta: { title: "管理后台", requireMod: true } },
      ],
    },
    { path: "/:pathMatch(.*)*", component: () => import("@/views/NotFound.vue"), meta: { public: true } },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // 公开页：游客也能看
  if (to.meta.public) {
    // 但若已登录，主动恢复用户信息
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
  if (to.meta.title) document.title = `${to.meta.title} · 药大垎坊`;
  // 管理后台：仅 mod / admin 可进
  if (to.meta.requireMod) {
    if (auth.user?.role !== "admin" && auth.user?.role !== "mod") {
      return { name: "home" };
    }
  }
  return true;
});
