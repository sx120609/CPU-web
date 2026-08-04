const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_UPSTREAM_VERSION = "4.15.3";
const INTEGRATION_VERSION = "4.15.7";
const EXPECTED_COMMIT = "890686a5e54f9a6d52d1169bae9ea5971e0863c7";
const OUTPUT = path.join(__dirname, "..", "assets", "userscripts", "multiplatform.js");
const THEME = path.join(__dirname, "..", "assets", "userscripts", "multiplatform-theme.css");
const SCREENSHOT_ADDON = path.join(__dirname, "..", "assets", "userscripts", "multiplatform-screenshot.js");
const SURFACE_ADDON = path.join(__dirname, "..", "assets", "userscripts", "multiplatform-surface.js");

const input = process.argv[2];
if (!input) {
  throw new Error("用法: node scripts/vendor-ocs.cjs <上游 dist/ocs.user.js>");
}

const source = fs.readFileSync(path.resolve(input), "utf8");
const desktopTheme = fs.readFileSync(THEME, "utf8")
  .replaceAll("\\", "\\\\")
  .replaceAll("`", "\\`")
  .replaceAll("${", "\\${");
const screenshotAddon = fs.readFileSync(SCREENSHOT_ADDON, "utf8").trim();
const surfaceAddon = fs.readFileSync(SURFACE_ADDON, "utf8").trim();
const headerMatch = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
if (!headerMatch) throw new Error("输入文件不是有效的 OCS UserScript");
if (!new RegExp(`^\\s*//\\s*@version\\s+${EXPECTED_UPSTREAM_VERSION.replace(/\./g, "\\.")}\\s*$`, "m").test(source)) {
  throw new Error(`只允许整合已审核的 OCS ${EXPECTED_UPSTREAM_VERSION}`);
}

