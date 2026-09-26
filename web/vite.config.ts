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
      // Element Plus 样式由 main.ts 整体引入并保证先于站点覆盖样式加载；按组件注入的样式
      // 会随懒加载 chunk 晚到并反向覆盖站点定制，因此这里不再自动引入组件样式。
      resolvers: [ElementPlusResolver({ importStyle: false })],
      // 只在开发服务器维护声明文件；生产构建并行运行时不应和 dev server 抢写同一文件。
      dts: command === "serve" ? "auto-imports.d.ts" : false,
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: false })],
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
            return "assets/fonts/harmonyos-sans-sc/v3/[name][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
        // 业务模块与 Element Plus 组件交给 Rollup 按路由自然拆分：强制合并会把懒加载页面
        // 拉进首屏，并让 Element Plus 桶文件的全部组件失去 tree-shaking。
        // 手动 chunk 会连带吸收其未归属的依赖（如 CommonJS 辅助模块），只保留确实独立的大库。
        manualChunks(id) {
          const normalized = id.replace(/\\/gu, "/");
          if (!normalized.includes("node_modules")) return undefined;
          if (normalized.includes("/echarts/") || normalized.includes("/vue-echarts/")) {
            return "charts";
          }
          if (normalized.includes("/zrender/")) {
            return "zrender";
          }
          if (normalized.includes("/xlsx/")) {
            return "xlsx-tools";
          }
          // Element Plus 只把样式放进框架 chunk：它的 CSS 会作为首个样式表链接，
          // 保证站点及 App.vue 的覆盖样式始终排在 Element Plus 基础样式之后。
          if (
            /\/node_modules\/(?:vue|vue-router|pinia|vue-demi|@vue\/[^/]+)\//u.test(normalized)
            || /\/node_modules\/element-plus\/.+\.css$/u.test(normalized)
          ) {
            return "core-vendor";
          }
          return undefined;
        },
      },
    },
  },
  experimental: {
    renderBuiltUrl(filename, { hostType, type }) {
      // Public files are served from the page origin. Relative URLs would walk
      // out of the versioned asset prefix when a JS chunk is served by the CDN.
      if (type === "public") return `/${filename}`;
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
