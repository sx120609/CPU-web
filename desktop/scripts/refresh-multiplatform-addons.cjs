const fs = require("node:fs");
const path = require("node:path");

const assetRoot = path.join(__dirname, "..", "assets", "userscripts");
const outputPath = path.join(assetRoot, "multiplatform.js");
const themePath = path.join(assetRoot, "multiplatform-theme.css");
const surfacePath = path.join(assetRoot, "multiplatform-surface.js");
const addonPath = path.join(assetRoot, "multiplatform-screenshot.js");
const startMarker = "// CPU_DESKTOP_SCREENSHOT_ADDON_START";
const endMarker = "// CPU_DESKTOP_SCREENSHOT_ADDON_END";
const integrationVersion = "4.15.5";

const theme = fs.readFileSync(themePath, "utf8")
  .replaceAll("\\", "\\\\")
  .replaceAll("`", "\\`")
  .replaceAll("${", "\\${");
const addon = fs.readFileSync(addonPath, "utf8").trim();
const surfaceAddon = fs.readFileSync(surfacePath, "utf8").trim();
let source = fs.readFileSync(outputPath, "utf8");

source = source.replace(
  /^\/\/\s*@version\s+\S+\s*$/m,
  `// @version      ${integrationVersion}`,
);

if (!source.includes("// @grant        GM_cpuPageAction")) {
  source = source.replace(
    "// @grant        GM_cpuCaptureArea",
    "// @grant        GM_cpuCaptureArea\n// @grant        GM_cpuPageAction",
  );
}

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
  `${startMarker}\n${surfaceAddon}\n\n${addon}\n${endMarker}\n\n/* eslint-disable no-undef */`,
);
source = source.replace(
  /      this\.container\.append\(\.\.\.styles, this\.messageContainer\);\n(?:      installCpuUnifiedSurface[\s\S]*?\n      \}\);\n)?      installCpuScreenshotSearch\(this\.root, this\.container\);/,
  "      this.container.append(...styles, this.messageContainer);",
).replace(
  "      this.container.append(...styles, this.messageContainer);",
  `      this.container.append(...styles, this.messageContainer);
      installCpuUnifiedSurface(this.root, this.container, {
        getCurrentPanel: () => this.config.store.getCurrentPanelName(),
        openPanel: (name) => this.config.store.setCurrentPanelName(name),
        openTask: async () => {
          const urls = this.defaults.urls(await this.config.store.getRenderURLs());
          await this.config.store.setCurrentPanelName(this.defaults.panelName("", urls));
        },
        hide: () => this.hidden()
      });
      installCpuScreenshotSearch(this.root, this.container);`,
);
source = source.replace(
  "请勿同时运行其他网课脚本，避免重复点击或提交。截图搜题与学习通定制工作台目前仅由学习通专用助手提供。",
  "请勿同时运行其他网课脚本，避免重复点击或提交。所有支持平台均可点击面板顶部的截图按钮手动搜题，建议先暂停自动任务。",
);
const desktopPanelResolver = `        panelName: (name, urls = [location.href]) => {
          const allowedInternalPanels = new Set(["common.guide", "common.settings", "render.console"]);
          const matched = utils_1.$.getMatchedScripts(this.projects, urls)
            .filter((script) => !script.hideInPanel)
            .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
          const current = matched.find((script) => script.namespace === name || script.fullName() === name || String(name || "").endsWith("-" + script.name));
          if (current && (!/^(common|background)\\./.test(String(current.namespace || "")) || allowedInternalPanels.has(String(current.namespace || "")))) {
            return current.namespace || current.fullName();
          }
          const preferred = matched.find((script) => !/^(common|background)\\./.test(String(script.namespace || "")));
          return preferred && (preferred.namespace || preferred.fullName()) || "common.guide";
        }`;
