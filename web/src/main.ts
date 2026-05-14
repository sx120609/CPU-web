import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";

import "element-plus/dist/index.css";
import "./styles/index.scss";

const app = createApp(App);
app.use(createPinia());
useAuthStore().hydrate();
app.use(router);
app.mount("#app");
