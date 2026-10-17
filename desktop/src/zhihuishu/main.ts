import { createApp } from "vue";
import Page from "../../../web/src/views/services/ZhihuishuAssistant.vue";
import "./style.css";
createApp(Page, { desktopMode: true, onBack: () => window.cpuZhihuishu.request("home") }).mount("#app");
