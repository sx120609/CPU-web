import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";

import "element-plus/dist/index.css";
import "./styles/index.scss";

function installTouchGuards() {
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("gesturechange", (event) => event.preventDefault());
  document.addEventListener("gestureend", (event) => event.preventDefault());
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}

installTouchGuards();

const app = createApp(App);
app.use(createPinia());
useAuthStore().hydrate();
app.use(router);
app.mount("#app");
