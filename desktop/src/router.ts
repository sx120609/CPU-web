import { createRouter, createWebHashHistory } from "vue-router";
import Login from "./views/Login.vue";
import ChaoxingLogin from "./views/ChaoxingLogin.vue";
import CourseList from "./views/CourseList.vue";
import Home from "./views/Home.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/login" },
    { path: "/login", component: Login },
    { path: "/chaoxing-login", component: ChaoxingLogin },
    { path: "/courses", component: CourseList },
    { path: "/home", component: Home },
  ],
});
