#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets", "userscripts", "multiplatform.js"), "utf8");
const main = fs.readFileSync(path.join(root, "electron", "main.ts"), "utf8");
const config = fs.readFileSync(path.join(root, "electron", "config.ts"), "utf8");
const learningPreload = fs.readFileSync(path.join(root, "electron", "learning-preload.ts"), "utf8");
const credentialStore = fs.readFileSync(path.join(root, "electron", "chaoxing-credentials.ts"), "utf8");
const shellHtml = fs.readFileSync(path.join(root, "src", "shell", "index.html"), "utf8");
const shellRenderer = fs.readFileSync(path.join(root, "src", "shell", "renderer.js"), "utf8");
const sitePreload = fs.readFileSync(path.join(root, "electron", "site-preload.ts"), "utf8");
const shellPreload = fs.readFileSync(path.join(root, "electron", "shell-preload.ts"), "utf8");
const tabs = fs.readFileSync(path.join(root, "electron", "tabs.ts"), "utf8");
const updater = fs.readFileSync(path.join(root, "electron", "userscript-update.ts"), "utf8");
const pageActions = fs.readFileSync(path.join(root, "electron", "page-actions.ts"), "utf8");

const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)?.[1] || "";
assert.match(header, /@name\s+药大拾间·全平台网课助手/);
assert.match(header, /@version\s+4\.15\.8/);
assert.match(header, /@connect\s+desktop\.localhost/);
const connects = [...header.matchAll(/^\s*\/\/\s*@connect\s+(.+?)\s*$/gm)].map((match) => match[1]);
assert.deepEqual(connects, ["desktop.localhost"], "不得保留外部题库联网权限");
assert.doesNotMatch(header, /\*\.(?:edu|org)\.cn/, "不得恢复教育网泛域名权限");
assert.doesNotMatch(header, /\*\.(?:chaoxing\.com|nbdlib\.cn|hnsyu\.net|gdhkmooc\.com)/, "学习通及其专用镜像只能由原有定制助手接管");

for (const project of ["ZHSProject", "CXProject", "IcveMoocProject", "ZJYProject", "ICourseProject", "YKTProject"]) {
  assert.match(source, new RegExp(`\\b${project}\\b`), `缺少 OCS 平台项目 ${project}`);
}
assert.match(source, /药大拾间桌面端关闭后台节流/, "桌面端不应显示浏览器前台运行警告");
assert.doesNotMatch(source, /禁止最小化浏览器、切屏/, "不得保留与桌面后台能力冲突的提示");
assert.match(source, /CPU_DESKTOP_STYLE/, "多平台助手应使用药大拾间统一工作台主题");
assert.match(source, /药大拾间·全平台网课助手已加载/, "通用引导应说明进入课程、章节、作业和考试的路径");
assert.match(source, /助手已识别智慧树/, "智慧树首页应提供平台专属进入课程引导");
assert.match(source, /所有支持平台均可点击面板顶部的截图按钮手动搜题/, "所有支持平台都应提供统一截图搜题入口");
assert.match(source, /installCpuScreenshotSearch\(this\.root, this\.container\)/, "截图搜题应挂载到 OCS 封闭工作台");
assert.match(source, /GM_cpuCaptureArea\(rect\)/, "多平台截图搜题必须调用宿主原图截取能力");
assert.match(source, /cpu-ocs-capture-host/, "截图框选层必须脱离可拖动的 OCS 面板坐标系");
assert.match(source, /document\.documentElement\.append\(captureHost\)/, "截图框选层必须挂载到页面视口根节点");
assert.match(source, /viewportWidth: window\.innerWidth/, "截图请求必须携带 CSS 视口宽度用于 DPI 换算");
assert.doesNotMatch(source, /root\.append\(overlay\)/, "截图框选层不得继续挂到发生位移的助手 ShadowRoot");
assert.match(source, /type: "input_image", image_url: imageUrl, detail: "high"/, "截图应以高细节原图提交给 AI");
assert.match(source, /cpu-ocs-shot-workbench/, "截图结果应在多平台统一工作台内部显示");
assert.doesNotMatch(source, /cpu-ocs-shot-result/, "不得恢复独立截图结果弹窗");
assert.match(source, /container\.body\.append\(panel\)/, "截图结果必须复用当前 OCS 工作台主体");
assert.match(source, /alignItems: "center", width: "100%"/, "多平台助手标题栏应使用精简模式，不展示 OCS 脚本选择器");
assert.match(source, /\^\(common\|background\)\\\./, "默认面板必须排除 OCS 的通用与后台内部模块");
assert.match(source, /GM_cpuPageAction\(data\)/, "OCS 页面动作必须走客户端内置桥接");
assert.doesNotMatch(source, /localhost:15319\/get-actions-key/, "不得要求用户另装 OCS 桌面助手");
assert.doesNotMatch(source, /docs\.ocsjs\.com\/docs\/script-helper/, "不得引导用户安装外部 OCS 组件");
assert.match(source, /\.user-guide \{ display: none !important; \}/, "不得展示 OCS 官网、交流群或关闭教程等无关入口");
assert.match(source, /严禁商业用途/, "多平台助手应明确禁止商业用途");
assert.match(source, /多平台助手已暂停/, "开始、暂停和继续状态应回传客户端统一状态区");
assert.match(source, /className = "cpu-assistant-run"/, "统一标题栏必须提供开始、暂停与继续按钮");
assert.match(source, /开始答题\|暂停\|继续/, "标题栏运行按钮必须代理 OCS 的实际任务控制");
assert.match(source, /let selectedTab = "task"/, "选项卡状态必须由统一工作台自己控制");
assert.match(source, /cpu-assistant-settings-workbench/, "设置页必须使用精简的客户端统一设置说明");
assert.match(source, /data-cpu-config="aiEnabled"/, "AI 解答必须可在统一设置中直接调整");
assert.match(source, /data-cpu-config="autoSubmit"/, "章节测验提交方式必须可在统一设置中直接调整");
assert.match(source, /GM_setValue\("config", next\)/, "统一设置必须回写客户端脚本配置");
assert.doesNotMatch(source, /data-cpu-assistant-tab="logs"/, "不得再显示独立的运行日志选项卡");
assert.doesNotMatch(source, /else if \(tab === "settings"\) await bridge\.openPanel\("common\.settings"\)/, "设置选项卡不得再打开 OCS 原始设置面板");
for (const host of ["zhihuishu.com", "icve.com.cn", "icourse163.org", "yuketang.cn"]) {
  assert.match(header, new RegExp(host.replaceAll(".", "\\.")), `缺少 ${host} 的脚本匹配`);
  assert.match(config, new RegExp(`"${host.replaceAll(".", "\\.")}"`), `宿主未放行 ${host}`);
}

