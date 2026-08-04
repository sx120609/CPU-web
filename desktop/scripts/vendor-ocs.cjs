const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_VERSION = "4.15.3";
const EXPECTED_COMMIT = "890686a5e54f9a6d52d1169bae9ea5971e0863c7";
const OUTPUT = path.join(__dirname, "..", "assets", "userscripts", "multiplatform.js");

const input = process.argv[2];
if (!input) {
  throw new Error("用法: node scripts/vendor-ocs.cjs <上游 dist/ocs.user.js>");
}

const source = fs.readFileSync(path.resolve(input), "utf8");
const headerMatch = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
if (!headerMatch) throw new Error("输入文件不是有效的 OCS UserScript");
if (!new RegExp(`^\\s*//\\s*@version\\s+${EXPECTED_VERSION.replace(/\./g, "\\.")}\\s*$`, "m").test(source)) {
  throw new Error(`只允许整合已审核的 OCS ${EXPECTED_VERSION}`);
}

const matches = [...headerMatch[1].matchAll(/^\s*\/\/\s*@match\s+(.+?)\s*$/gm)]
  .map((match) => match[1].trim())
  .filter((rule) => !/^\*:\/\/\*\.(?:edu|org)\.cn\/\*$/.test(rule))
  .map((rule) => rule.replace(/^\*:\/\//, "https://"));

const metadata = [
  "// ==UserScript==",
  "// @name         药大拾间·全平台网课助手",
  "// @namespace    cn.lizmt.cpuweb.ocs",
  `// @version      ${EXPECTED_VERSION}`,
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
  "// @grant        GM_cpuReport",
  "// @run-at       document-start",
  "//",
  `// OCS ${EXPECTED_VERSION}, commit ${EXPECTED_COMMIT}, Copyright (c) 2022 enncy, MIT License.`,
  "// 药大拾间移除了 OCS 外部题库连接权限；题面只经桌面宿主发往本站独立答题 AI。",
  "// ==/UserScript==",
].join("\n");

let output = source.replace(headerMatch[0], metadata);
output = output
  .replace("title: `OCS-${infos.script.version}`", "title: '药大拾间·全平台网课助手'")
  .replace("updatePage: 'https://docs.ocsjs.com/docs/update'", "updatePage: 'https://cpu.lizmt.cn/download'")
  .replace("⚠️ 禁止最小化浏览器、切屏，否则可能导致脚本无法运行！", "桌面客户端已启用后台运行，最小化或切换桌面不会主动暂停任务。")
  .replace(
    'if (document.visibilityState === "hidden" && !messageElement) {',
    'if (false && !messageElement) { // 药大拾间桌面端关闭后台节流，不显示浏览器前台警告',
  );

if (!output.includes("title: '药大拾间·全平台网课助手'")) {
  throw new Error("OCS 入口结构已变化，停止生成，需人工复核");
}
if (!output.includes("药大拾间桌面端关闭后台节流")) {
  throw new Error("OCS 后台可见性检测结构已变化，停止生成，需人工复核");
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, output, "utf8");
console.log(`已生成 ${path.relative(process.cwd(), OUTPUT)} (${Buffer.byteLength(output, "utf8")} bytes)`);
