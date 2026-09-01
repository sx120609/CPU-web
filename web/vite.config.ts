import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import path from "node:path";

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue", "vue-router", "pinia"],
      resolvers: [ElementPlusResolver()],
      // 只在开发服务器维护声明文件；生产构建并行运行时不应和 dev server 抢写同一文件。
      dts: command === "serve" ? "auto-imports.d.ts" : false,
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: command === "serve" ? "components.d.ts" : false,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        assetFileNames(assetInfo) {
          const originalName = assetInfo.names?.[0] || assetInfo.name || "";
          if (/^HarmonyOS_Sans_SC_(Regular|Medium|Bold)_UI\.woff2$/u.test(originalName)) {
            return "assets/fonts/harmonyos-sans-sc/v2/[name][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
        manualChunks(id) {
          const normalized = id.replace(/\\/gu, "/");
          if (!normalized.includes("node_modules")) {
            const deferredModule = /\/src\/(?:views\/admin\/|views\/services\/(?:ToolManage|ToolDetail|FileStore|FileStoreSubmit|FileStoreStatus|QuestionnaireFill|GradeCheckLookup|Tools|VoiceHubLaunch)\.vue|views\/search\/(?:Result|SiteSearch)\.vue|components\/common\/(?:DesktopToolsPanel|DownloadSafetyGuideDialog)\.vue|components\/forum\/ComposeActionSheet\.vue)/u.test(normalized);
            if (deferredModule) return undefined;
            if (
              normalized.includes("/src/layouts/MainLayout.vue")
              || normalized.includes("/src/views/Home.vue")
              || normalized.includes("/src/views/Schedule.vue")
              || normalized.includes("/src/views/jwxt/Index.vue")
              || normalized.includes("/src/views/services/Index.vue")
              || normalized.includes("/src/views/profile/Index.vue")
              || normalized.includes("/src/views/forum/")
              || normalized.includes("/src/components/forum/")
              || normalized.includes("/src/api/")
              || normalized.includes("/src/stores/")
              || normalized.includes("/src/utils/")
              || normalized.includes("/src/components/common/")
            ) {
              return "app-shell";
            }
            return undefined;
          }
          if (normalized.includes("/echarts/") || normalized.includes("/vue-echarts/")) {
            return "charts";
          }
          if (normalized.includes("/zrender/")) {
            return "zrender";
          }
          if (normalized.includes("/viewerjs/") || normalized.includes("/artplayer/") || normalized.includes("/qrcode/")) {
            return "media-tools";
          }
          if (normalized.includes("/xlsx/")) {
            return "xlsx-tools";
          }
          if (
            normalized.includes("/marked/")
            || normalized.includes("/dompurify/")
            || normalized.includes("/katex/")
            || normalized.includes("/element-plus/")
            || normalized.includes("/@element-plus/")
            || normalized.includes("/lodash-es/")
            || /\/node_modules\/(?:vue|vue-router|pinia|@vue\/)/u.test(normalized)
          ) {
            return "core-vendor";
          }
          return undefined;
        },
      },
    },
  },
  experimental: {
    renderBuiltUrl(_filename, { hostType, type }) {
      if (hostType === "css" && type === "asset") return { relative: true };
      return undefined;
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern",
        silenceDeprecations: ["legacy-js-api", "color-functions", "global-builtin", "import"],
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/filestore": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/share": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/voicehub": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
