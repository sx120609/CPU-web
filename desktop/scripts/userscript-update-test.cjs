#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { mkdtemp } = require("node:fs/promises");
const {
  checkUserScriptUpdate,
  parseUserScriptIdentity,
  readCachedUserScript,
  sha256Text,
  USER_SCRIPT_MANIFEST_PATH,
  USER_SCRIPT_SOURCE_PATH,
  validateUserScriptRelease,
} = require("../dist/electron/userscript-update.js");

const scriptPath = path.join(__dirname, "..", "assets", "userscripts", "monkey.js");

async function main() {
  const source = await readFile(scriptPath, "utf8");
  const identity = parseUserScriptIdentity(source);
  const manifest = {
    ...identity,
    sha256: sha256Text(source),
    size: Buffer.byteLength(source, "utf8"),
    sourceUrl: USER_SCRIPT_SOURCE_PATH,
  };
  assert.deepEqual(identity, { name: "药大拾间·学习通助手", version: "2.2.8" });
  assert.match(source, /章节、作业或考试/, "个人中心与课程引导应覆盖章节、作业和考试入口");
  assert.match(source, /customClass:\s*"cpu-learning-guide"/, "学习通引导应使用独立高层级样式");
  assert.match(source, /offset:\s*96/, "学习通引导应避开超星顶部导航");
  assert.match(source, /AI 答题额度已用完/, "额度耗尽时应向用户显示明确提示");
  assert.match(source, /助手已停止继续请求/, "额度耗尽后应停止当前页面继续请求");
  assert.match(source, /response\.status === 429/, "异常频率限制应提供独立处理");
  assert.match(source, /cpu-learning-assistant-panel/, "页面内应使用统一的助手工作台");
  assert.match(source, /data-action="toggle-runtime"/, "统一工作台应提供开始和暂停控制");
  assert.match(source, /章节测验答完自动提交/, "页面内应提供章节测验提交开关");
  assert.match(source, /data-action="copy-answer"/, "统一工作台应支持复制当前答案");
  assert.match(source, /data-action="locate"/, "统一工作台应支持定位原题");
  assert.match(source, /cpu-learning-assistant-position-v1/, "统一工作台应支持拖动并记住位置");
  assert.match(source, /task\.activity \|\| null/, "媒体与文档任务状态应进入统一工作台快照");
  assert.match(source, /解题思路/, "AI 答题应提供可折叠的公开解题说明");
  assert.match(source, /data\.learning_answer/, "AI 答题应优先读取服务端规范化的答案与解题思路");
  assert.match(source, /displayAnswer:\s*`\$\{answerLetter\}\. \$\{optionText\}`/, "单选题应同时显示选项字母和选项内容");
  assert.match(source, /waitUntilRunning/, "暂停状态应阻止继续处理下一项任务");
  assert.match(source, /formatLearningDisplayText/, "题目和答案展示前应清理 HTML 并恢复上下标");
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

    const olderSource = source.replace("// @version      2.2.8", "// @version      2.1.9");
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
    assert.equal(cached?.manifest.version, "2.2.8");
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
