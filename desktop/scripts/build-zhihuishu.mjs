import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.dirname(desktop);
await bundle({ entryPoints: [path.join(repo, "server/src/services/zhihuishuRunner.ts")], outfile: path.join(desktop, "dist/zhihuishu-runner.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", nodePaths: [path.join(desktop, "node_modules")] });
await build({ configFile: false, root: path.join(desktop, "src/zhihuishu"), base: "./", plugins: [vue()], resolve: { alias: [
  { find: "@/api/zhihuishu", replacement: path.join(desktop, "src/zhihuishu/api.ts") },
  { find: "@", replacement: path.join(repo, "web/src") },
  { find: "vue", replacement: path.join(desktop, "node_modules/vue/dist/vue.runtime.esm-bundler.js") },
] }, build: { outDir: path.join(desktop, "dist/zhihuishu"), emptyOutDir: true, target: "chrome132" } });

await import("./build-assistants.mjs");