source = source.replace(
  '        panelName: (name) => name || this.config.render.defaultPanelName || ""',
  desktopPanelResolver,
);
// 0.3.1 曾经写入过一版选择器；刷新旧产物时也要迁移，不能只对全新上游包生效。
source = source.replace(
  /        panelName: \(name, urls = \[location\.href\]\) => \{[\s\S]*?\n        \}(?=\n      \};)/,
  desktopPanelResolver,
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

source = source
  .replace(
    `          this.authToken = await request("http://localhost:15319/get-actions-key", {
            type: "GM_xmlhttpRequest",
            method: "get",
            responseType: "text"
          });`,
    `          if (typeof GM_cpuPageAction !== "function") return void 0;
          this.authToken = "cpu-desktop-integrated";`,
  )
  .replace(
    `            const res = await request("/ocs-script-actions", {
              type: "fetch",
              method: "post",
              responseType: ["waitForRequest", "waitForResponse", "reload"].includes(property) ? "json" : "text",
              headers: {
                "auth-token": authToken
              },
              data
            });`,
    `            const res = await GM_cpuPageAction(data);`,
  )
  .replace(
    /  const \$playwright = \{[\s\S]*?\n  \};\n  const state\$5 =/,
    `  const $playwright = {
    showError: () => {
      const message = "客户端页面控制暂时不可用，请更新药大拾间桌面客户端；已是最新版时请刷新当前网课标签后重试。";
      lib.$message.error({ content: message, duration: 0 });
      return new Error(message);
    }
  };
  const state$5 =`,
  )
  .replace(
    /  const createGuide = \(\) => \{[\s\S]*?\n  \};\n  function createSearchResultAlertElement/,
    `  const createGuide = () => lib.h("div", { className: "cpu-integrated-guide" }, [
    lib.h("b", "药大拾间·全平台网课助手"),
    lib.h("p", "请进入具体课程，再打开章节、视频、作业或考试页面；识别到任务后会自动开始。"),
    lib.h("p", "答题可在当前面板开始、暂停或继续，截图搜题也会在同一个工作台内显示。"),
    lib.h("p", "学习通仍由药大拾间专用助手负责，不会被本助手重复接管。"),
    lib.h("p", "本工具仅供个人学习辅助，严禁商业用途。")
  ]);
  function createSearchResultAlertElement`,
  )
  .replace(
    'this.header = ui_1.$ui.tooltip((0, dom_1$4.h)("header-element", { title: "菜单栏-可拖动区域" }));',
    'this.header = (0, dom_1$4.h)("header-element");',
  );

source = source.replace(
  /(\bconst projects = definedProjects\(\);\r?\n)(\s*\r?\n\s*\/\/ 运行脚本)/,
  "$1\t// CPU_DESKTOP_PROJECTS_CONFIGURED\n\tconfigureCpuDesktopProjects(projects);\n$2",
);

if (!source.includes("installCpuUnifiedSurface(this.root, this.container") || !source.includes("installCpuScreenshotSearch(this.root, this.container)")) {
  throw new Error("OCS 容器结构已变化，无法挂载多平台截图搜题");
}
if (!source.includes('display: "flex", alignItems: "center", width: "100%"')) {
  throw new Error("OCS 标题栏结构已变化，无法启用药大拾间精简模式");
}
if (!source.includes('allowedInternalPanels = new Set(["common.guide", "common.settings", "render.console"])')) {
  throw new Error("OCS 默认面板过滤规则未写入，无法刷新");
}
if (!source.includes("CPU_DESKTOP_PROJECTS_CONFIGURED")) {
  throw new Error("OCS 内部调试面板尚未从用户界面隔离");
}
if (!source.includes("GM_cpuPageAction(data)") || source.includes("http://localhost:15319/get-actions-key") || source.includes("docs.ocsjs.com/docs/script-helper")) {
  throw new Error("OCS 桌面桥仍未完全内置，无法刷新");
}
fs.writeFileSync(outputPath, source, "utf8");
console.log(`已刷新 ${path.relative(process.cwd(), outputPath)} 的桌面端主题与截图搜题能力`);
