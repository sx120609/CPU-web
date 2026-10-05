import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const { parse, compileScript } = require("@vue/compiler-sfc");
const { createSSRApp } = require("vue");
const { renderToString } = require("vue/server-renderer");
const componentPath = fileURLToPath(new URL("../src/views/download/DownloadAction.vue", import.meta.url));
const compiled = (await build({
  entryPoints: [componentPath],
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  bundle: true, write: false, format: "cjs", platform: "node", external: ["vue"],
  plugins: [{
    name: "vue-component",
    setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
        if (path !== componentPath) return { contents: "export default { render() { return null; } };", loader: "js" };
        const { descriptor } = parse(readFileSync(path, "utf8"));
        return { contents: compileScript(descriptor, { id: "download-action", inlineTemplate: true }).content, loader: "ts" };
      });
    },
  }],
})).outputFiles[0].text;

async function renderAction(ua, key, downloadUrl) {
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports, require,
    navigator: { userAgent: ua }, window: {},
  });
  const app = createSSRApp(module.exports.default, { card: { key, downloadUrl, actionLabel: "下载" } });
  app.component("router-link", { render() { return null; } });
  return renderToString(app);
}

test("iOS native download links make real requests instead of becoming popup SPA routes", async () => {
  for (const ua of ["iPhone CPUWebIOSApp/1", "iPhone CPUTimeNative/1"]) {
    for (const [key, url] of [
      ["android", "/api/site/downloads/android-app"],
      ["windows", "https://cputime.cn/api/site/downloads/desktop-app"],
      ["macos", "https://cputime.cn/api/site/downloads/desktop-mac-app"],
    ]) {
      const html = await renderAction(ua, key, url);
      assert.ok(html.includes(`href="${url}"`), `${ua}: ${key} keeps its download endpoint`);
      assert.ok(html.includes('target="_self"'), `${ua}: ${key} avoids the iOS popup router`);
    }
  }
});

test("browsers and Android/Harmony native shells keep downloads in a new window", async () => {
  for (const ua of ["iPhone Version/15.0 Safari/604.1", "Windows Chrome/130", "Android CPUWebScheduleApp/52 CPUTimeNative/1", "CPUWebHarmonyApp/18 CPUTimeNative/1"]) {
    const html = await renderAction(ua, "android", "/api/site/downloads/android-app");
    assert.ok(html.includes('target="_blank"'), ua);
    assert.ok(html.includes('rel="noopener noreferrer"'), ua);
  }
});
