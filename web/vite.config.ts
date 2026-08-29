import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import path from "node:path";

export default defineConfig(({ command }) => ({
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
          if (/^HarmonyOS_Sans_SC_(Regular|Medium|Bold)\.woff2$/u.test(originalName)) {
            return "assets/fonts/harmonyos-sans-sc/v1/[name][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/echarts/") || id.includes("/vue-echarts/")) {
            return "charts";
          }
          if (id.includes("/zrender/")) {
            return "zrender";
          }
          if (id.includes("/viewerjs/") || id.includes("/artplayer/") || id.includes("/html-to-image/") || id.includes("/qrcode/")) {
            return "media-tools";
          }
          if (id.includes("/xlsx/")) {
            return "xlsx-tools";
          }
          if (id.includes("/marked/") || id.includes("/dompurify/")) {
            return "markdown-tools";
          }
          return undefined;
        },
      },
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
      "/voicehub": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
