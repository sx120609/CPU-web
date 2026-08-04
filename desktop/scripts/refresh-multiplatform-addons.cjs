const fs = require("node:fs");
const path = require("node:path");

const assetRoot = path.join(__dirname, "..", "assets", "userscripts");
const outputPath = path.join(assetRoot, "multiplatform.js");
const themePath = path.join(assetRoot, "multiplatform-theme.css");
const addonPath = path.join(assetRoot, "multiplatform-screenshot.js");
const startMarker = "// CPU_DESKTOP_SCREENSHOT_ADDON_START";
const endMarker = "// CPU_DESKTOP_SCREENSHOT_ADDON_END";

const theme = fs.readFileSync(themePath, "utf8")
  .replaceAll("\\", "\\\\")
  .replaceAll("`", "\\`")
  .replaceAll("${", "\\${");
const addon = fs.readFileSync(addonPath, "utf8").trim();
let source = fs.readFileSync(outputPath, "utf8");

source = source.replace(
  /^\/\/\s*@match\s+https:\/\/\*\.(?:chaoxing\.com|nbdlib\.cn|hnsyu\.net|gdhkmooc\.com)\/\*\r?\n/gm,
  "",
);

source = source.replace(
  /const CPU_DESKTOP_STYLE = `[\s\S]*?`;\r?\n\r?\n/,
  `const CPU_DESKTOP_STYLE = \`${theme}\`;\n\n`,
);
source = source.replace(
  new RegExp(`\\r?\\n*${startMarker}[\\s\\S]*?${endMarker}\\r?\\n*`, "g"),
  "\n\n",
);
source = source.replace(
  "/* eslint-disable no-undef */",
  `${startMarker}\n${addon}\n${endMarker}\n\n/* eslint-disable no-undef */`,
);
source = source.replace(
  "      this.container.append(...styles, this.messageContainer);\n      installCpuScreenshotSearch(this.root, this.container);",
  "      this.container.append(...styles, this.messageContainer);",
).replace(
  "      this.container.append(...styles, this.messageContainer);",
  "      this.container.append(...styles, this.messageContainer);\n      installCpuScreenshotSearch(this.root, this.container);",
);
source = source.replace(
  "请勿同时运行其他网课脚本，避免重复点击或提交。截图搜题与学习通定制工作台目前仅由学习通专用助手提供。",
  "请勿同时运行其他网课脚本，避免重复点击或提交。所有支持平台均可点击面板顶部的截图按钮手动搜题，建议先暂停自动任务。",
);
source = source.replace(
  '        panelName: (name) => name || this.config.render.defaultPanelName || ""',
  `        panelName: (name, urls = [location.href]) => {
          const matched = utils_1.$.getMatchedScripts(this.projects, urls)
            .filter((script) => !script.hideInPanel)
            .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
          const current = matched.find((script) => script.namespace === name || String(name || "").endsWith("-" + script.name));
          if (current && !String(current.namespace || "").startsWith("common.")) return name;
          const preferred = matched.find((script) => !String(script.namespace || "").startsWith("common."));
          return preferred && preferred.namespace || name || this.config.render.defaultPanelName || "";
        }`,
);
source = source.replaceAll(
  "this.defaults.panelName(currentPanelName)",
  "this.defaults.panelName(currentPanelName, this.defaults.urls(urls))",
);
source = source.replace(
  `      this.container.header.append((0, utils_1.h)("div", { style: { width: "100%" } }, [
        (0, utils_1.h)("div", { style: { display: "flex", width: "100%" } }, [
          profile,
          ...scriptDropdowns,
          this.container.header.visualSwitcher || ""
        ]),
        (0, utils_1.h)("div", { style: { display: "flex", width: "100%" } }, [this.extraMenuBar])
      ]));`,
  `      this.container.header.append((0, utils_1.h)("div", { style: { width: "100%" } }, [
        (0, utils_1.h)("div", { style: { display: "flex", alignItems: "center", width: "100%" } }, [
          profile,
          this.container.header.visualSwitcher || ""
        ])
      ]));`,
);

if (!source.includes("installCpuScreenshotSearch(this.root, this.container)")) {
  throw new Error("OCS 容器结构已变化，无法挂载多平台截图搜题");
}
if (!source.includes('display: "flex", alignItems: "center", width: "100%"')) {
  throw new Error("OCS 标题栏结构已变化，无法启用药大拾间精简模式");
}
fs.writeFileSync(outputPath, source, "utf8");
console.log(`已刷新 ${path.relative(process.cwd(), outputPath)} 的桌面端主题与截图搜题能力`);