assert.match(main, /builtin-multiplatform-helper/);
assert.match(main, /verifyWisdomTreeGuideContent/, "智慧树课程列表首屏空白时应只自动恢复一次");
assert.match(main, /recoverLearningAssistantAfterSpaNavigation/, "智慧树 SPA 进入任务页时应重建助手实例");
assert.match(main, /matching\.some\(\(script\) => script\.id === "builtin-chaoxing-helper"\)/, "超星必须避免双引擎并跑");
assert.match(main, /https:\/\/desktop\.localhost\/ocs-ai/);
assert.match(main, /bridge\.requestAi/);
assert.match(main, /fullImage\.getSize\(\)/, "宿主必须依据截图实际像素尺寸换算 CSS 指针坐标");
assert.match(main, /const scaleX = fullSize\.width \/ viewportWidth/, "宿主必须处理 Windows DPI 和页面缩放");
assert.match(main, /userscript:page-action/);
assert.match(main, /learningPageActions\.perform/);
assert.match(main, /common\.settings\.upload/);
assert.match(main, /config\["autoSubmit"\] === true \? "100" : "save"/, "关闭提交时必须暂存答案");
assert.match(main, /"globalThis", definition\.source/, "OCS 应在隔离代理里读取 GM 全局能力");
assert.match(main, /Object\.prototype\.hasOwnProperty\.call\(gm, property\)/, "GM 全局兼容不得把特权接口挂到真实页面 window");
assert.match(main, /definition\.name \+ " v" \+ definition\.version \+ " 已加载/, "注入完成后应向客户端回报可见状态");
assert.match(updater, /MULTIPLATFORM_USER_SCRIPT_CHANNEL/);
assert.match(updater, /multiplatform-helper-cache\.json/);
assert.match(shellPreload, /script:get-update-states/);
assert.match(shellHtml, /id="multiplatform-script-version"/);
assert.match(shellHtml, /id="multiplatform-script-check-update"/);
assert.match(shellRenderer, /checkUpdate\(kind\)/);
assert.doesNotMatch(shellRenderer, /OCS v4\.15\.3 随客户端更新/, "OCS 不得再跟随客户端版本更新");

assert.match(tabs, /webContents\.setAudioMuted\(true\)/, "网课标签应默认静音作为宿主层兜底");
assert.match(tabs, /setMuted\(id: string, muted: boolean\)/, "用户应能按标签恢复或关闭声音");
assert.match(tabs, /url === "about:blank"/, "智慧树先开空白子窗口的导航必须保留");
assert.match(tabs, /createWindow: \(options\) => this\.createLearningPopupBridge/, "网课弹窗必须通过合法的中转窗口融合为应用内标签");
assert.match(tabs, /show: false[\s\S]*skipTaskbar: true/, "中转窗口不得显示为独立弹窗");
assert.match(tabs, /this\.openLearningTab\(candidate/, "捕获到真实课程地址后必须打开客户端标签");
assert.match(shellRenderer, /shell\.tabs\.setMuted\(tab\.id, !tab\.muted\)/, "标签栏静音按钮应调用宿主音频控制");

assert.match(shellHtml, /id="platform-dialog"/);
assert.match(shellRenderer, /shell\.tabs\.openLearning\(platform\.id\)/);
const platformOpenHandler = shellRenderer.match(/open\.addEventListener\("click", async \(\) => \{[\s\S]*?\n\s*\}\);/)?.[0] ?? "";
assert.ok(platformOpenHandler, "应找到网课平台打开事件");
assert.ok(
  platformOpenHandler.indexOf("dialog.close()") < platformOpenHandler.indexOf("shell.tabs.openLearning(platform.id)"),
  "打开平台前必须先关闭原生弹窗遮罩，避免进入页面后整窗持续模糊",
);
assert.match(sitePreload, /openLearning: \(platformId\?: string\)/);
assert.match(shellRenderer, /shell\.learningCredentials\.setRemember/);
assert.match(credentialStore, /safeStorage\.encryptString/);
assert.match(credentialStore, /learning-login-\$\{platformId\}\.bin/);
assert.match(learningPreload, /learning-credentials:context/);
assert.match(learningPreload, /learning-credentials:offer/);
assert.match(learningPreload, /userscript:page-action/);
assert.match(pageActions, /Network\.enable/);
assert.match(pageActions, /Network\.getResponseBody/);
assert.match(pageActions, /waitForResponse/);
assert.match(pageActions, /executeJavaScript\(selectorScript/);
assert.match(learningPreload, /MutationObserver/, "动态登录弹窗出现后也应识别密码框");

console.log("多平台助手检查通过：六个平台、CPU AI、统一截图搜题、提交保护、平台入口与加密凭据均已覆盖。");
