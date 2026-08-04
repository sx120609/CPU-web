#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { mkdtemp } = require("node:fs/promises");
const {
  checkUserScriptUpdate,
  compareUserScriptVersions,
  MULTIPLATFORM_USER_SCRIPT_CHANNEL,
  parseUserScriptIdentity,
  readCachedUserScript,
  selectPreferredUserScriptSource,
  sha256Text,
  USER_SCRIPT_MANIFEST_PATH,
  USER_SCRIPT_SOURCE_PATH,
  validateUserScriptRelease,
} = require("../dist/electron/userscript-update.js");

const scriptPath = path.join(__dirname, "..", "assets", "userscripts", "monkey.js");

async function main() {
  const source = await readFile(scriptPath, "utf8");
  const tabsSource = await readFile(path.join(__dirname, "..", "electron", "tabs.ts"), "utf8");
  const identity = parseUserScriptIdentity(source);
  const manifest = {
    ...identity,
    sha256: sha256Text(source),
    size: Buffer.byteLength(source, "utf8"),
    sourceUrl: USER_SCRIPT_SOURCE_PATH,
  };
  assert.deepEqual(identity, { name: "药大拾间·学习通助手", version: "2.2.14" });
  assert.match(source, /章节、作业或考试/, "个人中心与课程引导应覆盖章节、作业和考试入口");
  assert.match(source, /customClass:\s*"cpu-learning-guide"/, "学习通引导应使用独立高层级样式");
  assert.match(source, /offset:\s*96/, "学习通引导应避开超星顶部导航");
  assert.match(source, /AI 答题额度已用完/, "额度耗尽时应向用户显示明确提示");
  assert.match(source, /助手已停止继续请求/, "额度耗尽后应停止当前页面继续请求");
  assert.match(source, /response\.status === 429/, "异常频率限制应提供独立处理");
  assert.match(source, /cpu-learning-assistant-panel/, "页面内应使用统一的助手工作台");
  assert.match(source, /data-action="toggle-runtime"/, "统一工作台应提供开始和暂停控制");
  assert.match(source, /章节测验答完自动提交/, "页面内应提供章节测验提交开关");
  assert.match(source, /if \(succ < ques\.length\)/, "章节测验只有全部题目获得答案后才能自动提交");
  assert.doesNotMatch(source, /succ \/ ques\.length < submitConfig\.minAccuracy/, "不得再把答案覆盖率称为正确率");
  assert.doesNotMatch(source, /正确率:/, "助手运行状态不得再展示伪正确率");
  const manualSubmitBranch = source.match(/if \(!submitConfig\.autoSubmit\) \{([\s\S]*?)return void resolve\(\);/)?.[1] ?? "";
  assert.match(manualSubmitBranch, /iframeWindow\.noSubmit\(\)/, "关闭自动提交时也必须点击学习通的暂时保存");
  assert.match(manualSubmitBranch, /答案已暂时保存/, "关闭自动提交时应明确告知用户已经暂存");
  assert.match(source, /data-action="copy-answer"/, "统一工作台应支持复制当前答案");
  assert.match(source, /data-action="locate"/, "统一工作台应支持定位原题");
  assert.match(source, /cpu-learning-assistant-position-v1/, "统一工作台应支持拖动并记住位置");
  assert.match(source, /task\.activity \|\| null/, "媒体与文档任务状态应进入统一工作台快照");
  assert.match(source, /解题思路/, "AI 答题应提供公开解题说明");
  assert.doesNotMatch(source, /<details class="cpu-la-(?:sources|reasoning)/, "答案来源与解题思路不应默认折叠");
  assert.match(source, /data-action="screenshot-search"/, "暂停时也应提供独立截图搜题入口");
  assert.match(source, /\.cpu-la-run, #\$\{panelId\} \.cpu-la-shot, #\$\{panelId\} \.cpu-la-icon \{[^}]*border: 1px solid var\(--cpu-la-border\);[^}]*background: var\(--cpu-la-card\)/, "截图、运行与关闭按钮应使用统一尺寸、边框和底色");
  assert.doesNotMatch(source, /\.cpu-la-run \{ border: 0;/, "运行按钮不应再单独使用无边框强调块");
  assert.match(source, /GM_cpuCaptureArea/, "截图搜题应通过受控桌面桥接获取画面");
  assert.match(source, /快速判断.*深入分析.*挑战难题/, "统一设置应提供三档答题模式");
  assert.match(source, /reasoningEffort/, "自动答题与截图搜题应把答题模式传给服务端");
  assert.match(source, /config\.answerModes/, "三档点数倍率应由服务端规则下发而非写死");
  assert.match(source, /data\.learning_answer/, "AI 答题应优先读取服务端规范化的答案与解题思路");
  assert.match(source, /只返回 JSON/, "AI 答题应使用 JSON 区分可提交答案与解题说明");
  assert.match(source, /候选项：\$\{allOptionsText\}/, "填空等非选择题存在图片候选项时也必须随题发送");
  assert.match(source, /parsedReply\.answer;/, "自动填写只能消费结构化答案字段");
  assert.doesNotMatch(source, /parsedReply\.answer \|\| content/, "模型原始回复不得兜底写入答案框");
  assert.match(source, /解题思路\|说明\|原因/, "写入页面前应再次拒绝说明字段");
  assert.match(source, /displayAnswer:\s*`\$\{answerLetter\}\. \$\{optionText\}`/, "单选题应同时显示选项字母和选项内容");
  assert.match(source, /waitUntilRunning/, "暂停状态应阻止继续处理下一项任务");
  assert.match(source, /renderLearningMarkdown/, "题目、答案和解题思路应统一渲染 Markdown 与公式");
  assert.match(source, /cpu-la-inline-image/, "图片题应在助手中显示并支持查看原图");
  assert.match(source, /navigationGeneration/, "切换章节时应终止旧章节任务并扫描新章节");
  assert.match(source, /taskCurrent/, "媒体与答题任务应在异步步骤后确认仍属于当前章节");
  assert.match(source, /isLearningNonAnswerFeedback/, "填空与简答题不得把模型内部状态说明写入答案框");
  assert.match(source, /题面缺失状态说明，已拦截且不会写入答案框/, "被拦截的非答案内容应留下可排查日志");
  assert.match(tabsSource, /backgroundThrottling:\s*kind !== "learning"/, "学习通标签页在窗口最小化或切换桌面后不应被 Chromium 暂停");
  assert.doesNotMatch(source, /切记填写完要刷新页面才会生效/, "不应继续显示旧版付费秘钥提示");
  assert.doesNotMatch(source, /题库秘钥配置请点击这个按钮|label:\s*"公告"|label:\s*"运行框"/, "旧配置提示、公告页和运行框不应残留");
  assert.doesNotMatch(source, /cpu-la-footer/, "章节测验提交开关不应残留在窗口底部");
  assert.doesNotThrow(() => validateUserScriptRelease(source, manifest));
  assert.throws(
    () => validateUserScriptRelease(`${source}\n// tampered`, manifest),
    /大小校验失败|SHA-256 校验失败/,
  );

  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "cpu-userscript-test-"));
  try {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(String(url));
      if (new URL(url).pathname === USER_SCRIPT_MANIFEST_PATH) {
        return new Response(JSON.stringify({ code: 0, data: manifest, message: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (new URL(url).pathname === USER_SCRIPT_SOURCE_PATH) {
        return new Response(source, {
          status: 200,
          headers: {
            "content-type": "application/javascript",
            "content-length": String(manifest.size),
          },
        });
      }
      return new Response("", { status: 404 });
    };

    const olderSource = source.replace("// @version      2.2.14", "// @version      2.1.9");
    const updated = await checkUserScriptUpdate({
      origin: "https://cpu.lizmt.cn",
      cacheDirectory,
      currentSource: olderSource,
      validateSource: () => undefined,
      fetchImpl,
    });
    assert.equal(updated.status, "updated");
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1]).searchParams.get("sha256"), manifest.sha256, "正文请求应使用发布哈希隔离缓存");

    const cached = await readCachedUserScript(cacheDirectory, () => undefined);
    assert.equal(cached?.manifest.version, "2.2.14");
    assert.equal(cached?.source, source);

    requests.length = 0;
    const current = await checkUserScriptUpdate({
      origin: "https://cpu.lizmt.cn",
      cacheDirectory,
      currentSource: source,
      validateSource: () => undefined,
      fetchImpl,
    });
    assert.equal(current.status, "current");
    assert.equal(requests.length, 1, "脚本未变化时不应重复下载正文");
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }

  console.log("学习通助手脚本热更新：版本、哈希、缓存与免重复下载检查通过。");

  const multiplatformSource = await readFile(
    path.join(__dirname, "..", "assets", "userscripts", "multiplatform.js"),
    "utf8",
  );
  const multiplatformIdentity = parseUserScriptIdentity(multiplatformSource);
  const multiplatformManifest = {
    ...multiplatformIdentity,
    sha256: sha256Text(multiplatformSource),
    size: Buffer.byteLength(multiplatformSource, "utf8"),
    sourceUrl: MULTIPLATFORM_USER_SCRIPT_CHANNEL.sourcePath,
  };
  assert.equal(compareUserScriptVersions("4.15.4", "4.15.3"), 1);
  assert.equal(compareUserScriptVersions("4.15.4", "4.15.4"), 0);
  assert.equal(compareUserScriptVersions("4.15.4-beta.2", "4.15.4-beta.1"), 1);
  assert.equal(compareUserScriptVersions("4.15.4", "4.15.4-beta.2"), 1);
  assert.deepEqual(multiplatformIdentity, { name: "药大拾间·全平台网课助手", version: "4.15.7" });
  assert.doesNotThrow(() => validateUserScriptRelease(
    multiplatformSource,
    multiplatformManifest,
    MULTIPLATFORM_USER_SCRIPT_CHANNEL,
  ));

  const multiplatformCache = await mkdtemp(path.join(tmpdir(), "cpu-ocs-userscript-test-"));
  try {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(String(url));
      if (new URL(url).pathname === MULTIPLATFORM_USER_SCRIPT_CHANNEL.manifestPath) {
        return new Response(JSON.stringify({ code: 0, data: multiplatformManifest, message: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (new URL(url).pathname === MULTIPLATFORM_USER_SCRIPT_CHANNEL.sourcePath) {
        return new Response(multiplatformSource, {
          status: 200,
          headers: { "content-length": String(multiplatformManifest.size) },
        });
      }
      return new Response("", { status: 404 });
    };
    const olderSource = multiplatformSource.replace("// @version      4.15.7", "// @version      4.15.6");
    assert.deepEqual(
      selectPreferredUserScriptSource(multiplatformSource, olderSource),
      { source: multiplatformSource, origin: "builtin" },
      "a newer built-in script must not be downgraded by an older cache",
    );
    const updated = await checkUserScriptUpdate({
      origin: "https://cpu.lizmt.cn",
      cacheDirectory: multiplatformCache,
      currentSource: olderSource,
      validateSource: () => undefined,
      channel: MULTIPLATFORM_USER_SCRIPT_CHANNEL,
      fetchImpl,
    });
    assert.equal(updated.status, "updated");
    assert.equal(requests.length, 2);
    const cached = await readCachedUserScript(
      multiplatformCache,
      () => undefined,
      MULTIPLATFORM_USER_SCRIPT_CHANNEL,
    );
    assert.equal(cached?.manifest.version, "4.15.7");
    assert.equal(cached?.source, multiplatformSource);

    requests.length = 0;
    const staleManifest = {
      ...multiplatformManifest,
      version: "4.15.3",
      sha256: sha256Text(olderSource),
      size: Buffer.byteLength(olderSource, "utf8"),
    };
    const staleFetch = async (url) => {
      requests.push(String(url));
      if (new URL(url).pathname === MULTIPLATFORM_USER_SCRIPT_CHANNEL.manifestPath) {
        return new Response(JSON.stringify({ code: 0, data: staleManifest, message: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(olderSource, { status: 200 });
    };
    const protectedFromDowngrade = await checkUserScriptUpdate({
      origin: "https://cpu.lizmt.cn",
      cacheDirectory: multiplatformCache,
      currentSource: multiplatformSource,
      validateSource: () => undefined,
      channel: MULTIPLATFORM_USER_SCRIPT_CHANNEL,
      fetchImpl: staleFetch,
    });
    assert.equal(protectedFromDowngrade.status, "current");
    assert.equal(protectedFromDowngrade.manifest.version, "4.15.7");
    assert.equal(protectedFromDowngrade.source, multiplatformSource);
    assert.equal(requests.length, 1, "an older cloud script must not be downloaded over a newer client");
  } finally {
    await rm(multiplatformCache, { recursive: true, force: true });
  }
  console.log("多平台 OCS 脚本热更新：独立清单、哈希、大文件上限与缓存检查通过。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
