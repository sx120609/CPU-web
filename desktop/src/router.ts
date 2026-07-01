import { createRouter, createWebHashHistory } from "vue-router";
import Welcome from "./views/Welcome.vue";
import Login from "./views/Login.vue";
import ChaoxingLogin from "./views/ChaoxingLogin.vue";
import CourseList from "./views/CourseList.vue";
import Home from "./views/Home.vue";
import Tools from "./views/Tools.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/welcome" },
    { path: "/welcome", component: Welcome },
    { path: "/login", component: Login },
    { path: "/chaoxing-login", component: ChaoxingLogin },
    { path: "/courses", component: CourseList },
    { path: "/home", component: Home },
    { path: "/tools", component: Tools },
  ],
});