const matches = [...headerMatch[1].matchAll(/^\s*\/\/\s*@match\s+(.+?)\s*$/gm)]
  .map((match) => match[1].trim())
  .filter((rule) => !/^\*:\/\/\*\.(?:edu|org)\.cn\/\*$/.test(rule))
  // 学习通及专用高校镜像继续使用药大拾间原有定制助手，绝不交给 OCS 双重接管。
  .filter((rule) => !/\*\.(?:chaoxing\.com|nbdlib\.cn|hnsyu\.net|gdhkmooc\.com)\//.test(rule))
  .map((rule) => rule.replace(/^\*:\/\//, "https://"));

const metadata = [
  "// ==UserScript==",
  "// @name         药大拾间·全平台网课助手",
  "// @namespace    cn.lizmt.cpuweb.ocs",
  `// @version      ${INTEGRATION_VERSION}`,
  "// @description  药大拾间桌面端多平台网课助手；平台适配能力基于 OCS，答题只使用药大拾间独立 AI。",
  "// @author       enncy；药大拾间整合维护",
  "// @license      MIT",
  "// @homepage     https://cpu.lizmt.cn/download",
  "// @source       https://github.com/ocsjs/ocsjs",
  ...matches.map((rule) => `// @match        ${rule}`),
  "// @connect      desktop.localhost",
  "// @grant        GM_info",
  "// @grant        GM_getTab",
  "// @grant        GM_saveTab",
  "// @grant        GM_setValue",
  "// @grant        GM_getValue",
  "// @grant        unsafeWindow",
  "// @grant        GM_listValues",
  "// @grant        GM_deleteValue",
  "// @grant        GM_notification",
  "// @grant        GM_xmlhttpRequest",
  "// @grant        GM_getResourceText",
  "// @grant        GM_addValueChangeListener",
  "// @grant        GM_removeValueChangeListener",
  "// @grant        GM_cpuAIRequest",
  "// @grant        GM_cpuCaptureArea",
  "// @grant        GM_cpuPageAction",
  "// @grant        GM_cpuReport",
  "// @run-at       document-start",
  "//",
  `// OCS ${EXPECTED_UPSTREAM_VERSION}, commit ${EXPECTED_COMMIT}, Copyright (c) 2022 enncy, MIT License.`,
  "// 药大拾间移除了 OCS 外部题库连接权限；题面只经桌面宿主发往本站独立答题 AI。",
  "// ==/UserScript==",
].join("\n");

let output = source.replace(headerMatch[0], metadata);
output = output
  .replace("title: `OCS-${infos.script.version}`", "title: '药大拾间·全平台网课助手'")
  .replace(
    "        panelName: (name) => name || this.config.render.defaultPanelName || \"\"",
  `        panelName: (name, urls = [location.href]) => {
          const allowedInternalPanels = new Set(["common.guide", "render.console"]);
          const matched = utils_1.$.getMatchedScripts(this.projects, urls)
            .filter((script) => !script.hideInPanel)
            .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
          const current = matched.find((script) => script.namespace === name || script.fullName() === name || String(name || "").endsWith("-" + script.name));
          if (current && (!/^(common|background)\\./.test(String(current.namespace || "")) || allowedInternalPanels.has(String(current.namespace || "")))) {
            return current.namespace || current.fullName();
          }
          const preferred = matched.find((script) => !/^(common|background)\\./.test(String(script.namespace || "")));
          return preferred && (preferred.namespace || preferred.fullName()) || \"common.guide\";
        }`,
  )
  .replaceAll("this.defaults.panelName(currentPanelName)", "this.defaults.panelName(currentPanelName, this.defaults.urls(urls))")
  .replace(
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
  )
  .replace("updatePage: 'https://docs.ocsjs.com/docs/update'", "updatePage: 'https://cpu.lizmt.cn/download'")
  .replace("⚠️ 禁止最小化浏览器、切屏，否则可能导致脚本无法运行！", "桌面客户端已启用后台运行，最小化或切换桌面不会主动暂停任务。")
  .replace(
    '"打开任意网课平台，进入视频、作业页面等待脚本运行，",\n              "⚠️ 禁止与其他脚本一起使用（不兼容），也不能开多个相同脚本",\n              "桌面客户端已启用后台运行，最小化或切换桌面不会主动暂停任务。",\n              "有疑问请访问下方交流群，进群后带截图进行反馈。"',
    '"药大拾间·全平台网课助手已加载。请先进入具体课程，再打开章节、视频、作业或考试页面。",\n              "识别到可执行任务后会自动开始；答题任务也可在当前面板使用“开始答题 / 暂停”控制。",\n              "桌面客户端已启用后台运行并默认静音，最小化或切换桌面不会主动暂停任务；声音可在客户端标签栏单独恢复。",\n              "请勿同时运行其他网课脚本，避免重复点击或提交。所有支持平台均可点击面板顶部的截图按钮手动搜题，建议先暂停自动任务。",\n              "本工具仅供个人学习辅助，严禁商业用途。"',
  )
  .replace(
    '"请手动进入视频、作业、考试页面，脚本会自动运行。",\n              "兴趣课会自动下一个，所以不提供脚本。"',
    '"助手已识别智慧树。请进入具体课程，再打开需要学习的章节、视频、作业或考试页面。",\n              "进入支持页面后会自动加载任务；答题时可在助手面板开始、暂停或继续。",\n              "客户端已默认静音当前网课标签，需要声音时可点击标签上的扬声器按钮。",\n              "兴趣课由平台自动切换，助手不会重复接管。"',
  )
  .replace(
    '      running = true;\n      worker = options.workerProvider(workOptions);',
    '      running = true;\n      typeof GM_cpuReport === "function" && GM_cpuReport("status", `${script2.name} · 运行中`);\n      worker = options.workerProvider(workOptions);',
  )
  .replace(
    '        controlBtn.disabled = true;\n      });',
    '        controlBtn.disabled = true;\n        typeof GM_cpuReport === "function" && GM_cpuReport("status", `${script2.name} · 已完成`);\n      });',
  )
  .replace(
    '      controlBtn.value = stop ? "▶️继续" : "⏸️暂停";',
    '      controlBtn.value = stop ? "▶️继续" : "⏸️暂停";\n      typeof GM_cpuReport === "function" && GM_cpuReport("status", stop ? "多平台助手已暂停" : "多平台助手已继续");',
  )
  .replace(
    "/* eslint-disable no-undef */",
    `// 药大拾间桌面端主题与统一工作台均位于 OCS 的封闭 ShadowRoot 内，不污染网课页面。\nconst CPU_DESKTOP_STYLE = \`${desktopTheme}\`;\n\n${surfaceAddon}\n\n${screenshotAddon}\n\n/* eslint-disable no-undef */`,
  )
  .replace(
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
  )
  .replace("styles: [STYLE]", "styles: [STYLE, CPU_DESKTOP_STYLE]")
  .replace(
    'if (document.visibilityState === "hidden" && !messageElement) {',
    'if (false && !messageElement) { // 药大拾间桌面端关闭后台节流，不显示浏览器前台警告',
  );

// OCS 上游把跨上下文点击与接口监听交给它自己的 localhost 程序。药大拾间桌面端
// 直接通过受 nonce 保护的 Electron 桥实现同一套调用，不让用户再安装第二个桌面插件。
output = output
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

output = output.replace(
  /(\bconst projects = definedProjects\(\);\r?\n)(\s*\r?\n\s*\/\/ 运行脚本)/,
  "$1\t// CPU_DESKTOP_PROJECTS_CONFIGURED\n\tconfigureCpuDesktopProjects(projects);\n$2",
);

if (!output.includes("title: '药大拾间·全平台网课助手'")) {
  throw new Error("OCS 入口结构已变化，停止生成，需人工复核");
}
if (!output.includes("药大拾间桌面端关闭后台节流")) {
  throw new Error("OCS 后台可见性检测结构已变化，停止生成，需人工复核");
}
if (!output.includes("CPU_DESKTOP_STYLE") || !output.includes("多平台助手已暂停") || !output.includes("installCpuUnifiedSurface(this.root, this.container") || !output.includes("installCpuScreenshotSearch(this.root, this.container)")) {
  throw new Error("药大拾间多平台引导、主题或状态桥结构未生成，停止发布");
}
if (!output.includes("CPU_DESKTOP_PROJECTS_CONFIGURED")) {
  throw new Error("OCS 内部调试面板尚未从用户界面隔离，停止发布");
}
if (!output.includes('alignItems: "center", width: "100%"') || !output.includes(".user-guide { display: none !important; }")) {
  throw new Error("OCS 精简标题栏或无关入口过滤未生成，停止发布");
}
if (!output.includes("GM_cpuPageAction(data)") || output.includes("http://localhost:15319/get-actions-key") || output.includes("docs.ocsjs.com/docs/script-helper")) {
  throw new Error("OCS 桌面桥仍未完全内置，停止发布");
}
if (matches.some((rule) => /(?:chaoxing\.com|nbdlib\.cn|hnsyu\.net|gdhkmooc\.com)/.test(rule))) {
  throw new Error("OCS 仍会接管学习通域名，停止发布");
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, output, "utf8");
console.log(`已生成 ${path.relative(process.cwd(), OUTPUT)} (${Buffer.byteLength(output, "utf8")} bytes)`);
