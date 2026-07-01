import { createRouter, createWebHashHistory } from "vue-router";
import Login from "./views/Login.vue";
import Home from "./views/Home.vue";

// Electron file:// 协议必须用 hash history
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/login" },
    { path: "/login", component: Login },
    { path: "/home", component: Home },
  ],
});
