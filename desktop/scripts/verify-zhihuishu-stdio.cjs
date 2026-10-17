const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function verify(executable) {
  const text = "药理学 · 第一章 绪论 · 正在读取课程 · 未作答、未提交 · 🎓";
  for (const encoding of ["gb18030", "cp1252", "utf-8"]) {
    const result = spawnSync(executable, ["--check-stdio"], {
      input: Buffer.from(JSON.stringify({ text }) + "\n", "utf8"),
      env: { ...process.env, PYTHONIOENCODING: encoding, PYTHONUTF8: "0", LANG: "C" },
      timeout: 45000, windowsHide: true,
    });
    assert.equal(result.status, 0, `Worker stdio check failed (${encoding})`);
    const output = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
    assert.deepEqual(JSON.parse(output), { type: "stdio-check", text });
  }
  console.log("Packaged worker: Chinese course/chapter/status and emoji round-trip passed");
}
module.exports = verify;
if (require.main === module) verify(process.argv[2]);
